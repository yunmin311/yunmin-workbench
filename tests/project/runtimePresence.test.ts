import { describe, expect, it, vi } from 'vitest';
import {
  applyRuntimePresenceEnvelope,
  type RuntimePresenceEnvelope,
  type RuntimePresenceSnapshot,
} from '../../src/core/runtimePresence';
import { LiveExecutionRegistry } from '../../src/main/liveExecutions';

const execution = {
  executionId: 'opencode::execution:intent-1',
  harness: 'opencode' as const,
  externalSessionRef: 'ses_native',
  startedAt: '2026-09-16T00:00:00.000Z',
  canCancel: true,
};

describe('Runtime presence authority', () => {
  it('publishes one ordered mutation stream from the LiveExecutionRegistry', () => {
    const registry = new LiveExecutionRegistry({ epoch: 'epoch-a' });
    const received: RuntimePresenceEnvelope[] = [];
    registry.subscribe((envelope) => received.push(envelope));

    registry.add('opencode', 'ses_native', execution.startedAt, true, 'intent-1');
    registry.remove('opencode', 'ses_native', 'intent-1');
    registry.remove('opencode', 'ses_native', 'intent-1');

    expect(received).toEqual([
      {
        kind: 'mutation', epoch: 'epoch-a', previousRevision: 0, revision: 1,
        mutation: { type: 'upsert', execution },
      },
      {
        kind: 'mutation', epoch: 'epoch-a', previousRevision: 1, revision: 2,
        mutation: { type: 'remove', executionId: execution.executionId },
      },
    ]);
    expect(registry.snapshot()).toEqual({
      kind: 'snapshot', epoch: 'epoch-a', revision: 2, executions: [],
    });
  });

  it('rejects stale and gapped mutations and accepts a new restart epoch snapshot', () => {
    const initial: RuntimePresenceSnapshot = {
      kind: 'snapshot', epoch: 'epoch-a', revision: 2, executions: [execution],
    };
    const stale: RuntimePresenceEnvelope = {
      kind: 'mutation', epoch: 'epoch-a', previousRevision: 0, revision: 1,
      mutation: { type: 'upsert', execution: { ...execution, externalSessionRef: 'ses_stale' } },
    };
    const gap: RuntimePresenceEnvelope = {
      kind: 'mutation', epoch: 'epoch-a', previousRevision: 3, revision: 4,
      mutation: { type: 'remove', executionId: execution.executionId },
    };
    const restarted: RuntimePresenceEnvelope = {
      kind: 'snapshot', epoch: 'epoch-b', revision: 0, executions: [],
    };

    expect(applyRuntimePresenceEnvelope(initial, stale)).toEqual({
      snapshot: initial, accepted: false, needsSnapshot: false,
    });
    expect(applyRuntimePresenceEnvelope(initial, gap)).toEqual({
      snapshot: initial, accepted: false, needsSnapshot: true,
    });
    expect(applyRuntimePresenceEnvelope(initial, restarted)).toEqual({
      snapshot: restarted, accepted: true, needsSnapshot: false,
    });
  });

  it('keeps Full and Compact on the same verdict through start and finish', () => {
    const registry = new LiveExecutionRegistry({ epoch: 'epoch-shared' });
    let full = registry.snapshot();
    let compact = registry.snapshot();
    registry.subscribe((envelope) => {
      full = applyRuntimePresenceEnvelope(full, envelope).snapshot;
      compact = applyRuntimePresenceEnvelope(compact, envelope).snapshot;
    });

    registry.add('opencode', 'ses_native', execution.startedAt, true, 'intent-1');
    expect(full.executions).toHaveLength(1);
    expect(compact).toEqual(full);
    registry.remove('opencode', 'ses_native', 'intent-1');
    expect(full.executions).toEqual([]);
    expect(compact).toEqual(full);
  });

  it('does not allow an ended execution to be recreated by historical Activity', () => {
    const registry = new LiveExecutionRegistry({ epoch: 'epoch-a' });
    const onActivity = vi.fn((_event: unknown) => registry.snapshot());
    registry.add('opencode', 'ses_native', execution.startedAt, true, 'intent-1');
    registry.remove('opencode', 'ses_native', 'intent-1');

    const afterLateActivity = onActivity({ kind: 'turn-started', runtimeRef: 'ses_native' });
    expect(afterLateActivity.executions).toEqual([]);
  });
});
