import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { watch, type FSWatcher } from 'chokidar';
import { z } from 'zod';
import { freezePacket } from '../core/project/packet';
import type { FrozenPacket, OverlaySnapshot, TaskPacket } from '../core/types';
import {
  defaultOverlaySearchRoot,
  discoverOverlayRoot,
  loadOverlay,
  readMemoryBody,
  watchTargets,
} from './adapters/overlaySource';
import { readGitFacts } from './adapters/gitFacts';
import { encodeStateKey } from './stateKey';

// test hook: Playwright E2E redirects Workbench-owned state to a temp dir
if (process.env.WB_STATE_DIR) app.setPath('userData', process.env.WB_STATE_DIR);

/** Workbench-owned state: frozen packets live here, never in the overlay. */
function stateDir(): string {
  return join(app.getPath('userData'), 'state');
}

async function frozenPacketDir(projectId: string, conversationId: string): Promise<string> {
  const dir = join(
    stateDir(),
    'frozen-packets',
    encodeStateKey(projectId),
    encodeStateKey(conversationId),
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

const KeySchema = z.string().min(1).max(1024);
const ContextItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  body: z.string(),
  state: z.enum(['available', 'included', 'excluded']),
  pinned: z.boolean(),
  isReference: z.boolean(),
  sourceRef: z.string().optional(),
});
const TaskPacketSchema = z.object({
  schemaVersion: z.literal(1),
  packetId: z.string(),
  createdAt: z.string(),
  projectId: KeySchema,
  conversationKey: KeySchema,
  conversationId: z.string().optional(),
  taskSummary: z.string(),
  governanceRefs: z.array(z.string()),
  included: z.array(ContextItemSchema),
  references: z.array(ContextItemSchema),
  sourceFingerprints: z.array(z.object({ sourceRef: z.string(), sha256: z.string() })),
  unresolvedDependencies: z.array(z.string()),
  roughTokens: z.number().int().nonnegative(),
});

async function listFrozen(projectId: string, conversationId: string): Promise<FrozenPacket[]> {
  try {
    const dir = await frozenPacketDir(projectId, conversationId);
    const out: FrozenPacket[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      out.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as FrozenPacket);
    }
    return out.sort((a, b) => a.version - b.version);
  } catch {
    return [];
  }
}

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

  const refresh = async (): Promise<OverlaySnapshot> => {
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

  ipcMain.handle('packet:freeze', async (_e, rawPacket: unknown) => {
    const packet: TaskPacket = TaskPacketSchema.parse(rawPacket);
    const existing = await listFrozen(packet.projectId, packet.conversationKey);
    const frozen = freezePacket(packet, existing);
    const dir = await frozenPacketDir(packet.projectId, packet.conversationKey);
    const file = join(dir, `v${frozen.version}-${frozen.hash.slice(0, 8)}.json`);
    await writeFile(file, JSON.stringify(frozen, null, 2), 'utf8');
    return { frozen, path: file };
  });

  ipcMain.handle('packet:list', (_e, rawProjectId: unknown, rawConversationId: unknown) => {
    const projectId = KeySchema.parse(rawProjectId);
    const conversationId = KeySchema.parse(rawConversationId);
    return listFrozen(projectId, conversationId);
  });

  return { refresh };
}

/** P4: watch the overlay's canonical files; push a cheap invalidation, never contents. */
function watchOverlay(getRoot: () => string | undefined, win: BrowserWindow): void {
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    const root = getRoot();
    if (!root) return;
    watcher?.close();
    watcher = watch(watchTargets(root), { ignoreInitial: true, depth: 1 });
    watcher.on('all', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('overlay:changed');
      }, 600);
    });
  };
  ipcMain.handle('overlay:watch', () => arm());
}

function createWindow(refresh: () => Promise<OverlaySnapshot>): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
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
  watchOverlay(() => root, win);
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const { refresh } = registerIpc();
  createWindow(refresh);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(refresh);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
