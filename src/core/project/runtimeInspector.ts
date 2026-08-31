import type { ActivityEvent, Observation, RuntimeBinding, RuntimeState } from '../types';
import { orderActivity } from './activity';
import { runtimeExecutionId } from './runtimeIdentity';

/**
 * Runtime Inspector projection. Consumes the existing Activity projection and
 * derives per-execution views. It owns no state and no store: malformed or
 * unattributable events are isolated, never merged by cwd/provider/time
 * proximity, and missing facts stay null so the UI renders UNKNOWN.
 */

export interface ExecutionReceiptView {
  accepted: boolean;
  at: string;
  summary: string;
  protocolSourceRef: string;
  source: Observation['source'];
}

export interface RuntimeExecutionView {
  /**
   * Workbench execution id: `harness::nativeRef` when a native ref was
   * observed, otherwise `intent:<intentId>` for a dispatch that never
   * produced one. This is a Workbench id, not the harness's own session ref.
   */
  executionId: string;
  /** Harness-native session ref; null means UNKNOWN, never guessed. */
  nativeRef: string | null;
  harness: string | null;
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
  intentState: 'dispatched' | 'accepted' | 'failed' | 'unknown';
  /** Dispatch receipt; a receipt only proves the handoff, never completion. */
  receipt: ExecutionReceiptView | null;
  /** Provenance of the event that established this execution. */
  observed: Observation | null;
  events: ActivityEvent[];
}

/** Execution id for an event that carries explicit harness + native ref evidence. */
export function executionIdForEvent(event: ActivityEvent): string | null {
  const harness = event.harness ?? event.binding?.harness;
  if (!harness || !event.runtimeRef) return null;
  return runtimeExecutionId(harness, event.runtimeRef);
}

function isIntentEvent(event: ActivityEvent): boolean {
  return event.kind === 'handoff-dispatched'
    || event.kind === 'handoff-accepted'
    || event.kind === 'handoff-failed';
}

type IntentEvent = ActivityEvent & {
  kind: 'handoff-dispatched' | 'handoff-accepted' | 'handoff-failed';
};

function isTypedIntentEvent(event: ActivityEvent): event is IntentEvent {
  return isIntentEvent(event);
}

function intentIdOf(event: ActivityEvent): string | null {
  return event.attentionKey ?? null;
}

/**
 * Resolves the execution an Attention item points at. Attention sessionRef is
 * either a full Workbench execution id (`harness::ref`) or a bare native ref;
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
  if (item.sessionRef && item.sessionRef.includes('::')) return item.sessionRef;
  if (event && isIntentEvent(event)) {
    const intentId = intentIdOf(event);
    return intentId ? `intent:${intentId}` : null;
  }
  return null;
}

const INTENT_STATE_BY_KIND: Record<'handoff-dispatched' | 'handoff-accepted' | 'handoff-failed', RuntimeExecutionView['intentState']> = {
  'handoff-dispatched': 'dispatched',
  'handoff-accepted': 'accepted',
  'handoff-failed': 'failed',
};

interface ExecutionBucket {
  executionId: string;
  nativeRef: string | null;
  harness: string | null;
  events: ActivityEvent[];
}

export function projectRuntimeExecutions(
  events: ActivityEvent[],
  liveExecutionIds: readonly string[] = [],
): RuntimeExecutionView[] {
  const live = new Set(liveExecutionIds);
  const buckets = new Map<string, ExecutionBucket>();
  const intentToExecution = new Map<string, string>();
  const intentOnly = new Map<string, ExecutionBucket>();

  const bucketFor = (executionId: string): ExecutionBucket => {
    let bucket = buckets.get(executionId);
    if (!bucket) {
      bucket = { executionId, nativeRef: executionId.includes('::') ? executionId.slice(executionId.indexOf('::') + 2) : null, harness: executionId.includes('::') ? executionId.slice(0, executionId.indexOf('::')) : null, events: [] };
      buckets.set(executionId, bucket);
    }
    return bucket;
  };

  for (const event of orderActivity(events)) {
    const fromRef = executionIdForEvent(event);
    if (fromRef) {
      bucketFor(fromRef).events.push(event);
      const intentId = isIntentEvent(event) ? intentIdOf(event) : null;
      if (intentId) intentToExecution.set(intentId, fromRef);
      continue;
    }
    if (isIntentEvent(event)) {
      const intentId = intentIdOf(event);
      const correlated = intentId ? intentToExecution.get(intentId) : undefined;
      if (correlated) {
        bucketFor(correlated).events.push(event);
        continue;
      }
      const key = `intent:${intentId ?? event.id}`;
      let bucket = intentOnly.get(key);
      if (!bucket) {
        bucket = { executionId: key, nativeRef: null, harness: event.harness ?? event.binding?.harness ?? null, events: [] };
        intentOnly.set(key, bucket);
      }
      bucket.events.push(event);
      continue;
    }
    // Unattributable observation: no harness+ref, no intent correlation.
    // Isolated on purpose — it must not attach to a runtime it never named.
  }

  const merged = [...buckets.values(), ...intentOnly.values()];
  return merged.map((bucket) => {
    const withState = [...bucket.events].reverse().find((event) => event.runtimeState !== undefined);
    const binding = bucket.events.find((event) => event.binding !== undefined)?.binding ?? null;
    const intentEvents = bucket.events.filter(isTypedIntentEvent);
    const latestIntent = intentEvents.at(-1) ?? null;
    const receiptEvent = [...bucket.events].reverse().find((event) => event.kind === 'handoff-accepted' || event.kind === 'handoff-failed') ?? null;
    const projectId = bucket.events.find((event) => event.projectId)?.projectId ?? null;
    const conversationKey = bucket.events.find((event) => event.conversationKey)?.conversationKey ?? null;
    return {
      executionId: bucket.executionId,
      nativeRef: bucket.nativeRef,
      harness: bucket.harness ?? binding?.harness ?? null,
      projectId,
      conversationKey,
      binding,
      state: withState?.runtimeState ?? 'unknown',
      live: live.has(bucket.executionId),
      startedAt: bucket.events[0]?.observed.observedAt ?? null,
      endedAt: null,
      intentId: latestIntent ? intentIdOf(latestIntent) : null,
      intentState: latestIntent ? INTENT_STATE_BY_KIND[latestIntent.kind] : 'unknown',
      receipt: receiptEvent
        ? {
          accepted: receiptEvent.kind === 'handoff-accepted',
          at: receiptEvent.observed.observedAt,
          summary: receiptEvent.summary,
          protocolSourceRef: receiptEvent.observed.sourceRef,
          source: receiptEvent.observed.source,
        }
        : null,
      observed: bucket.events[0]?.observed ?? null,
      events: bucket.events,
    } satisfies RuntimeExecutionView;
  }).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}
