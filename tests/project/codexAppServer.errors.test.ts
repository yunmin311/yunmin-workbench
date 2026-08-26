import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexAppServerAdapter } from '../../src/main/adapters/codexAppServer';

const MISSING = 'codex-definitely-not-on-path-3f8a';
const FAKE = fileURLToPath(new URL('../fixtures/codex-fake-app-server.cjs', import.meta.url));

describe('Codex adapter survives a missing executable (P0)', () => {
  it('capabilities() answers with structured unavailable instead of throwing', async () => {
    const adapter = new CodexAppServerAdapter({ command: MISSING });
    const capabilities = await adapter.capabilities();
    expect(capabilities.harness).toBe('codex');
    expect(capabilities.canDispatch).toBe(false);
    expect(capabilities.canCreateSession).toBe(false);
    expect(capabilities.evidence).toContain('unavailable');
    expect(capabilities.evidence).toContain('ENOENT');
    adapter.close();
  });

  it('dispatch() returns a FAILED receipt instead of throwing', async () => {
    const adapter = new CodexAppServerAdapter({ command: MISSING });
    const receipt = await adapter.dispatch('11111111-1111-4111-8111-111111111111', process.cwd(), 'hello');
    expect(receipt.status).toBe('FAILED');
    expect(receipt.message).toContain('ENOENT');
    adapter.close();
  });

  it('stays retryable after spawn failures and never emits an unhandled error event', async () => {
    const adapter = new CodexAppServerAdapter({ command: MISSING });
    await adapter.capabilities();
    const receipt = await adapter.dispatch('22222222-2222-4222-8222-222222222222', process.cwd(), 'again');
    expect(receipt.status).toBe('FAILED');
    const second = await adapter.capabilities();
    expect(second.canDispatch).toBe(false);
    adapter.close();
  }, 30_000);
});

describe('Codex adapter against a fake app-server (protocol fixture)', () => {
  it('completes smoke over the real stdio protocol', async () => {
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [FAKE] });
    try {
      const result = await adapter.smoke(process.cwd());
      expect(result.userAgent).toBe('codex-fake/1.0');
      expect(result.ephemeralThreadId).toMatch(/^fake-thread-/);
    } finally {
      adapter.close();
    }
  });

  it('rejects pending requests cleanly when the server dies mid-turn, then recovers', async () => {
    const dying = new CodexAppServerAdapter({
      command: process.execPath,
      args: [FAKE],
    });
    process.env.FAKE_MODE = 'die-after-thread-start';
    try {
      const receipt = await dying.dispatch('33333333-3333-4333-8333-333333333333', process.cwd(), 'dying');
      expect(receipt.status).toBe('FAILED');
      expect(receipt.message).toContain('exited');
    } finally {
      delete process.env.FAKE_MODE;
      dying.close();
    }

    const recovered = new CodexAppServerAdapter({ command: process.execPath, args: [FAKE] });
    try {
      const capabilities = await recovered.capabilities();
      expect(capabilities.canDispatch).toBe(true);
    } finally {
      recovered.close();
    }
  }, 30_000);
});
