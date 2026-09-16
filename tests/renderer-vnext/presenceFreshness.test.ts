import { describe, expect, it, vi } from 'vitest';
import type { HarnessSessionPresence } from '../../src/core/types';
import { startHarnessPresenceRefresh } from '../../src/renderer-vnext/src/presenceFreshness';
import type { RuntimePresenceSnapshot } from '../../src/core/runtimePresence';
import type { ActivityEvent } from '../../src/core/types';

const session = (nativeRef: string): HarnessSessionPresence => ({
  harness: 'opencode',
  nativeRef,
  label: nativeRef,
  runtimeState: 'unknown',
  sourceRef: `opencode:session:list:${nativeRef}`,
  observedAt: '2026-09-15T00:00:00.000Z',
});

const activityEvent = (): ActivityEvent => ({
  id: 'evt-refresh', projectId: 'project-a', conversationKey: 'project-a::codex::main',
  kind: 'agent-response', summary: 'activity', harness: 'codex',
  observed: { source: 'protocol', sourceRef: 'codex:item', observedAt: '2026-09-15T00:00:00Z', verification: 'OBSERVED' },
});

describe('Full Workbench harness presence freshness', () => {
  it('shows a short execution from the authority stream even before the first poll settles', async () => {
    let runtimeEvent: ((event: import('../../src/core/runtimePresence').RuntimePresenceEnvelope) => void) | undefined;
    const verdicts: string[][] = [];
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions: vi.fn().mockResolvedValue([]),
      apply: () => undefined,
      applyRuntimePresence: (snapshot) => verdicts.push(snapshot.executions.map((item) => item.executionId)),
      subscribeActivity: () => () => undefined,
      subscribeRuntimePresence: (listener) => { runtimeEvent = listener; return () => undefined; },
    });
    const execution = {
      executionId: 'opencode::execution:intent-short', harness: 'opencode' as const,
      externalSessionRef: 'ses_short', startedAt: '2026-09-16T00:00:00Z', canCancel: true,
    };
    runtimeEvent?.({
      kind: 'mutation', epoch: 'epoch-short', previousRevision: 0, revision: 1,
      mutation: { type: 'upsert', execution },
    });
    runtimeEvent?.({
      kind: 'mutation', epoch: 'epoch-short', previousRevision: 1, revision: 2,
      mutation: { type: 'remove', executionId: execution.executionId },
    });

    expect(verdicts).toEqual([[execution.executionId], []]);
    controller.dispose();
  });

  it('uses Activity only to request an authoritative refresh', async () => {
    let activity: ((event: ActivityEvent) => void) | undefined;
    const empty: RuntimePresenceSnapshot = { kind: 'snapshot', epoch: 'epoch-a', revision: 2, executions: [] };
    const applied: RuntimePresenceSnapshot[] = [];
    const loadRuntimePresence = vi.fn().mockResolvedValue(empty);
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions: vi.fn().mockResolvedValue([]),
      apply: () => undefined,
      loadRuntimePresence,
      applyRuntimePresence: (snapshot) => applied.push(snapshot),
      subscribeActivity: (listener) => { activity = listener; return () => undefined; },
      subscribeRuntimePresence: () => () => undefined,
    });

    activity?.({
      id: 'late-start', projectId: 'project-a', conversationKey: 'conversation',
      kind: 'turn-started', summary: 'historical start', harness: 'opencode',
      runtimeRef: 'ses_ended', intentId: 'intent-ended',
      observed: { source: 'protocol', sourceRef: 'late', observedAt: '2026-09-16T00:00:00Z', verification: 'VERIFIED' },
    });
    await vi.waitFor(() => expect(applied).toHaveLength(1));
    expect(loadRuntimePresence).toHaveBeenCalledOnce();
    expect(applied.at(-1)?.executions).toEqual([]);
    controller.dispose();
  });
  it('refreshes only session presence on activity and the bounded interval', async () => {
    vi.useFakeTimers();
    let activity: ((event: ActivityEvent) => void) | undefined;
    const applied: string[][] = [];
    const listSessions = vi.fn()
      .mockResolvedValueOnce([session('ses_initial')])
      .mockResolvedValueOnce([session('ses_activity')])
      .mockResolvedValueOnce([session('ses_interval')]);
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions,
      apply: (sessions) => applied.push(sessions.map((item) => item.nativeRef)),
      subscribeActivity: (listener) => { activity = listener; return () => { activity = undefined; }; },
    });

    await controller.refresh();
    activity?.(activityEvent());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(listSessions).toHaveBeenCalledTimes(3);
    expect(applied).toEqual([['ses_initial'], ['ses_activity'], ['ses_interval']]);
    controller.dispose();
    vi.useRealTimers();
  });

  it('drops a late response after the selected Project changes', async () => {
    let projectId = 'project-a';
    let resolveFirst!: (sessions: HarnessSessionPresence[]) => void;
    const first = new Promise<HarnessSessionPresence[]>((resolve) => { resolveFirst = resolve; });
    const applied: string[][] = [];
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => projectId,
      listSessions: () => first,
      apply: (sessions) => applied.push(sessions.map((item) => item.nativeRef)),
      subscribeActivity: () => () => undefined,
    });

    const pending = controller.refresh();
    projectId = 'project-b';
    resolveFirst([session('ses_wrong_project')]);
    await pending;

    expect(applied).toEqual([]);
    controller.dispose();
  });

  it('does not churn the Full workspace when only observation time changes', async () => {
    const applied: HarnessSessionPresence[][] = [];
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions: vi.fn()
        .mockResolvedValueOnce([session('ses_stable')])
        .mockResolvedValueOnce([{ ...session('ses_stable'), observedAt: '2026-09-15T00:00:04.000Z' }]),
      apply: (sessions) => applied.push(sessions),
      subscribeActivity: () => () => undefined,
    });

    await controller.refresh();
    await controller.refresh();

    expect(applied).toHaveLength(1);
    controller.dispose();
  });

  it('refreshes authoritative live execution and Attention even when session rows stay unchanged', async () => {
    const runtime: string[][] = [];
    const attention: number[] = [];
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions: vi.fn().mockResolvedValue([session('ses_stable')]),
      apply: () => undefined,
      loadRuntimePresence: vi.fn()
        .mockResolvedValueOnce({ kind: 'snapshot', epoch: 'epoch-a', revision: 0, executions: [] })
        .mockResolvedValueOnce({
          kind: 'snapshot', epoch: 'epoch-a', revision: 1,
          executions: [{ executionId: 'opencode::execution:intent-1', harness: 'opencode', externalSessionRef: 'ses_live', startedAt: '2026-09-15T00:00:00Z', canCancel: true }],
        }),
      applyRuntimePresence: (snapshot) => runtime.push(snapshot.executions.map((item) => item.executionId)),
      loadAttention: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{}]),
      applyAttention: (items) => attention.push(items.length),
      subscribeActivity: () => () => undefined,
    });

    await controller.refresh();
    await controller.refresh();
    expect(runtime).toEqual([[], ['opencode::execution:intent-1']]);
    expect(attention).toEqual([0, 1]);
    controller.dispose();
  });
});
