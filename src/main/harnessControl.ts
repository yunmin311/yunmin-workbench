import { z } from 'zod';
import { parseRuntimeExecutionId, runtimeExecutionId } from '../core/project/runtimeIdentity';
import type { LiveExecution, LiveExecutionRegistry } from './liveExecutions';

const RuntimeLiveRequestSchema = z.undefined();
const CancelRequestSchema = z.object({
  executionId: z.string().min(1).max(2048),
}).strict();

export interface CancelOutcome {
  delivered: boolean;
  reason?: 'no-live-context' | 'cancel-not-supported' | 'invalid-execution-id' | 'adapter-error';
}

export interface CancelDependencies {
  liveIntents: ReadonlyMap<string, string>;
  cancelByIntent: (intentId: string) => boolean;
  cancelableHarnesses: ReadonlySet<string>;
}

export function handleRuntimeLiveRequest(
  rawRequest: unknown,
  registry: Pick<LiveExecutionRegistry, 'list'>,
): LiveExecution[] {
  if (!RuntimeLiveRequestSchema.safeParse(rawRequest).success) {
    throw new Error('Invalid runtime:live request');
  }
  return registry.list();
}

export function handleCancelRequest(rawRequest: unknown, deps: CancelDependencies): CancelOutcome {
  const request = CancelRequestSchema.safeParse(rawRequest);
  if (!request.success) return { delivered: false, reason: 'invalid-execution-id' };
  const parsed = parseRuntimeExecutionId(request.data.executionId);
  if (!parsed) return { delivered: false, reason: 'invalid-execution-id' };
  const executionId = runtimeExecutionId(parsed.harness, parsed.externalSessionRef);
  const intentId = deps.liveIntents.get(executionId);
  if (!intentId) return { delivered: false, reason: 'no-live-context' };
  if (!deps.cancelableHarnesses.has(parsed.harness)) {
    return { delivered: false, reason: 'cancel-not-supported' };
  }
  try {
    return deps.cancelByIntent(intentId)
      ? { delivered: true }
      : { delivered: false, reason: 'no-live-context' };
  } catch {
    return { delivered: false, reason: 'adapter-error' };
  }
}
