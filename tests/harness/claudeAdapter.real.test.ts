import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/main/adapters/claudeCodeAdapter';

const versionProbe = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'claude.cmd', '--version'], { windowsHide: true })
  : spawnSync('claude', ['--version'], { windowsHide: true });
const hasClaude = versionProbe.status === 0;
const enabled = process.env.WB_REAL_CLAUDE_SMOKE === '1' && hasClaude;

describe.runIf(enabled)('real Claude Code structured protocol', () => {
  it('returns a native session ref and structured completed result without persistent history', async () => {
    const adapter = new ClaudeCodeAdapter();
    try {
      const receipt = await adapter.smoke(process.cwd());
      expect(receipt).toMatchObject({ harness: 'claude', status: 'ACCEPTED' });
      expect(receipt.runtimeRef).toMatch(/^[0-9a-f-]{36}$/i);
      expect(receipt.protocolEvidence).toBe('claude:stream-json:result:success');
    } finally {
      adapter.close();
    }
  }, 120_000);

  it('cancels the real active process tree and reports observed cancellation without a synthetic completion', async () => {
    const adapter = new ClaudeCodeAdapter();
    const intentId = '9db412c8-2013-4f19-91a5-5c02f88caf86';
    const events: Array<{ kind?: string; method?: string; sourceRef?: string; runtimeSessionRef?: string }> = [];
    adapter.onEvent((event) => events.push(event));
    let delivered = false;
    try {
      const receipt = await adapter.dispatch(
        intentId,
        process.cwd(),
        'Reply with exactly: THIS_RESPONSE_SHOULD_BE_CANCELLED. Do not use tools.',
        () => { delivered = adapter.cancel(intentId); },
      );
      expect(delivered).toBe(true);
      expect(receipt).toMatchObject({
        harness: 'claude', status: 'CANCELLED', source: 'process',
        protocolEvidence: 'Claude dispatch cancelled',
      });
      expect(receipt.runtimeRef).toMatch(/^[0-9a-f-]{36}$/i);
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'lifecycle', method: 'process/cancelled', sourceRef: 'claude:process:cancelled',
      }));
      expect(events.some((event) => event.method === 'turn/completed')).toBe(false);
      expect(adapter.cancel(intentId)).toBe(false);
    } finally {
      adapter.close();
    }
  }, 120_000);
});
