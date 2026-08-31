import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';

/**
 * DeepSeek Harness — honest capability probe.
 * Current reality (E machine, 2026-08): no stable structured live interface.
 * Only CLI/web/UI exist, no app-server/stream-json equivalent.
 * We do NOT synthesize via web automation or heuristic parser.
 */
export class DeepSeekAdapter {
  async capabilities(): Promise<HarnessCapabilities> {
    // Check for deepseek CLI existence without invoking model
    // We treat absence as graceful NO, not failure.
    try {
      const { spawn } = await import('node:child_process');
      const child = spawn('deepseek', ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const result = await new Promise<{ code: number | null }>((resolve) => {
        child.on('error', () => resolve({ code: 127 }));
        child.on('close', (code) => resolve({ code }));
        setTimeout(() => { try { child.kill(); } catch {}; resolve({ code: 124 }); }, 2000);
      });
      if (result.code === 0) {
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
          protocol: 'DeepSeek CLI (unstructured)',
          evidence: 'deepseek binary found but Workbench has no validated stable structured interface',
        };
      }
    } catch {}
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
      evidence: 'unavailable: deepseek binary not found or no stable structured interface — graceful degradation',
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
