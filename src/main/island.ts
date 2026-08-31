import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { readAmbientPreference, writeAmbientPreferenceAtomic } from './ambientPersistence';
import {
  ambientAttentionSnapshot,
  clampAmbientBounds,
  selectAmbientWorkArea,
  type AmbientAttentionSnapshot,
  type AmbientDisplay,
  type AmbientIslandPreferenceV1,
} from '../core/ambient/island';
import type { AttentionItem } from '../core/types';

interface IslandWindowManager {
  island: BrowserWindow | null;
  showTimer: NodeJS.Timeout | null;
  hideTimer: NodeJS.Timeout | null;
  snapshot: AmbientAttentionSnapshot;
  isExpanded: boolean;
  savePositionTimer: NodeJS.Timeout | null;
}

const manager: IslandWindowManager = {
  island: null,
  showTimer: null,
  hideTimer: null,
  snapshot: { visible: false, count: 0, items: [] },
  isExpanded: false,
  savePositionTimer: null,
};

function getDisplays(): AmbientDisplay[] {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
    },
  }));
}

function calculateIslandBounds(
  preference: AmbientIslandPreferenceV1,
  expanded: boolean,
  displays: AmbientDisplay[],
): { x: number; y: number; width: number; height: number } {
  const compactHeight = 48;
  const expandedHeight = 320;
  const width = 380;
  const primaryDisplayId = screen.getPrimaryDisplay().id;

  const workArea = selectAmbientWorkArea(
    preference.x !== undefined && preference.y !== undefined
      ? { x: preference.x, y: preference.y }
      : undefined,
    displays,
    primaryDisplayId,
  );

  const defaultBounds = {
    x: workArea.x + 20,
    y: workArea.y + 20,
    width,
    height: expanded ? expandedHeight : compactHeight,
  };

  const restoredBounds = preference.x !== undefined && preference.y !== undefined
    ? {
        x: preference.x,
        y: preference.y,
        width,
        height: expanded ? expandedHeight : compactHeight,
      }
    : defaultBounds;

  return clampAmbientBounds(restoredBounds, workArea);
}

async function createIsland(stateDir: string): Promise<BrowserWindow> {
  const preference = await readAmbientPreference(stateDir);
  if (!preference.enabled) {
    throw new Error('Ambient Island is disabled');
  }

  const displays = getDisplays();
  const bounds = calculateIslandBounds(preference, preference.expanded, displays);

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 260,
    minHeight: 48,
    maxWidth: 800,
    maxHeight: 600,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    // Never steal focus: Island is attention projection, not main taskbar entry
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Island must never become second taskbar entry or steal focus on show.
  // showInactive is used by caller; prevent auto-focus on creation.

  win.on('closed', () => {
    manager.island = null;
    manager.snapshot = { visible: false, count: 0, items: [] };
  });

  // Persist moved position clamped to current workArea; throttled
  const handleMove = () => {
    if (manager.savePositionTimer) clearTimeout(manager.savePositionTimer);
    manager.savePositionTimer = setTimeout(() => {
      manager.savePositionTimer = null;
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      const displaysNow = getDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      const workArea = selectAmbientWorkArea({ x, y }, displaysNow, primaryId);
      const boundsNow = win.getBounds();
      const clamped = clampAmbientBounds(boundsNow, workArea);
      // If off-screen due to DPI change, snap back visibly; otherwise just persist clamped position
      if (clamped.x !== boundsNow.x || clamped.y !== boundsNow.y) {
        win.setBounds(clamped);
      }
      void saveIslandPosition(stateDir, clamped.x, clamped.y);
    }, 350);
  };
  win.on('move', handleMove);
  win.on('resize', () => {
    if (manager.savePositionTimer) clearTimeout(manager.savePositionTimer);
    manager.savePositionTimer = setTimeout(() => {
      manager.savePositionTimer = null;
      if (win.isDestroyed()) return;
      const displaysNow = getDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      const workArea = selectAmbientWorkArea(
        (() => { const [x, y] = win.getPosition(); return { x, y }; })(),
        displaysNow,
        primaryId,
      );
      const clamped = clampAmbientBounds(win.getBounds(), workArea);
      if (clamped.width !== win.getBounds().width || clamped.height !== win.getBounds().height || clamped.x !== win.getBounds().x || clamped.y !== win.getBounds().y) {
        win.setBounds(clamped);
      }
      void saveIslandPosition(stateDir, clamped.x, clamped.y);
    }, 350);
  });

  // Graceful: Island crash/close does not affect Main Window
  win.webContents.on('render-process-gone', (_e, details) => {
    console.warn('[Island] render-process-gone', details);
    // keep manager snapshot; Main Window remains unaffected
  });
  win.on('unresponsive', () => {
    console.warn('[Island] window unresponsive');
  });

  void win.loadFile(join(__dirname, '../island/index.html'));

  manager.island = win;
  manager.isExpanded = preference.expanded;
  return win;
}

export function getIslandWindow(): BrowserWindow | null {
  return manager.island;
}

export async function showIsland(stateDir: string): Promise<void> {
  if (manager.showTimer) clearTimeout(manager.showTimer);
  if (manager.hideTimer) {
    clearTimeout(manager.hideTimer);
    manager.hideTimer = null;
  }

  const preference = await readAmbientPreference(stateDir);
  if (!preference.enabled) return;

  if (manager.island && !manager.island.isDestroyed()) {
    // Default: do not steal focus
    manager.island.showInactive();
    return;
  }

  manager.showTimer = setTimeout(async () => {
    manager.showTimer = null;
    try {
      const win = await createIsland(stateDir);
      win.showInactive();
      // Ensure content receives snapshot after load; send once ready
      const sendSnapshot = () => {
        if (!win.isDestroyed()) win.webContents.send('island:snapshot', manager.snapshot);
      };
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', sendSnapshot);
      } else {
        setTimeout(sendSnapshot, 60);
      }
    } catch (error) {
      console.error('Failed to show Island:', error);
    }
  }, 60);
}

export async function hideIsland(): Promise<void> {
  if (manager.showTimer) {
    clearTimeout(manager.showTimer);
    manager.showTimer = null;
  }
  if (manager.hideTimer) clearTimeout(manager.hideTimer);

  manager.hideTimer = setTimeout(() => {
    manager.hideTimer = null;
    if (manager.island && !manager.island.isDestroyed()) {
      if (!manager.snapshot.visible) {
        manager.island.close();
      }
    }
  }, 900);
}

export async function updateIslandSnapshot(
  stateDir: string,
  rawItems: AttentionItem[],
): Promise<void> {
  const snapshot = ambientAttentionSnapshot(rawItems);
  manager.snapshot = snapshot;

  if (!snapshot.visible && manager.island && !manager.island.isDestroyed()) {
    await hideIsland();
    return;
  }

  if (snapshot.visible) {
    const preference = await readAmbientPreference(stateDir);
    if (!preference.enabled) return;
    await showIsland(stateDir);
    // If already showing, push snapshot immediately; if still creating, showIsland will push after load
    if (manager.island && !manager.island.isDestroyed() && !manager.island.webContents.isLoading()) {
      manager.island.webContents.send('island:snapshot', snapshot);
    }
  }
}

export async function toggleIslandExpansion(stateDir: string): Promise<{ expanded: boolean }> {
  const preference = await readAmbientPreference(stateDir);
  const expanded = !preference.expanded;
  const updated: AmbientIslandPreferenceV1 = {
    ...preference,
    expanded,
  };
  await writeAmbientPreferenceAtomic(stateDir, updated);
  manager.isExpanded = expanded;

  if (manager.island && !manager.island.isDestroyed()) {
    const displays = getDisplays();
    const bounds = calculateIslandBounds(updated, expanded, displays);
    manager.island.setBounds(bounds);
    manager.island.webContents.send('island:expanded', expanded);
  }

  return { expanded };
}

export async function setIslandEnabled(stateDir: string, enabled: boolean): Promise<void> {
  const preference = await readAmbientPreference(stateDir);
  const updated: AmbientIslandPreferenceV1 = {
    ...preference,
    enabled,
  };
  await writeAmbientPreferenceAtomic(stateDir, updated);

  if (!enabled && manager.island && !manager.island.isDestroyed()) {
    manager.island.close();
  } else if (enabled && manager.snapshot.visible) {
    await showIsland(stateDir);
  }
}

export async function saveIslandPosition(
  stateDir: string,
  x: number,
  y: number,
): Promise<void> {
  const preference = await readAmbientPreference(stateDir);
  const updated: AmbientIslandPreferenceV1 = {
    ...preference,
    x,
    y,
  };
  await writeAmbientPreferenceAtomic(stateDir, updated);
}

export function moveIslandBy(dx: number, dy: number, stateDir: string): void {
  const win = manager.island;
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const displays = getDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const workArea = selectAmbientWorkArea({ x: x + dx, y: y + dy }, displays, primaryId);
  const nextBounds = clampAmbientBounds({ ...win.getBounds(), x: x + dx, y: y + dy }, workArea);
  win.setBounds(nextBounds);
  // position will be persisted via move handler throttling; also persist immediately for drag end
  void saveIslandPosition(stateDir, nextBounds.x, nextBounds.y);
}

export function closeIsland(): void {
  if (manager.showTimer) {
    clearTimeout(manager.showTimer);
    manager.showTimer = null;
  }
  if (manager.hideTimer) {
    clearTimeout(manager.hideTimer);
    manager.hideTimer = null;
  }
  if (manager.savePositionTimer) {
    clearTimeout(manager.savePositionTimer);
    manager.savePositionTimer = null;
  }
  if (manager.island && !manager.island.isDestroyed()) {
    manager.island.close();
  }
  manager.island = null;
  manager.snapshot = { visible: false, count: 0, items: [] };
}

export function handleIslandCrashed(): void {
  manager.island = null;
}
