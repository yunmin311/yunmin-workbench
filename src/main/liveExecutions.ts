import { runtimeExecutionId } from '../core/project/runtimeIdentity';
import type { HarnessCapabilities } from '../core/types';

type Harness = HarnessCapabilities['harness'];

export interface LiveExecution {
  executionId: string;
  harness: Harness;
  externalSessionRef: string;
  startedAt: string;
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

  private key(harness: Harness, externalSessionRef: string): string {
    return `${harness}\0${externalSessionRef}`;
  }

  add(harness: Harness, externalSessionRef: string, startedAt: string): LiveExecution {
    const entry: LiveExecution = {
      executionId: runtimeExecutionId(harness, externalSessionRef),
      harness,
      externalSessionRef,
      startedAt,
    };
    this.entries.set(this.key(harness, externalSessionRef), entry);
    return entry;
  }

  remove(harness: Harness, externalSessionRef: string): void {
    this.entries.delete(this.key(harness, externalSessionRef));
  }

  has(harness: Harness, externalSessionRef: string): boolean {
    return this.entries.has(this.key(harness, externalSessionRef));
  }

  list(): LiveExecution[] {
    return [...this.entries.values()].sort((a, b) => a.executionId.localeCompare(b.executionId));
  }

  clear(): void {
    this.entries.clear();
  }
}
