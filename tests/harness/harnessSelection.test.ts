import { describe, expect, it } from 'vitest';
import { canDispatchToHarness, dispatchableHarnesses, resolveHarnessTarget } from '../../src/core/project/harnessSelection';
import type { HarnessCapabilities } from '../../src/core/types';

function capability(harness: HarnessCapabilities['harness'], dispatch: boolean): HarnessCapabilities {
  return {
    harness,
    support: {
      dispatch: dispatch ? 'YES' : 'NO', observe: 'NO', receipt: 'NO', approval: 'UNKNOWN', needsInput: 'UNKNOWN',
      toolEvents: 'UNKNOWN', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
    },
    canDispatch: dispatch, canCreateSession: dispatch, canResumeSession: false,
    canObserveRuntime: false, canReceiveReceipt: false, protocol: harness, evidence: harness,
  };
}

const matrix = (codex: boolean, claude: boolean, deepseek: boolean) => ({
  codex: capability('codex', codex), claude: capability('claude', claude), deepseek: capability('deepseek', deepseek),
});

describe('Harness target selection', () => {
  it('uses the sole real dispatch target without showing a choice', () => {
    const caps = matrix(true, false, false);
    expect(dispatchableHarnesses(caps)).toEqual(['codex']);
    expect(resolveHarnessTarget(caps, null)).toBe('codex');
  });

  it('does not guess a default when multiple harnesses can really dispatch', () => {
    const caps = matrix(true, true, false);
    expect(dispatchableHarnesses(caps)).toEqual(['codex', 'claude']);
    expect(resolveHarnessTarget(caps, null)).toBeNull();
    expect(resolveHarnessTarget(caps, 'claude')).toBe('claude');
  });

  it('rejects an unavailable prior selection instead of silently switching', () => {
    expect(resolveHarnessTarget(matrix(true, false, false), 'claude')).toBeNull();
  });

  it('never authorizes dispatch when the compatibility boolean contradicts capability truth', () => {
    const inconsistent = capability('claude', true);
    inconsistent.support.dispatch = 'UNKNOWN';
    expect(canDispatchToHarness(inconsistent)).toBe(false);
  });
});
