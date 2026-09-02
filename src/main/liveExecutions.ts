import { isValidNativeRuntimeRef, runtimeExecutionId, workbenchExecutionId } from '../core/project/runtimeIdentity';
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
    this.entries.set(entry.executionId, entry);
    return entry;
  }

  remove(harness: Harness, externalSessionRef: string, intentId?: string): void {
    if (intentId) {
      this.entries.delete(workbenchExecutionId(harness, intentId));
      return;
    }
    for (const [executionId, entry] of this.entries) {
      if (entry.harness === harness && entry.externalSessionRef === externalSessionRef) {
        this.entries.delete(executionId);
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
    this.entries.clear();
  }
}
