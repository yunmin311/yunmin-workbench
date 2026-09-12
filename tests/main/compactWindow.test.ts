import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCompactSnapshot,
  currentSelectionFromUser,
  normalizeCurrentSelection,
} from '../../src/core/compact/snapshot';
import {
  computeCompactBounds,
  defaultCompactBounds,
} from '../../src/main/compactWindow';
import {
  readCurrentSelection,
  writeCurrentSelectionAtomic,
} from '../../src/main/currentSelectionPersistence';
import { compileWorkGraph } from '../../src/core/workgraph/compiler';
import { reduceAttention, applyAttentionLocalState } from '../../src/core/attention/reducer';
import type { ActivityEvent, AttentionItem } from '../../src/core/types';

const NOW = '2026-09-12T00:00:00.000Z';
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const DISPLAYS = [{ id: 1, workArea: WORK_AREA }];

function revisionFixture() {
  const facts = {
    governanceBindings: [{
      projectId: 'creative-os', workId: '001-inspiration-capture', workLabel: '灵感采集',
      binding: { projectId: 'creative-os', root: '/repo', canonicalPath: '/repo', observedAt: NOW, verification: 'VERIFIED' as const },
    }],
    historySessions: [], memoryEntries: [], packets: [], handoffs: [], adapterExecutions: [],
    contextItems: [], attentionItems: [], artifacts: [],
    tasks: [{
      taskId: 'T006', projectId: 'creative-os', label: '定义主/渲染共享类型', source: 'canonical-project-fact',
      sourceRef: 'specs/001-inspiration-capture/tasks.md#T006', observedAt: NOW, verification: 'VERIFIED' as const,
      currentness: 'CURRENT' as const, workId: '001-inspiration-capture', evidenceRefs: [],
    }],
    evidenceItems: [],
  };
  return compileWorkGraph({ projectId: 'creative-os', sourceDigest: 'fixture', facts: facts as never, now: NOW })
    .then((result) => result.revision ?? null);
}

function attentionEvent(id: string, kind: 'approval-required'): ActivityEvent {
  return {
    id, projectId: 'creative-os', conversationKey: 'k', kind,
    summary: `needs approval ${id}`, attentionKey: id, attentionKind: kind, attentionStatus: 'active',
    observed: { source: 'protocol', sourceRef: `protocol:${id}`, observedAt: NOW, verification: 'VERIFIED' },
  } as ActivityEvent;
}

describe('Compact current-selection bookmark (thin local UI state)', () => {
  it('persists only explicit selections and never derives one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-compact-sel-'));
    expect(await readCurrentSelection(root)).toBeNull();
    await writeCurrentSelectionAtomic(root, currentSelectionFromUser({
      projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006',
    }, NOW));
    const loaded = await readCurrentSelection(root);
    expect(loaded).toMatchObject({
      schemaVersion: 1, projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006',
    });
    // Corrupt file -> null, never a guessed selection.
    await writeCurrentSelectionAtomic(root, currentSelectionFromUser({ projectId: 'creative-os' }, NOW));
    const bogus = await import('node:fs/promises');
    await bogus.writeFile(join(root, 'current-selection-v1.json'), '{"projectId":"creative-os"}', 'utf8');
    expect(await readCurrentSelection(root)).toBeNull();
  });
});

describe('Compact snapshot assembly (same facts as Full, nothing invented)', () => {
  it('shows nothing without an explicit selection — no guessed current Task', async () => {
    const revision = await revisionFixture();
    const snapshot = buildCompactSnapshot({ selection: null, revision, liveExecutions: [], attentionItems: [] });
    expect(snapshot).toEqual({ project: null, work: null, task: null, running: [], attention: [] });
  });

  it('projects exact canonical identity from the shared WorkGraph revision', async () => {
    const revision = await revisionFixture();
    const snapshot = buildCompactSnapshot({
      selection: currentSelectionFromUser({ projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006' }, NOW),
      revision,
      liveExecutions: [],
      attentionItems: [],
    });
    expect(snapshot.project).toEqual({ projectId: 'creative-os' });
    expect(snapshot.work).toMatchObject({ workId: '001-inspiration-capture', currentness: 'CURRENT' });
    // Canonical manifest declares no lifecycle -> taskState stays unknown, never upgraded.
    expect(snapshot.task).toMatchObject({ taskId: 'T006', taskState: 'unknown' });
    expect(snapshot.running).toEqual([]);
    expect(snapshot.attention).toEqual([]);
  });

  it('running appears only from real live executions; attention only from real instances', async () => {
    const revision = await revisionFixture();
    const base = {
      selection: currentSelectionFromUser({ projectId: 'creative-os', workId: '001-inspiration-capture' }, NOW),
      revision,
    };
    // No execution -> no Running module. No attention instance -> no Attention module.
    expect(buildCompactSnapshot({ ...base, liveExecutions: [], attentionItems: [] }))
      .toMatchObject({ running: [], attention: [] });

    const attention: AttentionItem[] = applyAttentionLocalState(
      reduceAttention({ activity: [attentionEvent('evt-1', 'approval-required')], limit: 200 }),
      { schemaVersion: 1, dismissed: {} },
    );
    const withFacts = buildCompactSnapshot({
      ...base,
      liveExecutions: [{ executionId: 'exec-1', harness: 'claude', startedAt: NOW }],
      attentionItems: attention,
    });
    expect(withFacts.running).toEqual([{ executionId: 'exec-1', harness: 'claude', startedAt: NOW }]);
    expect(withFacts.attention).toHaveLength(1);
    expect(withFacts.attention[0]).toMatchObject({ level: 'action', title: 'Approval required' });
  });
});

describe('Compact window bounds (multi-monitor / DPI clamping)', () => {
  it('defaults to the top-right edge of the primary work area, clamped', () => {
    const bounds = defaultCompactBounds(WORK_AREA, false);
    expect(bounds.width).toBe(380);
    expect(bounds.y).toBe(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WORK_AREA.width);
    const expanded = defaultCompactBounds(WORK_AREA, true);
    expect(expanded.height).toBe(320);
  });

  it('restores persisted bounds onto the containing display and clamps invalid ones', () => {
    const displays = [
      { id: 1, workArea: WORK_AREA },
      { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 720 } },
    ];
    // Valid second-display position stays on that display.
    const onSecond = computeCompactBounds(
      { schemaVersion: 1, expanded: false, x: 2600, y: 40 },
      displays, 1,
    );
    expect(onSecond.x).toBeGreaterThanOrEqual(1920);
    // Persisted position outside every display snaps back into the primary.
    const offScreen = computeCompactBounds(
      { schemaVersion: 1, expanded: false, x: -900, y: -900 },
      displays, 1,
    );
    expect(offScreen.x).toBeGreaterThanOrEqual(0);
    expect(offScreen.y).toBeGreaterThanOrEqual(0);
    expect(offScreen.x + offScreen.width).toBeLessThanOrEqual(WORK_AREA.width);
    // Absurd size clamps to the work area.
    const huge = computeCompactBounds(
      { schemaVersion: 1, expanded: true, x: 10, y: 10, width: 9999, height: 9999 },
      [{ id: 1, workArea: { x: 0, y: 0, width: 800, height: 600 } }], 1,
    );
    expect(huge.width).toBeLessThanOrEqual(800);
    expect(huge.height).toBeLessThanOrEqual(600);
  });
});
