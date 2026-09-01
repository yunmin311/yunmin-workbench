import { describe, expect, it } from 'vitest';
import { HarnessDispatchSchema, HarnessSmokeSchema, workbenchRejectedReceipt } from '../../src/main/harnessRequest';

const request = {
  intentId: '11111111-1111-4111-8111-111111111111',
  projectId: 'project-a', conversationKey: 'project-a::codex::main', packetText: 'packet',
  groupId: '22222222-2222-4222-8222-222222222222',
};

describe('Harness dispatch IPC contract', () => {
  it('rejects a request with no explicit harness', () => {
    expect(() => HarnessDispatchSchema.parse(request)).toThrow();
  });

  it('accepts an explicit supported harness', () => {
    expect(HarnessDispatchSchema.parse({ ...request, harness: 'claude', environment: { kind: 'real' } }).harness).toBe('claude');
  });

  it('requires explicit real or scoped Demo environment identity', () => {
    expect(() => HarnessDispatchSchema.parse({ ...request, harness: 'codex' })).toThrow();
    expect(() => HarnessDispatchSchema.parse({ ...request, harness: 'codex', environment: { kind: 'demo' } })).toThrow();
    expect(HarnessDispatchSchema.parse({
      ...request, harness: 'codex', environment: { kind: 'demo', sessionId: 'demo-session-a' },
    }).environment).toEqual({ kind: 'demo', sessionId: 'demo-session-a' });
  });

  it('requires an explicit harness for smoke', () => {
    expect(() => HarnessSmokeSchema.parse(undefined)).toThrow();
    expect(HarnessSmokeSchema.parse('codex')).toBe('codex');
  });

  it('labels a Workbench-side rejection as Workbench evidence, not protocol', () => {
    const receipt = workbenchRejectedReceipt(
      HarnessDispatchSchema.parse({ ...request, harness: 'claude', environment: { kind: 'real' } }),
      'Workbench capability probe',
      'Claude unavailable',
    );
    expect(receipt).toMatchObject({ status: 'REJECTED', source: 'workbench', protocolEvidence: 'Workbench capability probe' });
  });
});
