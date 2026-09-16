import type { HarnessCapabilities } from './types';

export type HarnessName = HarnessCapabilities['harness'];
export type ResumeCapability = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';

export interface TranscriptLocator {
  kind: 'transcript' | 'rollout' | 'history';
  /** Provider-owned or filesystem locator. Never used as native session identity. */
  locator: string;
}

export interface ExecutionHostIdentity {
  kind: 'local';
  /** Optional stable host/device id when the authoritative source provides one. */
  id?: string;
}

export interface ExactResumeSeam {
  kind: 'cli-argv';
  program: string;
  /** Exact argv tokens. They are never reconstructed through a shell string. */
  args: readonly string[];
  promptTransport: 'stdin' | 'argument';
}

export type ResumeContract =
  | { capability: 'SUPPORTED'; seam: ExactResumeSeam }
  | { capability: 'UNSUPPORTED' | 'UNKNOWN'; reason: string };

export interface HarnessSessionIdentity {
  harness: HarnessName;
  provider: string;
  /** Provider-owned native session identity. Never derived from cwd/title/time. */
  nativeSessionId: string;
  transcript?: TranscriptLocator;
  executionHost?: ExecutionHostIdentity;
  resume: ResumeContract;
  provenance: {
    verification: 'VERIFIED' | 'OBSERVED';
    sourceRef: string;
  };
}

const SAFE_IDENTITY = /^[^\u0000\r\n]+$/;

function requiredIdentity(value: string, label: string): string {
  if (!value || value.length > 2048 || !SAFE_IDENTITY.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function createHarnessSessionIdentity(input: HarnessSessionIdentity): HarnessSessionIdentity {
  requiredIdentity(input.provider, 'provider');
  requiredIdentity(input.nativeSessionId, 'native session identity');
  requiredIdentity(input.provenance.sourceRef, 'session provenance sourceRef');
  if (input.transcript) requiredIdentity(input.transcript.locator, 'transcript locator');
  if (input.executionHost?.id) requiredIdentity(input.executionHost.id, 'execution host identity');
  if (input.resume.capability === 'SUPPORTED') {
    requiredIdentity(input.resume.seam.program, 'resume program');
    for (const arg of input.resume.seam.args) requiredIdentity(arg, 'resume argv token');
  } else {
    requiredIdentity(input.resume.reason, 'resume capability reason');
  }
  return input;
}

export interface OpenCodeSessionIdentityInput {
  nativeSessionId: string;
  cwd: string;
  program: string;
  prefixArgs?: readonly string[];
  sourceRef: string;
  transcript?: TranscriptLocator;
  executionHost?: ExecutionHostIdentity;
}

/** Exact native OpenCode resume seam; no cwd/title/time discovery is involved. */
export function createOpenCodeSessionIdentity(input: OpenCodeSessionIdentityInput): HarnessSessionIdentity {
  if (!/^ses_[A-Za-z0-9_-]+$/.test(input.nativeSessionId)) {
    throw new Error('Invalid OpenCode native session identity');
  }
  return createHarnessSessionIdentity({
    harness: 'opencode',
    provider: 'opencode',
    nativeSessionId: input.nativeSessionId,
    transcript: input.transcript,
    executionHost: input.executionHost ?? { kind: 'local' },
    resume: {
      capability: 'SUPPORTED',
      seam: {
        kind: 'cli-argv',
        program: input.program,
        args: [
          ...(input.prefixArgs ?? []),
          'run', '--format', 'json', '--dir', input.cwd, '--session', input.nativeSessionId,
        ],
        promptTransport: 'stdin',
      },
    },
    provenance: { verification: 'VERIFIED', sourceRef: input.sourceRef },
  });
}
