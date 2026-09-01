// Demo dispatch engine — a WORKBENCH-OWNED simulation that never touches a real
// Harness. It produces the same structured HandoffReceipt + ActivityEvent shape
// the real adapters emit, so the renderer projections exercise the genuine
// contract surface, but every value here is fictional and local.

import type { ActivityEvent, HandoffReceipt } from '../../../core/types';

export interface DemoDispatchRequest {
  intentId: string;
  projectId: string;
  conversationKey: string;
  harness: 'codex' | 'claude' | 'deepseek';
  text: string;
}

interface DemoReceive {
  receipt: HandoffReceipt;
  events: ActivityEvent[];
}

const now = () => new Date().toISOString();

function observed(ref: string) {
  return { source: 'protocol' as const, sourceRef: ref, observedAt: now(), verification: 'OBSERVED' as const };
}

/**
 * Simulate a dispatch against a demo harness. It returns an ACCEPTED receipt and
 * a short scripted activity stream (turn-started -> tool-completed -> turn-completed).
 * It never spawns a process, writes a file, or reads external truth. A caller may
 * choose an optional 'fail' to exercise the failure path without real runtime.
 */
export function runDemoDispatch(request: DemoDispatchRequest, opts: { fail?: boolean } = {}): DemoReceive {
  const runtimeRef = `demo-${request.harness}-${request.intentId.slice(0, 8)}`;
  const base = {
    projectId: request.projectId,
    conversationKey: request.conversationKey,
    harness: request.harness,
    adapter: request.harness === 'codex' ? 'codex-app-server' : 'claude-code-stream-json',
    observed: observed(`demo:protocol:${request.harness}:${request.intentId}`),
  };
  const binding = { harness: request.harness, machine: 'demo-machine', cwd: 'demo/projects', externalSessionRef: runtimeRef };

  if (opts.fail) {
    return {
      receipt: {
        intentId: request.intentId,
        harness: request.harness,
        status: 'FAILED',
        at: now(),
        source: 'protocol',
        protocolEvidence: 'Demo simulation (external truth not reachable)',
        message: 'Demo simulated runtime failure',
      },
      events: [
        { id: `${request.intentId}-0`, ...base, kind: 'handoff-accepted', summary: 'Demo intent accepted (simulated)', runtimeRef, runtimeState: 'idle', binding, observed: observed(`demo:protocol:${request.harness}:${request.intentId}`) },
        { id: `${request.intentId}-1`, ...base, kind: 'harness-error', summary: 'Demo simulated harness error', runtimeRef, runtimeState: 'error', observed: observed(`demo:process:${request.harness}:${request.intentId}`) },
      ],
    };
  }

  return {
    receipt: {
      intentId: request.intentId,
      harness: request.harness,
      status: 'ACCEPTED',
      at: now(),
      runtimeRef,
      turnRef: `demo-turn-${request.intentId.slice(0, 8)}`,
      source: 'protocol',
      protocolEvidence: 'Demo simulation',
    },
    events: [
      { id: `${request.intentId}-0`, ...base, kind: 'handoff-accepted', summary: 'Demo intent accepted (simulated)', runtimeRef, runtimeState: 'idle', binding, observed: observed(`demo:protocol:${request.harness}:${request.intentId}`) },
      { id: `${request.intentId}-1`, ...base, kind: 'turn-started', summary: 'Demo turn started', runtimeRef, runtimeState: 'working', binding, observed: observed(`demo:protocol:${request.harness}:${request.intentId}`) },
      { id: `${request.intentId}-2`, ...base, capability: 'toolEvents', kind: 'tool-completed', summary: 'Demo tool call finished', runtimeRef, runtimeState: 'working', binding, observed: observed(`demo:protocol:${request.harness}:${request.intentId}`) },
      { id: `${request.intentId}-3`, ...base, kind: 'turn-completed', summary: 'Demo turn completed', runtimeRef, runtimeState: 'idle', binding, observed: observed(`demo:protocol:${request.harness}:${request.intentId}`) },
    ],
  };
}
