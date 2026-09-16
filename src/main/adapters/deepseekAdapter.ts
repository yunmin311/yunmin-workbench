import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';
import { runProcess } from '../process/processRunner';
import { allowlistedVersionToken, boundedProcessError } from './evidenceBounds';

export interface DeepSeekAdapterOptions {
  command?: string;
  commandArgs?: string[];
}

/**
 * DeepSeek Harness — honest capability probe.
 * Current reality (E machine, 2026-08): no stable structured live interface.
 * Only CLI/web/UI exist, no app-server/stream-json equivalent.
 * We do NOT synthesize via web automation or heuristic parser.
 */
export class DeepSeekAdapter {
  private readonly command: string;
  private readonly commandArgs: string[];

  constructor(options: DeepSeekAdapterOptions = {}) {
    this.command = options.command ?? 'dsh';
    this.commandArgs = options.commandArgs ?? [];
  }

  private async probe(args: string[], timeoutMs = 4_000): Promise<{ code: number | null; stdout: string; marker?: string }> {
    const result = await runProcess({
      program: this.command,
      args: [...this.commandArgs, ...args],
      timeoutMs,
      maxOutputBytes: 20_000,
      ownProcessTree: true,
    });
    return {
      code: result.timedOut ? 124 : result.code,
      stdout: result.stdout,
      marker: result.timedOut ? 'timeout' : result.code === 127 ? result.stderr : undefined,
    };
  }

  async capabilities(): Promise<HarnessCapabilities> {
    try {
      const result = await this.probe(['--version']);
      if (result.code === 0) {
        const version = allowlistedVersionToken(result.stdout.split(/\r?\n/)[0] ?? '') ?? 'unknown';
        const help = await this.probe(['--profile', 'headless', '--help'], 20_000);
        const headless = help.code === 0 && /profile headless|Answer one task/i.test(help.stdout);
        return {
          harness: 'deepseek',
          support: {
            dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'UNKNOWN', needsInput: 'UNKNOWN',
            toolEvents: 'UNKNOWN', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
          },
          canDispatch: false,
          canCreateSession: false,
          canResumeSession: false,
          canObserveRuntime: false,
          canReceiveReceipt: false,
          protocol: 'DeepSeek Harness headless CLI',
          evidence: `dsh ${version}; headless=${headless ? 'yes' : 'unknown'}; no structured lifecycle or native session identity`,
        };
      }
    } catch (error) {
      return this.unavailable(boundedProcessError(error));
    }
    return this.unavailable('dsh binary not found or version probe failed');
  }

  private unavailable(reason: string): HarnessCapabilities {
    return {
      harness: 'deepseek',
      support: {
        dispatch: 'NO', observe: 'NO', receipt: 'NO', approval: 'UNKNOWN', needsInput: 'UNKNOWN',
        toolEvents: 'UNKNOWN', fileEvents: 'UNKNOWN', externalSessionRef: 'UNKNOWN', resume: 'NO',
      },
      canDispatch: false,
      canCreateSession: false,
      canResumeSession: false,
      canObserveRuntime: false,
      canReceiveReceipt: false,
      protocol: 'DeepSeek harness',
      evidence: `unavailable: ${reason}; no stable structured interface — graceful degradation`,
    };
  }

  async dispatch(intentId: string, _cwd: string, _text: string): Promise<HandoffReceipt> {
    const caps = await this.capabilities();
    return {
      intentId,
      harness: 'deepseek',
      status: 'FAILED',
      at: new Date().toISOString(),
      source: 'workbench',
      protocolEvidence: caps.evidence,
      message: `DeepSeek dispatch not available: ${caps.evidence}`,
    };
  }

  async smoke(_cwd: string): Promise<{ userAgent: string; ephemeralThreadId: string }> {
    const caps = await this.capabilities();
    throw new Error(caps.evidence);
  }

  close(): void {}

  onEvent(_listener: (event: unknown) => void): () => void { return () => undefined; }
}
