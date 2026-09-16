import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter } from '../../src/main/adapters/openCodeAdapter';

const enabled = process.env.WB_REAL_OPENCODE_SMOKE === '1';

describe.skipIf(!enabled)('OpenCode adapter — real read-only smoke', () => {
  it('discovers the installed CLI and reads native session presence without model execution', async () => {
    const adapter = new OpenCodeAdapter();
    try {
      const caps = await adapter.capabilities();
      expect(caps.harness).toBe('opencode');
      expect(caps.canDispatch, caps.evidence).toBe(true);
      expect(caps.canResumeSession, caps.evidence).toBe(true);
      const sessions = await adapter.smoke(process.cwd());
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => /^ses_/.test(session.nativeRef))).toBe(true);
      expect(sessions.every((session) => session.sourceRef.endsWith(session.nativeRef))).toBe(true);
      expect(
        sessions.every((session) =>
          typeof session.directory === 'string' &&
          session.directory.localeCompare(process.cwd(), undefined, { sensitivity: 'accent' }) === 0
        )
      ).toBe(true);
    } finally {
      adapter.close();
    }
  }, 20_000);
});
