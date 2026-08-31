import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AttentionItem } from '../../src/core/types';
import {
  ambientAttentionSnapshot,
  clampAmbientBounds,
  resolveIslandTarget,
  selectAmbientWorkArea,
} from '../../src/core/ambient/island';

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'attention:one',
  kind: 'approval-required',
  level: 'action',
  title: 'Approval required',
  summary: 'Review the explicit approval request',
  projectId: 'creative-os',
  conversationKey: 'creative-os::claude::main',
  sessionRef: 'session-explicit-1',
  sourceRef: 'protocol:approval:one',
  eventRef: 'event-explicit-1',
  observedAt: '2026-08-31T08:00:00.000Z',
  verification: 'OBSERVED',
  ...overrides,
});

describe('Ambient Island contract – single instance must target Main Window explicitly', () => {
  it('does not use getAllWindows()[0] – must find role main', () => {
    const mainCode = readFileSync('src/main/index.ts', 'utf8');
    expect(mainCode).toMatch(/windowRoles\.get\(w\)\?\.role === 'main'/);
    expect(mainCode).not.toMatch(/BrowserWindow\.getAllWindows\(\)\[0\]/);
  });

  it('second-instance handler restores and focuses main window only', () => {
    const code = readFileSync('src/main/index.ts', 'utf8');
    expect(code).toMatch(/app\.on\('second-instance'/);
    expect(code).toMatch(/mainWindow\.restore\(\)/);
    expect(code).toMatch(/mainWindow\.show\(\)/);
    expect(code).toMatch(/mainWindow\.focus\(\)/);
    // must not focus island
    const islandFocusInSecondInstance = code.split("second-instance")[1]?.includes("island");
    expect(islandFocusInSecondInstance).toBe(false);
  });
});

describe('Ambient Island contract – lifecycle', () => {
  it('Main Window closed destroys Island (no ghost)', () => {
    const code = readFileSync('src/main/index.ts', 'utf8');
    expect(code).toMatch(/win\.on\('closed', \(\) => \{\s+closeIsland\(\)/);
  });

  it('Island crash/close does not affect Main Window', () => {
    const islandCode = readFileSync('src/main/island.ts', 'utf8');
    expect(islandCode).toMatch(/render-process-gone/);
    expect(islandCode).toMatch(/handleIslandCrashed|manager\.island = null/);
    const indexCode = readFileSync('src/main/index.ts', 'utf8');
    // window-all-closed should still allow main to live if island closed
    expect(indexCode).toMatch(/window-all-closed/);
    // closeIsland nulls island but does not quit app directly
    expect(islandCode).toMatch(/function closeIsland\(\)/);
    expect(islandCode).not.toMatch(/app\.quit\(\)/);
  });

  it('Island never steals focus on show and is not taskbar entry', () => {
    const islandCode = readFileSync('src/main/island.ts', 'utf8');
    expect(islandCode).toMatch(/showInactive\(\)/);
    expect(islandCode).not.toMatch(/manager\.island\.focus\(\)/);
    expect(islandCode).toMatch(/skipTaskbar: true/);
    expect(islandCode).toMatch(/frame: false/);
  });
});

describe('Ambient Island contract – bounded Attention projection', () => {
  it('shows nothing when Attention is empty', () => {
    expect(ambientAttentionSnapshot([])).toEqual({ visible: false, count: 0, items: [] });
  });

  it('appears when attention appears and disappears when resolved (empty after dedupe)', () => {
    const before = ambientAttentionSnapshot([item({ id: 'a' })]);
    expect(before.visible).toBe(true);
    expect(before.count).toBe(1);
    const afterResolved = ambientAttentionSnapshot([]);
    expect(afterResolved.visible).toBe(false);
  });

  it('duplicate transport ids are deduplicated and bounded to 4', () => {
    const dup = [
      item({ id: 'x', level: 'alert' }),
      item({ id: 'x', title: 'dup' }),
      item({ id: 'y' }),
      item({ id: 'z' }),
      item({ id: 'w' }),
      item({ id: 'v' }),
    ];
    const snap = ambientAttentionSnapshot(dup);
    expect(snap.count).toBe(5);
    expect(snap.items).toHaveLength(4);
    expect(snap.items.map((i) => i.id)).toEqual(['x', 'y', 'z', 'w']);
  });

  it('preserves reducer order and highestLevel is first item level', () => {
    const snap = ambientAttentionSnapshot([
      item({ id: 'first', level: 'review' }),
      item({ id: 'second', level: 'alert' }),
    ]);
    expect(snap.highestLevel).toBe('review');
    expect(snap.items[0].id).toBe('first');
  });
});

describe('Ambient Island contract – multi-display / DPI clamp', () => {
  it('clamps off-screen restored bounds into current workArea', () => {
    expect(clampAmbientBounds(
      { x: 9000, y: -2000, width: 380, height: 320 },
      { x: -1920, y: 0, width: 1920, height: 1040 },
    )).toEqual({ x: -380, y: 0, width: 380, height: 320 });
  });

  it('selects containing display, falls back to primary for stale positions', () => {
    const displays = [
      { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
      { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } },
    ];
    expect(selectAmbientWorkArea({ x: 1600, y: 30 }, displays, 1)).toEqual(displays[1].workArea);
    expect(selectAmbientWorkArea({ x: 9000, y: -4000 }, displays, 1)).toEqual(displays[0].workArea);
  });

  it('clamps width/height to workArea size', () => {
    const clamped = clampAmbientBounds({ x: 0, y: 0, width: 5000, height: 5000 }, { x: 0, y: 0, width: 800, height: 600 });
    expect(clamped.width).toBe(800);
    expect(clamped.height).toBe(600);
  });

  it('island move persists clamped position (code check)', () => {
    const code = readFileSync('src/main/island.ts', 'utf8');
    expect(code).toMatch(/clampAmbientBounds/);
    expect(code).toMatch(/moveIslandBy/);
  });
});

describe('Ambient Island contract – identity navigation (no guessing)', () => {
  const snapshot = {
    projects: [{ projectId: 'proj-a' }, { projectId: 'proj-b' }],
    conversations: [
      { key: 'proj-a::claude::main', project: 'proj-a' },
      { key: 'proj-b::codex::main', project: 'proj-b' },
    ],
  };

  it('navigates when project and conversation both verifiable', () => {
    const r = resolveIslandTarget({
      projectId: 'proj-a', conversationKey: 'proj-a::claude::main', sourceRef: 'protocol:x', eventRef: 'e1',
    }, snapshot);
    expect(r.status).toBe('navigable');
    if (r.status === 'navigable') {
      expect(r.projectId).toBe('proj-a');
      expect(r.conversationKey).toBe('proj-a::claude::main');
    }
  });

  it('returns unavailable when project not in snapshot (no guessing)', () => {
    const r = resolveIslandTarget({ projectId: 'unknown-proj', sourceRef: 'protocol:x' }, snapshot);
    expect(r.status).toBe('unavailable');
  });

  it('returns unavailable when conversation key missing or mismatched project', () => {
    const r1 = resolveIslandTarget({ projectId: 'proj-a', conversationKey: 'nonexistent', sourceRef: 'protocol:x' }, snapshot);
    expect(r1.status).toBe('unavailable');
    const r2 = resolveIslandTarget({ projectId: 'proj-a', conversationKey: 'proj-b::codex::main', sourceRef: 'protocol:x' }, snapshot);
    expect(r2.status).toBe('unavailable');
  });

  it('returns unavailable when only source/session without identity (stale target)', () => {
    const r = resolveIslandTarget({ sourceRef: 'protocol:stale', sessionRef: 'sess-1' }, snapshot);
    expect(r.status).toBe('unavailable');
  });

  it('does not invent project from sessionRef alone', () => {
    const r = resolveIslandTarget({ sessionRef: 'sess-123', sourceRef: 'protocol:x' }, snapshot);
    expect(r.status).toBe('unavailable');
  });
});

describe('Ambient Island contract – dismiss reuses local attention state', () => {
  it('island preload exposes dismiss via attention:dismiss channel', () => {
    const code = readFileSync('src/preload/island.ts', 'utf8');
    expect(code).toMatch(/dismissAttention/);
    expect(code).toMatch(/attention:dismiss/);
  });
  it('island item renders Dismiss button that calls dismissAttention', () => {
    const comp = readFileSync('src/island/components/AmbientItem.tsx', 'utf8');
    expect(comp).toMatch(/Dismiss/);
    expect(comp).toMatch(/dismissAttention/);
  });
});

describe('Ambient Island contract – enable/position only writes Workbench userData', () => {
  it('ambientPersistence only writes to ambient/island-v1.json under userData', () => {
    const code = readFileSync('src/main/ambientPersistence.ts', 'utf8');
    expect(code).toMatch(/island-v1\.json/);
    expect(code).toContain("'ambient'");
    expect(code).not.toMatch(/overlay-discovery|history:|\bINBOX\b/);
  });
  it('island enable/disable/position do not write to overlay/history/memory', () => {
    const islandCode = readFileSync('src/main/island.ts', 'utf8');
    expect(islandCode).not.toMatch(/writeFile.*overlay/);
    expect(islandCode).not.toContain('history:');
    expect(islandCode).toMatch(/writeAmbientPreferenceAtomic/);
  });
});

describe('Ambient Island contract – must be pure projection (no History/Memory/Overlay inference)', () => {
  it('ambient island core does not import History/Memory/Overlay/Governance', () => {
    const code = readFileSync('src/core/ambient/island.ts', 'utf8');
    // Core must only depend on Attention reducer output; check forbidden service imports, not words in comments/type names
    expect(code).not.toMatch(/HistoryService|MemoryService|loadOverlay|readMemoryBody|INBOX/);
    expect(code).toMatch(/AttentionItem/);
  });
  it('island main does not read History/Memory directly', () => {
    const code = readFileSync('src/main/island.ts', 'utf8');
    expect(code).not.toMatch(/HistoryService|MemoryService|loadOverlay|readMemoryBody/);
  });
  it('island snapshot rejects non-observed verification (no inferred)', () => {
    expect(() => ambientAttentionSnapshot([item({ verification: 'INFERRED' as unknown as 'OBSERVED' })])).toThrow();
    expect(() => ambientAttentionSnapshot([item({ verification: 'UNKNOWN' as unknown as 'OBSERVED' })])).toThrow();
  });
});

describe('Ambient Island contract – no second SOT / no dashboard bloat', () => {
  it('island snapshot is bounded to 4 items and preserves reducer order', () => {
    const many = Array.from({ length: 10 }, (_, i) => item({ id: `id-${i}`, title: `t${i}` }));
    const snap = ambientAttentionSnapshot(many);
    expect(snap.items).toHaveLength(4);
    expect(snap.count).toBe(10);
  });
  it('island does not create tray, daemon, direct approve, or harness command', () => {
    const mainCode = readFileSync('src/main/index.ts', 'utf8');
    const islandCode = readFileSync('src/main/island.ts', 'utf8');
    expect(mainCode).not.toMatch(/Tray|toast|daemon/);
    expect(islandCode).not.toMatch(/Tray|toast|daemon|approve|reject|harness/);
    expect(islandCode).not.toMatch(/codexAdapter|handoffDispatch/);
  });
});

describe('Ambient Island contract – persistence restart restores enable/position', () => {
  it('normalize rejects malformed and defaults to disabled', async () => {
    const { normalizeAmbientPreference, DEFAULT_AMBIENT_PREFERENCE } = await import('../../src/core/ambient/island');
    expect(normalizeAmbientPreference({ schemaVersion: 2, enabled: true })).toEqual(DEFAULT_AMBIENT_PREFERENCE);
    expect(normalizeAmbientPreference({ schemaVersion: 1, enabled: true, expanded: true, x: 10, y: 20 }))
      .toEqual({ schemaVersion: 1, enabled: true, expanded: true, x: 10, y: 20 });
  });
});
