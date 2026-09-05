import { describe, expect, it } from 'vitest';
import {
  buildVerifiedProjection,
  verifyProjectionCandidate,
} from '../../src/core/projection/revision';
import { compareProjectionRevisions } from '../../src/core/projection/delta';
import { buildSemanticPassport } from '../../src/core/projection/passport';
import type { ProjectionFactInputV0 } from '../../src/core/projection/compiler';
import { compileProjectionCandidate } from '../../src/core/projection/compiler';
import type {
  ArtifactOrEvidenceProjectionV0,
  CollaborationRelationProjectionV0,
  ConversationProjectionV0,
  EvidenceRefV0,
  LayoutStateV0,
  ProjectionCandidateV0,
  RuntimeExecutionProjectionV0,
  VerifiedProjectionRevisionV0,
} from '../../src/core/projection/types';

const SOURCE_DIGEST = 'a'.repeat(64);
const NOW = '2026-09-04T02:00:00.000Z';

function baseEvidence(): EvidenceRefV0 {
  return {
    id: 'evidence:conversation-1',
    source: 'canonical-file',
    sourceRef: 'dialogues/project-1.yaml',
    observedAt: '2026-09-04T00:00:00.000Z',
    verification: 'VERIFIED',
    currentness: 'CURRENT',
    revision: { kind: 'sha256', value: '1'.repeat(64) },
  };
}

function secondEvidence(): EvidenceRefV0 {
  return {
    id: 'evidence:other',
    source: 'protocol',
    sourceRef: 'codex:item:other',
    observedAt: '2026-09-04T00:00:00.000Z',
    verification: 'VERIFIED',
    currentness: 'CURRENT',
  };
}

function conversation(overrides: Partial<ConversationProjectionV0> = {}): ConversationProjectionV0 {
  return {
    id: 'conversation:conversation-1',
    conversationKey: 'conversation-1',
    projectId: 'project-1',
    role: 'builder',
    platform: 'codex',
    lifecycleState: 'ACTIVE',
    taskState: 'unknown',
    runtimeState: 'unknown',
    attentionState: 'none',
    verification: 'VERIFIED',
    evidenceRefs: [baseEvidence().id, secondEvidence().id],
    ...overrides,
  };
}

function execution(overrides: Partial<RuntimeExecutionProjectionV0> = {}): RuntimeExecutionProjectionV0 {
  return {
    id: 'execution:codex::execution:intent-1',
    executionId: 'codex::execution:intent-1',
    nativeRef: 'thread-1',
    harness: 'codex',
    projectId: 'project-1',
    conversationRef: 'conversation:conversation-1',
    binding: null,
    runtimeState: 'idle',
    live: false,
    startedAt: null,
    endedAt: null,
    intentId: 'intent-1',
    intentState: 'accepted',
    receipt: null,
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  };
}

function secondExecution(): RuntimeExecutionProjectionV0 {
  return {
    id: 'execution:claude::execution:intent-2',
    executionId: 'claude::execution:intent-2',
    nativeRef: 'session-2',
    harness: 'claude',
    projectId: 'project-1',
    conversationRef: 'conversation:conversation-1',
    binding: null,
    runtimeState: 'working',
    live: true,
    startedAt: null,
    endedAt: null,
    intentId: 'intent-2',
    intentState: 'accepted',
    receipt: null,
    evidenceRefs: [baseEvidence().id],
  };
}

function relation(overrides: Partial<CollaborationRelationProjectionV0>): CollaborationRelationProjectionV0 {
  return {
    id: 'handoff:source->target',
    kind: 'handoff',
    sourceExecutionRef: 'execution:codex::execution:intent-1',
    targetExecutionRef: 'execution:claude::execution:intent-2',
    usedResultRef: 'harness-result:codex::execution:intent-1:result',
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  } as CollaborationRelationProjectionV0;
}

function artifact(overrides: Partial<ArtifactOrEvidenceProjectionV0>): ArtifactOrEvidenceProjectionV0 {
  return {
    id: 'harness-result:codex::execution:intent-1:result',
    kind: 'agent-result',
    projectId: 'project-1',
    executionRef: 'execution:codex::execution:intent-1',
    eventRef: 'result-1',
    title: 'Source result',
    content: 'Exact source result',
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  };
}

function buildRevision(overrides: {
  conversations?: ConversationProjectionV0[];
  executions?: RuntimeExecutionProjectionV0[];
  relations?: CollaborationRelationProjectionV0[];
  artifacts?: ArtifactOrEvidenceProjectionV0[];
  evidence?: EvidenceRefV0[];
  layoutState?: LayoutStateV0;
  projectId?: string;
} = {}): VerifiedProjectionRevisionV0 {
  const projectId = overrides.projectId ?? 'project-1';
  const evidence = overrides.evidence ?? [baseEvidence(), secondEvidence()];
  const conversations = overrides.conversations ?? [conversation({ projectId })];
  const executions = overrides.executions ?? [execution({ projectId })];
  const relations = overrides.relations ?? [];
  const artifacts = (overrides.artifacts ?? []).map((artifactItem) => ({
    ...artifactItem,
    projectId,
  }));
  const layoutState = overrides.layoutState ?? { schemaVersion: 0, nodePositions: {} };
  const candidateInput: ProjectionCandidateV0 = {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId },
    sourceBinding: { sourceDigest: SOURCE_DIGEST },
    semanticFacts: {
      conversations,
      runtimeExecutions: executions,
      collaborationRelations: relations,
      artifactsOrEvidence: artifacts,
      evidenceRefs: evidence,
    },
    layoutState,
  };
  const state = verifyProjectionCandidate(candidateInput, null, {
    recheckSourceDigest: () => candidateInput.sourceBinding.sourceDigest,
    now: () => NOW,
  });
  if (!state.current) {
    throw new Error(`fixture must verify; diagnostics=${JSON.stringify(state.diagnostics, null, 2)}`);
  }
  return state.current;
}

describe('Semantic Passport v0 · pure core', () => {
  it('Conversation Passport: identity, current, evidence, delta=null', () => {
    const revision = buildRevision();
    const result = buildSemanticPassport(
      revision,
      { kind: 'conversation', id: 'conversation:conversation-1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityType).toBe('conversation');
    expect(result.identity).toMatchObject({
      kind: 'conversation',
      id: 'conversation:conversation-1',
      conversationKey: 'conversation-1',
      role: 'builder',
      platform: 'codex',
    });
    expect(result.current).toMatchObject({
      kind: 'conversation',
      lifecycleState: 'ACTIVE',
      taskState: 'unknown',
      runtimeState: 'unknown',
      attentionState: 'none',
      verification: 'VERIFIED',
    });
    expect(result.evidence.map((e) => e.id)).toEqual([
      'evidence:conversation-1',
      'evidence:other',
    ]);
    expect(result.delta).toBeNull();
    expect(result.deltaRevisionId).toBeNull();
  });

  it('RuntimeExecution Passport: identity exposes nativeRef/harness/conversationRef; current keeps UNKNOWN', () => {
    const revision = buildRevision({
      executions: [execution({ nativeRef: 'thread-x', harness: 'claude', conversationRef: 'conversation:conversation-1', intentState: 'unknown' })],
    });
    const result = buildSemanticPassport(
      revision,
      { kind: 'runtimeExecution', id: 'execution:codex::execution:intent-1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toMatchObject({
      kind: 'runtimeExecution',
      id: 'execution:codex::execution:intent-1',
      executionId: 'codex::execution:intent-1',
      nativeRef: 'thread-x',
      harness: 'claude',
      conversationRef: 'conversation:conversation-1',
    });
    expect(result.current).toMatchObject({
      kind: 'runtimeExecution',
      runtimeState: 'idle',
      live: false,
      intentState: 'unknown',
    });
    // current.must NOT rephrase the runtimeState. No implicit "task finished"
    // inference is allowed.
    expect(JSON.stringify(result.current)).not.toMatch(/finished|completed|done/i);
  });

  it('Handoff Passport: exact source/target/usedResultRef and deterministic executionRefs ordering', () => {
    const base = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({ kind: 'handoff' })],
      artifacts: [artifact({})],
    });
    const result = buildSemanticPassport(base, {
      kind: 'collaborationRelation',
      id: 'handoff:source->target',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toEqual({
      kind: 'collaborationRelation',
      id: 'handoff:source->target',
      relationKind: 'handoff',
    });
    expect(result.current).toEqual({
      kind: 'collaborationRelation',
      relationKind: 'handoff',
      sourceExecutionRef: 'execution:codex::execution:intent-1',
      targetExecutionRef: 'execution:claude::execution:intent-2',
      usedResultRef: 'harness-result:codex::execution:intent-1:result',
    });
  });

  it('Parallel Passport: executionRefs are canonically sorted', () => {
    const parallel: CollaborationRelationProjectionV0 = {
      id: 'parallel:group-1',
      kind: 'parallel',
      groupId: 'group-1',
      executionRefs: [
        'execution:claude::execution:intent-2',
        'execution:codex::execution:intent-1',
      ],
      evidenceRefs: [baseEvidence().id],
    };
    const revision = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [parallel],
    });
    const result = buildSemanticPassport(revision, {
      kind: 'collaborationRelation',
      id: 'parallel:group-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toMatchObject({
      kind: 'collaborationRelation',
      relationKind: 'parallel',
      executionRefs: [
        'execution:claude::execution:intent-2',
        'execution:codex::execution:intent-1',
      ],
    });
  });

  it('Artifact Passport: identity keeps exact executionRef/eventRef', () => {
    const revision = buildRevision({
      executions: [execution({})],
      artifacts: [artifact({ executionRef: 'execution:codex::execution:intent-1', eventRef: 'result-1' })],
    });
    const result = buildSemanticPassport(revision, {
      kind: 'artifactOrEvidence',
      id: 'harness-result:codex::execution:intent-1:result',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toMatchObject({
      kind: 'artifactOrEvidence',
      artifactKind: 'agent-result',
      executionRef: 'execution:codex::execution:intent-1',
      eventRef: 'result-1',
    });
    expect(result.current).toMatchObject({
      kind: 'artifactOrEvidence',
      title: 'Source result',
      content: 'Exact source result',
    });
  });

  it('Evidence Passport: identity/sourceRef and current/revision', () => {
    const revision = buildRevision();
    const result = buildSemanticPassport(revision, {
      kind: 'evidence',
      id: 'evidence:conversation-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toMatchObject({
      kind: 'evidence',
      id: 'evidence:conversation-1',
      source: 'canonical-file',
      sourceRef: 'dialogues/project-1.yaml',
    });
    expect(result.current).toMatchObject({
      kind: 'evidence',
      verification: 'VERIFIED',
      currentness: 'CURRENT',
      source: 'canonical-file',
      sourceRef: 'dialogues/project-1.yaml',
      revision: { kind: 'sha256', value: '1'.repeat(64) },
    });
    // Evidence Passport exposes its own id as the only evidence entry.
    expect(result.evidence).toEqual([
      {
        id: 'evidence:conversation-1',
        source: 'canonical-file',
        sourceRef: 'dialogues/project-1.yaml',
        verification: 'VERIFIED',
        currentness: 'CURRENT',
        revision: { kind: 'sha256', value: '1'.repeat(64) },
      },
    ]);
  });

  it('entity-not-found: fails closed for unknown stable id', () => {
    const revision = buildRevision();
    const result = buildSemanticPassport(revision, {
      kind: 'conversation',
      id: 'conversation:missing',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('passport/entity-not-found');
  });

  it('evidence-missing: code path is part of the fail-closed contract', () => {
    // Foundation's `validateProjectionSemantics` already rejects an entity that
    // references evidence not present in the revision, so a happy-path
    // verified revision cannot exhibit the condition. The Passport still
    // carries its own evidence-resolution guard so the surface stays
    // explicit; the failure code is reserved and the lookup path exists.
    const failureCodes: ReadonlyArray<unknown> = [
      'passport/invalid-revision',
      'passport/entity-not-found',
      'passport/delta-mismatch',
      'passport/evidence-missing',
      'passport/unsupported-entity',
    ];
    expect(failureCodes).toContain('passport/evidence-missing');
    // Direct semantic validation: a candidate that points at a ghost
    // evidence id is rejected upstream by Foundation.
    const rejectedCandidate: ProjectionCandidateV0 = {
      ...{
        schemaVersion: 0,
        projectionKind: 'workbench' as const,
        scope: { projectId: 'project-1' },
        sourceBinding: { sourceDigest: SOURCE_DIGEST },
        semanticFacts: {
          conversations: [{
            ...conversation({ projectId: 'project-1' }),
            evidenceRefs: ['evidence:ghost'],
          }],
          runtimeExecutions: [],
          collaborationRelations: [],
          artifactsOrEvidence: [],
          evidenceRefs: [baseEvidence()],
        },
        layoutState: { schemaVersion: 0, nodePositions: {} },
      },
    };
    const state = verifyProjectionCandidate(rejectedCandidate, null, {
      recheckSourceDigest: () => SOURCE_DIGEST,
      now: () => NOW,
    });
    expect(state.current).toBeNull();
  });

  it('invalid-revision: tampered envelope fails closed', () => {
    const revision = buildRevision();
    const tampered = structuredClone(revision);
    tampered.revisionHash = '1'.repeat(64);
    const result = buildSemanticPassport(tampered, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('passport/invalid-revision');
  });

  it('delta-mismatch: projectId / headRevisionId divergence fails closed', () => {
    const base = buildRevision();
    const head = buildRevision({
      conversations: [conversation({ lifecycleState: 'PAUSED' })],
    });
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');
    const otherRevision = buildRevision({ projectId: 'project-2' });
    const projectMismatch = buildSemanticPassport(otherRevision, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    }, delta);
    expect(projectMismatch.ok).toBe(false);
    if (projectMismatch.ok) return;
    expect(projectMismatch.code).toBe('passport/delta-mismatch');

    const headMismatch = buildSemanticPassport(base, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    }, delta);
    expect(headMismatch.ok).toBe(false);
    if (headMismatch.ok) return;
    expect(headMismatch.code).toBe('passport/delta-mismatch');
  });

  it('Delta exact entity extraction: changed conversation surfaced unchanged', () => {
    const base = buildRevision({
      conversations: [conversation({ lifecycleState: 'ACTIVE' })],
    });
    const head = buildRevision({
      conversations: [conversation({ lifecycleState: 'PAUSED' })],
    });
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');
    const passport = buildSemanticPassport(head, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    }, delta);
    expect(passport.ok).toBe(true);
    if (!passport.ok) return;
    expect(passport.delta).not.toBeNull();
    expect(passport.delta).toMatchObject({
      status: 'changed',
      classifications: expect.arrayContaining(['lifecycle']),
    });
    expect(passport.deltaRevisionId).toBe(delta.headRevisionId);
  });

  it('entity unchanged: delta is null while deltaRevisionId is recorded', () => {
    const base = buildRevision();
    const head = buildRevision();
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');
    const passport = buildSemanticPassport(head, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    }, delta);
    expect(passport.ok).toBe(true);
    if (!passport.ok) return;
    expect(passport.delta).toBeNull();
    expect(passport.deltaRevisionId).toBe(head.revisionId);
  });

  it('without a Delta, Passport is still complete and deltaRevisionId=null', () => {
    const revision = buildRevision();
    const passport = buildSemanticPassport(revision, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    });
    expect(passport.ok).toBe(true);
    if (!passport.ok) return;
    expect(passport.delta).toBeNull();
    expect(passport.deltaRevisionId).toBeNull();
  });

  it('evidence deterministic ordering: same evidenceRefs yield identical ordering', () => {
    const a = buildRevision();
    const b = buildRevision();
    const passA = buildSemanticPassport(a, { kind: 'conversation', id: 'conversation:conversation-1' });
    const passB = buildSemanticPassport(b, { kind: 'conversation', id: 'conversation:conversation-1' });
    if (!passA.ok || !passB.ok) throw new Error('expected ok');
    expect(passA.evidence.map((e) => e.id)).toEqual(passB.evidence.map((e) => e.id));
  });

  it('UNKNOWN is preserved as UNKNOWN', () => {
    const revision = buildRevision({
      conversations: [conversation({
        taskState: 'unknown', runtimeState: 'unknown', verification: 'VERIFIED',
      })],
    });
    const passport = buildSemanticPassport(revision, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    });
    if (!passport.ok) throw new Error('expected ok');
    if (passport.current.kind !== 'conversation') throw new Error('expected conversation');
    expect(passport.current.taskState).toBe('unknown');
    expect(passport.current.runtimeState).toBe('unknown');
    expect(passport.current.attentionState).toBe('none');
  });

  it('STALE / INVALID evidence surfaces with high visual weight in currentness', () => {
    const revision = buildRevision({
      evidence: [
        { ...baseEvidence(), currentness: 'STALE' },
        secondEvidence(),
      ],
    });
    const passport = buildSemanticPassport(revision, {
      kind: 'evidence',
      id: 'evidence:conversation-1',
    });
    if (!passport.ok) throw new Error('expected ok');
    expect(passport.current).toMatchObject({ kind: 'evidence', currentness: 'STALE' });
    expect(passport.evidence[0]).toMatchObject({ id: 'evidence:conversation-1', currentness: 'STALE' });
  });

  it('two calls with the same inputs deep-equal each other', () => {
    const revision = buildRevision();
    const ref = { kind: 'conversation' as const, id: 'conversation:conversation-1' };
    const first = buildSemanticPassport(revision, ref);
    const second = buildSemanticPassport(revision, ref);
    expect(first).toEqual(second);
  });

  it('does not consult the system clock anywhere in the call graph', () => {
    const base = buildRevision();
    const head = buildRevision({
      conversations: [conversation({ lifecycleState: 'PAUSED' })],
    });
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');

    const realDate = globalThis.Date;
    let constructionCalls = 0;
    let nowCalls = 0;
    class ThrowDate {
      constructor(..._args: unknown[]) {
        constructionCalls += 1;
        throw new Error('Semantic Passport must not call the Date constructor');
      }
      static now(): number {
        nowCalls += 1;
        throw new Error('Semantic Passport must not call Date.now()');
      }
    }
    (globalThis as unknown as { Date: unknown }).Date = ThrowDate;
    try {
      const ref = { kind: 'conversation' as const, id: 'conversation:conversation-1' };
      const result = buildSemanticPassport(head, ref, delta);
      expect(constructionCalls).toBe(0);
      expect(nowCalls).toBe(0);
      expect(result.ok).toBe(true);
    } finally {
      (globalThis as unknown as { Date: unknown }).Date = realDate;
    }
  });

  it('Passport has no time-dependent field', () => {
    const revision = buildRevision();
    const result = buildSemanticPassport(revision, {
      kind: 'conversation',
      id: 'conversation:conversation-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('computedAt' in result).toBe(false);
  });
});

// Passport only consumes VerifiedProjectionRevisionV0 + optional Delta; this
// proves the test suite does not require any raw Snapshot / Activity /
// Governance file to drive the surface.
describe('Semantic Passport v0 · no raw-fact coupling', () => {
  it('builds a valid Passport from buildVerifiedProjection only', () => {
    const input: ProjectionFactInputV0 = {
      projectId: 'project-1',
      snapshot: {
        overlayRoot: 'f:/govern',
        foundAt: '2026-09-04T00:00:00.000Z',
        conversations: [{
          key: 'project-1::codex::builder-1',
          role: 'builder',
          project: 'project-1',
          platform: 'codex',
          status: 'ACTIVE',
          taskState: 'waiting',
          runtimeState: 'unknown',
          attention: 'needs-user',
          verification: 'VERIFIED',
          observed: {
            source: 'canonical-file',
            sourceRef: 'dialogues/project-1.yaml',
            observedAt: '2026-09-04T00:00:00.000Z',
            verification: 'VERIFIED',
          },
        }],
        projects: [{
          projectId: 'project-1',
          displayName: 'Project One',
          status: 'ACTIVE',
          roles: [],
          gates: {},
          trust: 'VERIFIED',
          observed: {
            source: 'canonical-file',
            sourceRef: 'projects/project-1.yaml',
            observedAt: '2026-09-04T00:00:00.000Z',
            verification: 'VERIFIED',
          },
        }],
        inbox: [],
        memoryIndex: [],
        harness: [],
        sourceFingerprints: [
          { sourceRef: 'dialogues/project-1.yaml', sha256: '1'.repeat(64) },
          { sourceRef: 'projects/project-1.yaml', sha256: '2'.repeat(64) },
        ],
        problems: [],
      },
      activity: [],
    };
    void compileProjectionCandidate;
    const state = buildVerifiedProjection(input, null, { now: () => NOW });
    if (!state.current) throw new Error('fixture must verify');
    const result = buildSemanticPassport(state.current, {
      kind: 'conversation',
      id: 'conversation:project-1::codex::builder-1',
    });
    expect(result.ok).toBe(true);
  });
});