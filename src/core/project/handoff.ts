import type { HandoffReceipt, UserIntent } from '../types';

export interface HandoffIntentPayload {
  projectId: string;
  conversationKey: string;
  packetText: string;
  harness: 'codex';
}

export function createHandoffIntent(id: string, payload: HandoffIntentPayload): UserIntent {
  return {
    id,
    kind: 'packet-handoff',
    payload: { ...payload },
    state: 'draft',
    createdAt: new Date().toISOString(),
  };
}

export function markHandoffDispatched(intent: UserIntent): UserIntent {
  if (intent.state !== 'draft') return intent;
  return { ...intent, state: 'dispatched' };
}

export function applyHandoffReceipt(intent: UserIntent, receipt: HandoffReceipt): UserIntent {
  if (receipt.intentId !== intent.id) return intent;
  const state = receipt.status === 'ACCEPTED'
    ? 'accepted'
    : receipt.status === 'REJECTED'
      ? 'rejected'
      : 'failed';
  return {
    ...intent,
    state,
    receipt: {
      at: receipt.at,
      message: receipt.message ?? receipt.protocolEvidence,
      runtimeRef: receipt.runtimeRef,
    },
  };
}
