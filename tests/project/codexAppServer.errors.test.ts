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
  it('exposes server-initiated approval requests with their explicit request id', async () => {
    process.env.FAKE_MODE = 'server-requests';
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [FAKE] });
    const events: { method: string; id?: string | number }[] = [];
    adapter.onEvent((event) => events.push(event));
    try {
      await adapter.dispatch('44444444-4444-4444-8444-444444444444', process.cwd(), 'approval');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(events).toContainEqual(expect.objectContaining({
        method: 'item/commandExecution/requestApproval', id: 'approval-1',
      }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

  it('emits a process error for an accepted active thread when the server exits', async () => {
    process.env.FAKE_MODE = 'die-after-turn-start';
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [FAKE] });
    const events: { method: string; params?: unknown }[] = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('55555555-5555-4555-8555-555555555555', process.cwd(), 'accepted then crash');
      expect(receipt.status).toBe('ACCEPTED');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(events).toContainEqual(expect.objectContaining({
        method: 'adapter/error',
        params: expect.objectContaining({ threadId: receipt.runtimeRef }),
      }));
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });

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
    const dyingEvents: { method: string }[] = [];
    dying.onEvent((event) => dyingEvents.push(event));
    process.env.FAKE_MODE = 'die-after-thread-start';
    try {
      const receipt = await dying.dispatch('33333333-3333-4333-8333-333333333333', process.cwd(), 'dying');
      expect(receipt.status).toBe('FAILED');
      expect(receipt.message).toContain('exited');
      expect(dyingEvents.some((event) => event.method === 'adapter/error')).toBe(false);
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
