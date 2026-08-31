import { z } from 'zod';
import type { HandoffReceipt } from '../core/types';

const KeySchema = z.string().min(1).max(1024);

export const HarnessDispatchSchema = z.object({
  intentId: z.string().uuid(),
  projectId: KeySchema,
  conversationKey: KeySchema,
  packetText: z.string().min(1).max(5_000_000),
  harness: z.enum(['codex', 'claude', 'deepseek']),
});

export const HarnessSmokeSchema = z.enum(['codex', 'claude', 'deepseek']);

type HarnessDispatchRequest = z.infer<typeof HarnessDispatchSchema>;

export function workbenchRejectedReceipt(
  request: Pick<HarnessDispatchRequest, 'intentId' | 'harness'>,
  evidence: string,
  message: string,
): HandoffReceipt & { message: string } {
  return {
    intentId: request.intentId,
    harness: request.harness,
    status: 'REJECTED',
    at: new Date().toISOString(),
    source: 'workbench',
    protocolEvidence: evidence,
    message,
  };
}
