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

// test hook: Playwright E2E redirects Workbench-owned state to a temp dir
if (process.env.WB_STATE_DIR) app.setPath('userData', process.env.WB_STATE_DIR);

const codexAdapter = new CodexAppServerAdapter();
const handoffRequests = new HandoffDispatchRegistry<HandoffReceipt>();

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
  const runtimeContexts = new Map<string, {
    projectId: string;
    conversationKey: string;
    machine: string;
    cwd: string;
  }>();
  const reviewWorthyTurns = new Set<string>();
  const history = new HistoryService({ stateDir: stateDir(), roots: defaultHistoryRoots() });
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
    const context = runtimeContexts.get(threadId);
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
      runtimeRef: threadId,
      turnRef: turnId,
      observed: observed(`codex-app-server:${event.method}`),
    };
    if (event.method === 'adapter/error') {
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
        ...base, id: randomUUID(), kind: 'approval-required',
        summary: `Codex approval required${reason}`,
        attentionKey: `codex-request:${requestId}`, attentionStatus: 'active',
      });
      return;
    }
    if (requestId && (event.method === 'item/tool/requestUserInput' || event.method === 'mcpServer/elicitation/request')) {
      void recordActivity({
        ...base, id: randomUUID(), kind: 'needs-user-input',
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
        void recordActivity({ ...base, kind: 'file-change', summary: `File change ${event.method === 'item/started' ? 'started' : 'completed'}` });
      } else if (['commandExecution', 'mcpToolCall', 'dynamicToolCall'].includes(itemType)) {
        void recordActivity({
          ...base,
          kind: event.method === 'item/started' ? 'tool-started' : 'tool-completed',
          summary: `${itemType} ${event.method === 'item/started' ? 'started' : 'completed'}`,
        });
      }
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

  ipcMain.handle('harness:capabilities', async (): Promise<HarnessCapabilities> => {
    try {
      return await codexAdapter.capabilities();
    } catch (error) {
      return {
        harness: 'codex',
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
  const HandoffSchema = z.object({
    intentId: z.string().uuid(),
    projectId: KeySchema,
    conversationKey: KeySchema,
    packetText: z.string().min(1).max(5_000_000),
  });
  ipcMain.handle('harness:dispatch', async (_event, rawRequest: unknown) => {
    const request = HandoffSchema.parse(rawRequest);
    return handoffRequests.run(request.intentId, async () => {
      const snap = cache?.snapshot ?? (await refresh());
      const cwd = await projectRoot(snap, request.projectId);
      if (!cwd) {
        const receipt = {
          intentId: request.intentId,
          harness: 'codex',
          status: 'REJECTED',
          at: new Date().toISOString(),
          source: 'protocol',
          protocolEvidence: 'Workbench machine projectRoots lookup',
          message: `No project root binding for ${request.projectId}`,
        } satisfies HandoffReceipt;
        await recordActivity({
          id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
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
        kind: 'handoff-dispatched', summary: 'Packet dispatched to Codex',
        observed: {
          source: 'process', sourceRef: `workbench-intent:${request.intentId}`,
          observedAt: new Date().toISOString(), verification: 'OBSERVED',
        },
      });
      const machine = snap.machine?.deviceId ?? 'UNKNOWN';
      let receipt: HandoffReceipt;
      try {
        receipt = await codexAdapter.dispatch(request.intentId, cwd, request.packetText, (threadId) => {
          runtimeContexts.set(threadId, {
            projectId: request.projectId,
            conversationKey: request.conversationKey,
            machine,
            cwd,
          });
          void recordActivity({
            id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
            kind: 'session-started', summary: 'Codex session created', runtimeRef: threadId,
            runtimeState: 'unknown',
            binding: {
              harness: 'codex', machine, cwd, externalSessionRef: threadId,
            },
            observed: observed('codex-app-server:thread/start.result.thread.id'),
          });
        });
      } catch (error) {
        await recordActivity({
          id: randomUUID(), projectId: request.projectId, conversationKey: request.conversationKey,
          kind: 'harness-error', summary: `Codex harness error: ${String(error)}`,
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
        kind: receipt.status === 'ACCEPTED' ? 'handoff-accepted' : 'handoff-failed',
        summary: receipt.status === 'ACCEPTED' ? 'Codex accepted the packet' : `Codex handoff ${receipt.status.toLowerCase()}`,
        attentionKey: request.intentId,
        runtimeRef: receipt.runtimeRef, turnRef: receipt.turnRef,
        observed: observed(`codex-app-server:${receipt.protocolEvidence}`),
      });
      return receipt;
    });
  });
  ipcMain.handle('harness:smoke', async (_event, rawProjectId: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const snap = cache?.snapshot ?? (await refresh());
    const cwd = await projectRoot(snap, projectId);
    if (!cwd) throw new Error(`No project root binding for ${projectId}`);
    return codexAdapter.smoke(cwd);
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

async function createWindow(refresh: () => Promise<OverlaySnapshot>): Promise<void> {
  const savedWindow = await readWindowState(stateDir());
  const display = savedWindow?.x !== undefined && savedWindow.y !== undefined
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
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => codexAdapter.close());

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    const { refresh } = registerIpc();
    void createWindow(refresh);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(refresh);
    });
  });
}
