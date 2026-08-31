import { describe, expect, it } from 'vitest';
import { applyAttentionLocalState, reduceAttention } from '../../src/core/attention/reducer';
import type {
  ActivityEvent,
  AttentionGateFact,
  AttentionLocalState,
  AttentionPacketFact,
  RuntimeSession,
} from '../../src/core/types';
import { isReviewWorthyCodexFileChange } from '../../src/core/attention/codexSignals';

const observed = (at: string, verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN' = 'OBSERVED') => ({
  source: 'protocol' as const,
  sourceRef: `protocol:${at}`,
  observedAt: at,
  verification,
});

function event(id: string, kind: ActivityEvent['kind'], at: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id,
    projectId: 'project-a',
    conversationKey: 'project-a::codex::main',
    harness: 'codex',
    kind,
    summary: `${kind} ${id}`,
    observed: observed(at),
    ...extra,
  };
}

describe('Attention reducer', () => {
  it('deduplicates repeated explicit approval observations and keeps the newest provenance', () => {
    const items = reduceAttention({ activity: [
      event('approval-old', 'approval-required', '2026-08-30T10:00:00Z', { attentionKey: 'approval:turn-1' }),
      event('approval-new', 'approval-required', '2026-08-30T10:01:00Z', { attentionKey: 'approval:turn-1', summary: 'Approve shell access' }),
    ] });

    expect(items).toEqual([expect.objectContaining({
      kind: 'approval-required', level: 'action', summary: 'Approve shell access',
      eventRef: 'approval-new', observedAt: '2026-08-30T10:01:00Z', verification: 'OBSERVED',
    })]);
  });

  it('projects only explicit approval, needs-input, failures, errors, invalid sources, and review-worthy completion', () => {
    const packetFacts: AttentionPacketFact[] = [
      { key: 'packet:a', projectId: 'project-a', conversationKey: 'project-a::codex::main', validity: 'STALE', packetRef: 'packet:a:v1', observed: observed('2026-08-30T11:00:00Z', 'VERIFIED') },
      { key: 'packet:b', projectId: 'project-b', conversationKey: 'project-b::codex::main', validity: 'INVALID', packetRef: 'packet:b:v2', observed: observed('2026-08-30T11:01:00Z', 'VERIFIED') },
    ];
    const gateFacts: AttentionGateFact[] = [
      { key: 'gate:a', projectId: 'project-a', status: 'failed', title: 'Release gate', summary: 'Release gate failed', observed: observed('2026-08-30T11:02:00Z', 'VERIFIED') },
    ];
    const items = reduceAttention({
      activity: [
        event('approval', 'approval-required', '2026-08-30T10:00:00Z', { attentionKey: 'approval:1' }),
        event('input', 'needs-user-input', '2026-08-30T10:01:00Z', { attentionKey: 'input:1' }),
        event('receipt', 'handoff-failed', '2026-08-30T10:02:00Z'),
        event('runtime', 'turn-error', '2026-08-30T10:03:00Z', { runtimeRef: 'thread-1' }),
        event('review', 'turn-completed', '2026-08-30T10:04:00Z', { runtimeRef: 'thread-2', attentionKey: 'review:turn-2', attentionKind: 'execution-review' }),
      ],
      packetFacts,
      gateFacts,
    });

    expect(new Set(items.map((item) => item.kind))).toEqual(new Set([
      'approval-required', 'needs-user-input', 'receipt-failed', 'runtime-error',
      'execution-review', 'packet-stale', 'packet-invalid', 'gate-attention',
    ]));
  });

  it('does not emit normal or UNKNOWN state and never derives Attention from unrelated fields', () => {
    const runtime: RuntimeSession = {
      id: 'thread-normal', conversationKey: 'project-b::codex::main',
      binding: { harness: 'codex', machine: 'machine', cwd: 'E:\\same-cwd' },
      state: 'unknown', observed: observed('2026-08-30T12:00:00Z', 'UNKNOWN'), startedAt: '2026-08-30T12:00:00Z',
    };
    expect(reduceAttention({
      activity: [
        event('accepted', 'handoff-accepted', '2026-08-30T12:00:00Z'),
        event('started', 'turn-started', '2026-08-30T12:01:00Z', { runtimeRef: 'thread-normal' }),
        event('tool', 'tool-completed', '2026-08-30T12:02:00Z'),
      ],
      runtimeSessions: [runtime],
      packetFacts: [{ key: 'packet', projectId: 'project-a', validity: 'UNKNOWN', packetRef: 'packet:x', observed: observed('2026-08-30T12:03:00Z', 'UNKNOWN') }],
      gateFacts: [{ key: 'gate', projectId: 'project-a', status: 'unknown', title: 'Unknown gate', summary: 'Unknown', observed: observed('2026-08-30T12:04:00Z', 'UNKNOWN') }],
    })).toEqual([]);
  });

  it('keeps an observed user cancellation in Activity without turning it into Attention', () => {
    expect(reduceAttention({ activity: [
      event('cancel-process', 'process-cancelled', '2026-08-30T12:05:00Z', {
        harness: 'claude', runtimeRef: 'session-1', runtimeState: 'stopped',
      }),
      event('cancel-receipt', 'handoff-cancelled', '2026-08-30T12:05:01Z', {
        harness: 'claude', runtimeRef: 'session-1', attentionKey: 'intent-cancelled',
      }),
    ] })).toEqual([]);
  });

  it('rejects UNKNOWN, INFERRED, and heuristic observations from Attention', () => {
    const heuristic = observed('2026-08-30T12:09:00Z', 'VERIFIED');
    const items = reduceAttention({
      activity: [
        event('unknown-approval', 'approval-required', '2026-08-30T12:05:00Z', {
          attentionKey: 'unknown', observed: observed('2026-08-30T12:05:00Z', 'UNKNOWN'),
        }),
        event('inferred-error', 'turn-error', '2026-08-30T12:06:00Z', {
          runtimeRef: 'thread-inferred', observed: observed('2026-08-30T12:06:00Z', 'INFERRED'),
        }),
      ],
      packetFacts: [{
        key: 'inferred-packet', projectId: 'project-a', validity: 'INVALID', packetRef: 'packet',
        observed: observed('2026-08-30T12:07:00Z', 'INFERRED'),
      }],
      gateFacts: [{
        key: 'heuristic-gate', projectId: 'project-a', status: 'failed', title: 'Gate', summary: 'Gate failed',
        observed: { ...heuristic, source: 'heuristic' },
      }],
    });
    expect(items).toEqual([]);
  });

  it('removes resolved facts while retaining the append-only source history', () => {
    const activity = [
      event('approval-active', 'approval-required', '2026-08-30T13:00:00Z', { attentionKey: 'approval:1' }),
      event('approval-resolved', 'approval-required', '2026-08-30T13:01:00Z', { attentionKey: 'approval:1', attentionStatus: 'resolved' }),
      event('runtime-error', 'turn-error', '2026-08-30T13:02:00Z', { runtimeRef: 'thread-1' }),
      event('runtime-recovered', 'turn-started', '2026-08-30T13:03:00Z', { runtimeRef: 'thread-1' }),
      event('receipt-failed', 'handoff-failed', '2026-08-30T13:04:00Z', { attentionKey: 'intent:resolved' }),
      event('receipt-accepted', 'handoff-accepted', '2026-08-30T13:05:00Z', { attentionKey: 'intent:resolved' }),
    ];
    expect(reduceAttention({ activity })).toEqual([]);
    expect(activity).toHaveLength(6);
  });

  it('does not resolve one intent failure with another intent or an unrelated runtime event', () => {
    const items = reduceAttention({ activity: [
      event('failed-intent-a', 'handoff-failed', '2026-08-30T13:10:00Z', { attentionKey: 'intent-a' }),
      event('accepted-intent-b', 'handoff-accepted', '2026-08-30T13:11:00Z', { attentionKey: 'intent-b' }),
      event('harness-intent-c', 'harness-error', '2026-08-30T13:12:00Z', { attentionKey: 'intent-c' }),
      event('unrelated-turn', 'turn-started', '2026-08-30T13:13:00Z', { runtimeRef: 'thread-other' }),
    ] });
    expect(items.map((item) => item.eventRef)).toEqual(expect.arrayContaining([
      'failed-intent-a', 'harness-intent-c',
    ]));
  });

  it('uses exact turn refs for resolution when broader runtime or intent refs are absent', () => {
    expect(reduceAttention({ activity: [
      event('failed-by-turn', 'handoff-failed', '2026-08-30T13:20:00Z', { turnRef: 'turn-receipt' }),
      event('accepted-by-turn', 'handoff-accepted', '2026-08-30T13:21:00Z', { turnRef: 'turn-receipt' }),
      event('error-by-turn', 'turn-error', '2026-08-30T13:22:00Z', { turnRef: 'turn-runtime' }),
      event('recovered-by-turn', 'turn-started', '2026-08-30T13:23:00Z', { turnRef: 'turn-runtime' }),
    ] })).toEqual([]);
  });

  it('does not let a later turn on the same thread resolve an earlier turn error', () => {
    const items = reduceAttention({ activity: [
      event('turn-a-error', 'turn-error', '2026-08-30T13:30:00Z', {
        runtimeRef: 'thread-shared', turnRef: 'turn-a',
      }),
      event('turn-b-started', 'turn-started', '2026-08-30T13:31:00Z', {
        runtimeRef: 'thread-shared', turnRef: 'turn-b',
      }),
    ] });
    expect(items).toEqual([expect.objectContaining({ eventRef: 'turn-a-error', sessionRef: 'thread-shared' })]);
  });

  it('marks only protocol-confirmed successful file changes as review-worthy', () => {
    expect(isReviewWorthyCodexFileChange('item/completed', { type: 'fileChange', status: 'completed' })).toBe(true);
    expect(isReviewWorthyCodexFileChange('item/completed', { type: 'fileChange', status: 'failed' })).toBe(false);
    expect(isReviewWorthyCodexFileChange('item/completed', { type: 'fileChange', status: 'declined' })).toBe(false);
    expect(isReviewWorthyCodexFileChange('item/started', { type: 'fileChange', status: 'completed' })).toBe(false);
  });

  it('does not pair an event to a different session using equal cwd or provider', () => {
    const runtime: RuntimeSession = {
      id: 'thread-b', conversationKey: 'project-b::codex::main',
      binding: { harness: 'codex', machine: 'machine', cwd: 'E:\\shared' },
      state: 'error', observed: observed('2026-08-30T14:01:00Z'), startedAt: '2026-08-30T14:00:00Z',
    };
    const [item] = reduceAttention({
      activity: [event('ordinary-a', 'turn-started', '2026-08-30T14:00:00Z', { binding: { harness: 'codex', machine: 'machine', cwd: 'E:\\shared' } })],
      runtimeSessions: [runtime],
    });
    expect(item).toMatchObject({ kind: 'runtime-error', conversationKey: 'project-b::codex::main', sessionRef: 'thread-b' });
    expect(item.projectId).toBeUndefined();
  });

  it('keeps the explicit event provenance when a runtime projection repeats the same observation', () => {
    const errorEvent = event('runtime-event', 'turn-error', '2026-08-30T14:05:00Z', { harness: 'codex', runtimeRef: 'thread-explicit' });
    const [item] = reduceAttention({
      activity: [errorEvent],
      runtimeSessions: [{
        id: 'codex::thread-explicit', conversationKey: errorEvent.conversationKey,
        binding: { harness: 'codex', machine: 'machine', cwd: 'E:\\project-a' },
        state: 'error', observed: errorEvent.observed, startedAt: errorEvent.observed.observedAt,
      }],
    });
    expect(item).toMatchObject({ eventRef: 'runtime-event', projectId: 'project-a' });
  });

  it('filters only the dismissed observation version and lets a newer observation reappear', () => {
    const first = reduceAttention({ activity: [event('failed-1', 'handoff-failed', '2026-08-30T15:00:00Z')] });
    const local: AttentionLocalState = { schemaVersion: 1, dismissed: { [first[0].id]: first[0].observedAt } };
    expect(applyAttentionLocalState(first, local)).toEqual([]);

    const updated = reduceAttention({ activity: [
      event('failed-1', 'handoff-failed', '2026-08-30T15:00:00Z'),
      event('failed-2', 'handoff-failed', '2026-08-30T15:01:00Z'),
    ] });
    expect(applyAttentionLocalState(updated, local)).toHaveLength(1);
  });

  it('keeps a version-keyed packet dismissal across re-observation and reappears for changed dependencies', () => {
    const first = reduceAttention({ packetFacts: [{
      key: 'packet-hash:STALE:deps-a', projectId: 'project-a', validity: 'STALE', packetRef: 'v1:packet-hash',
      observed: observed('2026-08-30T15:10:00Z', 'VERIFIED'),
    }], activity: [] });
    const local: AttentionLocalState = { schemaVersion: 1, dismissed: { [first[0].id]: first[0].observedAt } };
    const sameDependencies = reduceAttention({ packetFacts: [{
      key: 'packet-hash:STALE:deps-a', projectId: 'project-a', validity: 'STALE', packetRef: 'v1:packet-hash',
      observed: observed('2026-08-30T15:11:00Z', 'VERIFIED'),
    }], activity: [] });
    const changedDependencies = reduceAttention({ packetFacts: [{
      key: 'packet-hash:STALE:deps-b', projectId: 'project-a', validity: 'STALE', packetRef: 'v1:packet-hash',
      observed: observed('2026-08-30T15:12:00Z', 'VERIFIED'),
    }], activity: [] });
    expect(applyAttentionLocalState(sameDependencies, local)).toEqual([]);
    expect(applyAttentionLocalState(changedDependencies, local)).toHaveLength(1);
  });

  it('bounds the projection without deleting source events', () => {
    const activity = Array.from({ length: 80 }, (_, index) => event(
      `approval-${index}`, 'approval-required', `2026-08-30T16:${String(index).padStart(2, '0')}:00Z`,
      { attentionKey: `approval:${index}` },
    ));
    expect(reduceAttention({ activity, limit: 25 })).toHaveLength(25);
    expect(activity).toHaveLength(80);
  });
});
