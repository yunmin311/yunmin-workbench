import { describe, expect, it, vi } from 'vitest';
import type { HarnessCapabilities } from '../../src/core/types';
import { buildDispatchPlan, settleDispatchPlan } from '../../src/core/project/dispatchPipeline';

const capabilities = (harness: 'codex' | 'claude'): HarnessCapabilities => ({
  harness,
  support: {
    dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'YES', needsInput: 'YES',
    toolEvents: 'YES', fileEvents: 'YES', externalSessionRef: 'YES', resume: 'NO',
  },
  canDispatch: true,
  canCreateSession: true,
  canResumeSession: false,
  canObserveRuntime: true,
  canReceiveReceipt: true,
  protocol: `${harness}-test`,
  evidence: 'test fixture',
});

describe('one product dispatch pipeline', () => {
  it('compiles Context into one packet and fans Parallel out as independent native dispatch requests', () => {
    const ids = ['group-1', 'packet-1', 'intent-codex', 'intent-claude'][Symbol.iterator]();
    const plan = buildDispatchPlan({
      projectId: 'project-1',
      conversationKey: 'conversation-1',
      conversationId: 'native-conversation-1',
      taskSummary: 'Compare two implementation approaches',
      governanceRefs: [],
      staging: [{
        id: 'manual-1', title: 'Constraint', source: 'manual', body: 'Do not invent evidence.',
        state: 'included', pinned: false, isReference: false, provenance: 'USER PROVIDED',
      }],
      fingerprints: [],
      agents: ['codex', 'claude'],
      capabilities: { codex: capabilities('codex'), claude: capabilities('claude') },
      environment: { kind: 'real' },
      now: '2026-09-01T00:00:00.000Z',
    }, () => ids.next().value as string);

    expect(plan.mode).toBe('parallel');
    expect(plan.groupId).toBe('group-1');
    expect(plan.packet.packetId).toBe('packet-1');
    expect(plan.packetText).toContain('Do not invent evidence.');
    expect(plan.requests).toEqual([
      expect.objectContaining({ intentId: 'intent-codex', harness: 'codex', groupId: 'group-1', environment: { kind: 'real' } }),
      expect.objectContaining({ intentId: 'intent-claude', harness: 'claude', groupId: 'group-1', environment: { kind: 'real' } }),
    ]);
    expect(new Set(plan.requests.map((request) => request.packetText))).toEqual(new Set([plan.packetText]));
  });

  it('fails closed before dispatch when a declared Context source cannot be validated', () => {
    expect(() => buildDispatchPlan({
      projectId: 'project-1', conversationKey: 'conversation-1', taskSummary: 'Use canonical context',
      governanceRefs: [],
      staging: [{
        id: 'missing', title: 'Missing source', source: 'project-file:project-1:missing.md',
        sourceRef: 'project-file:project-1:missing.md', body: 'stale body', state: 'included', pinned: false,
        isReference: true, provenance: 'EXTERNAL',
      }],
      fingerprints: [], agents: ['codex'], capabilities: { codex: capabilities('codex') },
      environment: { kind: 'real' },
    })).toThrow(/invalid.*missing/i);
  });

  it('isolates an agent failure so another Parallel execution remains usable', async () => {
    const ids = ['group-2', 'packet-2', 'intent-codex', 'intent-claude'][Symbol.iterator]();
    const plan = buildDispatchPlan({
      projectId: 'project-1', conversationKey: 'conversation-1', taskSummary: 'Parallel probe',
      governanceRefs: [], staging: [], fingerprints: [], agents: ['codex', 'claude'],
      capabilities: { codex: capabilities('codex'), claude: capabilities('claude') },
      environment: { kind: 'demo', sessionId: 'demo-session-a' },
    }, () => ids.next().value as string);
    const dispatch = vi.fn(async (request: (typeof plan.requests)[number]) => {
      if (request.harness === 'codex') throw new Error('codex failed');
      return {
        intentId: request.intentId, harness: request.harness, status: 'ACCEPTED' as const,
        at: '2026-09-01T00:00:01.000Z', runtimeRef: 'demo-claude-1', source: 'protocol' as const,
        protocolEvidence: 'mock:accepted',
      };
    });

    const outcomes = await settleDispatchPlan(plan, dispatch);
    expect(outcomes).toEqual([
      expect.objectContaining({ harness: 'codex', status: 'failed', error: 'Error: codex failed' }),
      expect.objectContaining({ harness: 'claude', status: 'accepted', receipt: expect.objectContaining({ runtimeRef: 'demo-claude-1' }) }),
    ]);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
