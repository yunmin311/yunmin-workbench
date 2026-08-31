import type {
  ActivityEvent,
  AttentionGateFact,
  AttentionItem,
  AttentionKind,
  AttentionLevel,
  AttentionLocalState,
  AttentionPacketFact,
  RuntimeSession,
} from '../types';
import { runtimeExecutionId } from '../project/runtimeIdentity';

export interface AttentionReducerInput {
  activity: ActivityEvent[];
  runtimeSessions?: RuntimeSession[];
  packetFacts?: AttentionPacketFact[];
  gateFacts?: AttentionGateFact[];
  limit?: number;
}

interface Candidate {
  key: string;
  active: boolean;
  observedAt: string;
  specificity: number;
  item?: AttentionItem;
}

const levelRank: Record<AttentionLevel, number> = { alert: 0, action: 1, review: 2 };

function isTrustedObservation(observed: { source: string; verification: string }): boolean {
  return observed.source !== 'heuristic'
    && (observed.verification === 'VERIFIED' || observed.verification === 'OBSERVED');
}

function itemId(kind: AttentionKind, key: string): string {
  return `attention:${kind}:${encodeURIComponent(key)}`;
}

function latest(map: Map<string, Candidate>, candidate: Candidate): void {
  const prior = map.get(candidate.key);
  if (!prior
    || candidate.observedAt > prior.observedAt
    || (candidate.observedAt === prior.observedAt && candidate.specificity >= prior.specificity)) {
    map.set(candidate.key, candidate);
  }
}

function eventItem(
  event: ActivityEvent,
  key: string,
  kind: AttentionKind,
  level: AttentionLevel,
  title: string,
): AttentionItem {
  return {
    id: itemId(kind, key), kind, level, title, summary: event.summary,
    projectId: event.projectId, conversationKey: event.conversationKey,
    sessionRef: event.runtimeRef, sourceRef: event.observed.sourceRef,
    eventRef: event.id, observedAt: event.observed.observedAt,
    verification: event.observed.verification,
  };
}

function resolvedEvent(event: ActivityEvent, key: string): Candidate {
  return { key, active: false, observedAt: event.observed.observedAt, specificity: 2 };
}

function activityCandidates(events: ActivityEvent[]): Candidate[] {
  const out: Candidate[] = [];
  for (const event of events) {
    if (event.kind === 'handoff-failed' || event.kind === 'handoff-accepted') {
      const key = `receipt:${event.attentionKey ?? event.turnRef ?? event.id}`;
      out.push(event.kind === 'handoff-accepted'
        ? resolvedEvent(event, key)
        : { key, active: true, observedAt: event.observed.observedAt, specificity: 2, item: eventItem(event, key, 'receipt-failed', 'alert', 'Handoff failed or rejected') });
    }

    if (event.kind === 'harness-error') {
      const key = `harness:${event.attentionKey ?? event.id}`;
      out.push(event.attentionStatus === 'resolved'
        ? resolvedEvent(event, key)
        : { key, active: true, observedAt: event.observed.observedAt, specificity: 2, item: eventItem(event, key, 'runtime-error', 'alert', 'Runtime or harness error') });
    }

    if (event.kind === 'turn-error' || event.kind === 'turn-started' || event.kind === 'turn-completed') {
      const harness = event.harness ?? event.binding?.harness;
      const externalRef = event.turnRef ?? event.runtimeRef;
      const key = `runtime:${harness && externalRef ? `${harness}::${externalRef}` : event.attentionKey ?? event.id}`;
      out.push(event.kind === 'turn-error'
        ? { key, active: true, observedAt: event.observed.observedAt, specificity: 2, item: eventItem(event, key, 'runtime-error', 'alert', 'Runtime or harness error') }
        : resolvedEvent(event, key));
    }

    const explicitKind = event.attentionKind ?? (
      event.kind === 'approval-required' ? 'approval-required'
        : event.kind === 'needs-user-input' ? 'needs-user-input'
          : undefined
    );
    if (!explicitKind) continue;
    const key = `explicit:${event.attentionKey ?? event.id}`;
    if (event.attentionStatus === 'resolved') {
      out.push(resolvedEvent(event, key));
      continue;
    }
    const level: AttentionLevel = explicitKind === 'execution-review' ? 'review' : 'action';
    const title = explicitKind === 'approval-required' ? 'Approval required'
      : explicitKind === 'needs-user-input' ? 'User input needed'
        : 'Execution ready to review';
    out.push({ key, active: true, observedAt: event.observed.observedAt, specificity: 2, item: eventItem(event, key, explicitKind, level, title) });
  }
  return out;
}

function runtimeCandidates(sessions: RuntimeSession[]): Candidate[] {
  return sessions.map((session) => {
    const key = `runtime:${session.id}`;
    if (session.state !== 'error') {
      return {
        key, active: false, observedAt: session.observed.observedAt, specificity: 1,
      };
    }
    return {
      key, active: true, observedAt: session.observed.observedAt, specificity: 1,
      item: {
        id: itemId('runtime-error', key), kind: 'runtime-error', level: 'alert',
        title: 'Runtime or harness error', summary: `Runtime ${session.id} reported error`,
        conversationKey: session.conversationKey, sessionRef: session.id,
        sourceRef: session.observed.sourceRef, observedAt: session.observed.observedAt,
        verification: session.observed.verification,
      },
    };
  });
}

function packetCandidates(facts: AttentionPacketFact[]): Candidate[] {
  return facts.map((fact) => {
    const key = `packet:${fact.key}`;
    if (fact.validity !== 'STALE' && fact.validity !== 'INVALID') {
      return {
        key, active: false, observedAt: fact.observed.observedAt, specificity: 1,
      };
    }
    const kind = fact.validity === 'INVALID' ? 'packet-invalid' : 'packet-stale';
    return {
      key, active: true, observedAt: fact.observed.observedAt, specificity: 1,
      item: {
        id: itemId(kind, key), kind, level: fact.validity === 'INVALID' ? 'alert' : 'action',
        title: `Packet ${fact.validity}`, summary: `Packet ${fact.packetRef} is ${fact.validity}`,
        projectId: fact.projectId, conversationKey: fact.conversationKey,
        sourceRef: fact.observed.sourceRef, observedAt: fact.observed.observedAt,
        verification: fact.observed.verification,
      },
    };
  });
}

function gateCandidates(facts: AttentionGateFact[]): Candidate[] {
  return facts.map((fact) => {
    const key = `gate:${fact.key}`;
    const active = ['approval-required', 'needs-user-input', 'failed', 'stale', 'invalid'].includes(fact.status);
    return {
      key, active, observedAt: fact.observed.observedAt, specificity: 1,
      item: {
        id: active ? itemId('gate-attention', key) : '', kind: 'gate-attention',
        level: fact.status === 'failed' || fact.status === 'invalid' ? 'alert' : 'action',
        title: fact.title, summary: fact.summary, projectId: fact.projectId,
        conversationKey: fact.conversationKey, sessionRef: fact.sessionRef,
        sourceRef: fact.observed.sourceRef, observedAt: fact.observed.observedAt,
        verification: fact.observed.verification,
      },
    };
  });
}

export function reduceAttention(input: AttentionReducerInput): AttentionItem[] {
  const trustedActivity = input.activity.filter((event) => isTrustedObservation(event.observed));
  const explicitlyObservedRuntimeRefs = new Set(
    trustedActivity.flatMap((event) => {
      const harness = event.harness ?? event.binding?.harness;
      return harness && event.runtimeRef ? [runtimeExecutionId(harness, event.runtimeRef)] : [];
    }),
  );
  const candidates = [
    ...activityCandidates(trustedActivity),
    ...runtimeCandidates((input.runtimeSessions ?? []).filter((session) =>
      isTrustedObservation(session.observed) && !explicitlyObservedRuntimeRefs.has(session.id))),
    ...packetCandidates((input.packetFacts ?? []).filter((fact) => isTrustedObservation(fact.observed))),
    ...gateCandidates((input.gateFacts ?? []).filter((fact) => isTrustedObservation(fact.observed))),
  ];
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates) latest(byKey, candidate);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  return [...byKey.values()]
    .filter((candidate): candidate is Candidate & { item: AttentionItem } => candidate.active && Boolean(candidate.item))
    .map((candidate) => candidate.item)
    .sort((a, b) => levelRank[a.level] - levelRank[b.level] || b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function applyAttentionLocalState(items: AttentionItem[], local: AttentionLocalState): AttentionItem[] {
  return items.filter((item) => {
    const dismissedObservedAt = local.dismissed[item.id];
    if ((item.kind === 'packet-stale' || item.kind === 'packet-invalid') && dismissedObservedAt) return false;
    return !dismissedObservedAt || dismissedObservedAt < item.observedAt;
  });
}
