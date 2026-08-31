import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/main/adapters/claudeCodeAdapter';

const FAKE = fileURLToPath(new URL('../fixtures/claude-fake.cjs', import.meta.url));
const MISSING = 'claude-definitely-not-on-path-xyz';

describe('Claude adapter — missing binary (P0)', () => {
  it('capabilities() answers unavailable instead of throwing', async () => {
    const adapter = new ClaudeCodeAdapter({ command: MISSING });
    const caps = await adapter.capabilities();
    expect(caps.harness).toBe('claude');
    expect(caps.canDispatch).toBe(false);
    expect(caps.support).toEqual({
      dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'NO', needsInput: 'NO',
      toolEvents: 'NO', fileEvents: 'NO', externalSessionRef: 'NO', resume: 'NO',
    });
    expect(caps.evidence).toContain('unavailable');
    adapter.close();
  });
  it('dispatch() returns FAILED receipt instead of throwing', async () => {
    const adapter = new ClaudeCodeAdapter({ command: MISSING });
    const receipt = await adapter.dispatch('11111111-1111-4111-8111-111111111111', process.cwd(), 'hello');
    expect(receipt.status).toBe('FAILED');
    expect(receipt.harness).toBe('claude');
    expect(receipt.source).toBe('process');
    adapter.close();
  });
});

describe('Claude adapter — incompatible binary', () => {
  it('reports dispatch NO when the installed CLI lacks stream-json', async () => {
    process.env.FAKE_MODE = 'incompatible';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    try {
      const caps = await adapter.capabilities();
      expect(caps.support.dispatch).toBe('NO');
      expect(caps.evidence).toContain('does not advertise stream-json');
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});

describe('Claude adapter — malformed / partial event isolation', () => {
  it('ignores malformed JSON lines and does not guess structured events', async () => {
    process.env.FAKE_MODE = 'malformed';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const events: unknown[] = [];
    adapter.onEvent((e) => events.push(e));
    try {
      const receipt = await adapter.dispatch('22222222-2222-4111-8111-111111111111', process.cwd(), 'test malformed');
      // Even with malformed, should still get a receipt (ACCEPTED or FAILED) without throwing
      expect(['ACCEPTED', 'FAILED']).toContain(receipt.status);
      // Should not have emitted an event with INFERRED from stdout string guess
      const inferred = events.filter((e) => (e as { verification?: string }).verification === 'INFERRED');
      expect(inferred).toHaveLength(0);
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'error', method: 'adapter/error', verification: 'OBSERVED',
        sourceRef: 'claude:stream-json:malformed-line',
      }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
  it('returns FAILED and isolates a truncated final event', async () => {
    process.env.FAKE_MODE = 'partial';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const events: unknown[] = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('23232323-2323-4232-8232-232323232323', process.cwd(), 'partial');
      expect(receipt.status).toBe('FAILED');
      expect(receipt.protocolEvidence).toContain('no result');
      expect(receipt.source).toBe('process');
      expect(events).toContainEqual(expect.objectContaining({ kind: 'error', method: 'adapter/error' }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
  it('rejects a result event that omits formal terminal fields', async () => {
    process.env.FAKE_MODE = 'malformed-result';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const events: unknown[] = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('24242424-2424-4242-8242-242424242424', process.cwd(), 'malformed result');
      expect(receipt.status).toBe('FAILED');
      expect(receipt.protocolEvidence).toContain('no result');
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'error', method: 'adapter/error', sourceRef: 'claude:stream-json:malformed-result',
      }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});

describe('Claude adapter — process crash structured', () => {
  it('returns FAILED receipt with exit evidence when child crashes', async () => {
    process.env.FAKE_MODE = 'crash';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const events: unknown[] = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('33333333-3333-4111-8111-111111111111', process.cwd(), 'crash test');
      expect(receipt.status).toBe('FAILED');
      expect(receipt.protocolEvidence).toMatch(/exit/);
      expect(receipt.source).toBe('process');
      expect(events).toContainEqual(expect.objectContaining({ kind: 'error', method: 'adapter/error' }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
  it('cancel terminates an active child and lets the dispatch settle', async () => {
    process.env.FAKE_MODE = 'hang';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    try {
      const pending = adapter.dispatch('44444444-4444-4111-8111-111111111111', process.cwd(), 'cleanup test');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(adapter.cancel('44444444-4444-4111-8111-111111111111')).toBe(true);
      await expect(pending).resolves.toMatchObject({ status: 'FAILED', protocolEvidence: 'Claude dispatch cancelled' });
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});

describe('Claude adapter — protocol provenance', () => {
  it('uses no-session-persistence and never bypasses permissions', async () => {
    process.env.FAKE_MODE = 'assert-safe-args';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    try {
      await expect(adapter.dispatch('45454545-4545-4454-8454-454545454545', process.cwd(), 'safe')).resolves.toMatchObject({ status: 'ACCEPTED' });
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('normalizes only structured nested tool events and does not claim file changes', async () => {
    process.env.FAKE_MODE = 'tool';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const events: Array<{ kind?: string; method?: string; sourceRef?: string; runtimeSessionRef?: string }> = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('46464646-4646-4464-8464-464646464646', process.cwd(), 'tool');
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', method: 'tool-started', sourceRef: 'claude:stream-json:assistant:tool_use', runtimeSessionRef: receipt.runtimeRef }));
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', method: 'tool-completed', sourceRef: 'claude:stream-json:user:tool_result', runtimeSessionRef: receipt.runtimeRef }));
      expect(events.some((event) => event.kind === 'file')).toBe(false);
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});

describe('Claude adapter — real identity', () => {
  it('uses session_id from protocol as externalSessionRef, never cwd', async () => {
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    let runtimeRef: string | undefined;
    const receipt = await adapter.dispatch('55555555-5555-4111-8111-111111111111', process.cwd(), 'identity test', (id) => { runtimeRef = id; });
    expect(receipt.runtimeRef).toBeDefined();
    expect(receipt.runtimeRef).toMatch(/^claude-session-/);
    expect(runtimeRef).toBe(receipt.runtimeRef);
    adapter.close();
  });
  it('when session_id missing, does not guess from cwd — receipt has undefined runtimeRef', async () => {
    process.env.FAKE_MODE = 'no-session-id';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    try {
      const receipt = await adapter.dispatch('66666666-6666-4111-8111-111111111111', process.cwd(), 'no id');
      expect(receipt.runtimeRef).toBeUndefined();
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});

describe('Claude adapter — honest capability', () => {
  it('canResumeSession is always false (no reliable resume)', async () => {
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const caps = await adapter.capabilities();
    expect(caps.canResumeSession).toBe(false);
    expect(caps.support).toEqual({
      dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'NO', needsInput: 'NO',
      toolEvents: 'YES', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
    });
    adapter.close();
  });
  it('fixture smoke proves contract only and returns the fixture native session ref', async () => {
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });
    const result = await adapter.smoke(process.cwd());
    expect(result).toMatchObject({ status: 'ACCEPTED', harness: 'claude' });
    expect(result.runtimeRef).toMatch(/^claude-session-/);
    adapter.close();
  });
});
