import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { watch, type FSWatcher } from 'chokidar';
import { freezePacket } from '../core/project/packet';
import type { FrozenPacket, OverlaySnapshot, TaskPacket } from '../core/types';
import { discoverOverlayRoot, loadOverlay, readMemoryBody } from './adapters/overlaySource';
import { readGitFacts } from './adapters/gitFacts';

// test hook: Playwright E2E redirects Workbench-owned state to a temp dir
if (process.env.WB_STATE_DIR) app.setPath('userData', process.env.WB_STATE_DIR);

/** Workbench-owned state: frozen packets live here, never in the overlay. */
function stateDir(): string {
  return join(app.getPath('userData'), 'state');
}

async function frozenPacketDir(projectId: string, conversationId: string): Promise<string> {
  const dir = join(stateDir(), 'frozen-packets', projectId, encodeURIComponent(conversationId));
  await mkdir(dir, { recursive: true });
  return dir;
}

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
    const { root, candidates } = await discoverOverlayRoot('D:\\');
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

  ipcMain.handle('overlay:load', async (_e, opts?: { refresh?: boolean }) => {
    if (cache && !opts?.refresh && Date.now() - cache.at < 5_000) return cache.snapshot;
    return refresh();
  });

  ipcMain.handle('memory:read', (_e, memoryId: string) => {
    const root = cache?.snapshot.overlayRoot;
    return root ? readMemoryBody(root, memoryId) : null;
  });

  ipcMain.handle('git:load', async (_e, projectId: string) => {
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

  ipcMain.handle('packet:freeze', async (_e, packet: TaskPacket) => {
    const existing = await listFrozen(packet.projectId, packet.conversationId);
    const frozen = freezePacket(packet, existing);
    const dir = await frozenPacketDir(packet.projectId, packet.conversationId);
    const file = join(dir, `v${frozen.version}-${frozen.hash.slice(0, 8)}.json`);
    await writeFile(file, JSON.stringify(frozen, null, 2), 'utf8');
    return { frozen, path: file };
  });

  ipcMain.handle('packet:list', (_e, projectId: string, conversationId: string) =>
    listFrozen(projectId, conversationId),
  );

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
    watcher = watch(
      [
        join(root, 'INBOX.md'),
        join(root, 'memory/MEMORY.md'),
        join(root, 'profiles/machines/instances'),
        join(root, 'projects/instances'),
        join(root, 'harness/manifest.yaml'),
      ],
      { ignoreInitial: true, depth: 1 },
    );
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
