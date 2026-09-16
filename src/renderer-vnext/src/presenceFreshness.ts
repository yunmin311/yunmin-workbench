import type { ActivityEvent, AttentionItem, HarnessSessionPresence } from '../../core/types';
import { workbenchExecutionId } from '../../core/project/runtimeIdentity';

export interface LiveExecutionPresence {
  executionId: string;
  harness: string;
  externalSessionRef: string;
  startedAt: string;
  canCancel: boolean;
}

export interface RuntimePresenceSnapshot {
  liveExecutions: LiveExecutionPresence[];
  attention: AttentionItem[];
}

export const FULL_PRESENCE_REFRESH_MS = 4_000;

interface PresenceRefreshOptions {
  currentProjectId: () => string | null;
  listSessions: (projectId: string) => Promise<HarnessSessionPresence[]>;
  apply: (sessions: HarnessSessionPresence[]) => void;
  loadRuntime?: (projectId: string) => Promise<RuntimePresenceSnapshot>;
  applyRuntime?: (snapshot: RuntimePresenceSnapshot) => void;
  subscribeActivity: (listener: (event: ActivityEvent) => void) => () => void;
  observeActivity?: (event: ActivityEvent) => void;
}

export function projectLiveExecutionActivity(
  current: LiveExecutionPresence[],
  event: ActivityEvent,
  projectId: string,
): LiveExecutionPresence[] {
  if (event.projectId !== projectId || !event.harness || !event.runtimeRef || !event.intentId) return current;
  const executionId = workbenchExecutionId(event.harness, event.intentId);
  if (event.kind === 'turn-started') {
    const next = current.filter((item) => item.executionId !== executionId);
    return [...next, {
      executionId,
      harness: event.harness,
      externalSessionRef: event.runtimeRef,
      startedAt: event.observed.observedAt,
      canCancel: event.harness === 'claude' || event.harness === 'opencode',
    }];
  }
  if (['turn-completed', 'turn-error', 'process-cancelled', 'handoff-failed', 'handoff-cancelled'].includes(event.kind)) {
    return current.filter((item) => item.executionId !== executionId);
  }
  return current;
}

export function startHarnessPresenceRefresh(options: PresenceRefreshOptions): {
  refresh: () => Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let requestSequence = 0;
  let appliedSignature: string | undefined;
  let appliedRuntimeSignature: string | undefined;

  const signature = (projectId: string, sessions: HarnessSessionPresence[]): string => JSON.stringify({
    projectId,
    sessions: sessions.map((session) => ({
      harness: session.harness,
      nativeRef: session.nativeRef,
      label: session.label,
      runtimeState: session.runtimeState,
      agent: session.agent,
      sourceRef: session.sourceRef,
    })),
  });

  const refresh = async (): Promise<void> => {
    const projectId = options.currentProjectId();
    if (!projectId || disposed) return;
    const sequence = ++requestSequence;
    try {
      const [sessions, runtime] = await Promise.all([
        options.listSessions(projectId),
        options.loadRuntime?.(projectId),
      ]);
      if (disposed || sequence !== requestSequence || options.currentProjectId() !== projectId) return;
      const nextSignature = signature(projectId, sessions);
      if (nextSignature !== appliedSignature) {
        appliedSignature = nextSignature;
        options.apply(sessions);
      }
      if (runtime && options.applyRuntime) {
        const runtimeSignature = JSON.stringify(runtime);
        if (runtimeSignature !== appliedRuntimeSignature) {
          appliedRuntimeSignature = runtimeSignature;
          options.applyRuntime(runtime);
        }
      }
    } catch {
      // Presence is an observational projection. Keep the last known rows when
      // the native CLI is temporarily unavailable; the next bounded refresh retries.
    }
  };

  const timer = globalThis.setInterval(() => void refresh(), FULL_PRESENCE_REFRESH_MS);
  const unsubscribeActivity = options.subscribeActivity((event) => {
    options.observeActivity?.(event);
    void refresh();
  });
  return {
    refresh,
    dispose: () => {
      disposed = true;
      requestSequence += 1;
      globalThis.clearInterval(timer);
      unsubscribeActivity();
    },
  };
}
