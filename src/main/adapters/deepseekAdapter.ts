import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';
import { spawn } from 'node:child_process';
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
    const defaultWindowsCommand = options.command === undefined && process.platform === 'win32';
    this.command = defaultWindowsCommand ? (process.env.ComSpec ?? 'cmd.exe') : (options.command ?? 'dsh');
    this.commandArgs = defaultWindowsCommand
      ? ['/d', '/s', '/c', 'dsh.cmd', ...(options.commandArgs ?? [])]
      : (options.commandArgs ?? []);
  }

  private probe(args: string[], timeoutMs = 4_000): Promise<{ code: number | null; stdout: string; marker?: string }> {
    return new Promise((resolve) => {
      let done = false;
      let stdout = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: { code: number | null; stdout: string; marker?: string }) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      let child;
      try {
        child = spawn(this.command, [...this.commandArgs, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        finish({ code: 127, stdout, marker: boundedProcessError(error) });
        return;
      }
      child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-20_000); });
      child.on('error', (error) => finish({ code: 127, stdout, marker: boundedProcessError(error) }));
      child.on('close', (code) => finish({ code, stdout }));
      timer = setTimeout(() => { try { child.kill(); } catch {}; finish({ code: 124, stdout, marker: 'timeout' }); }, timeoutMs);
    });
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
