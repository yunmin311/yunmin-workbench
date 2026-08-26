import type { ActivityEvent, RuntimeSession } from '../types';

const stateRank: Record<string, number> = {
  'session-started': 0,
  'turn-started': 1,
  'turn-completed': 2,
  'turn-error': 2,
};

export function orderActivity(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => {
    const time = a.observed.observedAt.localeCompare(b.observed.observedAt);
    if (time !== 0) return time;
    const rank = (stateRank[a.kind] ?? 1) - (stateRank[b.kind] ?? 1);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });
}

/** Runtime sessions are derived only from protocol-observed activity carrying a runtime reference. */
export function projectRuntimeSessions(events: ActivityEvent[]): RuntimeSession[] {
  const sessions = new Map<string, RuntimeSession>();
  for (const event of orderActivity(events)) {
    if (!event.runtimeRef || event.observed.source !== 'protocol') continue;
    const prior = sessions.get(event.runtimeRef);
    if (!prior && !event.binding) continue;
    const state = event.runtimeState ?? prior?.state ?? 'unknown';
    sessions.set(event.runtimeRef, {
      id: event.runtimeRef,
      conversationKey: event.conversationKey,
      binding: event.binding ?? prior!.binding,
      state,
      observed: event.observed,
      startedAt: prior?.startedAt ?? event.observed.observedAt,
      // A completed turn makes the loaded thread idle; it is not evidence that the session ended.
      endedAt: prior?.endedAt,
    });
  }
  return [...sessions.values()];
}
