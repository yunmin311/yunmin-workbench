import { describe, expect, it, vi } from 'vitest';
import type { HarnessSessionPresence } from '../../src/core/types';
import { projectLiveExecutionActivity, startHarnessPresenceRefresh } from '../../src/renderer-vnext/src/presenceFreshness';
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
  it('projects exact turn lifecycle immediately so a fast execution is not missed between polls', () => {
    const base: ActivityEvent = {
      id: 'evt-start', projectId: 'project-a', conversationKey: 'project-a::codex::main',
      kind: 'turn-started', summary: 'started', harness: 'codex', runtimeRef: 'thread-native',
      intentId: '11111111-1111-4111-8111-111111111111',
      observed: { source: 'protocol', sourceRef: 'codex:turn-started', observedAt: '2026-09-16T00:00:00Z', verification: 'VERIFIED' },
    };
    const running = projectLiveExecutionActivity([], base, 'project-a');
    expect(running).toEqual([expect.objectContaining({ harness: 'codex', externalSessionRef: 'thread-native', canCancel: false })]);
    expect(projectLiveExecutionActivity(running, { ...base, id: 'evt-finish', kind: 'turn-completed' }, 'project-a')).toEqual([]);
    expect(projectLiveExecutionActivity(running, { ...base, projectId: 'project-b' }, 'project-a')).toBe(running);
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

  it('refreshes live execution and attention even when session rows stay unchanged', async () => {
    const runtime: string[][] = [];
    const controller = startHarnessPresenceRefresh({
      currentProjectId: () => 'project-a',
      listSessions: vi.fn().mockResolvedValue([session('ses_stable')]),
      apply: () => undefined,
      loadRuntime: vi.fn()
        .mockResolvedValueOnce({ liveExecutions: [], attention: [] })
        .mockResolvedValueOnce({
          liveExecutions: [{ executionId: 'execution:opencode:intent-1', harness: 'opencode', externalSessionRef: 'ses_live', startedAt: '2026-09-15T00:00:00Z', canCancel: true }],
          attention: [],
        }),
      applyRuntime: (snapshot) => runtime.push(snapshot.liveExecutions.map((item) => item.executionId)),
      subscribeActivity: () => () => undefined,
    });

    await controller.refresh();
    await controller.refresh();
    expect(runtime).toEqual([[], ['execution:opencode:intent-1']]);
    controller.dispose();
  });
});
