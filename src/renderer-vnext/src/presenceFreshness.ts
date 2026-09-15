import type { HarnessSessionPresence } from '../../core/types';

export const FULL_PRESENCE_REFRESH_MS = 4_000;

interface PresenceRefreshOptions {
  currentProjectId: () => string | null;
  listSessions: (projectId: string) => Promise<HarnessSessionPresence[]>;
  apply: (sessions: HarnessSessionPresence[]) => void;
  subscribeActivity: (listener: () => void) => () => void;
}

export function startHarnessPresenceRefresh(options: PresenceRefreshOptions): {
  refresh: () => Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let requestSequence = 0;
  let appliedSignature: string | undefined;

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
      const sessions = await options.listSessions(projectId);
      if (disposed || sequence !== requestSequence || options.currentProjectId() !== projectId) return;
      const nextSignature = signature(projectId, sessions);
      if (nextSignature === appliedSignature) return;
      appliedSignature = nextSignature;
      options.apply(sessions);
    } catch {
      // Presence is an observational projection. Keep the last known rows when
      // the native CLI is temporarily unavailable; the next bounded refresh retries.
    }
  };

  const timer = globalThis.setInterval(() => void refresh(), FULL_PRESENCE_REFRESH_MS);
  const unsubscribeActivity = options.subscribeActivity(() => void refresh());
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
