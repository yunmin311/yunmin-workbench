import { describe, expect, it } from 'vitest';
import { DeepSeekAdapter } from '../../src/main/adapters/deepseekAdapter';

describe('DeepSeek adapter — honest capability (no heuristic)', () => {
  it('reports unavailable when no binary and no structured protocol', async () => {
    const adapter = new DeepSeekAdapter();
    const caps = await adapter.capabilities();
    expect(caps.harness).toBe('deepseek');
    expect(caps.canDispatch).toBe(false);
    expect(caps.canCreateSession).toBe(false);
    expect(caps.support).toEqual({
      dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'UNKNOWN', needsInput: 'UNKNOWN',
      toolEvents: 'UNKNOWN', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
    });
    expect(caps.evidence).toContain('unavailable');
  });
  it('dispatch returns FAILED honest receipt, not throw', async () => {
    const adapter = new DeepSeekAdapter();
    const receipt = await adapter.dispatch('77777777-7777-4111-8111-111111111111', process.cwd(), 'hello');
    expect(receipt.status).toBe('FAILED');
    expect(receipt.harness).toBe('deepseek');
    expect(receipt.protocolEvidence).toContain('unavailable');
  });
  it('real smoke is skipped instead of inventing a DeepSeek session ref', async () => {
    const adapter = new DeepSeekAdapter();
    await expect(adapter.smoke(process.cwd())).rejects.toThrow(/unavailable|no stable structured interface/i);
  });
  it('does not turn an environment flag into fictional live capability', async () => {
    process.env.WB_FORCE_DEEPSEEK = 'available';
    const adapter = new DeepSeekAdapter();
    try {
      const caps = await adapter.capabilities();
      expect(caps.canDispatch).toBe(false);
      expect(caps.support.dispatch).toBe('NO');
    } finally {
      delete process.env.WB_FORCE_DEEPSEEK;
    }
  });
  it('does not use web automation or heuristic parser', async () => {
    const adapter = new DeepSeekAdapter();
    const caps = await adapter.capabilities();
    expect(caps.protocol).not.toMatch(/web|automation|heuristic/i);
  });
});
