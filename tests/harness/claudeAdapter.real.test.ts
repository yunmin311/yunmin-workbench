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
});
