import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../src/core/types';
import {
  executionIdForEvent,
  projectRuntimeExecutions,
  resolveExecutionIdForAttention,
} from '../../src/core/project/runtimeInspector';

function event(
  id: string,
  kind: ActivityEvent['kind'],
  at: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id,
    projectId: 'creative-os',
    conversationKey: 'creative-os:runtime',
    kind,
    summary: kind,
    observed: {
      source: 'protocol',
      sourceRef: `fixture:${id}`,
      observedAt: at,
      verification: 'VERIFIED',
    },
    ...extra,
  };
}

describe('Runtime Inspector execution projection', () => {
  it('correlates an earlier dispatch receipt to its later native execution without creating an intent execution', () => {
    const events = [
      event('dispatch', 'handoff-dispatched', '2026-08-31T01:00:00.000Z', {
        harness: 'codex', attentionKey: 'intent-1',
      }),
      event('accepted', 'handoff-accepted', '2026-08-31T01:00:01.000Z', {
        harness: 'codex', attentionKey: 'intent-1', runtimeRef: 'thread-1',
      }),
      event('started', 'session-started', '2026-08-31T01:00:02.000Z', {
        harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'working',
        binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'thread-1' },
      }),
    ];

    const projected = projectRuntimeExecutions(events, ['codex::thread-1']);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      executionId: 'codex::thread-1',
      intentId: 'intent-1',
      intentState: 'accepted',
      state: 'working',
      live: true,
      startedAt: '2026-08-31T01:00:01.000Z',
      observed: expect.objectContaining({ sourceRef: 'fixture:accepted' }),
    });
    expect(projected[0].events.map((item) => item.id)).toEqual(['dispatch', 'accepted', 'started']);
  });

  it('projects multiple executions for one Conversation and keeps equal native refs separate by Harness', () => {
    const events = [
      event('codex-a', 'session-started', '2026-08-31T01:00:00.000Z', {
        harness: 'codex', runtimeRef: 'same-ref', runtimeState: 'working',
        binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'same-ref' },
      }),
      event('claude-a', 'session-started', '2026-08-31T01:00:01.000Z', {
        harness: 'claude', runtimeRef: 'same-ref', runtimeState: 'idle',
        binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'same-ref' },
      }),
      event('codex-b', 'session-started', '2026-08-31T01:00:02.000Z', {
        harness: 'codex', runtimeRef: 'thread-2', runtimeState: 'unknown',
        binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'thread-2' },
      }),
    ];

    expect(projectRuntimeExecutions(events).map((item) => item.executionId).sort()).toEqual([
      'claude::same-ref', 'codex::same-ref', 'codex::thread-2',
    ]);
  });

  it('uses an observed binding external ref as identity and rejects contradictory identity fields', () => {
    const bindingOnly = event('binding', 'session-started', '2026-08-31T01:00:00.000Z', {
      harness: 'claude',
      binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'session-1' },
    });
    const contradictory = event('bad', 'session-started', '2026-08-31T01:00:01.000Z', {
      harness: 'codex', runtimeRef: 'thread-a',
      binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'thread-b' },
    });

    expect(executionIdForEvent(bindingOnly)).toBe('claude::session-1');
    expect(executionIdForEvent(contradictory)).toBeNull();
    expect(projectRuntimeExecutions([bindingOnly, contradictory]).map((item) => item.executionId)).toEqual([
      'claude::session-1',
    ]);
  });

  it('does not turn an accepted receipt into completion or historical activity into live state', () => {
    const accepted = event('accepted', 'handoff-accepted', '2026-08-31T01:00:00.000Z', {
      harness: 'codex', attentionKey: 'intent-1', runtimeRef: 'thread-1',
    });
    const [execution] = projectRuntimeExecutions([accepted]);
    expect(execution).toMatchObject({
      state: 'unknown', live: false, endedAt: null,
      intentState: 'accepted', receipt: { accepted: true },
    });
  });

  it('does not invent an execution for a dispatch or failed receipt without a native ref', () => {
    const events = [
      event('dispatch', 'handoff-dispatched', '2026-08-31T01:00:00.000Z', {
        harness: 'claude', attentionKey: 'intent-only',
      }),
      event('failed', 'handoff-failed', '2026-08-31T01:00:01.000Z', {
        harness: 'claude', attentionKey: 'intent-only',
      }),
    ];
    expect(projectRuntimeExecutions(events)).toEqual([]);
  });

  it('projects an observed user cancellation as stopped and cancelled, never error or completed', () => {
    const [execution] = projectRuntimeExecutions([
      event('started', 'session-started', '2026-08-31T01:00:00.000Z', {
        harness: 'claude', runtimeRef: 'session-cancelled', runtimeState: 'working',
      }),
      event('stopped', 'process-cancelled', '2026-08-31T01:00:01.000Z', {
        harness: 'claude', runtimeRef: 'session-cancelled', runtimeState: 'stopped',
      }),
      event('receipt', 'handoff-cancelled', '2026-08-31T01:00:02.000Z', {
        harness: 'claude', runtimeRef: 'session-cancelled', attentionKey: 'intent-cancelled',
      }),
    ]);
    expect(execution).toMatchObject({
      state: 'stopped', intentState: 'cancelled', receipt: { status: 'CANCELLED', accepted: false },
    });
    expect(execution.events.some((item) => item.kind === 'turn-completed')).toBe(false);
  });

  it('resolves Attention only to an exact execution observed in activity', () => {
    const runtime = event('runtime-error', 'harness-error', '2026-08-31T01:00:00.000Z', {
      harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'error',
    });
    const events = new Map([[runtime.id, runtime]]);
    expect(resolveExecutionIdForAttention({ eventRef: runtime.id }, events)).toBe('codex::thread-1');
    expect(resolveExecutionIdForAttention({ sessionRef: 'codex::thread-1' }, events)).toBe('codex::thread-1');
    expect(resolveExecutionIdForAttention({ sessionRef: 'codex::stale' }, events)).toBeNull();
    expect(resolveExecutionIdForAttention({ sessionRef: 'codex::' }, events)).toBeNull();
  });
});
