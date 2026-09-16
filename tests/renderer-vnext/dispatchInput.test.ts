import { describe, expect, it } from 'vitest';
import { composeDispatchInput } from '../../src/renderer-vnext/src/dispatchInput';
import { presentDispatchPreflight } from '../../src/renderer-vnext/src/components/dispatch/DispatchSurface';

describe('Send-ready dispatch input', () => {
  it('puts the explicit user instruction before the immutable packet snapshot', () => {
    expect(composeDispatchInput('Return exactly OPEN_CODE_REAL_OK. Do not use tools.', 'PACKET SNAPSHOT')).toBe([
      '# Instruction',
      'Return exactly OPEN_CODE_REAL_OK. Do not use tools.',
      '',
      '# Frozen Packet',
      'PACKET SNAPSHOT',
    ].join('\n'));
  });
});

describe('Send-ready pending truth', () => {
  it('withholds temporary BLOCK rows until async verification settles', () => {
    const checks = [{ id: 'root', label: 'Project root', status: 'BLOCK' as const, detail: 'unbound' }];
    expect(presentDispatchPreflight(false, false, checks)).toEqual({ ready: false, checking: true, checks: [] });
    expect(presentDispatchPreflight(false, true, checks)).toEqual({ ready: false, checking: false, checks });
  });
});
