import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter } from '../../src/main/adapters/openCodeAdapter';

const FAKE = fileURLToPath(new URL('../fixtures/opencode-fake.cjs', import.meta.url));
const make = () => new OpenCodeAdapter({ command: process.execPath, commandArgs: [FAKE] });

describe('OpenCode adapter native contract', () => {
  it('advertises only the structured CLI capabilities that are actually available', async () => {
    const adapter = make();
    const caps = await adapter.capabilities();
    expect(caps).toMatchObject({
      harness: 'opencode', canDispatch: true, canCreateSession: true,
      canResumeSession: true, canObserveRuntime: true, canReceiveReceipt: true,
      support: {
        dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'NO', needsInput: 'NO',
        toolEvents: 'YES', fileEvents: 'UNKNOWN', externalSessionRef: 'YES', resume: 'YES',
      },
    });
    expect(caps.evidence).toContain('1.18.26');
  });

  it('lists history by OpenCode native session id without deriving identity from cwd or title', async () => {
    const adapter = make();
    const sessions = await adapter.listSessions(5);
    expect(sessions).toEqual([expect.objectContaining({
      nativeRef: 'ses_native_history_1', title: 'Native session', agent: 'build',
      sourceRef: 'opencode:session:list:ses_native_history_1',
    })]);
  });

  it('scopes presence by exact bound project root instead of fuzzy cwd matching', async () => {
    const adapter = make();
    await expect(adapter.listSessions(5, process.cwd())).resolves.toHaveLength(1);
    await expect(adapter.listSessions(5, join(process.cwd(), 'nested'))).resolves.toHaveLength(0);
  });

  it('normalizes a structured run into native session, turn, text and terminal events', async () => {
    const adapter = make();
    const events: Array<{ method: string; runtimeSessionRef?: string }> = [];
    adapter.onEvent((event) => events.push(event));
    const receipt = await adapter.dispatch('11111111-1111-4111-8111-111111111111', process.cwd(), 'hello');
    expect(receipt).toMatchObject({ harness: 'opencode', status: 'ACCEPTED', source: 'protocol' });
    expect(receipt.runtimeRef).toMatch(/^ses_native_/);
    expect(events.map((event) => event.method)).toEqual(expect.arrayContaining([
      'session/started', 'turn/started', 'item/completed', 'turn/completed',
    ]));
    expect(events.every((event) => event.runtimeSessionRef === receipt.runtimeRef)).toBe(true);
  });

  it('continues only the explicitly supplied native session id', async () => {
    const adapter = make();
    const receipt = await adapter.continueSession(
      '22222222-2222-4222-8222-222222222222', process.cwd(), 'ses_exact_native', 'continue',
    );
    expect(receipt.runtimeRef).toBe('ses_exact_native');
    expect(receipt.status).toBe('ACCEPTED');
  });

  it('does not guess a session identity or success when structured terminal evidence is missing', async () => {
    process.env.FAKE_MODE = 'no-session';
    const adapter = make();
    try {
      const receipt = await adapter.dispatch('33333333-3333-4333-8333-333333333333', process.cwd(), 'hello');
      expect(receipt).toMatchObject({ status: 'FAILED', runtimeRef: undefined });
    } finally {
      delete process.env.FAKE_MODE;
    }
  });

  it('turns structured provider failures into a short summary plus bounded provenance', async () => {
    process.env.FAKE_MODE = 'provider-limit';
    const adapter = make();
    const events: Array<{ method: string; params?: unknown }> = [];
    adapter.onEvent((event) => events.push(event));
    try {
      const receipt = await adapter.dispatch('66666666-6666-4666-8666-666666666666', process.cwd(), 'hello');
      expect(receipt).toMatchObject({ status: 'FAILED', message: 'OpenCode provider rate limit reached. Try again later.' });
      expect(events).toContainEqual(expect.objectContaining({
        method: 'adapter/error',
        params: expect.objectContaining({
          message: 'OpenCode provider rate limit reached. Try again later.',
          provenance: expect.stringContaining('FreeUsageLimitError'),
        }),
      }));
      const provenance = (events.find((event) => event.method === 'adapter/error')?.params as { provenance: string }).provenance;
      expect(provenance.length).toBeLessThanOrEqual(4_000);
    } finally {
      delete process.env.FAKE_MODE;
    }
  });

  it('settles from a quiet structured step_finish when the CLI wrapper keeps the process open', async () => {
    process.env.FAKE_MODE = 'finish-hang';
    const adapter = new OpenCodeAdapter({ command: process.execPath, commandArgs: [FAKE], terminalSettleMs: 100 });
    try {
      await expect(adapter.dispatch('55555555-5555-4555-8555-555555555555', process.cwd(), 'hello'))
        .resolves.toMatchObject({ status: 'ACCEPTED', protocolEvidence: 'opencode:run:step_start+step_finish' });
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  }, 1_500);

  it('cancels the exact active Workbench intent', async () => {
    process.env.FAKE_MODE = 'hang';
    const adapter = make();
    try {
      const pending = adapter.dispatch('44444444-4444-4444-8444-444444444444', process.cwd(), 'wait');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(adapter.cancel('44444444-4444-4444-8444-444444444444')).toBe(true);
      await expect(pending).resolves.toMatchObject({ status: 'CANCELLED' });
    } finally {
      delete process.env.FAKE_MODE;
      adapter.close();
    }
  });
});
