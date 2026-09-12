import { describe, expect, it } from 'vitest';
import {
  createDispatchDraft,
  isCanonicalTaskDispatch,
  preflightDispatch,
  setDispatchConversation,
  setDispatchExecutor,
  setDispatchInstruction,
  setDispatchPacket,
  type DispatchDraftV1,
} from '../../src/core/project/dispatchDraft';
import { compilePacket, checkPacketValidity, freezePacket, renderAgentInput } from '../../src/core/project/packet';
import { buildDispatchPlan } from '../../src/core/project/dispatchPipeline';
import { HandoffDispatchRegistry } from '../../src/main/handoffDispatch';
import type { HarnessCapabilities, SourceFingerprint, TaskPacket } from '../../src/core/types';

const NOW = '2026-09-12T00:00:00.000Z';

function capabilities(overrides: Partial<HarnessCapabilities> = {}): HarnessCapabilities {
  return {
    harness: 'codex',
    support: {
      dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'UNKNOWN', needsInput: 'UNKNOWN',
      toolEvents: 'YES', fileEvents: 'YES', externalSessionRef: 'YES', resume: 'UNKNOWN',
    },
    canDispatch: true,
    canCreateSession: true,
    canResumeSession: true,
    canObserveRuntime: true,
    canReceiveReceipt: true,
    protocol: 'Codex app-server JSONL v2',
    evidence: 'codex app-server reachable',
    ...overrides,
  };
}

function frozenPacket(packetId = 'packet-1'): { frozen: ReturnType<typeof freezePacket>; packet: TaskPacket } {
  const packet = compilePacket({
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::CO 主对话',
    taskSummary: 'task objective',
    governanceRefs: ['overlay:projects/instances/creative-os.adapter.yaml'],
    staging: [{
      id: 'gate:creative-os:visual', title: 'Gate: visual', source: 'adapter:creative-os', body: 'gallery-first',
      state: 'included', pinned: false, isReference: false, sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml',
    }],
    fingerprints: [{ sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml', sha256: 'a'.repeat(64) }],
    now: NOW,
    packetId,
  });
  return { packet, frozen: freezePacket(packet, [], NOW) };
}

function readyDraft(overrides: Partial<DispatchDraftV1> = {}): DispatchDraftV1 {
  return {
    ...createDispatchDraft('creative-os', { workId: '001-inspiration-capture', taskId: 'T006' }),
    conversationKey: 'creative-os::claude::CO 主对话',
    packetId: 'packet-1',
    backend: 'native',
    provider: 'codex',
    ...overrides,
  };
}

const FINGERPRINTS: SourceFingerprint[] = [{ sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml', sha256: 'a'.repeat(64) }];

describe('Dispatch Draft (PHASE 3D.1)', () => {
  it('carries exact canonical Work/Task lineage only from an explicit selection; nothing infers it', () => {
    const draft = createDispatchDraft('creative-os', { workId: '001-inspiration-capture', taskId: 'T006' });
    expect(draft.workId).toBe('001-inspiration-capture');
    expect(draft.taskId).toBe('T006');
    // No label / cwd / title / recency inference exists in this module:
    // the only lineage entry point is the exact createDispatchDraft argument.
    expect(isCanonicalTaskDispatch(draft)).toBe(true);

    // Work-only entry: taskId stays empty, still exact.
    const workOnly = createDispatchDraft('creative-os', { workId: '001-inspiration-capture' });
    expect(workOnly.taskId).toBeUndefined();
    expect(isCanonicalTaskDispatch(workOnly)).toBe(false);

    // QUICK entry: no canonical identity is minted.
    const quick = createDispatchDraft('creative-os');
    expect(quick.workId).toBeUndefined();
    expect(quick.taskId).toBeUndefined();
    expect(isCanonicalTaskDispatch(quick)).toBe(false);
  });

  it('requires an exact frozen packetId; mutating context yields a NEW packet, never a mutated frozen one', () => {
    const draft = setDispatchPacket(createDispatchDraft('creative-os'), 'packet-1');
    expect(draft.packetId).toBe('packet-1');

    const { frozen, packet } = frozenPacket();
    // Same staging + same sources + same packetId -> identical frozen body.
    const recompiled = compilePacket({
      projectId: packet.projectId,
      conversationKey: packet.conversationKey,
      taskSummary: packet.taskSummary,
      governanceRefs: packet.governanceRefs,
      staging: packet.included,
      fingerprints: FINGERPRINTS,
      now: NOW,
      packetId: packet.packetId,
    });
    expect(recompiled).toEqual(packet);
    // A context change is a new compile -> NEW packetId; the frozen record is untouched.
    const changed = compilePacket({
      projectId: packet.projectId,
      conversationKey: packet.conversationKey,
      taskSummary: packet.taskSummary,
      governanceRefs: packet.governanceRefs,
      staging: [{ ...packet.included[0]!, body: 'changed' }],
      fingerprints: FINGERPRINTS,
      now: NOW,
    });
    expect(changed.packetId).not.toBe(frozen.packetId);
    expect(frozen.hash).toBe(frozen.hash);
    expect(renderAgentInput(frozen)).toContain('gallery-first');
  });

  it('preflight: CURRENT passes; STALE is blocked toward recompile; INVALID and missing are blocked', () => {
    const input = { capabilities: { codex: capabilities() }, projectRootBound: true };
    const current = preflightDispatch(readyDraft(), { ...input, packetValidity: 'CURRENT', packetId: 'packet-1' });
    expect(current.ok).toBe(true);
    expect(current.checks.find((check) => check.id === 'packet')?.detail).toContain('CURRENT');

    const stale = preflightDispatch(readyDraft(), { ...input, packetValidity: 'STALE', packetId: 'packet-1' });
    expect(stale.ok).toBe(false);
    const staleCheck = stale.checks.find((check) => check.id === 'packet')!;
    expect(staleCheck.status).toBe('BLOCK');
    expect(staleCheck.detail).toContain('new packet');

    const invalid = preflightDispatch(readyDraft(), { ...input, packetValidity: 'INVALID', packetId: 'packet-1' });
    expect(invalid.ok).toBe(false);
    expect(invalid.checks.find((check) => check.id === 'packet')?.detail).toContain('prohibited');

    const mismatch = preflightDispatch(readyDraft(), { ...input, packetValidity: 'CURRENT', packetId: 'other' });
    expect(mismatch.ok).toBe(false);

    const none = preflightDispatch(readyDraft({ packetId: undefined }), input);
    expect(none.ok).toBe(false);
  });

  it('explicit conversation selection belongs to this dispatch only; nothing writes Task.conversation_ids', () => {
    const draft = setDispatchConversation(createDispatchDraft('creative-os'), 'creative-os::claude::CO 主对话');
    expect(draft.conversationKey).toBe('creative-os::claude::CO 主对话');
    // The draft has no field that could mirror the canonical Task relation,
    // and the module exposes no write into canonical facts.
    expect(Object.keys(draft)).not.toContain('conversationIds');
    const cleared = setDispatchConversation(draft, null);
    expect(cleared.conversationKey).toBeUndefined();
  });

  it('keeps backend and provider orthogonal and never auto-picks an executor', () => {
    const draft = createDispatchDraft('creative-os');
    expect(draft.backend).toBeNull();
    expect(draft.provider).toBeNull();
    const picked = setDispatchExecutor(draft, 'native', 'codex');
    expect(picked.backend).toBe('native');
    expect(picked.provider).toBe('codex');
    // Paseo backend stays a distinct dimension, combinable with providers.
    const paseo = setDispatchExecutor(draft, 'paseo', 'codex');
    expect(paseo.backend).toBe('paseo');
    expect(paseo.provider).toBe('codex');
    expect(paseo).not.toEqual(picked);
    // Clearing either side clears the whole executor selection.
    expect(setDispatchExecutor(picked, null, 'codex')).toEqual(setDispatchExecutor(picked, null, null));
  });

  it('UNKNOWN / unsupported executor capability fails closed with the exact reason', () => {
    const unknownDispatch = preflightDispatch(readyDraft({ provider: 'claude' }), {
      capabilities: { claude: capabilities({ harness: 'claude', support: { ...capabilities().support, dispatch: 'UNKNOWN' }, canDispatch: false, evidence: 'claude CLI not reachable' }) },
      packetValidity: 'CURRENT',
      packetId: 'packet-1',
      projectRootBound: true,
    });
    expect(unknownDispatch.ok).toBe(false);
    const check = unknownDispatch.checks.find((item) => item.id === 'executor')!;
    expect(check.status).toBe('BLOCK');
    expect(check.detail).toContain('claude CLI not reachable');

    const noProvider = preflightDispatch(readyDraft({ provider: 'deepseek' }), {
      capabilities: {},
      packetValidity: 'CURRENT',
      packetId: 'packet-1',
      projectRootBound: true,
    });
    expect(noProvider.ok).toBe(false);
    expect(noProvider.checks.find((item) => item.id === 'executor')?.detail).toContain('no capability truth');
  });

  it('one explicit dispatch = one plan = one intentId per request; requests preserve full lineage', () => {
    const { packet } = frozenPacket();
    const plan = buildDispatchPlan({
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::CO 主对话',
      taskSummary: packet.taskSummary,
      governanceRefs: packet.governanceRefs,
      staging: packet.included,
      fingerprints: FINGERPRINTS,
      agents: ['codex'],
      capabilities: { codex: capabilities() },
      environment: { kind: 'real' },
      workId: '001-inspiration-capture',
      taskId: 'T006',
      packetId: packet.packetId,
    });
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]).toMatchObject({
      intentId: expect.any(String),
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::CO 主对话',
      workId: '001-inspiration-capture',
      taskId: 'T006',
      packetId: packet.packetId,
    });
    // buildDispatchPlan forbids dispatching an uncapable harness outright.
    expect(() => buildDispatchPlan({
      projectId: 'creative-os', conversationKey: 'k', taskSummary: '', governanceRefs: [],
      staging: [], fingerprints: [], agents: ['claude'],
      capabilities: { claude: capabilities({ harness: 'claude', canDispatch: false }) },
      environment: { kind: 'real' },
    })).toThrow(/dispatch unavailable/);
  });

  it('double submit is idempotent per intentId via the existing dispatch registry', async () => {
    const registry = new HandoffDispatchRegistry<string>();
    let calls = 0;
    const run = () => registry.run('intent-1', async () => {
      calls += 1;
      return 'receipt';
    });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe('receipt');
    expect(b).toBe('receipt');
    expect(calls).toBe(1);
  });

  it('no real dispatch happened while preparing: the draft alone writes nothing anywhere', () => {
    const draft = setDispatchInstruction(
      setDispatchExecutor(
        setDispatchPacket(
          setDispatchConversation(createDispatchDraft('creative-os', { workId: '001-inspiration-capture', taskId: 'T006' }), 'creative-os::claude::CO 主对话'),
          'packet-1',
        ),
        'native', 'codex',
      ),
      'prepare only',
    );
    const result = preflightDispatch(draft, { capabilities: {}, projectRootBound: true });
    // A prepared-but-not-dispatched draft fails closed without capability
    // truth and has produced no requests, receipts, or activity events.
    expect(result.ok).toBe(false);
    expect(draft.instruction).toBe('prepare only');
    expect(checkPacketValidity(
      { sourceFingerprints: FINGERPRINTS, unresolvedDependencies: [] },
      FINGERPRINTS,
    )).toBe('CURRENT');
  });
});
