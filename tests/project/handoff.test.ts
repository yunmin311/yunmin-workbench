import { describe, expect, it, vi } from 'vitest';
import {
  applyHandoffReceipt,
  createHandoffIntent,
  markHandoffDispatched,
} from '../../src/core/project/handoff';
import { HandoffDispatchRegistry } from '../../src/main/handoffDispatch';
import type { HandoffReceipt } from '../../src/core/types';

const payload = {
  projectId: 'creative-os',
  conversationKey: 'creative-os:codex:main',
  packetText: 'deterministic packet text',
  harness: 'codex' as const,
};

function receipt(status: HandoffReceipt['status']): HandoffReceipt {
  return {
    intentId: '11111111-1111-4111-8111-111111111111',
    harness: 'codex',
    status,
    at: '2026-08-26T00:00:00.000Z',
    runtimeRef: status === 'ACCEPTED' ? 'thread-1' : undefined,
    turnRef: status === 'ACCEPTED' ? 'turn-1' : undefined,
    source: 'protocol',
    protocolEvidence: 'official response ids',
  };
}

describe('real harness handoff intent boundary', () => {
  it('advances only from local draft to dispatched to protocol-accepted', () => {
    const draft = createHandoffIntent('11111111-1111-4111-8111-111111111111', payload);
    expect(draft.state).toBe('draft');
    const dispatched = markHandoffDispatched(draft);
    expect(dispatched.state).toBe('dispatched');
    const accepted = applyHandoffReceipt(dispatched, receipt('ACCEPTED'));
    expect(accepted.state).toBe('accepted');
    expect(accepted.receipt?.runtimeRef).toBe('thread-1');
    expect(accepted).not.toHaveProperty('runtimeState');
  });

  it.each(['REJECTED', 'FAILED'] as const)('preserves %s as an intent result, not runtime truth', (status) => {
    const intent = markHandoffDispatched(
      createHandoffIntent('11111111-1111-4111-8111-111111111111', payload),
    );
    expect(applyHandoffReceipt(intent, receipt(status)).state).toBe(status.toLowerCase());
  });

  it('preserves CANCELLED as a distinct user intent result', () => {
    const intent = markHandoffDispatched(
      createHandoffIntent('11111111-1111-4111-8111-111111111111', payload),
    );
    expect(applyHandoffReceipt(intent, receipt('CANCELLED')).state).toBe('cancelled');
  });

  it('does not apply a receipt from a different harness to the intent', () => {
    const intent = markHandoffDispatched(
      createHandoffIntent('11111111-1111-4111-8111-111111111111', payload),
    );
    const wrongHarness = { ...receipt('ACCEPTED'), harness: 'claude' as const };
    expect(applyHandoffReceipt(intent, wrongHarness)).toBe(intent);
  });

  it('deduplicates repeated dispatches by intent id', async () => {
    const registry = new HandoffDispatchRegistry<HandoffReceipt>();
    const dispatch = vi.fn(async () => receipt('ACCEPTED'));
    const first = registry.run(receipt('ACCEPTED').intentId, dispatch);
    const second = registry.run(receipt('ACCEPTED').intentId, dispatch);
    expect(await first).toEqual(await second);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
