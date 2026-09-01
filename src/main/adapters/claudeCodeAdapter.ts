import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';
import { allowlistedVersionToken, boundedProcessError } from './evidenceBounds';

export interface ClaudeProtocolEvent {
  kind: 'session' | 'turn' | 'assistant' | 'result' | 'tool' | 'file' | 'approval' | 'input' | 'error' | 'receipt' | 'lifecycle';
  method: string;
  id?: string | number;
  params?: unknown;
  // unified envelope retains harness-specific detail
  harness: 'claude';
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED';
  sourceRef: string;
  observedAt: string;
  /** Native Claude session_id only. Never cwd, title, provider, or a Workbench id. */
  runtimeSessionRef?: string;
  /** Workbench-local dispatch correlation; never presented as external session identity. */
  dispatchRef: string;
}

function unavailableCapabilities(reason: string): HarnessCapabilities {
  return {
    harness: 'claude',
    support: {
      dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'NO', needsInput: 'NO',
      toolEvents: 'NO', fileEvents: 'NO', externalSessionRef: 'NO', resume: 'NO',
    },
    canDispatch: false,
    canCreateSession: false,
    canResumeSession: false,
    canObserveRuntime: false,
    canReceiveReceipt: false,
    protocol: 'Claude Code --output-format stream-json',
    evidence: `unavailable: ${reason}`,
  };
}

export interface ClaudeAdapterOptions {
  command?: string;
  /** Arguments required to invoke the Claude-compatible executable (used by protocol fixtures). */
  commandArgs?: string[];
}

/**
 * Live adapter for Claude Code based on verifiable CLI behavior:
 * - `claude --version` for capability probe
 * - `claude -p --output-format stream-json --verbose` for dispatch
 * No History JSONL inference, no stdout string guessing unless marked OBSERVED.
 * External session ref is Claude's `session_id` from stream-json system init.
 */
export class ClaudeCodeAdapter {
  private listeners = new Set<(event: ClaudeProtocolEvent) => void>();
  private closing = false;
  private readonly command: string;
  private readonly commandArgs: string[];
  private readonly promptViaStdin: boolean;
  private activeChildren = new Map<string, ChildProcessWithoutNullStreams>();
  private cancelled = new Set<string>();

  constructor(options: ClaudeAdapterOptions = {}) {
    const defaultWindowsCommand = options.command === undefined && process.platform === 'win32';
    this.command = defaultWindowsCommand ? (process.env.ComSpec ?? 'cmd.exe') : (options.command ?? 'claude');
    this.commandArgs = defaultWindowsCommand
      ? ['/d', '/s', '/c', 'claude.cmd', ...(options.commandArgs ?? [])]
      : (options.commandArgs ?? []);
    this.promptViaStdin = options.command === undefined;
  }

  onEvent(listener: (event: ClaudeProtocolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ClaudeProtocolEvent): void {
    for (const l of this.listeners) l(event);
  }

  private terminate(child: ChildProcessWithoutNullStreams): void {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: 'ignore', timeout: 5_000,
        });
      } else if (!child.killed) {
        child.kill('SIGTERM');
      }
    } catch {
      try { child.kill(); } catch {}
    }
  }

  cancel(intentId: string): boolean {
    const child = this.activeChildren.get(intentId);
    if (!child) return false;
    this.cancelled.add(intentId);
    this.terminate(child);
    return true;
  }

  async capabilities(): Promise<HarnessCapabilities> {
    try {
      const child = spawn(this.command, [...this.commandArgs, '--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
        child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
        child.on('error', () => resolve({ code: 127, stdout, stderr: 'spawn error' }));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        setTimeout(() => {
          try { child.kill(); } catch {}
          resolve({ code: 124, stdout, stderr: 'timeout' });
        }, 4000);
      });
      if (result.code !== 0) {
        // Withhold raw stderr/stdout: only the exit code and our own static
        // markers are allowlisted capability facts.
        const marker = result.stderr === 'spawn error' || result.stderr === 'timeout' ? ` (${result.stderr})` : '';
        return unavailableCapabilities(`claude --version exited ${result.code}${marker}`);
      }
      const version = allowlistedVersionToken(result.stdout.split(/\r?\n/)[0] ?? '') ?? 'unknown';
      // Probe stream-json support by checking help contains output-format
      const helpChild = spawn(this.command, [...this.commandArgs, '--help'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const help = await new Promise<string>((resolve) => {
        let out = '';
        helpChild.stdout?.on('data', (c: Buffer) => (out += c.toString('utf8')));
        helpChild.on('error', () => resolve(''));
        helpChild.on('close', () => resolve(out));
        setTimeout(() => { try { helpChild.kill(); } catch {}; resolve(out); }, 3000);
      });
      const supportsStreamJson = help.includes('stream-json');
      if (!supportsStreamJson) return unavailableCapabilities('installed Claude Code does not advertise stream-json');
      return {
        harness: 'claude',
        support: {
          dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'NO', needsInput: 'NO',
          toolEvents: 'YES', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
        },
        canDispatch: true,
        canCreateSession: true,
        canResumeSession: false,
        canObserveRuntime: supportsStreamJson,
        canReceiveReceipt: true,
        protocol: 'Claude Code --output-format stream-json',
        evidence: `claude --version ${version}; stream-json=${supportsStreamJson ? 'yes' : 'no'}`,
      };
    } catch (error) {
      return unavailableCapabilities(boundedProcessError(error));
    }
  }

  async dispatch(
    intentId: string,
    cwd: string,
    text: string,
    onThreadStarted?: (threadId: string) => void,
  ): Promise<HandoffReceipt> {
    let child: ChildProcessWithoutNullStreams | null = null;
    let proc: ChildProcessWithoutNullStreams | null = null;
    try {
      const args = [
        ...this.commandArgs,
        '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        ...(this.promptViaStdin ? [] : [text]),
      ];
      child = spawn(this.command, args, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      }) as ChildProcessWithoutNullStreams;
      proc = child;
      if (this.promptViaStdin) proc.stdin.end(text);
      this.activeChildren.set(intentId, proc);
      const processChild = proc;
      let stderr = '';
      proc.stderr?.on('data', (c: Buffer) => { stderr = `${stderr}${c.toString('utf8')}`.slice(-8000); });
      proc.on('error', () => undefined);
      proc.stdout?.on('error', () => undefined);
      proc.stderr?.on('error', () => undefined);

      // Parse stream-json lines for session_id and lifecycle
      let sessionId: string | null = null;
      let sawResult = false;
      let resultSuccess = true;
      let resultText = '';
      const emit = (event: Omit<ClaudeProtocolEvent, 'harness' | 'observedAt' | 'runtimeSessionRef' | 'dispatchRef'>): void => {
        this.emit({
          ...event,
          harness: 'claude',
          observedAt: new Date().toISOString(),
          runtimeSessionRef: sessionId ?? undefined,
          dispatchRef: intentId,
        });
      };
      const rl = createInterface({ input: proc.stdout });
      const parsePromise = new Promise<void>((resolve) => {
        rl.on('line', (line) => {
          if (!line.trim()) return;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            emit({
              kind: 'error', method: 'adapter/error',
              params: { message: 'Malformed Claude stream-json line was isolated' },
              verification: 'OBSERVED', sourceRef: 'claude:stream-json:malformed-line',
            });
            return;
          }
          // Malformed or partial event is ignored, not guessed
          const type = typeof msg.type === 'string' ? msg.type : '';
          const subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
          if (!type) {
            emit({
              kind: 'error', method: 'adapter/error',
              params: { message: 'Claude stream-json event omitted type' },
              verification: 'OBSERVED', sourceRef: 'claude:stream-json:malformed-event',
            });
            return;
          }
          if (!sessionId && type === 'system' && subtype === 'init' && typeof msg.session_id === 'string') {
            sessionId = msg.session_id as string;
            onThreadStarted?.(sessionId);
            emit({
              kind: 'session', method: 'session/started',
              params: { sessionId, cwd },
              verification: 'VERIFIED',
              sourceRef: 'claude:stream-json:system:init:session_id',
            });
          }
          if (type === 'system' && subtype === 'init') {
            emit({ kind: 'turn', method: 'turn/started', params: msg, verification: 'VERIFIED', sourceRef: 'claude:stream-json:system:init' });
          } else if (type === 'assistant') {
            const content = (msg.message as { content?: unknown[] } | undefined)?.content;
            if (Array.isArray(content)) {
              const textParts = content
                .filter((block): block is { type: string; text: string } => {
                  const value = block as Record<string, unknown>;
                  return value.type === 'text' && typeof value.text === 'string';
                })
                .map((block) => block.text)
                .join('\n');
              if (textParts) emit({
                kind: 'assistant', method: 'item/completed', params: { type: 'assistant', text: textParts, raw: msg },
                verification: 'OBSERVED', sourceRef: 'claude:stream-json:assistant:text',
              });
              for (const block of content) {
                const value = block as Record<string, unknown>;
                if (value.type === 'tool_use' && typeof value.id === 'string' && typeof value.name === 'string') {
                  emit({
                    kind: 'tool', method: 'tool-started', params: value,
                    verification: 'OBSERVED', sourceRef: 'claude:stream-json:assistant:tool_use',
                  });
                }
              }
            }
          } else if (type === 'user') {
            const content = (msg.message as { content?: unknown[] } | undefined)?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const value = block as Record<string, unknown>;
                if (value.type === 'tool_result' && typeof value.tool_use_id === 'string') {
                  emit({
                    kind: 'tool', method: 'tool-completed', params: value,
                    verification: 'OBSERVED', sourceRef: 'claude:stream-json:user:tool_result',
                  });
                }
              }
            }
          } else if (type === 'result') {
            const validSuccess = subtype === 'success'
              && msg.is_error === false
              && typeof msg.result === 'string';
            const validFailure = msg.is_error === true && subtype.length > 0;
            if (!validSuccess && !validFailure) {
              emit({
                kind: 'error', method: 'adapter/error',
                params: { message: 'Claude result event omitted or contradicted terminal fields' },
                verification: 'OBSERVED', sourceRef: 'claude:stream-json:malformed-result',
              });
              return;
            }
            sawResult = true;
            resultSuccess = validSuccess;
            resultText = typeof msg.result === 'string' ? (msg.result as string).slice(0, 400) : '';
            emit({ kind: 'result', method: resultSuccess ? 'turn/completed' : 'turn/error', params: msg, verification: 'VERIFIED', sourceRef: 'claude:stream-json:result' });
          }
          // Approval / needs-input: Claude uses permission prompts; if model indicates, surface as structured OBSERVED
          // We do not synthesize approval from stdout strings.
        });
        rl.on('close', () => resolve());
        processChild.on('close', () => rl.close());
        processChild.on('error', () => rl.close());
      });

      const exitCode: number | null = await new Promise((resolve) => {
        let done = false;
        const finish = (code: number | null) => { if (!done) { done = true; resolve(code); } };
        processChild.on('close', (code) => finish(code));
        processChild.on('error', () => finish(127));
        processChild.on('exit', (code) => finish(code));
      });
      // Ensure all lines parsed before evaluating receipt
      await parsePromise;

      this.activeChildren.delete(intentId);
      const wasCancelled = this.cancelled.delete(intentId);
      child = null;

      if (wasCancelled) {
        emit({
          kind: 'lifecycle', method: 'process/cancelled',
          params: { message: 'Claude dispatch cancelled' },
          verification: 'OBSERVED', sourceRef: 'claude:process:cancelled',
        });
        return {
          intentId, harness: 'claude', status: 'CANCELLED', at: new Date().toISOString(),
          runtimeRef: sessionId ?? undefined, source: 'process',
          protocolEvidence: 'Claude dispatch cancelled', message: 'Claude dispatch cancelled',
        };
      }

      // External session ref MUST come from protocol session_id, never cwd/provider/title guess
      const runtimeRef = sessionId ?? undefined;
      if (exitCode === 0 && sawResult && resultSuccess) {
        return {
          intentId, harness: 'claude', status: 'ACCEPTED', at: new Date().toISOString(),
          runtimeRef, turnRef: runtimeRef ? `${runtimeRef}:turn` : undefined,
          source: 'protocol', protocolEvidence: 'claude:stream-json:result:success',
          message: resultText || undefined,
        };
      }
      if (exitCode === 0 && sawResult && !resultSuccess) {
        return {
          intentId, harness: 'claude', status: 'FAILED', at: new Date().toISOString(),
          runtimeRef, source: 'protocol', protocolEvidence: 'claude:stream-json:result:is_error',
          message: resultText || stderr.slice(-500) || 'Claude reported error',
        };
      }
      if (exitCode !== 0) {
        emit({
          kind: 'error', method: 'adapter/error',
          params: { message: stderr.slice(-800) || `claude exited ${exitCode ?? 'without an exit code'}` },
          verification: 'OBSERVED', sourceRef: 'claude:process:exit',
        });
        return {
          intentId, harness: 'claude', status: 'FAILED', at: new Date().toISOString(),
          runtimeRef, source: 'process', protocolEvidence: `claude process exit ${exitCode}`,
          message: stderr.slice(-800) || `claude exited ${exitCode}`,
        };
      }
      // No result but exit 0 — treat as failed to avoid fake success
      return {
        intentId, harness: 'claude', status: 'FAILED', at: new Date().toISOString(),
        runtimeRef, source: 'process', protocolEvidence: 'claude:stream-json:no result',
        message: stderr.slice(-500) || 'No structured result from Claude',
      };
    } catch (error) {
      this.activeChildren.delete(intentId);
      this.cancelled.delete(intentId);
      return {
        intentId, harness: 'claude', status: 'FAILED', at: new Date().toISOString(),
        source: 'process', protocolEvidence: 'Claude dispatch exception',
        message: String(error),
      };
    } finally {
      if (child) {
        this.terminate(child);
        this.activeChildren.delete(intentId);
        this.cancelled.delete(intentId);
      }
    }
  }

  async smoke(cwd: string): Promise<HandoffReceipt> {
    const caps = await this.capabilities();
    if (!caps.canDispatch) throw new Error(caps.evidence);
    return this.dispatch(
      randomUUID(),
      cwd,
      'Reply with exactly: YUNMIN_HARNESS_SMOKE_OK. Do not use tools.',
    );
  }

  close(): void {
    this.closing = true;
    for (const [intentId, child] of this.activeChildren) {
      this.cancelled.add(intentId);
      this.terminate(child);
    }
    this.activeChildren.clear();
  }
}
