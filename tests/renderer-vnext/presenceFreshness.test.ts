import { describe, expect, it, vi } from 'vitest';
import type { HarnessSessionPresence } from '../../src/core/types';
import { startHarnessPresenceRefresh } from '../../src/renderer-vnext/src/presenceFreshness';

const session = (nativeRef: string): HarnessSessionPresence => ({
  harness: 'opencode',
  nativeRef,
  label: nativeRef,
  runtimeState: 'unknown',
  sourceRef: `opencode:session:list:${nativeRef}`,
  observedAt: '2026-09-15T00:00:00.000Z',
});

describe('Full Workbench harness presence freshness', () => {
  it('refreshes only session presence on activity and the bounded interval', async () => {
    vi.useFakeTimers();
    let activity: (() => void) | undefined;
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
    activity?.();
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
});
