import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CodexAppServerAdapter } from '../../src/main/adapters/codexAppServer';

const hasCodex = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

describe.runIf(hasCodex)('official Codex app-server protocol', () => {
  it('initializes and creates a real ephemeral thread without starting a model turn', async () => {
    const adapter = new CodexAppServerAdapter();
    try {
      const smoke = await adapter.smoke(process.cwd());
      expect(smoke.userAgent.toLowerCase()).toContain('codex');
      expect(smoke.ephemeralThreadId.length).toBeGreaterThan(8);
    } finally {
      adapter.close();
    }
  }, 60_000);
});
