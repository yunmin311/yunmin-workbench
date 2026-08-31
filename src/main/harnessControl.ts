import { z } from 'zod';

export const ExecutionIdSchema = z.string().regex(/^[a-z]+::.+|^intent:.+/);

export interface CancelOutcome {
  delivered: boolean;
  /** Machine-checkable reason when not delivered; never a synthetic success. */
  reason?: 'no-live-context' | 'cancel-not-supported' | 'invalid-execution-id';
}

/**
 * Resolves a Cancel request against the live runtime context. Only adapters
 * with a real cancel path are delivered; everything else returns a structured
 * refusal so the UI can keep the control disabled or explain why.
 */
export function resolveCancelRequest(input: {
  executionId: string;
  /** executionId -> intentId for executions the adapters currently hold. */
  liveIntents: ReadonlyMap<string, string>;
  cancelByIntent: (intentId: string) => boolean;
  /** Harnesses whose adapter implements a real cancel path. */
  cancelableHarnesses: ReadonlySet<string>;
}): CancelOutcome {
  const parsed = ExecutionIdSchema.safeParse(input.executionId);
  if (!parsed.success) return { delivered: false, reason: 'invalid-execution-id' };
  if (parsed.data.startsWith('intent:')) return { delivered: false, reason: 'no-live-context' };
  const harness = parsed.data.slice(0, parsed.data.indexOf('::'));
  const intentId = input.liveIntents.get(parsed.data);
  if (!intentId) return { delivered: false, reason: 'no-live-context' };
  if (!input.cancelableHarnesses.has(harness)) return { delivered: false, reason: 'cancel-not-supported' };
  return { delivered: input.cancelByIntent(intentId) };
}
