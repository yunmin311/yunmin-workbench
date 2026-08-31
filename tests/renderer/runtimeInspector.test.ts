import { describe, expect, it } from 'vitest';
import type { RuntimeExecutionView } from '../../src/core/project/runtimeInspector';
import {
  latestRuntimeExecutionForConversation,
  resolveRuntimeInspectorScope,
  runtimeCancelAvailability,
} from '../../src/renderer/src/runtimeInspectorModel';

function execution(
  executionId: string,
  startedAt: string,
  extra: Partial<RuntimeExecutionView> = {},
): RuntimeExecutionView {
  const separator = executionId.indexOf('::');
  return {
    executionId,
    harness: executionId.slice(0, separator),
    nativeRef: executionId.slice(separator + 2),
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::CO 主对话',
    binding: null,
    state: 'unknown',
    live: false,
    startedAt,
    endedAt: null,
    intentId: null,
    intentState: 'unknown',
    receipt: null,
    observed: null,
    events: [],
    ...extra,
  };
}

describe('Runtime Inspector renderer model', () => {
  it('selects the exact harness-scoped execution when native refs are equal', () => {
    const list = [
      execution('codex::same-ref', '2026-08-31T01:00:00.000Z'),
      execution('claude::same-ref', '2026-08-31T01:00:01.000Z'),
    ];
    const result = resolveRuntimeInspectorScope({
      executions: list,
      targetExecutionId: 'claude::same-ref',
      selectedExecutionId: null,
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::CO 主对话',
    });
    expect(result.selected?.executionId).toBe('claude::same-ref');
    expect(result.targetUnavailable).toBe(false);
  });

  it('fails a stale exact target closed instead of selecting the latest execution', () => {
    const result = resolveRuntimeInspectorScope({
      executions: [execution('codex::latest', '2026-08-31T01:00:02.000Z')],
      targetExecutionId: 'codex::stale',
      selectedExecutionId: null,
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::CO 主对话',
    });
    expect(result.targetUnavailable).toBe(true);
    expect(result.selected).toBeNull();
  });

  it('chooses the newest execution for a Conversation without borrowing another execution live state', () => {
    const older = execution('codex::older', '2026-08-31T01:00:00.000Z', { live: true, state: 'working' });
    const newer = execution('claude::newer', '2026-08-31T01:00:03.000Z', { live: false, state: 'idle' });
    expect(latestRuntimeExecutionForConversation([older, newer], 'creative-os::claude::CO 主对话')).toBe(newer);
  });

  it('enables Cancel only for the exact live entry whose adapter exposes cancel', () => {
    const selected = execution('claude::session-1', '2026-08-31T01:00:00.000Z', { live: true });
    expect(runtimeCancelAvailability(selected, [])).toMatchObject({ enabled: false, reason: 'not-live' });
    expect(runtimeCancelAvailability(selected, [{
      executionId: 'claude::session-1', harness: 'claude', externalSessionRef: 'session-1',
      startedAt: '2026-08-31T01:00:00.000Z', canCancel: false,
    }])).toMatchObject({ enabled: false, reason: 'unsupported' });
    expect(runtimeCancelAvailability(selected, [{
      executionId: 'claude::session-1', harness: 'claude', externalSessionRef: 'session-1',
      startedAt: '2026-08-31T01:00:00.000Z', canCancel: true,
    }])).toEqual({ enabled: true, reason: null });
  });
});
