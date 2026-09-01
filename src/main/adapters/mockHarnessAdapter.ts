import { randomUUID } from 'node:crypto';
import type { HandoffReceipt, HarnessCapabilities } from '../../core/types';
import { packetTaskSummary } from '../activityEvidence';

export interface MockHarnessEvent {
  kind: 'session' | 'turn' | 'assistant' | 'tool';
  method: 'session/started' | 'turn/started' | 'tool-started' | 'tool-completed' | 'item/completed' | 'turn/completed';
  params?: unknown;
  harness: HarnessCapabilities['harness'];
  verification: 'VERIFIED' | 'OBSERVED';
  sourceRef: string;
  observedAt: string;
  runtimeSessionRef: string;
  dispatchRef: string;
  simulated: true;
}

export interface MockHarnessOptions {
  sessionId: string;
  now?: () => string;
  id?: () => string;
  completionDelayMs?: number;
}

export class MockHarnessAdapter {
  private readonly listeners = new Set<(event: MockHarnessEvent) => void>();
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(
    private readonly harness: HarnessCapabilities['harness'],
    private readonly options: MockHarnessOptions,
  ) {
    if (!options.sessionId.trim()) throw new Error('Mock Harness requires an explicit demo session identity.');
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
  }

  onEvent(listener: (event: MockHarnessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async capabilities(): Promise<HarnessCapabilities> {
    return {
      harness: this.harness,
      support: {
        dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'YES', needsInput: 'YES',
        toolEvents: 'YES', fileEvents: 'YES', externalSessionRef: 'YES', resume: 'NO',
      },
      canDispatch: true,
      canCreateSession: true,
      canResumeSession: false,
      canObserveRuntime: true,
      canReceiveReceipt: true,
      protocol: 'Workbench deterministic Mock Harness',
      evidence: `DEMO/SIMULATED · scoped session ${this.options.sessionId}`,
    };
  }

  private emit(event: Omit<MockHarnessEvent, 'harness' | 'observedAt' | 'simulated'>): void {
    const envelope: MockHarnessEvent = {
      ...event,
      harness: this.harness,
      observedAt: this.now(),
      simulated: true,
    };
    for (const listener of this.listeners) listener(envelope);
  }

  async dispatch(intentId: string, _cwd: string, text: string): Promise<HandoffReceipt> {
    const runtimeRef = `demo:${this.options.sessionId}:${this.harness}:${this.id()}`;
    const base = { runtimeSessionRef: runtimeRef, dispatchRef: intentId };
    this.emit({ ...base, kind: 'session', method: 'session/started', params: { sessionId: runtimeRef }, verification: 'VERIFIED', sourceRef: `mock:${this.options.sessionId}:session` });
    this.emit({ ...base, kind: 'turn', method: 'turn/started', params: { intentId }, verification: 'VERIFIED', sourceRef: `mock:${this.options.sessionId}:turn` });
    this.emit({ ...base, kind: 'tool', method: 'tool-started', params: { type: 'tool_use', id: `${intentId}:context`, name: 'Read Context' }, verification: 'OBSERVED', sourceRef: `mock:${this.options.sessionId}:tool:start` });
    this.emit({ ...base, kind: 'tool', method: 'tool-completed', params: { type: 'tool_result', id: `${intentId}:context`, name: 'Read Context' }, verification: 'OBSERVED', sourceRef: `mock:${this.options.sessionId}:tool:complete` });
    const task = packetTaskSummary(text) ?? text;
    this.emit({ ...base, kind: 'assistant', method: 'item/completed', params: { type: 'assistant', text: `[DEMO/SIMULATED · ${this.harness}] Result for: ${task}`, simulated: true }, verification: 'VERIFIED', sourceRef: `mock:${this.options.sessionId}:assistant` });
    if ((this.options.completionDelayMs ?? 0) > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.options.completionDelayMs));
    }
    this.emit({ ...base, kind: 'turn', method: 'turn/completed', params: { status: 'completed' }, verification: 'VERIFIED', sourceRef: `mock:${this.options.sessionId}:complete` });
    return {
      intentId,
      harness: this.harness,
      status: 'ACCEPTED',
      at: this.now(),
      runtimeRef,
      turnRef: `${runtimeRef}:turn`,
      source: 'protocol',
      protocolEvidence: `mock-harness:${this.options.sessionId}:deterministic`,
      message: 'DEMO/SIMULATED execution accepted',
    };
  }
}
