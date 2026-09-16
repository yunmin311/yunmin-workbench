import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createOpenCodeSessionIdentity, type HarnessSessionIdentity } from '../../core/harnessSessionIdentity';
import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';
import { runProcess, spawnOwnedProcess, type OwnedProcess } from '../process/processRunner';
import { allowlistedVersionToken, boundedProcessError } from './evidenceBounds';

export interface OpenCodeProtocolEvent {
  kind: 'session' | 'turn' | 'assistant' | 'tool' | 'error' | 'lifecycle';
  method: string;
  params?: unknown;
  harness: 'opencode';
  verification: 'VERIFIED' | 'OBSERVED';
  sourceRef: string;
  observedAt: string;
  /** Native OpenCode `ses_...` identity from JSON events only. */
  runtimeSessionRef?: string;
  /** Workbench-local correlation; never used as external identity. */
  dispatchRef: string;
}

export interface OpenCodeSessionPresence {
  nativeRef: string;
  title?: string;
  directory?: string;
  agent?: string;
  model?: string;
  updatedAt?: string;
  sourceRef: string;
}

export interface OpenCodeAdapterOptions {
  command?: string;
  commandArgs?: string[];
  terminalSettleMs?: number;
}

function unavailableCapabilities(reason: string): HarnessCapabilities {
  return {
    harness: 'opencode',
    support: {
      dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'NO', needsInput: 'NO',
      toolEvents: 'NO', fileEvents: 'NO', externalSessionRef: 'NO', resume: 'NO',
    },
    canDispatch: false,
    canCreateSession: false,
    canResumeSession: false,
    canObserveRuntime: false,
    canReceiveReceipt: false,
    protocol: 'OpenCode CLI JSON events',
    evidence: `unavailable: ${reason}`,
  };
}

function isNativeSessionRef(value: unknown): value is string {
  return typeof value === 'string' && /^ses_[A-Za-z0-9_-]+$/.test(value);
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const ANSI_ESCAPE = /\u001B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;

function boundedFailureProvenance(value: unknown, limit = 4_000): string {
  let raw: string;
  try { raw = typeof value === 'string' ? value : JSON.stringify(value); } catch { raw = String(value); }
  const clean = raw.replace(ANSI_ESCAPE, '').replace(CONTROL_CHARS, '').trim();
  if (clean.length <= limit) return clean;
  const half = Math.floor((limit - 24) / 2);
  return `${clean.slice(0, half)}\n… provenance bounded …\n${clean.slice(-half)}`;
}

function nestedMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (record.data && typeof record.data === 'object' && typeof (record.data as Record<string, unknown>).message === 'string') {
    return (record.data as Record<string, unknown>).message as string;
  }
  return '';
}

function providerFailure(value: unknown): { message: string; provenance: string } {
  const provenance = boundedFailureProvenance(value);
  const detail = `${nestedMessage(value)} ${provenance}`.toLowerCase();
  if (/\b429\b|rate.?limit|usage.?limit|too many requests/.test(detail)) {
    return { message: 'OpenCode provider rate limit reached. Try again later.', provenance };
  }
  if (/auth|unauthori[sz]ed|invalid.?key|credential/.test(detail)) {
    return { message: 'OpenCode provider authentication failed. Check the configured provider credentials.', provenance };
  }
  const direct = nestedMessage(value).trim();
  return { message: direct ? `OpenCode provider failed: ${direct.slice(0, 240)}` : 'OpenCode provider failed.', provenance };
}

/**
 * OpenCode's official CLI is the production seam:
 * - `session list --format json` exposes exact native session identities.
 * - `run --format json` exposes the Workbench-owned run's lifecycle and result.
 * - `run --session <ses_...>` continues only an explicit native identity.
 *
 * Non-interactive OpenCode rejects permission requests itself. Workbench does
 * not claim approval/question support and never enables --auto/yolo.
 */
export class OpenCodeAdapter {
  private readonly command: string;
  private readonly commandArgs: string[];
  private readonly terminalSettleMs: number;
  private readonly listeners = new Set<(event: OpenCodeProtocolEvent) => void>();
  private readonly activeChildren = new Map<string, OwnedProcess>();
  private readonly cancelled = new Set<string>();

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.command = options.command ?? 'opencode';
    this.commandArgs = options.commandArgs ?? [];
    this.terminalSettleMs = Math.max(50, options.terminalSettleMs ?? 5_000);
  }

  onEvent(listener: (event: OpenCodeProtocolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OpenCodeProtocolEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  sessionIdentity(nativeSessionId: string, cwd: string, sourceRef: string): HarnessSessionIdentity {
    return createOpenCodeSessionIdentity({
      nativeSessionId,
      cwd,
      program: this.command,
      prefixArgs: this.commandArgs,
      sourceRef,
      executionHost: { kind: 'local' },
    });
  }

  private async capture(args: string[], timeoutMs = 5_000, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string; marker?: string }> {
    const result = await runProcess({
      program: this.command,
      args: [...this.commandArgs, ...args],
      cwd,
      timeoutMs,
      maxOutputBytes: 2_000_000,
      ownProcessTree: true,
    });
    return {
      code: result.timedOut ? 124 : result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      marker: result.timedOut ? 'timeout' : result.code === 127 ? result.stderr : undefined,
    };
  }

  async capabilities(): Promise<HarnessCapabilities> {
    try {
      const versionResult = await this.capture(['--version']);
      if (versionResult.code !== 0) return unavailableCapabilities(versionResult.marker ?? `opencode --version exited ${versionResult.code}`);
      const version = allowlistedVersionToken(versionResult.stdout.split(/\r?\n/)[0] ?? '') ?? 'unknown';
      const help = await this.capture(['run', '--help']);
      const helpText = `${help.stdout}\n${help.stderr}`;
      if (help.code !== 0 || !helpText.includes('--format') || !helpText.includes('json') || !helpText.includes('--session')) {
        return unavailableCapabilities('installed OpenCode does not advertise JSON events plus native session continuation');
      }
      return {
        harness: 'opencode',
        support: {
          dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'NO', needsInput: 'NO',
          toolEvents: 'YES', fileEvents: 'UNKNOWN', externalSessionRef: 'YES', resume: 'YES',
        },
        canDispatch: true,
        canCreateSession: true,
        canResumeSession: true,
        canObserveRuntime: true,
        canReceiveReceipt: true,
        protocol: 'OpenCode run/session CLI JSON',
        evidence: `opencode ${version}; run --format json; native --session; non-interactive permission requests auto-reject upstream`,
      };
    } catch (error) {
      return unavailableCapabilities(boundedProcessError(error));
    }
  }

  async listSessions(limit = 20, exactDirectory?: string): Promise<OpenCodeSessionPresence[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const result = await this.capture(
      ['session', 'list', '--format', 'json', '--max-count', String(boundedLimit)],
      10_000,
      exactDirectory,
    );
    if (result.code !== 0) return [];
    let values: unknown;
    try { values = JSON.parse(result.stdout); } catch { return []; }
    if (!Array.isArray(values)) return [];
    const expectedDirectory = exactDirectory
      ? (process.platform === 'win32' ? resolve(exactDirectory).toLocaleLowerCase() : resolve(exactDirectory))
      : undefined;
    return values.flatMap((raw): OpenCodeSessionPresence[] => {
      const value = raw as Record<string, unknown>;
      if (!isNativeSessionRef(value.id)) return [];
      const directory = typeof value.directory === 'string' ? value.directory : undefined;
      const normalizedDirectory = directory
        ? (process.platform === 'win32' ? resolve(directory).toLocaleLowerCase() : resolve(directory))
        : undefined;
      if (expectedDirectory && normalizedDirectory !== expectedDirectory) return [];
      const model = value.model as Record<string, unknown> | undefined;
      const time = value.time as Record<string, unknown> | undefined;
      return [{
        nativeRef: value.id,
        title: typeof value.title === 'string' ? value.title : undefined,
        directory,
        agent: typeof value.agent === 'string' ? value.agent : undefined,
        model: typeof model?.providerID === 'string' && typeof model?.id === 'string'
          ? `${model.providerID}/${model.id}` : undefined,
        updatedAt: typeof time?.updated === 'number' ? new Date(time.updated).toISOString() : undefined,
        sourceRef: `opencode:session:list:${value.id}`,
      }];
    });
  }

  cancel(intentId: string): boolean {
    const owned = this.activeChildren.get(intentId);
    if (!owned) return false;
    this.cancelled.add(intentId);
    void owned.terminate();
    return true;
  }

  async continueSession(intentId: string, cwd: string, identity: HarnessSessionIdentity, text: string, onThreadStarted?: (threadId: string) => void): Promise<HandoffReceipt> {
    if (identity.harness !== 'opencode' || identity.provider !== 'opencode'
      || !isNativeSessionRef(identity.nativeSessionId) || identity.resume.capability !== 'SUPPORTED') {
      return {
        intentId, harness: 'opencode', status: 'FAILED', at: new Date().toISOString(), source: 'workbench',
        protocolEvidence: 'OpenCode native session id validation', message: 'Invalid OpenCode native session id',
      };
    }
    return this.run(intentId, cwd, text, onThreadStarted, identity);
  }

  async dispatch(intentId: string, cwd: string, text: string, onThreadStarted?: (threadId: string) => void): Promise<HandoffReceipt> {
    return this.run(intentId, cwd, text, onThreadStarted);
  }

  private async run(intentId: string, cwd: string, text: string, onThreadStarted?: (threadId: string) => void, resumeIdentity?: HarnessSessionIdentity): Promise<HandoffReceipt> {
    let owned: OwnedProcess | null = null;
    try {
      const resumeSeam = resumeIdentity?.resume.capability === 'SUPPORTED' ? resumeIdentity.resume.seam : undefined;
      const nativeSessionRef = resumeIdentity?.nativeSessionId;
      const args = resumeSeam?.args ?? [...this.commandArgs, 'run', '--format', 'json', '--dir', cwd];
      owned = spawnOwnedProcess({
        program: resumeSeam?.program ?? this.command,
        args,
        cwd,
        env: { ...process.env },
        input: text,
        timeoutMs: null,
        maxOutputBytes: 2_000_000,
        ownProcessTree: true,
      });
      const proc = owned.child;
      this.activeChildren.set(intentId, owned);
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000); });
      proc.on('error', () => undefined);
      proc.stdout.on('error', () => undefined);
      proc.stderr.on('error', () => undefined);
      let sessionId: string | undefined;
      let sawStart = false;
      let sawFinish = false;
      let settledFromTerminalEvidence = false;
      let resultText = '';
      let structuredFailure: { message: string; provenance: string } | undefined;
      const emit = (event: Omit<OpenCodeProtocolEvent, 'harness' | 'observedAt' | 'dispatchRef' | 'runtimeSessionRef'>) => {
        this.emit({ ...event, harness: 'opencode', dispatchRef: intentId, runtimeSessionRef: sessionId, observedAt: new Date().toISOString() });
      };
      const rl = createInterface({ input: proc.stdout });
      const parsed = new Promise<void>((resolve) => {
        let terminalTimer: ReturnType<typeof setTimeout> | undefined;
        rl.on('line', (line) => {
          if (!line.trim()) return;
          if (terminalTimer) clearTimeout(terminalTimer);
          let event: Record<string, unknown>;
          try { event = JSON.parse(line) as Record<string, unknown>; } catch {
            emit({ kind: 'error', method: 'adapter/error', params: { message: 'Malformed OpenCode JSON line was isolated' }, verification: 'OBSERVED', sourceRef: 'opencode:run:malformed-line' });
            return;
          }
          const eventSession = event.sessionID;
          if (isNativeSessionRef(eventSession)) {
            if (nativeSessionRef && eventSession !== nativeSessionRef) {
              emit({ kind: 'error', method: 'adapter/error', params: { message: 'OpenCode returned a different native session id' }, verification: 'VERIFIED', sourceRef: 'opencode:run:session-mismatch' });
              return;
            }
            if (!sessionId) {
              const identity = this.sessionIdentity(eventSession, cwd, 'opencode:run:event.sessionID');
              sessionId = identity.nativeSessionId;
              onThreadStarted?.(sessionId);
              emit({ kind: 'session', method: 'session/started', params: { sessionId }, verification: 'VERIFIED', sourceRef: 'opencode:run:event.sessionID' });
            }
          }
          if (!sessionId || eventSession !== sessionId) return;
          const type = typeof event.type === 'string' ? event.type : '';
          const part = event.part as Record<string, unknown> | undefined;
          if (type === 'step_start') {
            sawStart = true;
            sawFinish = false;
            emit({ kind: 'turn', method: 'turn/started', params: event, verification: 'VERIFIED', sourceRef: 'opencode:run:step_start' });
          } else if (type === 'text' && typeof part?.text === 'string') {
            resultText = part.text.slice(0, 2_000);
            emit({ kind: 'assistant', method: 'item/completed', params: { type: 'assistant', text: resultText }, verification: 'OBSERVED', sourceRef: 'opencode:run:text' });
          } else if (type === 'tool_use' && part?.type === 'tool') {
            const status = (part.state as Record<string, unknown> | undefined)?.status;
            emit({ kind: 'tool', method: status === 'completed' || status === 'error' ? 'tool-completed' : 'tool-started', params: part, verification: 'OBSERVED', sourceRef: 'opencode:run:tool_use' });
          } else if (type === 'step_finish') {
            sawFinish = true;
            emit({ kind: 'turn', method: 'turn/completed', params: event, verification: 'VERIFIED', sourceRef: 'opencode:run:step_finish' });
          } else if (type === 'error') {
            structuredFailure = providerFailure(event.error);
            emit({ kind: 'error', method: 'adapter/error', params: structuredFailure, verification: 'OBSERVED', sourceRef: 'opencode:run:error' });
          }
          if (sawFinish) {
            terminalTimer = setTimeout(() => {
              settledFromTerminalEvidence = true;
              void owned?.terminate();
            }, this.terminalSettleMs);
          }
        });
        rl.on('close', () => {
          if (terminalTimer) clearTimeout(terminalTimer);
          resolve();
        });
        proc.on('close', () => rl.close());
        proc.on('error', () => rl.close());
      });
      const processResult = await owned.result;
      const exitCode = processResult.code;
      await parsed;
      this.activeChildren.delete(intentId);
      owned = null;
      if (this.cancelled.delete(intentId)) {
        emit({ kind: 'lifecycle', method: 'process/cancelled', params: {}, verification: 'OBSERVED', sourceRef: 'opencode:process:cancelled' });
        return { intentId, harness: 'opencode', status: 'CANCELLED', at: new Date().toISOString(), runtimeRef: sessionId, source: 'process', protocolEvidence: 'OpenCode process cancelled' };
      }
      if ((exitCode === 0 || settledFromTerminalEvidence) && sessionId && sawStart && sawFinish) {
        return {
          intentId, harness: 'opencode', status: 'ACCEPTED', at: new Date().toISOString(), runtimeRef: sessionId,
          turnRef: `${sessionId}:turn`, source: 'protocol', protocolEvidence: 'opencode:run:step_start+step_finish', message: resultText || undefined,
        };
      }
      return {
        intentId, harness: 'opencode', status: 'FAILED', at: new Date().toISOString(), runtimeRef: sessionId,
        source: 'process', protocolEvidence: `OpenCode run incomplete (exit=${exitCode}; start=${sawStart}; finish=${sawFinish})`,
        message: structuredFailure?.message || boundedFailureProvenance(stderr, 800) || 'OpenCode did not provide complete structured lifecycle evidence',
      };
    } catch (error) {
      return { intentId, harness: 'opencode', status: 'FAILED', at: new Date().toISOString(), source: 'process', protocolEvidence: 'OpenCode dispatch exception', message: boundedProcessError(error) };
    } finally {
      if (owned) void owned.terminate();
      this.activeChildren.delete(intentId);
      this.cancelled.delete(intentId);
    }
  }

  async smoke(cwd: string): Promise<OpenCodeSessionPresence[]> {
    const caps = await this.capabilities();
    if (!caps.canDispatch) throw new Error(caps.evidence);
    return this.listSessions(3, cwd);
  }

  close(): void {
    for (const [intentId, owned] of this.activeChildren) {
      this.cancelled.add(intentId);
      void owned.terminate();
    }
    this.activeChildren.clear();
  }
}
