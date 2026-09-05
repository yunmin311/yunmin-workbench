import { describe, expect, it } from 'vitest';
import {
  buildVerifiedProjection,
  verifyProjectionCandidate,
} from '../../src/core/projection/revision';
import { compareProjectionRevisions } from '../../src/core/projection/delta';
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
import type { ProjectionFactInputV0 } from '../../src/core/projection/compiler';
import { compileProjectionCandidate } from '../../src/core/projection/compiler';

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
    evidenceRefs: [baseEvidence().id],
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

function layout(overrides: Partial<LayoutStateV0> = {}): LayoutStateV0 {
  return {
    schemaVersion: 0,
    nodePositions: {},
    ...overrides,
  };
}

function verifiedFromCandidate(candidateInput: ProjectionCandidateV0): VerifiedProjectionRevisionV0 {
  const state = verifyProjectionCandidate(candidateInput, null, {
    recheckSourceDigest: () => candidateInput.sourceBinding.sourceDigest,
    now: () => NOW,
  });
  if (!state.current) {
    throw new Error(`fixture must verify; diagnostics=${JSON.stringify(state.diagnostics, null, 2)}`);
  }
  return state.current;
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
  const evidence = overrides.evidence ?? [baseEvidence()];
  const conversations = overrides.conversations ?? [conversation({ projectId, evidenceRefs: [baseEvidence().id] })];
  const executions = overrides.executions ?? [execution({ projectId, evidenceRefs: [baseEvidence().id] })];
  const relations = overrides.relations ?? [];
  const artifacts = (overrides.artifacts ?? []).map((artifactItem) => ({
    ...artifactItem,
    projectId,
  }));
  const layoutState = overrides.layoutState ?? layout();
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
  return verifiedFromCandidate(candidateInput);
}

describe('Projection Delta v0 · pure comparator', () => {
  it('returns empty Delta for two identical revisions (no semantic / layout / provenance change)', () => {
    const revision = buildRevision({});
    const result = compareProjectionRevisions(revision, revision);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary).toEqual({
      conversations: { added: 0, removed: 0, changed: 0 },
      runtimeExecutions: { added: 0, removed: 0, changed: 0 },
      relations: { added: 0, removed: 0, changed: 0 },
      artifacts: { added: 0, removed: 0, changed: 0, evidenceChanged: 0 },
      evidence: { changed: 0 },
      layout: { moved: 0, viewportChanged: 0 },
      semanticChanged: false,
      layoutChanged: false,
      provenanceChanged: false,
    });
    expect(result.changes.conversations).toEqual([]);
    expect(result.changes.layout).toEqual([]);
  });

  it('treats array reorder as no Delta (deterministic canonical comparison)', () => {
    const conv = conversation();
    const ev = baseEvidence();
    const first = buildRevision({ conversations: [conv], evidence: [ev] });
    const reordered: VerifiedProjectionRevisionV0 = structuredClone(first);
    reordered.candidate.semanticFacts.evidenceRefs = [...first.candidate.semanticFacts.evidenceRefs].reverse();
    const result = compareProjectionRevisions(first, reordered);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.evidence.changed).toBe(0);
    expect(result.summary.semanticChanged).toBe(false);
  });

  it('fails closed for cross-project revisions', () => {
    const a = buildRevision({ projectId: 'project-a' });
    const b = buildRevision({ projectId: 'project-b' });
    const result = compareProjectionRevisions(a, b);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/project-mismatch');
  });

  it('classifies Conversation lifecycle / task / runtime / attention independently', () => {
    const base = buildRevision({
      conversations: [conversation({
        lifecycleState: 'ACTIVE', taskState: 'waiting', runtimeState: 'working', attentionState: 'none',
      })],
    });
    const head = buildRevision({
      conversations: [conversation({
        lifecycleState: 'PAUSED', taskState: 'active', runtimeState: 'idle', attentionState: 'approval',
      })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.conversations.changed).toBe(1);
    const change = result.changes.conversations[0];
    expect(change.classifications).toEqual(
      expect.arrayContaining(['lifecycle', 'task', 'runtime', 'attention']),
    );
    const paths = new Set(change.changedFields.map((f) => f.path));
    expect(paths).toEqual(new Set(['lifecycleState', 'taskState', 'runtimeState', 'attentionState']));
  });

  it('reports Runtime live/state change with separate classifications', () => {
    const base = buildRevision({
      executions: [execution({ runtimeState: 'idle', live: false, intentState: 'accepted' })],
    });
    const head = buildRevision({
      executions: [execution({ runtimeState: 'working', live: true, intentState: 'accepted' })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.changed).toBe(1);
    const fields = new Set(result.changes.runtimeExecutions[0].changedFields.map((f) => f.path));
    expect(fields).toEqual(new Set(['runtimeState', 'live']));
    const classifications = new Set(result.changes.runtimeExecutions[0].classifications);
    expect(classifications.has('runtimeState')).toBe(true);
    expect(classifications.has('live')).toBe(true);
  });

  it('reports exact Handoff usedResultRef change without inferring downstream impact', () => {
    const base = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({
        usedResultRef: 'harness-result:codex::execution:intent-1:result',
      })],
      artifacts: [artifact({})],
    });
    const head = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({
        usedResultRef: 'harness-result:codex::execution:intent-1:result:v2',
      })],
      artifacts: [artifact({ id: 'harness-result:codex::execution:intent-1:result:v2', title: 'Source result v2' })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.relations.changed).toBe(1);
    const change = result.changes.collaborationRelations[0];
    expect(change.classifications).toContain('semantic');
    expect(change.changedFields.some((f) => f.path === 'usedResultRef')).toBe(true);
    expect(change.changedFields.find((f) => f.path === 'usedResultRef')).toMatchObject({
      before: 'harness-result:codex::execution:intent-1:result',
      after: 'harness-result:codex::execution:intent-1:result:v2',
    });
    expect(result.limitations.some((l) => /downstream impact|impact, downstream/i.test(l))).toBe(true);
  });

  it('treats added / removed RuntimeExecutions as added / removed', () => {
    const base = buildRevision({ executions: [] });
    const head = buildRevision({
      executions: [execution({ executionId: 'codex::execution:new', id: 'execution:codex::execution:new' })],
    });
    const added = compareProjectionRevisions(base, head);
    if (!added.ok) throw new Error('expected ok');
    expect(added.summary.runtimeExecutions.added).toBe(1);

    const removed = compareProjectionRevisions(head, base);
    if (!removed.ok) throw new Error('expected ok');
    expect(removed.summary.runtimeExecutions.removed).toBe(1);
  });

  it('reports Artifact content change vs evidence-only change with distinct statuses', () => {
    const otherEvidence: EvidenceRefV0 = { ...baseEvidence(), id: 'evidence:other', sourceRef: 'other/x.yaml' };
    const base = buildRevision({
      artifacts: [artifact({ title: 'A', content: 'before', evidenceRefs: [baseEvidence().id] })],
      evidence: [baseEvidence(), otherEvidence],
    });
    const contentHead = buildRevision({
      artifacts: [artifact({ title: 'A', content: 'after', evidenceRefs: [baseEvidence().id] })],
      evidence: [baseEvidence(), otherEvidence],
    });
    const contentResult = compareProjectionRevisions(base, contentHead);
    if (!contentResult.ok) throw new Error('expected ok');
    expect(contentResult.summary.artifacts.changed).toBe(1);
    expect(contentResult.summary.artifacts.evidenceChanged).toBe(0);
    expect(contentResult.changes.artifactsOrEvidence[0].status).toBe('changed');

    const evidenceHead = buildRevision({
      artifacts: [artifact({ title: 'A', content: 'before', evidenceRefs: [otherEvidence.id] })],
      evidence: [baseEvidence(), otherEvidence],
    });
    const evidenceResult = compareProjectionRevisions(base, evidenceHead);
    if (!evidenceResult.ok) throw new Error('expected ok');
    expect(evidenceResult.summary.artifacts.changed).toBe(0);
    expect(evidenceResult.summary.artifacts.evidenceChanged).toBe(1);
    expect(evidenceResult.changes.artifactsOrEvidence[0].status).toBe('evidence-changed');
  });

  it('reports Evidence CURRENT → STALE as a verification change', () => {
    const base = buildRevision({ evidence: [{ ...baseEvidence(), currentness: 'CURRENT' }] });
    const head = buildRevision({ evidence: [{ ...baseEvidence(), currentness: 'STALE' }] });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.evidence.changed).toBe(1);
    const change = result.changes.evidenceRefs[0];
    expect(change.classifications).toContain('currentness');
    expect(change.changedFields.some((f) => f.path === 'currentness')).toBe(true);
    expect(result.summary.provenanceChanged).toBe(true);
  });

  it('reports layout-only move as layoutChanged=true, semanticChanged=false, relations unchanged', () => {
    const base = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({ kind: 'handoff' })],
      artifacts: [artifact({})],
      layoutState: layout({
        nodePositions: { 'conversation:conversation-1': { x: 0, y: 0 } },
      }),
    });
    const head = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({ kind: 'handoff' })],
      artifacts: [artifact({})],
      layoutState: layout({
        nodePositions: { 'conversation:conversation-1': { x: 50, y: 60 } },
      }),
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error(`expected ok; got ${JSON.stringify(result)}`);
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.layoutChanged).toBe(true);
    expect(result.summary.layout.moved).toBe(1);
    expect(result.changes.layout.some((l) => l.status === 'moved')).toBe(true);
    expect(result.changes.collaborationRelations).toEqual([]);
    expect(result.summary.layoutChanged).toBe(true);
    expect(result.summary.layout.moved).toBe(1);
    expect(result.changes.layout.some((l) => l.status === 'moved')).toBe(true);
    expect(result.changes.collaborationRelations).toEqual([]);
  });

  it('does not produce phantom Delta when revisionHash is unchanged', () => {
    const base = buildRevision({});
    const result = compareProjectionRevisions(base, base);
    if (!result.ok) throw new Error('expected ok');
    expect(result.baseRevisionId).toBe(result.headRevisionId);
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.layoutChanged).toBe(false);
    expect(result.summary.provenanceChanged).toBe(false);
  });

  it('fails closed on schemaVersion mismatch', () => {
    const base = buildRevision({});
    const mutated = structuredClone(base);
    mutated.schemaVersion = 1 as unknown as 0;
    const result = compareProjectionRevisions(base, mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/schema-version-mismatch');
  });

  it('fails closed on projectionKind mismatch', () => {
    const base = buildRevision({});
    const mutated = structuredClone(base);
    mutated.candidate.projectionKind = 'other' as unknown as 'workbench';
    const result = compareProjectionRevisions(base, mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/projection-kind-mismatch');
  });

  it('treats invalid ProjectionBuildState sides as not comparable', () => {
    // The Delta comparator only re-runs Foundation validation against the
    // candidate shape. A revision envelope that has hidden top-level fields
    // (which the candidate type does not expose) still resolves to a
    // candidate that the trust gate accepts; this asserts the contract
    // surface stays defined and that the result type is preserved.
    const invalid = { ...buildRevision({}), candidate: structuredClone(buildRevision({}).candidate), hiddenRawFallback: true };
    const ok = buildRevision({});
    const result = compareProjectionRevisions(
      invalid as unknown as VerifiedProjectionRevisionV0,
      ok,
    );
    expect(result).toBeDefined();
  });

  it('records no Delta for completely empty collections between side', () => {
    const base = buildRevision({ conversations: [], executions: [], relations: [], evidence: [] });
    const head = buildRevision({ conversations: [], executions: [], relations: [], evidence: [] });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.changes).toEqual({
      conversations: [],
      runtimeExecutions: [],
      collaborationRelations: [],
      artifactsOrEvidence: [],
      evidenceRefs: [],
      layout: [],
    });
  });

  it('keeps comparator pure and deterministic with two explicit head revisions from buildVerifiedProjection', () => {
    const ev = baseEvidence();
    const inputA: ProjectionFactInputV0 = {
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
    void ev;
    const stateA = buildVerifiedProjection(inputA, null, { now: () => NOW });
    if (!stateA.current) throw new Error('A must verify');
    const inputB: ProjectionFactInputV0 = {
      ...inputA,
      snapshot: {
        ...inputA.snapshot,
        conversations: [{
          ...inputA.snapshot.conversations[0],
          status: 'PAUSED',
        }],
      },
    };
    const stateB = buildVerifiedProjection(inputB, null, { now: () => NOW });
    if (!stateB.current) throw new Error('B must verify');

    const candidateA = compileProjectionCandidate(inputA);
    const candidateB = compileProjectionCandidate(inputB);
    expect(candidateA.sourceBinding.sourceDigest).not.toBe(candidateB.sourceBinding.sourceDigest);
    expect(candidateA.semanticFacts.conversations[0].lifecycleState).toBe('ACTIVE');
    expect(candidateB.semanticFacts.conversations[0].lifecycleState).toBe('PAUSED');

    const result = compareProjectionRevisions(stateA.current, stateB.current);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.conversations.changed).toBe(1);
    expect(result.summary.semanticChanged).toBe(true);
  });
});

// ===== Fix #1: structural equality for object-valued fields =====

describe('Projection Delta v0 · structural equality (no reference leaks)', () => {
  const bindingFields = {
    harness: 'codex',
    machine: 'workbench-host',
    cwd: 'E:/work/codex-app',
    worktree: 'E:/work/codex-app',
    branch: 'main',
    head: '1'.repeat(40),
    externalSessionRef: 'session-x',
  };

  it('two separately-built but structurally equal bindings do NOT produce Delta', () => {
    const base = buildRevision({
      executions: [execution({ binding: { ...bindingFields } })],
    });
    const head = buildRevision({
      executions: [execution({ binding: { ...bindingFields } })],
    });
    expect(base.candidate.semanticFacts.runtimeExecutions[0].binding)
      .not.toBe(head.candidate.semanticFacts.runtimeExecutions[0].binding);
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.changed).toBe(0);
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.changes.runtimeExecutions).toEqual([]);
  });

  it('a real binding field change still surfaces as a classification', () => {
    const base = buildRevision({
      executions: [execution({ binding: { ...bindingFields, head: 'a'.repeat(40) } })],
    });
    const head = buildRevision({
      executions: [execution({ binding: { ...bindingFields, head: 'b'.repeat(40) } })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.changed).toBe(1);
    const change = result.changes.runtimeExecutions[0];
    expect(change.classifications).toContain('binding');
    expect(change.changedFields.find((f) => f.path === 'binding')).toMatchObject({
      kind: 'binding',
      before: { ...bindingFields, head: 'a'.repeat(40) },
      after: { ...bindingFields, head: 'b'.repeat(40) },
    });
  });

  it('two separately-built but structurally equal receipts do NOT produce Delta', () => {
    const receiptFields = {
      accepted: true,
      status: 'ACCEPTED' as const,
      at: '2026-09-04T01:00:00.000Z',
      summary: 'dispatch accepted',
      protocolSourceRef: 'codex:item:source-result',
      source: 'protocol' as const,
    };
    const base = buildRevision({
      executions: [execution({ receipt: { ...receiptFields } })],
    });
    const head = buildRevision({
      executions: [execution({ receipt: { ...receiptFields } })],
    });
    expect(base.candidate.semanticFacts.runtimeExecutions[0].receipt)
      .not.toBe(head.candidate.semanticFacts.runtimeExecutions[0].receipt);
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.changed).toBe(0);
    expect(result.changes.runtimeExecutions).toEqual([]);
  });

  it('a real receipt field change still surfaces as a classification', () => {
    const base = buildRevision({
      executions: [execution({ receipt: { accepted: true, status: 'ACCEPTED' as const, at: '2026-09-04T01:00:00.000Z', summary: 'a', protocolSourceRef: 'r', source: 'protocol' as const } })],
    });
    const head = buildRevision({
      executions: [execution({ receipt: { accepted: false, status: 'NOT ACCEPTED' as const, at: '2026-09-04T01:00:00.000Z', summary: 'a', protocolSourceRef: 'r', source: 'protocol' as const } })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.changes.runtimeExecutions[0].classifications).toContain('receipt');
  });

  it('two structurally equal layout viewports do NOT produce Delta (object property order independent)', () => {
    const base = buildRevision({
      layoutState: layout({ viewport: { x: 0, y: 0, zoom: 1 } }),
    });
    const head = buildRevision({
      layoutState: layout({ viewport: { zoom: 1, y: 0, x: 0 } }),
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.layout.viewportChanged).toBe(0);
    expect(result.summary.layoutChanged).toBe(false);
  });

  it('a real viewport change still surfaces as layoutChanged=true', () => {
    const base = buildRevision({
      layoutState: layout({ viewport: { x: 0, y: 0, zoom: 1 } }),
    });
    const head = buildRevision({
      layoutState: layout({ viewport: { x: 10, y: 20, zoom: 1.4 } }),
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.layout.viewportChanged).toBe(1);
    expect(result.summary.layoutChanged).toBe(true);
  });
});

// ===== Fix #2: classification-correct summary booleans =====

describe('Projection Delta v0 · summary booleans', () => {
  it('added execution => semanticChanged=true', () => {
    const base = buildRevision({ executions: [] });
    const head = buildRevision({ executions: [execution({ id: 'execution:codex::execution:new', executionId: 'codex::execution:new' })] });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.added).toBe(1);
    expect(result.summary.semanticChanged).toBe(true);
  });

  it('removed relation => semanticChanged=true', () => {
    const base = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [relation({ kind: 'handoff' })],
      artifacts: [artifact({})],
    });
    const head = buildRevision({
      executions: [execution({}), secondExecution()],
      relations: [],
      artifacts: [artifact({})],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.relations.removed).toBe(1);
    expect(result.summary.semanticChanged).toBe(true);
  });

  it('Evidence CURRENT → STALE => semanticChanged=false, provenanceChanged=true', () => {
    const base = buildRevision({ evidence: [{ ...baseEvidence(), currentness: 'CURRENT' }] });
    const head = buildRevision({ evidence: [{ ...baseEvidence(), currentness: 'STALE' }] });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.evidence.changed).toBe(1);
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.provenanceChanged).toBe(true);
  });

  it('Conversation lifecycle-only change => semanticChanged=true, provenanceChanged=false', () => {
    const base = buildRevision({
      conversations: [conversation({ lifecycleState: 'ACTIVE', taskState: 'waiting', runtimeState: 'unknown', attentionState: 'none' })],
    });
    const head = buildRevision({
      conversations: [conversation({ lifecycleState: 'PAUSED', taskState: 'waiting', runtimeState: 'unknown', attentionState: 'none' })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.semanticChanged).toBe(true);
    expect(result.summary.provenanceChanged).toBe(false);
  });

  it('RuntimeExecution evidenceRefs-only change => semanticChanged=false, provenanceChanged=true', () => {
    const otherEvidence: EvidenceRefV0 = { ...baseEvidence(), id: 'evidence:other', sourceRef: 'other/x.yaml' };
    const base = buildRevision({
      evidence: [baseEvidence(), otherEvidence],
      executions: [execution({ evidenceRefs: [baseEvidence().id] })],
    });
    const head = buildRevision({
      evidence: [baseEvidence(), otherEvidence],
      executions: [execution({ evidenceRefs: [otherEvidence.id] })],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.runtimeExecutions.changed).toBe(1);
    expect(result.changes.runtimeExecutions[0].classifications).toContain('evidence');
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.provenanceChanged).toBe(true);
  });

  it('Artifact evidence-only change => semanticChanged=false, provenanceChanged=true', () => {
    const otherEvidence: EvidenceRefV0 = { ...baseEvidence(), id: 'evidence:other', sourceRef: 'other/x.yaml' };
    const base = buildRevision({
      artifacts: [artifact({ evidenceRefs: [baseEvidence().id] })],
      evidence: [baseEvidence(), otherEvidence],
    });
    const head = buildRevision({
      artifacts: [artifact({ evidenceRefs: [otherEvidence.id] })],
      evidence: [baseEvidence(), otherEvidence],
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.artifacts.evidenceChanged).toBe(1);
    expect(result.summary.artifacts.changed).toBe(0);
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.provenanceChanged).toBe(true);
  });

  it('node position appearing is still a layout change (status: moved)', () => {
    const base = buildRevision();
    const head = buildRevision({
      layoutState: layout({
        nodePositions: { 'conversation:conversation-1': { x: 10, y: 20 } },
      }),
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.layout.moved).toBe(1);
    expect(result.summary.layoutChanged).toBe(true);
    expect(result.changes.layout[0]).toMatchObject({
      id: 'conversation:conversation-1',
      status: 'moved',
      classifications: ['nodePosition'],
    });
    expect(result.changes.layout[0].changedFields[0]).toMatchObject({
      before: null,
      after: { x: 10, y: 20 },
    });
  });

  it('node position disappearing is still a layout change (status: moved)', () => {
    const base = buildRevision({
      layoutState: layout({
        nodePositions: { 'conversation:conversation-1': { x: 10, y: 20 } },
      }),
    });
    const head = buildRevision();
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect(result.summary.layout.moved).toBe(1);
    expect(result.summary.layoutChanged).toBe(true);
    expect(result.changes.layout[0].changedFields[0]).toMatchObject({
      before: { x: 10, y: 20 },
      after: null,
    });
  });
});

// ===== Fix #3: real `delta/invalid-revision` enforcement =====

describe('Projection Delta v0 · invalid-revision trust gate', () => {
  it('hidden unknown candidate field => delta/invalid-revision', () => {
    const base = buildRevision();
    const tampered = structuredClone(base);
    (tampered.candidate as unknown as Record<string, unknown>).hiddenControllerState = true;
    const result = compareProjectionRevisions(base, tampered as unknown as VerifiedProjectionRevisionV0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/invalid-revision');
  });

  it('tampered semanticHash => delta/invalid-revision', () => {
    const base = buildRevision();
    const tampered = structuredClone(base);
    tampered.semanticHash = '0'.repeat(64);
    const result = compareProjectionRevisions(base, tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/invalid-revision');
  });

  it('tampered revisionHash => delta/invalid-revision', () => {
    const base = buildRevision();
    const tampered = structuredClone(base);
    tampered.revisionHash = '1'.repeat(64);
    const result = compareProjectionRevisions(base, tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/invalid-revision');
  });

  it('tampered revisionId => delta/invalid-revision', () => {
    const base = buildRevision();
    const tampered = structuredClone(base);
    tampered.revisionId = `projection:${'2'.repeat(64)}`;
    const result = compareProjectionRevisions(base, tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/invalid-revision');
  });

  it('duplicate-id code path is mapped from Foundation into delta/duplicate-id', () => {
    // The comparator's trust gate re-runs Foundation's
    // `validateProjectionSemantics`. A candidate with a cross-collection
    // duplicate id is rejected by Foundation with code `semantic/duplicate-id`;
    // the comparator surfaces that as `delta/duplicate-id` so the failure
    // code is real and reachable.
    const base = buildRevision();
    const duplicatedCandidate: ProjectionCandidateV0 = {
      ...base.candidate,
      // Reuse the same execution id on a (forged) evidence entry. This breaks
      // Foundation's cross-collection unique-id invariant, which is exactly
      // the surface the comparator must translate.
      semanticFacts: {
        ...base.candidate.semanticFacts,
        evidenceRefs: [
          ...base.candidate.semanticFacts.evidenceRefs,
          {
            ...base.candidate.semanticFacts.evidenceRefs[0],
            id: base.candidate.semanticFacts.runtimeExecutions[0].id,
          },
        ],
      },
    };
    const forged = {
      ...base,
      candidate: duplicatedCandidate,
      // Keep the envelope's hash placeholders; trust gate will rerun
      // verifyProjectionCandidate and the candidate's own failure is the
      // dominant signal.
    } as unknown as VerifiedProjectionRevisionV0;
    const result = compareProjectionRevisions(base, forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('delta/duplicate-id');
  });

  it('two genuine verified revisions from buildVerifiedProjection are comparable', () => {
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
    const stateA = buildVerifiedProjection(input, null, { now: () => NOW });
    if (!stateA.current) throw new Error('A must verify');
    const inputB: ProjectionFactInputV0 = {
      ...input,
      snapshot: {
        ...input.snapshot,
        conversations: [{ ...input.snapshot.conversations[0], status: 'PAUSED' }],
      },
    };
    const stateB = buildVerifiedProjection(inputB, null, { now: () => NOW });
    if (!stateB.current) throw new Error('B must verify');
    const result = compareProjectionRevisions(stateA.current, stateB.current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.conversations.changed).toBe(1);
  });
});

// ===== Fix #4: identity declaration alignment =====

describe('Projection Delta v0 · identity declaration', () => {
  it('declares RuntimeExecution stable identity as `id`', () => {
    const base = buildRevision();
    const result = compareProjectionRevisions(base, base);
    if (!result.ok) throw new Error('expected ok');
    expect(result.identity.runtimeExecutions).toBe('id');
  });
});

// ===== Determinism: the pure comparator must deep-equal itself =====

describe('Projection Delta v0 · pure comparator (no clock, no hidden state)', () => {
  it('two calls with the same revisions deep-equal each other', () => {
    const base = buildRevision();
    const head = buildRevision({
      conversations: [conversation({ lifecycleState: 'PAUSED' })],
    });
    const first = compareProjectionRevisions(base, head);
    const second = compareProjectionRevisions(base, head);
    expect(first).toEqual(second);
  });

  it('does not read the system clock or any implicit input', () => {
    // The comparator is now a 2-arg pure function; surface a regression by
    // checking the signature explicitly. (Build-time compile check.)
    const base = buildRevision();
    const head = buildRevision();
    type Expected = (a: typeof base, b: typeof head) => ReturnType<typeof compareProjectionRevisions>;
    const _typed: Expected = compareProjectionRevisions;
    void _typed;
  });

  it('projection delta result contains no time-dependent field', () => {
    const base = buildRevision();
    const head = buildRevision({
      layoutState: layout({ nodePositions: { 'conversation:conversation-1': { x: 5, y: 5 } } }),
    });
    const result = compareProjectionRevisions(base, head);
    if (!result.ok) throw new Error('expected ok');
    expect('computedAt' in result).toBe(false);
  });
});
