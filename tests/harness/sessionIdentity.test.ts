import { describe, expect, it } from 'vitest';
import {
  createHarnessSessionIdentity,
  createOpenCodeSessionIdentity,
} from '../../src/core/harnessSessionIdentity';

describe('HarnessSessionIdentity / ResumeContract', () => {
  it('keeps provider session identity independent from an optional transcript locator', () => {
    const identity = createHarnessSessionIdentity({
      harness: 'codex',
      provider: 'codex',
      nativeSessionId: 'thread-native-1',
      transcript: { kind: 'rollout', locator: 'C:/rollouts/2026/09/example.jsonl' },
      executionHost: { kind: 'local', id: 'desktop-a' },
      resume: { capability: 'UNSUPPORTED', reason: 'No verified exact resume seam' },
      provenance: { verification: 'VERIFIED', sourceRef: 'codex:thread/start:result.thread.id' },
    });
    expect(identity.nativeSessionId).toBe('thread-native-1');
    expect(identity.transcript?.locator).not.toBe(identity.nativeSessionId);
    expect(identity.resume).toEqual({ capability: 'UNSUPPORTED', reason: 'No verified exact resume seam' });
  });

  it('describes OpenCode resume as one exact argv seam with stdin prompt transport', () => {
    const identity = createOpenCodeSessionIdentity({
      nativeSessionId: 'ses_exact_native',
      cwd: 'E:/work capsule',
      program: 'C:/Tools/opencode.cmd',
      prefixArgs: ['--trace'],
      sourceRef: 'opencode:run:event.sessionID',
    });
    expect(identity.resume).toEqual({
      capability: 'SUPPORTED',
      seam: {
        kind: 'cli-argv',
        program: 'C:/Tools/opencode.cmd',
        args: ['--trace', 'run', '--format', 'json', '--dir', 'E:/work capsule', '--session', 'ses_exact_native'],
        promptTransport: 'stdin',
      },
    });
  });

  it('rejects guessed or control-character session identities', () => {
    expect(() => createOpenCodeSessionIdentity({
      nativeSessionId: 'title from cwd\n2026-09-16',
      cwd: 'E:/repo',
      program: 'opencode',
      sourceRef: 'heuristic:title',
    })).toThrow(/native session/i);
  });
});
