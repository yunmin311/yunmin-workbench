import { describe, expect, it, vi } from 'vitest';
import {
  handleCancelRequest,
  handleRuntimeLiveRequest,
} from '../../src/main/harnessControl';
import { LiveExecutionRegistry } from '../../src/main/liveExecutions';

describe('Runtime IPC boundaries', () => {
  it('accepts no runtime:live input and returns only process-local registry evidence', () => {
    const registry = new LiveExecutionRegistry();
    registry.add('codex', 'thread-1', '2026-08-31T01:00:00.000Z');
    expect(handleRuntimeLiveRequest(undefined, registry)).toEqual([
      expect.objectContaining({ executionId: 'codex::thread-1' }),
    ]);
    expect(() => handleRuntimeLiveRequest({ projectId: 'guess-me' }, registry)).toThrow('Invalid runtime:live request');
    expect(new LiveExecutionRegistry().list()).toEqual([]);
  });

  it('keeps equal external refs from different Harnesses distinct and rejects malformed refs', () => {
    const registry = new LiveExecutionRegistry();
    registry.add('codex', 'same-ref', '2026-08-31T01:00:00.000Z');
    registry.add('claude', 'same-ref', '2026-08-31T01:00:01.000Z', true);
    expect(registry.list().map((item) => [item.executionId, item.canCancel])).toEqual([
      ['claude::same-ref', true], ['codex::same-ref', false],
    ]);
    expect(() => registry.add('claude', '', '2026-08-31T01:00:02.000Z')).toThrow('Invalid native runtime ref');
  });

  it('keeps parallel Workbench executions distinct even when a native session ref is reused', () => {
    const registry = new LiveExecutionRegistry();
    registry.add('codex', 'shared-thread', '2026-08-31T01:00:00.000Z', false, 'intent-a');
    registry.add('codex', 'shared-thread', '2026-08-31T01:00:01.000Z', false, 'intent-b');
    expect(registry.list().map((item) => item.executionId)).toEqual([
      'codex::execution:intent-a', 'codex::execution:intent-b',
    ]);
  });

  it('fails malformed, stale, and unsupported cancel requests closed', () => {
    const cancelByIntent = vi.fn(() => true);
    const deps = {
      liveIntents: new Map([['claude::session-1', 'intent-1'], ['codex::thread-1', 'intent-2']]),
      cancelableHarnesses: new Set(['claude']),
      cancelByIntent,
    };

    expect(handleCancelRequest({ executionId: 'claude::' }, deps)).toEqual({
      delivered: false, reason: 'invalid-execution-id',
    });
    expect(handleCancelRequest({ executionId: 'claude::session-1', cwd: 'must-not-be-guessed' }, deps)).toEqual({
      delivered: false, reason: 'invalid-execution-id',
    });
    expect(handleCancelRequest({ executionId: 'claude::stale' }, deps)).toEqual({
      delivered: false, reason: 'no-live-context',
    });
    expect(handleCancelRequest({ executionId: 'codex::thread-1' }, deps)).toEqual({
      delivered: false, reason: 'cancel-not-supported',
    });
    expect(cancelByIntent).not.toHaveBeenCalled();
  });

  it('reports delivery only when the live adapter actually accepts cancel', () => {
    const deps = {
      liveIntents: new Map([['claude::session-1', 'intent-1']]),
      cancelableHarnesses: new Set(['claude']),
      cancelByIntent: vi.fn(() => false),
    };
    expect(handleCancelRequest({ executionId: 'claude::session-1' }, deps)).toEqual({
      delivered: false, reason: 'no-live-context',
    });
    deps.cancelByIntent.mockReturnValue(true);
    expect(handleCancelRequest({ executionId: 'claude::session-1' }, deps)).toEqual({ delivered: true });
    deps.cancelByIntent.mockImplementation(() => { throw new Error('adapter stopped'); });
    expect(handleCancelRequest({ executionId: 'claude::session-1' }, deps)).toEqual({
      delivered: false, reason: 'adapter-error',
    });
  });
});
