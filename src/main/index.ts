import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, type OpenDialogOptions } from 'electron';
import { watch, type FSWatcher } from 'chokidar';
import { z } from 'zod';
import type { ActivityEvent, HandoffReceipt, HarnessCapabilities, OverlaySnapshot, SourceFingerprint, TaskPacket } from '../core/types';
import { isReviewWorthyCodexFileChange } from '../core/attention/codexSignals';
import {
  listFrozenPackets,
  readFrozenPacketDetail,
  TaskPacketSchema,
  writeFrozenPacket,
} from './frozenPacketStore';
import {
  defaultOverlaySearchRoot,
  discoverOverlayRoot,
  loadOverlay,
  readMemoryBody,
  watchTargets,
} from './adapters/overlaySource';
import { readGitFacts } from './adapters/gitFacts';
import { createProjectFileContext, fingerprintFileAtRoot, fingerprintProjectFile } from './adapters/projectFiles';
import { CodexAppServerAdapter } from './adapters/codexAppServer';
import { appendActivity, clearActivity, readActivity } from './activityPersistence';
import { dismissAttention, readAttentionLocalState } from './attentionPersistence';
import { HandoffDispatchRegistry } from './handoffDispatch';
import {
  clearWorkbenchDraft,
  readWorkbenchDraft,
  WorkbenchDraftSchema,
  writeWorkbenchDraftAtomic,
} from './draftPersistence';
import { encodeStateKey } from './stateKey';
import {
  readWorkspaceSession,
  WorkspaceSessionSchema,
  writeWorkspaceSessionAtomic,
} from './workspacePersistence';
import { normalizeWindowState, readWindowState, writeWindowStateAtomic } from './windowStatePersistence';
import { defaultHistoryRoots, HistoryService } from './history/historyService';
import { effectiveProjectRoot, readProjectRootBindings, rebindProjectRoot } from './projectRootBindings';
import { applyProfileImportAtomic, exportProfileBundle, readPortableState, writeBundleFileAtomic } from './portabilityPersistence';
import { parseProfileBundle, previewProfileImport, type ProfileImportPreview } from '../core/portability/bundle';
import { projectFileSourceRef } from '../core/project/sourceIdentity';
import { MemoryService } from './memory/memoryService';
import {
  closeIsland,
  moveIslandBy,
  saveIslandPosition,
  setIslandEnabled,
  toggleIslandExpansion,
  updateIslandSnapshot,
} from './island';
import { readMaterialPreference, writeMaterialPreferenceAtomic } from './materialPersistence';
import { detectMaterialCapability } from './materialCapability';
import { ClaudeCodeAdapter } from './adapters/claudeCodeAdapter';
import { DeepSeekAdapter } from './adapters/deepseekAdapter';
import { LiveExecutionRegistry } from './liveExecutions';
import { handleCancelRequest, handleRuntimeLiveRequest } from './harnessControl';
import { RuntimeContextRegistry } from './runtimeContextRegistry';
import { HarnessDispatchSchema, HarnessSmokeSchema, workbenchRejectedReceipt } from './harnessRequest';
import { canDispatchToHarness } from '../core/project/harnessSelection';

// test hook: Playwright E2E redirects Workbench-owned state to a temp dir
if (process.env.WB_STATE_DIR) app.setPath('userData', process.env.WB_STATE_DIR);

const codexAdapter = new CodexAppServerAdapter();
const claudeAdapter = new ClaudeCodeAdapter();
const deepseekAdapter = new DeepSeekAdapter();
const handoffRequests = new HandoffDispatchRegistry<HandoffReceipt>();
const windowRoles = new WeakMap<BrowserWindow, { role: 'main' | 'island' }>();

/** Workbench-owned state: frozen packets live here, never in the overlay. */
function stateDir(): string {
  return join(app.getPath('userData'), 'state');
}

const KeySchema = z.string().min(1).max(1024);

function emptySnapshot(message: string): OverlaySnapshot {
  return {
    overlayRoot: '',
    foundAt: new Date().toISOString(),
    conversations: [],
    projects: [],
    inbox: [],
    memoryIndex: [],
    harness: [],
    sourceFingerprints: [],
    problems: [{ source: 'overlay-discovery', message }],
  };
}

function registerIpc(): { refresh: () => Promise<OverlaySnapshot> } {
  let cache: { snapshot: OverlaySnapshot; at: number } | null = null;
  let refreshing: Promise<OverlaySnapshot> | null = null;
  let activityWrite: Promise<void> = Promise.resolve();
  const liveExecutions = new LiveExecutionRegistry();
  const runtimeContexts = new RuntimeContextRegistry<{
    projectId: string;
    conversationKey: string;
    machine: string;
    cwd: string;
    intentId?: string;
  }>();
  const pendingClaudeContexts = new Map<string, {
    projectId: string;
    conversationKey: string;
    machine: string;
    cwd: string;
  }>();
  const reviewWorthyTurns = new Set<string>();
  const history = new HistoryService({ stateDir: stateDir(), roots: defaultHistoryRoots() });
  const memory = new MemoryService(stateDir(), history);
  const pendingProfileImports = new Map<string, { raw: string; preview: ProfileImportPreview }>();
  const pendingProfileExports = new Map<string, string>();
  let profileStateOperation: Promise<void> = Promise.resolve();
  const withProfileStateLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = profileStateOperation.then(operation, operation);
    profileStateOperation = result.then(() => undefined, () => undefined);
    return result;
  };

  const projectRoot = async (snapshot: OverlaySnapshot, projectId: string): Promise<string | undefined> =>
    withProfileStateLock(() => effectiveProjectRoot(stateDir(), projectId, snapshot.machine?.projectRoots));

  const profileImportPreview = async (bundle: ReturnType<typeof parseProfileBundle>): Promise<ProfileImportPreview> => {
    const snap = cache?.snapshot;
    if (!snap) throw new Error('workspace projection changed; reload and preview again');
    const local = await readProjectRootBindings(stateDir());
    const currentBindings = { ...(snap.machine?.projectRoots ?? {}) };
    for (const [projectId, binding] of Object.entries(local.bindings)) currentBindings[projectId] = binding.root;
    const knownProjectIds = [...new Set([
      ...snap.projects.map((item) => item.projectId),
      ...snap.conversations.map((item) => item.project),
      ...Object.keys(snap.machine?.projectRoots ?? {}),
      ...Object.keys(local.bindings),
    ])];
    const existingLocators = new Set(bundle.profile.projectBindings
      .map((item) => item.locator.value).filter((locator) => existsSync(locator)));
    const portable = await readPortableState(stateDir());
    const currentDraftKeys = new Set(portable.drafts.map((draft) => `${draft.scope.projectId}\0${draft.scope.conversationKey}`));
    return previewProfileImport(bundle, {
      knownProjectIds, currentBindings, existingLocators, currentDraftKeys,
      hasWorkspaceSession: portable.workspaceSession !== null,
    });
  };

  const recordActivity = (event: ActivityEvent): Promise<void> => {
    activityWrite = activityWrite.then(async () => {
      await appendActivity(stateDir(), event);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('activity:changed', event);
      }
    });
    return activityWrite;
  };

  const observed = (sourceRef: string, verification: 'VERIFIED' | 'OBSERVED' = 'VERIFIED') => ({
    source: 'protocol' as const,
    sourceRef,
    observedAt: new Date().toISOString(),
    verification,
  });

  codexAdapter.onEvent((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined;
    if (!threadId) return;
    const context = runtimeContexts.get('codex', threadId);
    if (!context) return;
    const turn = params?.turn as Record<string, unknown> | undefined;
    const item = params?.item as Record<string, unknown> | undefined;
    const turnId = typeof turn?.id === 'string'
      ? turn.id
      : typeof params?.turnId === 'string' ? params.turnId : undefined;
    const base = {
      id: randomUUID(),
      projectId: context.projectId,
      conversationKey: context.conversationKey,
      harness: 'codex' as const,
      adapter: 'codex-app-server',
      capability: 'observe' as const,
      runtimeRef: threadId,
      turnRef: turnId,
      observed: observed(`codex-app-server:${event.method}`),
    };
    if (event.method === 'adapter/error') {
      liveExecutions.remove('codex', threadId);
      const message = typeof params?.message === 'string' ? params.message : 'Codex app-server stopped';
      void recordActivity({
        ...base, id: randomUUID(), kind: 'harness-error', runtimeState: 'error',
        summary: message, attentionKey: `runtime:${threadId}`,
        observed: {
          source: 'process', sourceRef: `codex-app-server-process:${threadId}`,
          observedAt: new Date().toISOString(), verification: 'OBSERVED',
        },
      });
      return;
    }
    const requestId = event.id !== undefined ? String(event.id) : undefined;
    const approvalMethods = new Set([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'applyPatchApproval',
      'execCommandApproval',
    ]);
    if (requestId && approvalMethods.has(event.method)) {
      const reason = typeof params?.reason === 'string' ? `: ${params.reason}` : '';
      void recordActivity({
        ...base, id: randomUUID(), kind: 'approval-required', capability: 'approval',
        summary: `Codex approval required${reason}`,
        attentionKey: `codex-request:${requestId}`, attentionStatus: 'active',
      });
      return;
    }
    if (requestId && (event.method === 'item/tool/requestUserInput' || event.method === 'mcpServer/elicitation/request')) {
      void recordActivity({
        ...base, id: randomUUID(), kind: 'needs-user-input', capability: 'needsInput',
        summary: 'Codex requires user input',
        attentionKey: `codex-request:${requestId}`, attentionStatus: 'active',
      });
      return;
    }
    if (event.method === 'serverRequest/resolved') {
      const resolvedRequestId = typeof params?.requestId === 'string' || typeof params?.requestId === 'number'
        ? String(params.requestId)
        : undefined;
      if (resolvedRequestId) {
        void recordActivity({
          ...base, id: randomUUID(), kind: 'approval-required',
          capability: 'approval',
          summary: 'Codex request resolved', attentionKey: `codex-request:${resolvedRequestId}`,
          attentionStatus: 'resolved',
        });
      }
      return;
    }
    if (event.method === 'turn/started' && turnId) {
      void recordActivity({ ...base, kind: 'turn-started', summary: 'Codex turn started', runtimeState: 'working' });
      return;
    }
    if (event.method === 'turn/completed' && turnId) {
      // Turn completion ends the dispatch's turn; the thread leaves the live set
      // because this adapter starts one thread per dispatch. Receipt/completion
      // stay distinct from runtime state — they are separate projections.
      liveExecutions.remove('codex', threadId);
      const failed = turn?.status === 'failed' || Boolean(turn?.error);
      const reviewKey = `${threadId}:${turnId}`;
      const reviewWorthy = !failed && reviewWorthyTurns.delete(reviewKey);
      void recordActivity({
        ...base,
        kind: failed ? 'turn-error' : 'turn-completed',
        summary: failed ? 'Codex turn failed' : `Codex turn ${String(turn?.status ?? 'completed')}`,
        runtimeState: failed ? 'error' : 'idle',
        attentionKey: reviewWorthy ? `execution-review:${reviewKey}` : undefined,
        attentionKind: reviewWorthy ? 'execution-review' : undefined,
      });
      return;
    }
    if ((event.method === 'item/started' || event.method === 'item/completed') && item) {
      const itemType = typeof item.type === 'string' ? item.type : 'unknown';
      if (itemType === 'agentMessage' && event.method === 'item/completed') {
        void recordActivity({ ...base, kind: 'agent-response', summary: 'Agent response completed' });
      } else if (itemType === 'fileChange') {
        if (isReviewWorthyCodexFileChange(event.method, item) && turnId) {
          reviewWorthyTurns.add(`${threadId}:${turnId}`);
        }
        void recordActivity({ ...base, capability: 'fileEvents', kind: 'file-change', summary: `File change ${event.method === 'item/started' ? 'started' : 'completed'}` });
      } else if (['commandExecution', 'mcpToolCall', 'dynamicToolCall'].includes(itemType)) {
        void recordActivity({
          ...base,
          capability: 'toolEvents',
          kind: event.method === 'item/started' ? 'tool-started' : 'tool-completed',
          summary: `${itemType} ${event.method === 'item/started' ? 'started' : 'completed'}`,
        });
      }
    }
  });

  // Claude live adapter: normalize to same envelope but preserve harness-specific provenance
  claudeAdapter.onEvent((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    const threadId = event.runtimeSessionRef;
    const context = (threadId ? runtimeContexts.get('claude', threadId) : undefined)
      ?? pendingClaudeContexts.get(event.dispatchRef);
    if (!context) return;
    const base = {
      id: randomUUID(),
      projectId: context.projectId,
      conversationKey: context.conversationKey,
      harness: 'claude' as const,
      adapter: 'claude-code-stream-json',
      capability: 'observe' as const,
      runtimeRef: threadId,
      observed: {
        source: 'protocol' as const,
        sourceRef: event.sourceRef,
        observedAt: event.observedAt,
        verification: event.verification,
      },
    };
    if (event.method === 'adapter/error') {
      void recordActivity({
        ...base, id: randomUUID(), kind: 'harness-error', runtimeState: 'error' as const,
        summary: typeof params?.message === 'string' ? params.message as string : 'Claude harness error',
        attentionKey: threadId ? `runtime:claude:${threadId}` : `dispatch:${event.dispatchRef}`,
        observed: { ...base.observed, source: 'process' as const, verification: 'OBSERVED' as const },
      });
      return;
    }
    if (event.method === 'session/started' && threadId) {
      void recordActivity({ ...base, capability: 'externalSessionRef', kind: 'session-started', summary: 'Claude session started', runtimeState: 'unknown' as const, binding: { harness: 'claude', machine: context.machine, cwd: context.cwd, externalSessionRef: threadId } });
      return;
    }
    if (event.method === 'turn/started') {
      void recordActivity({ ...base, kind: 'turn-started', summary: 'Claude turn started', runtimeState: 'working' as const });
      return;
    }
    if (event.method === 'turn/completed') {
      void recordActivity({ ...base, kind: 'turn-completed', summary: 'Claude turn completed', runtimeState: 'idle' as const });
      return;
    }
    if (event.method === 'turn/error') {
      void recordActivity({ ...base, kind: 'turn-error', summary: 'Claude turn failed', runtimeState: 'error' as const, attentionKey: threadId ? `runtime:claude:${threadId}` : `dispatch:${event.dispatchRef}` });
      return;
    }
    if (event.method === 'tool-started' || event.method === 'tool-completed') {
      void recordActivity({ ...base, capability: 'toolEvents', kind: event.method === 'tool-started' ? 'tool-started' as const : 'tool-completed' as const, summary: `Claude tool ${event.method === 'tool-started' ? 'started' : 'completed'}` });
      return;
    }
    if (event.method === 'item/completed') {
      const p = params as { type?: string } | undefined;
      if (p?.type === 'assistant') void recordActivity({ ...base, kind: 'agent-response' as const, summary: 'Claude response completed' });
      return;
    }
  });

  const refreshUnlocked = (): Promise<OverlaySnapshot> => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const { root, candidates } = await discoverOverlayRoot(defaultOverlaySearchRoot());
      if (!root) {
        return emptySnapshot(
          candidates.length === 0
            ? 'no overlay found (set GOV_OVERLAY)'
            : `ambiguous overlays: ${candidates.join(', ')} — refusing to guess`,
        );
      }
      const snapshot = await loadOverlay(root);
      const localRoots = await readProjectRootBindings(stateDir());
      snapshot.workbenchProjectRoots = Object.fromEntries(Object.entries(localRoots.bindings).map(([projectId, binding]) => [projectId, {
        projectId,
        root: binding.root,
        canonicalPath: binding.canonicalPath,
        observed: {
          source: 'process' as const,
          sourceRef: `workbench-userData:portability/project-root-bindings-v1.json#${projectId}`,
          observedAt: binding.verifiedAt,
          verification: 'VERIFIED' as const,
        },
      }]));
      for (const [projectId, binding] of Object.entries(localRoots.bindings)) {
        const project = snapshot.projects.find((item) => item.projectId === projectId);
        if (!project?.canonicalSource?.path) continue;
        try {
          const fingerprint = await fingerprintProjectFile(projectId, binding.root, project.canonicalSource.path);
          const sourceRef = projectFileSourceRef(projectId, project.canonicalSource.path);
          snapshot.sourceFingerprints = snapshot.sourceFingerprints.filter((item) => item.sourceRef !== sourceRef);
          snapshot.sourceFingerprints.push(fingerprint);
        } catch {
          // The verified binding is now unavailable; keep the dependency unresolved rather than falling back to old machine truth.
          const sourceRef = projectFileSourceRef(projectId, project.canonicalSource.path);
          snapshot.sourceFingerprints = snapshot.sourceFingerprints.filter((item) => item.sourceRef !== sourceRef);
        }
      }
      cache = { snapshot, at: Date.now() };
      return snapshot;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };
  const refresh = (): Promise<OverlaySnapshot> => withProfileStateLock(refreshUnlocked);

  ipcMain.handle('overlay:load', async (_e, rawOpts?: unknown) => {
    const opts = z.object({ refresh: z.boolean().optional() }).optional().parse(rawOpts);
    if (cache && !opts?.refresh && Date.now() - cache.at < 5_000) return cache.snapshot;
    return refresh();
  });

  ipcMain.handle('memory:read', (_e, rawMemoryId: unknown) => {
    const memoryId = KeySchema.parse(rawMemoryId);
    const root = cache?.snapshot.overlayRoot;
    return root ? readMemoryBody(root, memoryId) : null;
  });

  ipcMain.handle('git:load', async (_e, rawProjectId: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const snap = cache?.snapshot ?? (await refresh());
    const localRoot = await projectRoot(snap, projectId);
    if (!localRoot) {
      return { error: `no local root binding for project ${projectId}` };
    }
    try {
      return { facts: await readGitFacts(projectId, localRoot) };
    } catch (err) {
      return { error: String(err) };
    }
  });

  const ProjectFileRequestSchema = z.object({
    projectId: KeySchema,
    asReference: z.boolean(),
  });
  ipcMain.handle('project-file:choose', async (event, rawRequest: unknown) => {
    const request = ProjectFileRequestSchema.parse(rawRequest);
    const snap = cache?.snapshot ?? (await refresh());
    const boundRoot = await projectRoot(snap, request.projectId);
    if (!boundRoot) return { error: `no local root binding for project ${request.projectId}` };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: request.asReference ? 'Add Project File Reference' : 'Add Project File Context',
      defaultPath: boundRoot,
      properties: ['openFile'],
    };
    const chosen = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (chosen.canceled || chosen.filePaths.length !== 1) return { canceled: true };
    try {
      return await createProjectFileContext(
        request.projectId,
        boundRoot,
        relative(boundRoot, chosen.filePaths[0]),
        request.asReference,
      );
    } catch (err) {
      return { error: String(err) };
    }
  });

  const RefreshProjectFilesSchema = z.object({
    projectId: KeySchema,
    files: z.array(z.object({ relativePath: z.string(), asReference: z.boolean() })).max(200),
  });
  ipcMain.handle('project-file:refresh', async (_event, rawRequest: unknown) => {
    const request = RefreshProjectFilesSchema.parse(rawRequest);
    const snap = cache?.snapshot ?? (await refresh());
    const boundRoot = await projectRoot(snap, request.projectId);
    if (!boundRoot) return { entries: [], errors: [`no local root binding for project ${request.projectId}`] };
    const entries = [];
    const errors: string[] = [];
    for (const file of request.files) {
      try {
        entries.push(await createProjectFileContext(
          request.projectId,
          boundRoot,
          file.relativePath,
          file.asReference,
        ));
      } catch (err) {
        errors.push(`${file.relativePath}: ${String(err)}`);
      }
    }
    return { entries, errors };
  });

  const SourceRecheckSchema = z.object({
    projectId: KeySchema,
    sourceRefs: z.array(z.string().min(1).max(2048)).max(500),
  });
  ipcMain.handle('sources:recheck', async (_event, rawRequest: unknown) => {
    const request = SourceRecheckSchema.parse(rawRequest);
    const snap = cache?.snapshot ?? (await refresh());
    const boundRoot = await projectRoot(snap, request.projectId);
    const fingerprints: SourceFingerprint[] = [];
    const errors: { sourceRef: string; message: string }[] = [];
    const uniqueRefs = [...new Set(request.sourceRefs)];

    const recheckOne = async (sourceRef: string): Promise<void> => {
      try {
        const projectPrefix = `project-file:${request.projectId}:`;
        if (sourceRef.startsWith(projectPrefix)) {
          if (!boundRoot) throw new Error(`no local root binding for project ${request.projectId}`);
          fingerprints.push(await fingerprintProjectFile(
            request.projectId,
            boundRoot,
            sourceRef.slice(projectPrefix.length),
          ));
        } else if (sourceRef.startsWith('overlay:')) {
          if (!snap.overlayRoot) throw new Error('overlay root is unavailable');
          fingerprints.push(await fingerprintFileAtRoot(
            snap.overlayRoot,
            sourceRef.slice('overlay:'.length),
            sourceRef,
          ));
        } else if (sourceRef.startsWith('history:')) {
          const fingerprint = await history.fingerprint(sourceRef);
          if (!fingerprint) throw new Error('History source is unavailable');
          fingerprints.push(fingerprint);
        } else {
          throw new Error('unsupported source identity');
        }
      } catch (error) {
        errors.push({ sourceRef, message: String(error) });
      }
    };

    const CONCURRENCY = 8;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, uniqueRefs.length) }, async () => {
      while (cursor < uniqueRefs.length) {
        const index = cursor;
        cursor += 1;
        await recheckOne(uniqueRefs[index]);
      }
    });
    await Promise.all(workers);
    return { checkedSourceRefs: [...new Set(request.sourceRefs)], fingerprints, errors };
  });

  const DraftScopeSchema = z.object({ projectId: KeySchema, conversationKey: KeySchema });
  ipcMain.handle('draft:load', (_event, rawScope: unknown) => {
    const scope = DraftScopeSchema.parse(rawScope);
    return withProfileStateLock(() => readWorkbenchDraft(stateDir(), scope.projectId, scope.conversationKey));
  });
  ipcMain.handle('draft:save', async (_event, rawDraft: unknown) => {
    const draft = WorkbenchDraftSchema.parse(rawDraft);
    return withProfileStateLock(async () => ({ path: await writeWorkbenchDraftAtomic(stateDir(), draft) }));
  });
  ipcMain.handle('draft:clear', async (_event, rawScope: unknown) => {
    const scope = DraftScopeSchema.parse(rawScope);
    await withProfileStateLock(() => clearWorkbenchDraft(stateDir(), scope.projectId, scope.conversationKey));
  });

  ipcMain.handle('workspace:load', () => withProfileStateLock(() => readWorkspaceSession(stateDir())));
  ipcMain.handle('workspace:save', async (_event, rawSession: unknown) => {
    const session = WorkspaceSessionSchema.parse(rawSession);
    return withProfileStateLock(async () => ({ path: await writeWorkspaceSessionAtomic(stateDir(), session) }));
  });

  ipcMain.handle('activity:load', async () => {
    await activityWrite;
    return readActivity(stateDir());
  });
  ipcMain.handle('activity:clear', async () => {
    await activityWrite;
    await clearActivity(stateDir());
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('activity:cleared');
    }
  });

  ipcMain.handle('portability:export-preview', async () => {
    if (!cache) await refresh();
    const raw = await withProfileStateLock(async () => {
      const snap = cache!.snapshot;
      const local = await readProjectRootBindings(stateDir());
      const roots = { ...(snap.machine?.projectRoots ?? {}) };
      for (const [projectId, binding] of Object.entries(local.bindings)) roots[projectId] = binding.root;
      return exportProfileBundle(stateDir(), { projectRoots: roots });
    });
    const bundle = parseProfileBundle(raw);
    pendingProfileExports.clear();
    pendingProfileExports.set(bundle.digest, raw);
    return {
      preview: {
        digest: bundle.digest,
        drafts: bundle.profile.drafts.length,
        manualContexts: bundle.profile.drafts.reduce((count, draft) => count + draft.manualContexts.length, 0),
        projectBindings: bundle.profile.projectBindings.length,
        workspaceSession: bundle.profile.workspaceSession !== null,
        included: bundle.manifest.included,
        skipped: bundle.manifest.excluded,
      },
    };
  });

  ipcMain.handle('portability:export-apply', async (event, rawDigest: unknown) => {
    const digest = z.string().regex(/^[0-9a-f]{64}$/).parse(rawDigest);
    const raw = pendingProfileExports.get(digest);
    if (!raw) throw new Error('profile export preview expired; preview again');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showSaveDialog(owner, { title: 'Export Workbench Profile', defaultPath: 'yunmin-workbench-profile-v1.json', filters: [{ name: 'Workbench Profile', extensions: ['json'] }] })
      : await dialog.showSaveDialog({ title: 'Export Workbench Profile', defaultPath: 'yunmin-workbench-profile-v1.json', filters: [{ name: 'Workbench Profile', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeBundleFileAtomic(result.filePath, raw);
    pendingProfileExports.delete(digest);
    return { path: result.filePath };
  });

  ipcMain.handle('portability:bindings', () => withProfileStateLock(() => readProjectRootBindings(stateDir())));

  ipcMain.handle('portability:import-preview', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, { title: 'Preview Workbench Profile Import', properties: ['openFile'], filters: [{ name: 'Workbench Profile', extensions: ['json'] }] })
      : await dialog.showOpenDialog({ title: 'Preview Workbench Profile Import', properties: ['openFile'], filters: [{ name: 'Workbench Profile', extensions: ['json'] }] });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true };
    const raw = await readFile(result.filePaths[0], 'utf8');
    const bundle = parseProfileBundle(raw);
    if (!cache) await refresh();
    const preview = await withProfileStateLock(() => profileImportPreview(bundle));
    pendingProfileImports.clear();
    pendingProfileImports.set(bundle.digest, { raw, preview });
    return { preview };
  });

  ipcMain.handle('portability:import-apply', async (_event, rawDigest: unknown) => {
    const digest = z.string().regex(/^[0-9a-f]{64}$/).parse(rawDigest);
    const pending = pendingProfileImports.get(digest);
    if (!pending) throw new Error('profile import preview expired; preview again');
    if (!pending.preview.canImport) throw new Error('profile import has conflicts; no files were changed');
    const bundle = parseProfileBundle(pending.raw);
    if (!cache) await refresh();
    await withProfileStateLock(async () => {
      const currentPreview = await profileImportPreview(bundle);
      if (JSON.stringify(currentPreview) !== JSON.stringify(pending.preview)) {
        pendingProfileImports.delete(digest);
        throw new Error('Workbench state changed after preview; preview again before importing');
      }
      await applyProfileImportAtomic(stateDir(), bundle, { dryRun: false, bindingStatuses: currentPreview.bindings });
    });
    pendingProfileImports.delete(digest);
    return { imported: true };
  });

  ipcMain.handle('portability:rebind', async (event, rawProjectId: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const snap = cache?.snapshot ?? (await refresh());
    const adapter = snap.projects.find((item) => item.projectId === projectId);
    if (!adapter?.canonicalSource?.path) throw new Error(`project identity is UNKNOWN for ${projectId}; no canonical locator is declared`);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, { title: `Rebind Project Root: ${projectId}`, properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: `Rebind Project Root: ${projectId}`, properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true };
    const canonicalPath = adapter.canonicalSource.path;
    const expectedRemote = adapter.canonicalSource.remote;
    const selectedRoot = result.filePaths[0];
    const bindings = await withProfileStateLock(() => rebindProjectRoot(stateDir(), {
      projectId, expectedProjectId: projectId, selectedRoot, canonicalPath,
      expectedRemote,
    }));
    cache = null;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('overlay:changed');
    }
    return { binding: bindings.bindings[projectId] };
  });
  ipcMain.handle('attention:local:load', () => readAttentionLocalState(stateDir()));
  ipcMain.handle('attention:dismiss', (_event, rawDismissal: unknown) => {
    const dismissal = z.object({
      itemId: z.string().min(1).max(4096),
      observedAt: z.string().datetime(),
    }).parse(rawDismissal);
    return dismissAttention(stateDir(), dismissal.itemId, dismissal.observedAt);
  });

  const HistoryQuerySchema = z.object({
    text: z.string().max(10_000),
    harness: z.enum(['claude-code', 'codex']).optional(),
    cwdContains: z.string().max(4_096).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  });
  ipcMain.handle('history:list', () => history.list());
  ipcMain.handle('history:search', (_event, rawQuery: unknown) => history.search(HistoryQuerySchema.parse(rawQuery)));
  ipcMain.handle('history:detail', (_event, rawSessionId: unknown) => history.detail(KeySchema.parse(rawSessionId)));
  const MemoryQuerySchema = z.object({
    text: z.string().max(10_000), limit: z.number().int().min(1).max(100).optional(), includeInvalid: z.boolean().optional(),
  });
  ipcMain.handle('memory:search', (_event, rawQuery: unknown) => memory.search(MemoryQuerySchema.parse(rawQuery)));
  ipcMain.handle('memory:expand', (_event, rawId: unknown) => memory.expand(KeySchema.parse(rawId)));
  ipcMain.handle('memory:record-use', (_event, rawId: unknown) => memory.recordMemoryUse(KeySchema.parse(rawId)));

  ipcMain.handle('harness:capabilities', async (): Promise<HarnessCapabilities> => {
    try {
      return await codexAdapter.capabilities();
    } catch (error) {
      return {
        harness: 'codex',
        support: {
          dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'NO', needsInput: 'NO',
          toolEvents: 'NO', fileEvents: 'NO', externalSessionRef: 'NO', resume: 'NO',
        },
        canDispatch: false,
        canCreateSession: false,
        canResumeSession: false,
        canObserveRuntime: false,
        canReceiveReceipt: false,
        protocol: 'Codex app-server JSONL v2',
        evidence: `unavailable: ${String(error)}`,
      };
    }
  });
  ipcMain.handle('harness:capabilitiesAll', async () => {
    const [codex, claude, deepseek] = await Promise.all([
      codexAdapter.capabilities(),
      claudeAdapter.capabilities(),
      deepseekAdapter.capabilities(),
    ]);
    return { codex, claude, deepseek } as const;
  });
  ipcMain.handle('harness:dispatch', async (_event, rawRequest: unknown) => {
    const request = HarnessDispatchSchema.parse(rawRequest);
    const harness = request.harness;
    return handoffRequests.run(request.intentId, async () => {
      const snap = cache?.snapshot ?? (await refresh());
      const cwd = await projectRoot(snap, request.projectId);
      if (!cwd) {
        const receipt = workbenchRejectedReceipt(
          request,
          'Workbench machine projectRoots lookup',
          `No project root binding for ${request.projectId}`,
        );
        await recordActivity({
          id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
          harness, adapter: `${harness}-adapter`, capability: 'dispatch',
          kind: 'handoff-failed', summary: receipt.message,
          attentionKey: request.intentId,
          observed: {
            source: 'process', sourceRef: `workbench-intent:${request.intentId}`,
            observedAt: receipt.at, verification: 'VERIFIED',
          },
        });
        return receipt;
      }
      const adapter = harness === 'claude' ? claudeAdapter : harness === 'deepseek' ? deepseekAdapter : codexAdapter;
      const caps = await adapter.capabilities();
      if (!canDispatchToHarness(caps)) {
        const receipt = workbenchRejectedReceipt(
          request,
          caps.evidence,
          `Harness ${harness} dispatch unavailable: ${caps.evidence}`,
        );
        await recordActivity({
          id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
          harness, adapter: `${harness}-adapter`, capability: 'dispatch',
          kind: 'handoff-failed', summary: receipt.message,
          attentionKey: request.intentId,
          observed: {
            source: 'process', sourceRef: `workbench-intent:${request.intentId}`,
            observedAt: receipt.at, verification: 'VERIFIED',
          },
        });
        return receipt;
      }
      await recordActivity({
        id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
        harness, adapter: `${harness}-adapter`, capability: 'dispatch',
        kind: 'handoff-dispatched', summary: `Packet dispatched to ${harness}`,
        attentionKey: request.intentId,
        observed: {
          source: 'process', sourceRef: `workbench-intent:${request.intentId}`,
          observedAt: new Date().toISOString(), verification: 'OBSERVED',
        },
      });
      const machine = snap.machine?.deviceId ?? 'UNKNOWN';
      let receipt: HandoffReceipt;
      try {
        const dispatchText = request.packetText;
        const rememberRuntime = (threadId: string) => {
          runtimeContexts.set(harness, threadId, {
            projectId: request.projectId,
            conversationKey: request.conversationKey,
            machine,
            cwd,
            intentId: request.intentId,
          });
          liveExecutions.add(harness, threadId, new Date().toISOString(), harness === 'claude');
        };
        const onCodexThread = (threadId: string) => {
          rememberRuntime(threadId);
          void recordActivity({
            id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
            harness: 'codex', adapter: 'codex-app-server', capability: 'externalSessionRef',
            kind: 'session-started', summary: `${harness} session created`, runtimeRef: threadId,
            runtimeState: 'unknown',
            binding: {
              harness, machine, cwd, externalSessionRef: threadId,
            },
            observed: observed(`${harness}:${threadId}:session-start`),
          });
        };
        if (harness === 'claude') {
          pendingClaudeContexts.set(request.intentId, { projectId: request.projectId, conversationKey: request.conversationKey, machine, cwd });
          try {
            const claudeReceipt = await (adapter as typeof claudeAdapter).dispatch(request.intentId, cwd, dispatchText, rememberRuntime);
            receipt = claudeReceipt;
            if (claudeReceipt.runtimeRef) liveExecutions.remove('claude', claudeReceipt.runtimeRef);
          } finally {
            pendingClaudeContexts.delete(request.intentId);
          }
        } else if (harness === 'deepseek') {
          receipt = await (adapter as typeof deepseekAdapter).dispatch(request.intentId, cwd, dispatchText);
          // deepseek currently has no thread callback; if it later provides runtimeRef, ensure context
          if (receipt.runtimeRef) {
            runtimeContexts.set('deepseek', receipt.runtimeRef, { projectId: request.projectId, conversationKey: request.conversationKey, machine, cwd });
          }
        } else {
          receipt = await (adapter as typeof codexAdapter).dispatch(request.intentId, cwd, dispatchText, onCodexThread);
        }
      } catch (error) {
        await recordActivity({
          id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
          harness, adapter: `${harness}-adapter`, capability: 'dispatch',
          kind: 'harness-error', summary: `${harness} harness error: ${String(error)}`,
          attentionKey: request.intentId,
          observed: {
            source: 'process', sourceRef: `workbench-intent:${request.intentId}`,
            observedAt: new Date().toISOString(), verification: 'OBSERVED',
          },
        });
        throw error;
      }
      await recordActivity({
        id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
        harness, adapter: `${harness}-adapter`, capability: 'receipt',
        kind: receipt.status === 'ACCEPTED' ? 'handoff-accepted' : 'handoff-failed',
        summary: receipt.status === 'ACCEPTED' ? `${harness} accepted the packet` : `${harness} handoff ${receipt.status.toLowerCase()}`,
        attentionKey: request.intentId,
        runtimeRef: receipt.runtimeRef, turnRef: receipt.turnRef,
        observed: observed(`${harness}:${receipt.protocolEvidence}`),
      });
      return receipt;
    });
  });
  ipcMain.handle('harness:smoke', async (_event, rawProjectId: unknown, rawHarness: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const harness = HarnessSmokeSchema.parse(rawHarness);
    const snap = cache?.snapshot ?? (await refresh());
    const cwd = await projectRoot(snap, projectId);
    if (!cwd) throw new Error(`No project root binding for ${projectId}`);
    const adapter = harness === 'claude' ? claudeAdapter : harness === 'deepseek' ? deepseekAdapter : codexAdapter;
    return adapter.smoke(cwd);
  });

  // Runtime Inspector: which executions currently hold adapter process evidence.
  // Empty after a restart — historical activity never renders as a live runtime.
  ipcMain.handle('runtime:live', (_event, rawRequest?: unknown) =>
    handleRuntimeLiveRequest(rawRequest, liveExecutions));

  ipcMain.handle('harness:cancel', (_event, rawRequest: unknown) => {
    const liveIntents = new Map<string, string>();
    for (const entry of liveExecutions.list()) {
      const context = runtimeContexts.get(entry.harness, entry.externalSessionRef);
      if (context?.intentId) liveIntents.set(entry.executionId, context.intentId);
    }
    // Mirrors adapter reality: only the Claude adapter implements a cancel path
    // today. Codex/DeepSeek return a structured refusal instead of a fake stop.
    return handleCancelRequest(rawRequest, {
      liveIntents,
      cancelableHarnesses: new Set(['claude']),
      cancelByIntent: (intentId) => claudeAdapter.cancel(intentId),
    });
  });

  ipcMain.handle('packet:freeze', async (_e, rawPacket: unknown) => {
    const packet: TaskPacket = TaskPacketSchema.parse(rawPacket);
    return writeFrozenPacket(stateDir(), packet);
  });

  ipcMain.handle('packet:list', async (_e, rawProjectId: unknown, rawConversationId: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const conversationId = KeySchema.parse(rawConversationId);
    return listFrozenPackets(stateDir(), projectId, conversationId);
  });

  const FrozenDetailSchema = z.union([
    z.object({ version: z.number().int().positive() }),
    z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) }),
  ]);
  ipcMain.handle('packet:detail', async (_e, rawProjectId: unknown, rawConversationId: unknown, rawQuery: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const conversationId = KeySchema.parse(rawConversationId);
    const query = FrozenDetailSchema.parse(rawQuery);
    return readFrozenPacketDetail(stateDir(), projectId, conversationId, query);
  });

  ipcMain.handle('clipboard:writeText', (_event, rawText: unknown) => {
    const text = z.string().max(5_000_000).parse(rawText);
    clipboard.writeText(text);
  });

  ipcMain.handle('overlay:watch', () => {
    for (const entry of overlayWatchers) armOverlayWatcher(entry);
  });

  ipcMain.handle('island:enable', async (_event, enabled: unknown) => {
    const parsed = z.boolean().parse(enabled);
    await setIslandEnabled(stateDir(), parsed);
  });

  ipcMain.handle('island:toggle-expansion', async () => {
    return toggleIslandExpansion(stateDir());
  });

  ipcMain.handle('island:save-position', async (_event, raw: unknown) => {
    const parsed = z.object({ x: z.number().int(), y: z.number().int() }).parse(raw);
    await saveIslandPosition(stateDir(), parsed.x, parsed.y);
  });

  ipcMain.on('island:move', (_event, raw: unknown) => {
    const parsed = z.object({ dx: z.number(), dy: z.number() }).parse(raw);
    moveIslandBy(parsed.dx, parsed.dy, stateDir());
  });

  ipcMain.on('island:open-source', (_event, raw: unknown) => {
    const target = z.object({
      projectId: z.string().optional(),
      conversationKey: z.string().optional(),
      sessionRef: z.string().optional(),
      sourceRef: z.string(),
      eventRef: z.string().optional(),
    }).parse(raw);

    const mainWindow = BrowserWindow.getAllWindows().find((w) => windowRoles.get(w)?.role === 'main');
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.focus();
    mainWindow.webContents.send('island:source-selected', target);
  });

  ipcMain.on('island:sync-attention', (_event, rawItems: unknown) => {
    try {
      const items = z.array(
        z.object({
          id: z.string(),
          kind: z.enum([
            'approval-required', 'needs-user-input', 'receipt-failed', 'runtime-error',
            'packet-stale', 'packet-invalid', 'gate-attention', 'execution-review',
          ]),
          level: z.enum(['alert', 'action', 'review']),
          title: z.string(),
          summary: z.string(),
          projectId: z.string().optional(),
          conversationKey: z.string().optional(),
          sessionRef: z.string().optional(),
          sourceRef: z.string(),
          eventRef: z.string().optional(),
          observedAt: z.string(),
          verification: z.enum(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']),
        }),
      ).parse(rawItems);
      void updateIslandSnapshot(stateDir(), items).catch((err) => console.warn('[Island] sync failed', err));
    } catch (err) {
      console.warn('[Island] invalid attention payload', err);
    }
  });

  ipcMain.handle('material:load', async () => {
    const pref = await readMaterialPreference(stateDir());
    return { material: pref.material };
  });
  ipcMain.handle('material:save', async (_event, raw: unknown) => {
    const material = z.enum(['system', 'pure', 'frost', 'glass']).parse(raw);
    await writeMaterialPreferenceAtomic(stateDir(), { schemaVersion: 1, material });
    const updated = { material };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('material:changed', updated);
    }
    return updated;
  });
  ipcMain.handle('material:capability', async () => {
    return detectMaterialCapability();
  });

  return { refresh };
}

interface OverlayWatchEntry {
  win: BrowserWindow;
  getRoot: () => string | undefined;
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout | null;
}

const overlayWatchers = new Set<OverlayWatchEntry>();

function armOverlayWatcher(entry: OverlayWatchEntry): void {
  const root = entry.getRoot();
  if (!root) return;
  entry.watcher?.close();
  entry.watcher = watch(watchTargets(root), { ignoreInitial: true, depth: 1 });
  entry.watcher.on('all', () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!entry.win.isDestroyed()) entry.win.webContents.send('overlay:changed');
    }, 600);
  });
}

/** P4: watch the overlay's canonical files; push a cheap invalidation, never contents. */
function attachOverlayWatch(getRoot: () => string | undefined, win: BrowserWindow): void {
  const entry: OverlayWatchEntry = { win, getRoot, watcher: null, timer: null };
  overlayWatchers.add(entry);
  win.on('closed', () => {
    entry.watcher?.close();
    if (entry.timer) clearTimeout(entry.timer);
    overlayWatchers.delete(entry);
  });
}

async function createWindow(refresh: () => Promise<OverlaySnapshot>): Promise<BrowserWindow> {
  const savedWindow = await readWindowState(stateDir());
  const display = savedWindow?.x !== undefined && savedWindow?.y !== undefined
    ? screen.getDisplayNearestPoint({ x: savedWindow.x, y: savedWindow.y })
    : screen.getPrimaryDisplay();
  const windowState = normalizeWindowState(savedWindow, display.workArea);
  const win = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 640,
    title: 'Yunmin Workbench',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let root: string | undefined;
  void refresh().then((s) => {
    root = s.overlayRoot || undefined;
  });
  attachOverlayWatch(() => root, win);
  win.on('focus', () => {
    if (!win.isDestroyed()) win.webContents.send('app:focus');
  });
  if (windowState.maximized) win.maximize();
  let saveWindowTimer: NodeJS.Timeout | null = null;
  const saveWindow = () => {
    if (saveWindowTimer) clearTimeout(saveWindowTimer);
    saveWindowTimer = setTimeout(() => {
      saveWindowTimer = null;
      const bounds = win.getNormalBounds();
      void writeWindowStateAtomic(stateDir(), {
        schemaVersion: 1,
        ...bounds,
        maximized: win.isMaximized(),
      });
    }, 250);
  };
  win.on('resize', saveWindow);
  win.on('move', saveWindow);
  win.on('maximize', saveWindow);
  win.on('unmaximize', saveWindow);
  win.on('closed', () => {
    closeIsland();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  windowRoles.set(win, { role: 'main' });
  return win;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  codexAdapter.close();
  claudeAdapter.close();
  deepseekAdapter.close();
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows().find((w) => windowRoles.get(w)?.role === 'main');
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const { refresh } = registerIpc();
    void createWindow(refresh);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(refresh);
    });
  });
}
