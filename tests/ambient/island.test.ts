import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '../../src/core/types';
import {
  ambientAttentionSnapshot,
  clampAmbientBounds,
  DEFAULT_AMBIENT_PREFERENCE,
  normalizeAmbientPreference,
  selectAmbientWorkArea,
} from '../../src/core/ambient/island';

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'attention:approval:one',
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

describe('Ambient Island projection boundary', () => {
  it('hides when Attention is empty and never invents an idle task', () => {
    expect(ambientAttentionSnapshot([])).toEqual({ visible: false, count: 0, items: [] });
  });

  it('preserves reducer order, caps detail, and de-duplicates transport repeats', () => {
    const items = [
      item({ id: 'alert', level: 'alert', title: 'Error' }),
      item({ id: 'action', title: 'Input' }),
      item({ id: 'review', level: 'review', title: 'Review' }),
      item({ id: 'four', title: 'Fourth' }),
      item({ id: 'five', title: 'Must be bounded' }),
      item({ id: 'alert', title: 'Duplicate transport copy' }),
    ];
    const snapshot = ambientAttentionSnapshot(items);
    expect(snapshot).toMatchObject({ visible: true, count: 5, highestLevel: 'alert' });
    expect(snapshot.items.map((entry) => entry.id)).toEqual(['alert', 'action', 'review', 'four']);
  });

  it('rejects missing provenance and non-observed verification instead of upgrading it', () => {
    expect(() => ambientAttentionSnapshot([item({ sourceRef: '' })])).toThrow(/provenance/i);
    expect(() => ambientAttentionSnapshot([item({ verification: 'UNKNOWN' })])).toThrow(/verification/i);
    expect(() => ambientAttentionSnapshot([item({ verification: 'INFERRED' })])).toThrow(/verification/i);
  });
});

describe('Ambient Island preference and display bounds', () => {
  it('is opt-in and rejects malformed persisted state', () => {
    expect(DEFAULT_AMBIENT_PREFERENCE).toEqual({ schemaVersion: 1, enabled: false, expanded: false });
    expect(normalizeAmbientPreference({ schemaVersion: 1, enabled: true, expanded: true, x: 22, y: 30 }))
      .toEqual({ schemaVersion: 1, enabled: true, expanded: true, x: 22, y: 30 });
    expect(normalizeAmbientPreference({ schemaVersion: 2, enabled: true })).toEqual(DEFAULT_AMBIENT_PREFERENCE);
  });

  it('uses the containing display, but sends stale off-screen positions to primary', () => {
    const displays = [
      { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
      { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } },
    ];
    expect(selectAmbientWorkArea({ x: 1600, y: 30 }, displays, 1)).toEqual(displays[1].workArea);
    expect(selectAmbientWorkArea({ x: 9000, y: -4000 }, displays, 1)).toEqual(displays[0].workArea);
  });

  it('clamps restored and resized bounds fully inside the selected work area', () => {
    expect(clampAmbientBounds(
      { x: 9_000, y: -2_000, width: 380, height: 320 },
      { x: -1920, y: 0, width: 1920, height: 1040 },
    )).toEqual({ x: -380, y: 0, width: 380, height: 320 });
  });
});
