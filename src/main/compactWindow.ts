import { BrowserWindow, globalShortcut, screen } from 'electron';
import { join } from 'node:path';
import {
  clampAmbientBounds,
  selectAmbientWorkArea,
  type AmbientDisplay,
  type AmbientRectangle,
} from '../core/ambient/island';
import { readFile, rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Compact / Edge Panel window (PHASE 4A).
 *
 * A separate, user-facing always-on-top surface built entirely on the
 * window mechanisms this repo already validated with the Ambient Island:
 * multi-display workArea selection, bounds clamping, throttled position
 * persistence, crash isolation, and main-window lifecycle coupling.
 *
 * Deliberately NOT copied from the Island: attention-driven auto show/hide
 * and timers. The Compact window is a user-toggled surface.
 *
 * Lifecycle decision: closing (or toggling off) HIDES the Compact window;
 * the Workbench background process is owned by the existing main-window
 * lifecycle. A real quit destroys it.
 */

const COMPACT_DEFAULT_WIDTH = 380;
const COMPACT_COLLAPSED_HEIGHT = 150;
const COMPACT_EXPANDED_HEIGHT = 380;
const EDGE_MARGIN = 12;

export const DEFAULT_COMPACT_TOGGLE_SHORTCUT = 'Alt+Shift+B';

export interface CompactWindowPreferenceV1 {
  schemaVersion: 1;
  expanded: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const CompactPreferenceSchema = z.object({
  schemaVersion: z.literal(1),
  expanded: z.boolean(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
}).strict();

const DEFAULT_PREFERENCE: CompactWindowPreferenceV1 = { schemaVersion: 1, expanded: false };

function preferencePath(stateDir: string): string {
  return join(stateDir, 'compact-window-preference-v1.json');
}

export async function readCompactPreference(stateDir: string): Promise<CompactWindowPreferenceV1> {
  try {
    const parsed = CompactPreferenceSchema.parse(JSON.parse(await readFile(preferencePath(stateDir), 'utf8')));
    return parsed;
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

async function writeCompactPreferenceAtomic(stateDir: string, preference: CompactWindowPreferenceV1): Promise<void> {
  const parsed = CompactPreferenceSchema.parse(preference);
  const file = preferencePath(stateDir);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

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

/** Default position: top-right edge of the display the user last used. */
export function defaultCompactBounds(workArea: AmbientRectangle, expanded: boolean): AmbientRectangle {
  const height = expanded ? COMPACT_EXPANDED_HEIGHT : COMPACT_COLLAPSED_HEIGHT;
  return clampAmbientBounds({
    x: workArea.x + workArea.width - COMPACT_DEFAULT_WIDTH - EDGE_MARGIN,
    y: workArea.y + EDGE_MARGIN,
    width: COMPACT_DEFAULT_WIDTH,
    height,
  }, workArea);
}

export function computeCompactBounds(
  preference: CompactWindowPreferenceV1,
  displays: AmbientDisplay[],
  primaryDisplayId: number,
): AmbientRectangle {
  const point = preference.x !== undefined && preference.y !== undefined
    ? { x: preference.x, y: preference.y }
    : undefined;
  const workArea = selectAmbientWorkArea(point, displays, primaryDisplayId);
  const bounds: AmbientRectangle = {
    x: preference.x ?? 0,
    y: preference.y ?? 0,
    width: preference.width ?? COMPACT_DEFAULT_WIDTH,
    height: (preference.height ?? (preference.expanded ? COMPACT_EXPANDED_HEIGHT : COMPACT_COLLAPSED_HEIGHT)),
  };
  if (point) return clampAmbientBounds(bounds, workArea);
  return defaultCompactBounds(workArea, preference.expanded);
}

interface CompactManager {
  compact: BrowserWindow | null;
  saveTimer: NodeJS.Timeout | null;
  shortcut: string | null;
  quitting: boolean;
}

const manager: CompactManager = { compact: null, saveTimer: null, shortcut: null, quitting: false };

export function getCompactWindow(): BrowserWindow | null {
  return manager.compact && !manager.compact.isDestroyed() ? manager.compact : null;
}

export async function createCompactWindow(stateDir: string): Promise<BrowserWindow> {
  if (getCompactWindow()) return manager.compact!;
  const preference = await readCompactPreference(stateDir);
  const bounds = computeCompactBounds(preference, getDisplays(), screen.getPrimaryDisplay().id);

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 280,
    minHeight: 96,
    maxWidth: 640,
    maxHeight: 560,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Workbench Compact',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  manager.compact = win;

  // Close = hide: the Compact surface is a toggle, not an app exit.
  win.on('close', (event) => {
    if (manager.quitting || win.isDestroyed()) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    manager.compact = null;
  });

  // Throttled, clamped position persistence (Island mechanism).
  const persistBounds = () => {
    if (manager.saveTimer) clearTimeout(manager.saveTimer);
    manager.saveTimer = setTimeout(async () => {
      manager.saveTimer = null;
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      const displaysNow = getDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      const workArea = selectAmbientWorkArea({ x, y }, displaysNow, primaryId);
      const clamped = clampAmbientBounds({ ...win.getBounds(), x, y }, workArea);
      if (clamped.x !== win.getBounds().x || clamped.y !== win.getBounds().y) {
        win.setBounds(clamped);
      }
      const preferenceNow = await readCompactPreference(stateDir);
      await writeCompactPreferenceAtomic(stateDir, {
        ...preferenceNow,
        x: clamped.x,
        y: clamped.y,
        width: clamped.width,
        height: clamped.height,
      });
    }, 350);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);

  // Display topology / DPI changes: snap back into a visible work area.
  const reclamp = () => {
    if (!getCompactWindow()) return;
    const [x, y] = win.getPosition();
    const workArea = selectAmbientWorkArea({ x, y }, getDisplays(), screen.getPrimaryDisplay().id);
    const clamped = clampAmbientBounds({ ...win.getBounds(), x, y }, workArea);
    if (clamped.x !== win.getBounds().x || clamped.y !== win.getBounds().y
      || clamped.width !== win.getBounds().width || clamped.height !== win.getBounds().height) {
      win.setBounds(clamped);
    }
  };
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  // Crash isolation: the Compact surface must never take down the main window.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[compact] render-process-gone', details);
    manager.compact = null;
  });

  void win.loadFile(join(__dirname, '../renderer-compact/index.html'));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  return win;
}

export async function toggleCompactWindow(stateDir: string): Promise<{ visible: boolean }> {
  const existing = getCompactWindow();
  if (existing) {
    if (existing.isVisible()) {
      existing.hide();
      return { visible: false };
    }
    // Re-clamp on show: the display topology may have changed while hidden.
    const [x, y] = existing.getPosition();
    const workArea = selectAmbientWorkArea({ x, y }, getDisplays(), screen.getPrimaryDisplay().id);
    const clamped = clampAmbientBounds({ ...existing.getBounds(), x, y }, workArea);
    existing.setBounds(clamped);
    existing.show();
    return { visible: true };
  }
  const win = await createCompactWindow(stateDir);
  win.once('ready-to-show', () => win.show());
  return { visible: true };
}

export async function setCompactExpanded(stateDir: string, expanded: boolean): Promise<{ expanded: boolean }> {
  const preference = await readCompactPreference(stateDir);
  await writeCompactPreferenceAtomic(stateDir, { ...preference, expanded });
  const win = getCompactWindow();
  if (win) {
    const [x, y] = win.getPosition();
    const workArea = selectAmbientWorkArea({ x, y }, getDisplays(), screen.getPrimaryDisplay().id);
    const height = expanded ? COMPACT_EXPANDED_HEIGHT : COMPACT_COLLAPSED_HEIGHT;
    const clamped = clampAmbientBounds({ ...win.getBounds(), x, y, height }, workArea);
    win.setBounds(clamped);
  }
  return { expanded };
}

/** Real quit destroys the window; a mere close only hides. */
export function markCompactQuitting(): void {
  manager.quitting = true;
}

/** Register the toggle shortcut; failure is fail-safe (surface stays reachable via the launch flag). */
export function registerCompactShortcut(stateDir: string, accelerator: string): void {
  if (manager.shortcut) {
    globalShortcut.unregister(manager.shortcut);
    manager.shortcut = null;
  }
  try {
    const registered = globalShortcut.register(accelerator, () => {
      void toggleCompactWindow(stateDir);
    });
    if (registered) {
      manager.shortcut = accelerator;
    } else {
      console.warn(`[compact] global shortcut "${accelerator}" already claimed by another application; continuing without it`);
    }
  } catch (error) {
    console.warn(`[compact] global shortcut "${accelerator}" failed to register: ${String(error)}`);
  }
}

export function unregisterCompactShortcut(): void {
  if (manager.shortcut) {
    try {
      globalShortcut.unregister(manager.shortcut);
    } catch { /* quitting; nothing to recover */ }
    manager.shortcut = null;
  }
}

export function closeCompactForQuit(): void {
  unregisterCompactShortcut();
  markCompactQuitting();
  if (manager.saveTimer) {
    clearTimeout(manager.saveTimer);
    manager.saveTimer = null;
  }
  if (manager.compact && !manager.compact.isDestroyed()) {
    manager.compact.destroy();
  }
  manager.compact = null;
}
