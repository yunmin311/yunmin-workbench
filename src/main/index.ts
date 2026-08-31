import { randomUUID } from 'node:crypto';
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

  const refresh = (): Promise<OverlaySnapshot> => {
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
      cache = { snapshot, at: Date.now() };
      return snapshot;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

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
    const localRoot = snap.machine?.projectRoots[projectId];
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
    const projectRoot = snap.machine?.projectRoots[request.projectId];
    if (!projectRoot) return { error: `no local root binding for project ${request.projectId}` };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: request.asReference ? 'Add Project File Reference' : 'Add Project File Context',
      defaultPath: projectRoot,
      properties: ['openFile'],
    };
    const chosen = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (chosen.canceled || chosen.filePaths.length !== 1) return { canceled: true };
    try {
      return await createProjectFileContext(
        request.projectId,
        projectRoot,
        relative(projectRoot, chosen.filePaths[0]),
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
    const projectRoot = snap.machine?.projectRoots[request.projectId];
    if (!projectRoot) return { entries: [], errors: [`no local root binding for project ${request.projectId}`] };
    const entries = [];
    const errors: string[] = [];
    for (const file of request.files) {
      try {
        entries.push(await createProjectFileContext(
          request.projectId,
          projectRoot,
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
    const projectRoot = snap.machine?.projectRoots[request.projectId];
    const fingerprints: SourceFingerprint[] = [];
    const errors: { sourceRef: string; message: string }[] = [];
    const uniqueRefs = [...new Set(request.sourceRefs)];

    const recheckOne = async (sourceRef: string): Promise<void> => {
      try {
        const projectPrefix = `project-file:${request.projectId}:`;
        if (sourceRef.startsWith(projectPrefix)) {
          if (!projectRoot) throw new Error(`no local root binding for project ${request.projectId}`);
          fingerprints.push(await fingerprintProjectFile(
            request.projectId,
            projectRoot,
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
    return readWorkbenchDraft(stateDir(), scope.projectId, scope.conversationKey);
  });
  ipcMain.handle('draft:save', async (_event, rawDraft: unknown) => {
    const draft = WorkbenchDraftSchema.parse(rawDraft);
    return { path: await writeWorkbenchDraftAtomic(stateDir(), draft) };
  });
  ipcMain.handle('draft:clear', async (_event, rawScope: unknown) => {
    const scope = DraftScopeSchema.parse(rawScope);
    await clearWorkbenchDraft(stateDir(), scope.projectId, scope.conversationKey);
  });

  ipcMain.handle('workspace:load', () => readWorkspaceSession(stateDir()));
  ipcMain.handle('workspace:save', async (_event, rawSession: unknown) => {
    const session = WorkspaceSessionSchema.parse(rawSession);
    return { path: await writeWorkspaceSessionAtomic(stateDir(), session) };
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
      const cwd = snap.machine?.projectRoots[request.projectId];
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
    const cwd = snap.machine?.projectRoots[projectId];
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
