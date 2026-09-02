import type { ActivityEvent, Observation, RuntimeBinding, RuntimeState } from '../types';
import { orderActivity } from './activity';
import { isValidNativeRuntimeRef, parseRuntimeExecutionId, runtimeExecutionId, workbenchExecutionId } from './runtimeIdentity';

/**
 * Runtime Inspector projection. Consumes the existing Activity projection and
 * derives per-execution views. It owns no state and no store: malformed or
 * unattributable events are isolated, never merged by cwd/provider/time
 * proximity, and missing facts stay null so the UI renders UNKNOWN.
 */

export interface ExecutionReceiptView {
  accepted: boolean;
  status: 'ACCEPTED' | 'NOT ACCEPTED' | 'CANCELLED';
  at: string;
  summary: string;
  protocolSourceRef: string;
  source: Observation['source'];
}

export interface RuntimeExecutionView {
  /**
   * Workbench execution id: `harness::execution:intentId` for current events.
   * Legacy activity without intent lineage falls back to `harness::nativeRef`.
   * Dispatch intents without a native external ref are not executions and are not projected.
   */
  executionId: string;
  /** Harness-native session ref, observed directly and never guessed. */
  nativeRef: string;
  harness: string;
  projectId: string | null;
  conversationKey: string | null;
  /** Execution binding: only fields the adapter actually observed. */
  binding: RuntimeBinding | null;
  /** Last runtime state explicitly reported by protocol/process events. */
  state: RuntimeState;
  /** The adapter currently holds live process evidence for this execution. */
  live: boolean;
  startedAt: string | null;
  /** Null until a source event proves the session ended; a completed turn is not an ended session. */
  endedAt: string | null;
  intentId: string | null;
  intentState: 'dispatched' | 'accepted' | 'failed' | 'cancelled' | 'unknown';
  /** Dispatch receipt; a receipt only proves the handoff, never completion. */
  receipt: ExecutionReceiptView | null;
  /** Provenance of the event that established this execution. */
  observed: Observation | null;
  events: ActivityEvent[];
}

/** Execution id for an event that carries explicit harness + native ref evidence. */
export function executionIdForEvent(event: ActivityEvent): string | null {
  const eventHarness = event.harness;
  const bindingHarness = event.binding?.harness;
  if (eventHarness && bindingHarness && eventHarness !== bindingHarness) return null;
  const harness = eventHarness ?? bindingHarness;
  const eventRef = event.runtimeRef;
  const bindingRef = event.binding?.externalSessionRef;
  if (eventRef && bindingRef && eventRef !== bindingRef) return null;
  const nativeRef = eventRef ?? bindingRef;
  if (!harness || !isValidNativeRuntimeRef(nativeRef)) return null;
  return event.intentId
    ? workbenchExecutionId(harness, event.intentId)
    : runtimeExecutionId(harness, nativeRef);
}

function nativeIdentityForEvent(event: ActivityEvent): { harness: string; nativeRef: string } | null {
  const eventHarness = event.harness;
  const bindingHarness = event.binding?.harness;
  if (eventHarness && bindingHarness && eventHarness !== bindingHarness) return null;
  const harness = eventHarness ?? bindingHarness;
  const eventRef = event.runtimeRef;
  const bindingRef = event.binding?.externalSessionRef;
  if (eventRef && bindingRef && eventRef !== bindingRef) return null;
  const nativeRef = eventRef ?? bindingRef;
  return harness && isValidNativeRuntimeRef(nativeRef) ? { harness, nativeRef } : null;
}

function isIntentEvent(event: ActivityEvent): boolean {
  return event.kind === 'handoff-dispatched'
    || event.kind === 'handoff-accepted'
    || event.kind === 'handoff-failed'
    || event.kind === 'handoff-cancelled';
}

type IntentEvent = ActivityEvent & {
  kind: 'handoff-dispatched' | 'handoff-accepted' | 'handoff-failed' | 'handoff-cancelled';
};

function isTypedIntentEvent(event: ActivityEvent): event is IntentEvent {
  return isIntentEvent(event);
}

function intentIdOf(event: ActivityEvent): string | null {
  return event.intentId ?? null;
}

/**
 * Resolves the execution an Attention item points at. Attention sessionRef is
 * either a full Workbench execution id (`harness::execution:intentId`) or a bare native ref;
 * the exact activity event (eventRef) is always preferred when resolvable.
 * Returns null for stale/unknown targets — the caller must not guess.
 */
export function resolveExecutionIdForAttention(
  item: { eventRef?: string; sessionRef?: string },
  eventsById: ReadonlyMap<string, ActivityEvent>,
): string | null {
  const event = item.eventRef ? eventsById.get(item.eventRef) : undefined;
  const fromEvent = event ? executionIdForEvent(event) : null;
  if (fromEvent) return fromEvent;
  const parsed = parseRuntimeExecutionId(item.sessionRef);
  if (parsed) {
    const requested = runtimeExecutionId(parsed.harness, parsed.externalSessionRef);
    const observed = [...eventsById.values()].some((candidate) => executionIdForEvent(candidate) === requested);
    if (observed) return requested;
  }
  return null;
}

const INTENT_STATE_BY_KIND: Record<'handoff-dispatched' | 'handoff-accepted' | 'handoff-failed' | 'handoff-cancelled', RuntimeExecutionView['intentState']> = {
  'handoff-dispatched': 'dispatched',
  'handoff-accepted': 'accepted',
  'handoff-failed': 'failed',
  'handoff-cancelled': 'cancelled',
};

interface ExecutionBucket {
  executionId: string;
  nativeRef: string;
  harness: string;
  events: ActivityEvent[];
}

export function projectRuntimeExecutions(
  events: ActivityEvent[],
  liveExecutionIds: readonly string[] = [],
): RuntimeExecutionView[] {
  const live = new Set(liveExecutionIds);
  const buckets = new Map<string, ExecutionBucket>();
  const identities = new Map<string, { harness: string; nativeRef: string }>();
  const intentToExecution = new Map<string, string>();
  const conflictedIntents = new Set<string>();

  const bucketFor = (executionId: string): ExecutionBucket => {
    let bucket = buckets.get(executionId);
    if (!bucket) {
      const observedIdentity = identities.get(executionId);
      const legacyIdentity = parseRuntimeExecutionId(executionId);
      const identity = observedIdentity ?? (legacyIdentity
        ? { harness: legacyIdentity.harness, nativeRef: legacyIdentity.externalSessionRef }
        : null);
      if (!identity) throw new Error('Invalid projected execution identity');
      bucket = { executionId, nativeRef: identity.nativeRef, harness: identity.harness, events: [] };
      buckets.set(executionId, bucket);
    }
    return bucket;
  };

  const ordered = orderActivity(events);
  for (const event of ordered) {
    const executionId = executionIdForEvent(event);
    const identity = nativeIdentityForEvent(event);
    if (executionId && identity) identities.set(executionId, identity);
  }
  for (const event of ordered) {
    if (!isIntentEvent(event)) continue;
    const intentId = intentIdOf(event);
    const executionId = executionIdForEvent(event);
    if (!intentId || !executionId || conflictedIntents.has(intentId)) continue;
    const prior = intentToExecution.get(intentId);
    if (prior && prior !== executionId) {
      intentToExecution.delete(intentId);
      conflictedIntents.add(intentId);
    } else {
      intentToExecution.set(intentId, executionId);
    }
  }

  for (const event of ordered) {
    const fromRef = executionIdForEvent(event);
    if (fromRef) {
      bucketFor(fromRef).events.push(event);
      continue;
    }
    if (isIntentEvent(event)) {
      const intentId = intentIdOf(event);
      const correlated = intentId ? intentToExecution.get(intentId) : undefined;
      if (correlated) {
        bucketFor(correlated).events.push(event);
      }
      continue;
    }
    // Unattributable observation: no harness+ref, no intent correlation.
    // Isolated on purpose — it must not attach to a runtime it never named.
  }

  return [...buckets.values()].map((bucket) => {
    const identityEvent = bucket.events.find((event) => executionIdForEvent(event) === bucket.executionId) ?? null;
    const withState = [...bucket.events].reverse().find((event) => event.runtimeState !== undefined);
    const binding = bucket.events.find((event) => event.binding !== undefined)?.binding ?? null;
    const intentEvents = bucket.events.filter(isTypedIntentEvent);
    const latestIntent = intentEvents.at(-1) ?? null;
    const receiptEvent = [...bucket.events].reverse().find((event) =>
      event.kind === 'handoff-accepted' || event.kind === 'handoff-failed' || event.kind === 'handoff-cancelled') ?? null;
    const endedEvent = [...bucket.events].reverse().find((event) => event.kind === 'process-cancelled') ?? null;
    const projectId = bucket.events.find((event) => event.projectId)?.projectId ?? null;
    const conversationKey = bucket.events.find((event) => event.conversationKey)?.conversationKey ?? null;
    return {
      executionId: bucket.executionId,
      nativeRef: bucket.nativeRef,
      harness: bucket.harness,
      projectId,
      conversationKey,
      binding,
      state: withState?.runtimeState ?? 'unknown',
      live: live.has(bucket.executionId),
      startedAt: bucket.events.find((event) =>
        event.kind === 'handoff-accepted' || event.kind === 'session-started')?.observed.observedAt ?? null,
      endedAt: endedEvent?.observed.observedAt ?? null,
      intentId: latestIntent ? intentIdOf(latestIntent) : null,
      intentState: latestIntent ? INTENT_STATE_BY_KIND[latestIntent.kind] : 'unknown',
      receipt: receiptEvent
        ? {
          accepted: receiptEvent.kind === 'handoff-accepted',
          status: receiptEvent.kind === 'handoff-accepted' ? 'ACCEPTED'
            : receiptEvent.kind === 'handoff-cancelled' ? 'CANCELLED' : 'NOT ACCEPTED',
          at: receiptEvent.observed.observedAt,
          summary: receiptEvent.summary,
          protocolSourceRef: receiptEvent.observed.sourceRef,
          source: receiptEvent.observed.source,
        }
        : null,
      observed: identityEvent?.observed ?? null,
      events: bucket.events,
    } satisfies RuntimeExecutionView;
  }).sort((a, b) => {
    const aLatest = a.events.at(-1)?.observed.observedAt ?? a.startedAt ?? '';
    const bLatest = b.events.at(-1)?.observed.observedAt ?? b.startedAt ?? '';
    return bLatest.localeCompare(aLatest);
  });
}
