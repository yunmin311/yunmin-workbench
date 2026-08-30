import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CodexAppServerAdapter } from '../../src/main/adapters/codexAppServer';

const hasCodex = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

describe.runIf(hasCodex)('official Codex app-server protocol', () => {
  it('initializes and creates a real ephemeral thread without starting a model turn', async () => {
    const adapter = new CodexAppServerAdapter();
    try {
      const smoke = await adapter.smoke(process.cwd());
      // initialize.userAgent is server-provided protocol evidence, not a
      // product-name field. Current Codex versions identify this client using
      // the clientInfo we sent (yunmin-workbench/...), so only require the
      // documented non-empty value; thread/start below proves the server.
      expect(smoke.userAgent.length).toBeGreaterThan(0);
      expect(smoke.ephemeralThreadId.length).toBeGreaterThan(8);
    } finally {
      adapter.close();
    }
  }, 60_000);
});
