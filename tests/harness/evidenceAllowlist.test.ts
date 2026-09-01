import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CodexAppServerAdapter } from '../../src/main/adapters/codexAppServer';
import { ClaudeCodeAdapter } from '../../src/main/adapters/claudeCodeAdapter';
import { allowlistedUserAgent, allowlistedVersionToken, boundedProcessError } from '../../src/main/adapters/evidenceBounds';

const CODEX_FAKE = fileURLToPath(new URL('../fixtures/codex-fake-app-server.cjs', import.meta.url));
const CLAUDE_FAKE = fileURLToPath(new URL('../fixtures/claude-fake.cjs', import.meta.url));

/** Asserts no fragment of the hostile fixture payload survives in the evidence string. */
function expectWithheld(evidence: string): void {
  for (const secret of ['SECRETVALUE', 'SECRET-RPC', 'SECRET-STDERR', 'token=abcdef', 'auth.json', 'victim']) {
    expect(evidence).not.toContain(secret);
  }
  expect(evidence).not.toMatch(/[A-Za-z]:\\/);
}

describe('harness evidence allowlist — unit', () => {
  it('admits only version-shaped facts', () => {
    expect(allowlistedUserAgent('codex-cli/1.2.3')).toBe('codex-cli/1.2.3');
    expect(allowlistedUserAgent('codex-fake/1.0')).toBe('codex-fake/1.0');
    expect(allowlistedUserAgent('sk-ant-api03-SECRETVALUE C:\\Users\\victim auth.json')).toBeUndefined();
    expect(allowlistedUserAgent('')).toBeUndefined();
    expect(allowlistedVersionToken('2.1.207 (Claude Code)')).toBe('2.1.207');
    expect(allowlistedVersionToken('v22.14.0')).toBe('v22.14.0');
    expect(allowlistedVersionToken('sk-ant-api03-SECRETVALUE C:\\Users\\victim')).toBeUndefined();
  });

  it('reduces process failures to exit/error codes only', () => {
    const enoent = Object.assign(new Error('spawn claude-definitely-not-on-path ENOENT'), { code: 'ENOENT' });
    expect(boundedProcessError(enoent)).toBe('process error ENOENT');
    expect(boundedProcessError(new Error('app-server request timed out: initialize'))).toBe('app-server request timed out');
    expect(boundedProcessError(new Error('app-server -32602: SECRET-RPC C:\\Users\\victim'))).toBe('app-server error -32602');
    // a hostile (non-numeric) RPC code carries no detail either
    expect(boundedProcessError(new Error('app-server sk-evil-code: SECRET-RPC token=abcdef'))).toBe('process error');
    expect(boundedProcessError(new Error('SECRET arbitrary message'))).toBe('process error');
  });
});

describe('harness evidence allowlist — adapter probes', () => {
  it('withholds a hostile Codex userAgent and reports structured unavailability', async () => {
    process.env.FAKE_MODE = 'hostile-useragent';
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [CODEX_FAKE] });
    try {
      const caps = await adapter.capabilities();
      expect(caps.canDispatch).toBe(false);
      expect(caps.evidence).toContain('unavailable');
      expectWithheld(caps.evidence);
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('withholds a hostile Codex initialize error message, keeping only the RPC code', async () => {
    process.env.FAKE_MODE = 'hostile-initialize-error';
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [CODEX_FAKE] });
    try {
      const caps = await adapter.capabilities();
      expect(caps.canDispatch).toBe(false);
      expect(caps.evidence).toBe('unavailable: app-server error 5');
      expectWithheld(caps.evidence);
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('withholds hostile Claude --version stdout and keeps only a version fact', async () => {
    process.env.FAKE_MODE = 'hostile-version';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [CLAUDE_FAKE] });
    try {
      const caps = await adapter.capabilities();
      expect(caps.canDispatch).toBe(true);
      expect(caps.evidence).toContain('claude --version unknown');
      expectWithheld(caps.evidence);
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('withholds hostile Claude --version stderr on a failing probe', async () => {
    process.env.FAKE_MODE = 'hostile-version-fail';
    const adapter = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [CLAUDE_FAKE] });
    try {
      const caps = await adapter.capabilities();
      expect(caps.canDispatch).toBe(false);
      expect(caps.evidence).toBe('unavailable: claude --version exited 3');
      expectWithheld(caps.evidence);
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('keeps the healthy fixture facts intact alongside the allowlist', async () => {
    const codex = new CodexAppServerAdapter({ command: process.execPath, args: [CODEX_FAKE] });
    try {
      await expect(codex.capabilities()).resolves.toMatchObject({ canDispatch: true });
    } finally { codex.close(); }
    const claude = new ClaudeCodeAdapter({ command: process.execPath, commandArgs: [CLAUDE_FAKE] });
    try {
      const caps = await claude.capabilities();
      expect(caps.canDispatch).toBe(true);
      expect(caps.evidence).toContain('claude --version 2.1.207');
      expect(caps.evidence).toContain('stream-json=yes');
    } finally { claude.close(); }
  });
});
