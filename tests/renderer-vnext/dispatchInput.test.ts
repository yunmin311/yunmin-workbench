import { describe, expect, it } from 'vitest';
import { composeDispatchInput } from '../../src/renderer-vnext/src/dispatchInput';

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
