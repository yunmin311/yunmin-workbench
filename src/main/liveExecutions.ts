import { randomUUID } from 'node:crypto';
import { isValidNativeRuntimeRef, runtimeExecutionId, workbenchExecutionId } from '../core/project/runtimeIdentity';
import type {
  RuntimePresenceEnvelope,
  RuntimePresenceMutation,
  RuntimePresenceSnapshot,
} from '../core/runtimePresence';
import type { HarnessCapabilities } from '../core/types';

type Harness = HarnessCapabilities['harness'];

export interface LiveExecution {
  executionId: string;
  harness: Harness;
  externalSessionRef: string;
  startedAt: string;
  canCancel: boolean;
}

/**
 * Process-local evidence that an adapter is currently executing for an
 * execution id. Entries are added when an adapter observes a native session
 * starting and removed when that execution provably stops (turn completed,
 * dispatch resolved, process exit). After a Workbench restart the set is
 * empty: historical activity must never render as a live runtime.
 */
export class LiveExecutionRegistry {
  private entries = new Map<string, LiveExecution>();
  private readonly epoch: string;
  private revision = 0;
  private readonly listeners = new Set<(envelope: RuntimePresenceEnvelope) => void>();

  constructor(options: { epoch?: string } = {}) {
    this.epoch = options.epoch ?? randomUUID();
  }

  private publish(mutation: RuntimePresenceMutation): void {
    const previousRevision = this.revision;
    this.revision += 1;
    const envelope: RuntimePresenceEnvelope = {
      kind: 'mutation',
      epoch: this.epoch,
      previousRevision,
      revision: this.revision,
      mutation,
    };
    for (const listener of this.listeners) listener(envelope);
  }

  subscribe(listener: (envelope: RuntimePresenceEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RuntimePresenceSnapshot {
    return {
      kind: 'snapshot',
      epoch: this.epoch,
      revision: this.revision,
      executions: this.list(),
    };
  }

  add(
    harness: Harness,
    externalSessionRef: string,
    startedAt: string,
    canCancel = false,
    intentId?: string,
  ): LiveExecution {
    if (!isValidNativeRuntimeRef(externalSessionRef)) throw new Error('Invalid native runtime ref');
    const entry: LiveExecution = {
      executionId: intentId
        ? workbenchExecutionId(harness, intentId)
        : runtimeExecutionId(harness, externalSessionRef),
      harness,
      externalSessionRef,
      startedAt,
      canCancel,
    };
    const previous = this.entries.get(entry.executionId);
    this.entries.set(entry.executionId, entry);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) {
      this.publish({ type: 'upsert', execution: entry });
    }
    return entry;
  }

  remove(harness: Harness, externalSessionRef: string, intentId?: string): void {
    if (intentId) {
      const executionId = workbenchExecutionId(harness, intentId);
      if (this.entries.delete(executionId)) this.publish({ type: 'remove', executionId });
      return;
    }
    for (const [executionId, entry] of this.entries) {
      if (entry.harness === harness && entry.externalSessionRef === externalSessionRef) {
        this.entries.delete(executionId);
        this.publish({ type: 'remove', executionId });
      }
    }
  }

  has(harness: Harness, externalSessionRef: string): boolean {
    return [...this.entries.values()].some((entry) =>
      entry.harness === harness && entry.externalSessionRef === externalSessionRef);
  }

  list(): LiveExecution[] {
    return [...this.entries.values()].sort((a, b) => a.executionId.localeCompare(b.executionId));
  }

  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.publish({ type: 'clear' });
  }
}
