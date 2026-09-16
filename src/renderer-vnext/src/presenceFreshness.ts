import type { ActivityEvent, AttentionItem, HarnessSessionPresence } from '../../core/types';
import {
  applyRuntimePresenceEnvelope,
  type RuntimePresenceEnvelope,
  type RuntimePresenceExecution,
  type RuntimePresenceSnapshot,
} from '../../core/runtimePresence';

export type LiveExecutionPresence = RuntimePresenceExecution;

export const FULL_PRESENCE_REFRESH_MS = 4_000;

interface PresenceRefreshOptions {
  currentProjectId: () => string | null;
  listSessions: (projectId: string) => Promise<HarnessSessionPresence[]>;
  apply: (sessions: HarnessSessionPresence[]) => void;
  loadAttention?: (projectId: string) => Promise<AttentionItem[]>;
  applyAttention?: (attention: AttentionItem[]) => void;
  loadRuntimePresence?: () => Promise<RuntimePresenceSnapshot>;
  applyRuntimePresence?: (snapshot: RuntimePresenceSnapshot) => void;
  subscribeRuntimePresence?: (listener: (envelope: RuntimePresenceEnvelope) => void) => () => void;
  subscribeActivity: (listener: (event: ActivityEvent) => void) => () => void;
}

export function startHarnessPresenceRefresh(options: PresenceRefreshOptions): {
  refresh: () => Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let requestSequence = 0;
  let appliedSignature: string | undefined;
  let appliedAttentionSignature: string | undefined;
  let authoritativePresence: RuntimePresenceSnapshot | undefined;

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
      const [sessions, attention, presence] = await Promise.all([
        options.listSessions(projectId),
        options.loadAttention?.(projectId),
        options.loadRuntimePresence?.(),
      ]);
      if (disposed || sequence !== requestSequence || options.currentProjectId() !== projectId) return;
      const nextSignature = signature(projectId, sessions);
      if (nextSignature !== appliedSignature) {
        appliedSignature = nextSignature;
        options.apply(sessions);
      }
      if (attention && options.applyAttention) {
        const attentionSignature = JSON.stringify(attention);
        if (attentionSignature !== appliedAttentionSignature) {
          appliedAttentionSignature = attentionSignature;
          options.applyAttention(attention);
        }
      }
      if (presence && options.applyRuntimePresence) {
        const applied = authoritativePresence
          ? applyRuntimePresenceEnvelope(authoritativePresence, presence)
          : { snapshot: presence, accepted: true, needsSnapshot: false };
        authoritativePresence = applied.snapshot;
        if (applied.accepted) options.applyRuntimePresence(applied.snapshot);
      }
    } catch {
      // Presence is an observational projection. Keep the last known rows when
      // the native CLI is temporarily unavailable; the next bounded refresh retries.
    }
  };

  const timer = globalThis.setInterval(() => void refresh(), FULL_PRESENCE_REFRESH_MS);
  const unsubscribeActivity = options.subscribeActivity(() => {
    void refresh();
  });
  const unsubscribeRuntimePresence = options.subscribeRuntimePresence?.((envelope) => {
    if (!authoritativePresence) {
      if (envelope.kind === 'mutation' && envelope.previousRevision === 0 && envelope.revision === 1) {
        authoritativePresence = {
          kind: 'snapshot', epoch: envelope.epoch, revision: 0, executions: [],
        };
        const applied = applyRuntimePresenceEnvelope(authoritativePresence, envelope);
        authoritativePresence = applied.snapshot;
        if (applied.accepted) options.applyRuntimePresence?.(applied.snapshot);
        return;
      }
      void refresh();
      return;
    }
    const applied = applyRuntimePresenceEnvelope(authoritativePresence, envelope);
    authoritativePresence = applied.snapshot;
    if (applied.accepted) options.applyRuntimePresence?.(applied.snapshot);
    if (applied.needsSnapshot) void refresh();
  }) ?? (() => undefined);
  return {
    refresh,
    dispose: () => {
      disposed = true;
      requestSequence += 1;
      globalThis.clearInterval(timer);
      unsubscribeActivity();
      unsubscribeRuntimePresence();
    },
  };
}
