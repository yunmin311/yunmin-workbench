import { describe, expect, it } from 'vitest';
import { computeProjectionReach } from '../../src/core/projection/reach';
import {
  computeProjectionLayoutHash,
  computeProjectionRevisionHash,
  computeProjectionSemanticHash,
  verifyProjectionCandidate,
} from '../../src/core/projection/revision';
import type { ProjectionFactInputV0 } from '../../src/core/projection/compiler';
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
const NOW = '2026-09-05T02:00:00.000Z';

const C1 = 'conversation:conversation-1';
const EX1 = 'execution:codex::execution:intent-1';
const EX2 = 'execution:codex::execution:intent-2';
const EXT = 'execution:claude::execution:intent-3';
const A1 = 'harness-result:codex::execution:intent-1:result';
const A3 = 'harness-result:claude::execution:intent-3:result';
const AE = 'tool-evidence:standalone';
const HANDOFF_1 = 'handoff:codex-intent-1->claude-intent-3';

function baseEvidence(): EvidenceRefV0 {
  return {
    id: 'evidence:conversation-1',
    source: 'canonical-file',
    sourceRef: 'dialogues/project-1.yaml',
    observedAt: '2026-09-05T00:00:00.000Z',
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
    observedAt: '2026-09-05T00:00:00.000Z',
    verification: 'VERIFIED',
    currentness: 'CURRENT',
  };
}

function conversation(overrides: Partial<ConversationProjectionV0> = {}): ConversationProjectionV0 {
  return {
    id: C1,
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

function execution(overrides: Partial<RuntimeExecutionProjectionV0> & { executionId: string }): RuntimeExecutionProjectionV0 {
  return {
    id: `execution:${overrides.executionId}`,
    nativeRef: `thread-${overrides.executionId}`,
    harness: 'codex',
    projectId: 'project-1',
    conversationRef: C1,
    binding: null,
    runtimeState: 'idle',
    live: false,
    startedAt: null,
    endedAt: null,
    intentId: overrides.executionId,
    intentState: 'accepted',
    receipt: null,
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactOrEvidenceProjectionV0> & { id: string }): ArtifactOrEvidenceProjectionV0 {
  return {
    kind: 'agent-result',
    projectId: 'project-1',
    title: 'Result',
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  };
}

function handoff(overrides: Partial<CollaborationRelationProjectionV0> & { id: string }): CollaborationRelationProjectionV0 {
  return {
    kind: 'handoff',
    sourceExecutionRef: EX1,
    targetExecutionRef: EXT,
    usedResultRef: A1,
    evidenceRefs: [baseEvidence().id, secondEvidence().id],
    ...overrides,
  } as CollaborationRelationProjectionV0;
}

function parallelRel(): CollaborationRelationProjectionV0 {
  return {
    id: 'parallel:p1',
    kind: 'parallel',
    groupId: 'group-1',
    executionRefs: [EX1, EX2],
    evidenceRefs: [baseEvidence().id],
  };
}

function layout(nodePositions: Record<string, { x: number; y: number }>): LayoutStateV0 {
  return { schemaVersion: 0, nodePositions };
}

function buildRevision(overrides: {
  conversations?: ConversationProjectionV0[];
  executions?: RuntimeExecutionProjectionV0[];
  relations?: CollaborationRelationProjectionV0[];
  artifacts?: ArtifactOrEvidenceProjectionV0[];
  evidence?: EvidenceRefV0[];
  layoutState?: LayoutStateV0;
} = {}): VerifiedProjectionRevisionV0 {
  const candidateInput: ProjectionCandidateV0 = {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest: SOURCE_DIGEST },
    semanticFacts: {
      conversations: overrides.conversations ?? [conversation()],
      runtimeExecutions: overrides.executions ?? [
        execution({ executionId: 'codex::execution:intent-1' }),
        execution({ executionId: 'codex::execution:intent-2' }),
        execution({ executionId: 'claude::execution:intent-3', harness: 'claude', conversationRef: null }),
      ],
      collaborationRelations: overrides.relations ?? [handoff({ id: HANDOFF_1 }), parallelRel()],
      artifactsOrEvidence: (overrides.artifacts ?? [
        artifact({ id: A1, executionRef: EX1 }),
        artifact({ id: A3, executionRef: EXT }),
        artifact({ id: AE, kind: 'tool-evidence', eventRef: 'event-1' }),
      ]).map((item) => ({ ...item, projectId: 'project-1' })),
      evidenceRefs: overrides.evidence ?? [baseEvidence(), secondEvidence()],
    },
    layoutState: overrides.layoutState ?? layout({}),
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

function reach(revision: VerifiedProjectionRevisionV0, originId: string, originKind: 'conversation' | 'runtimeExecution' | 'artifactOrEvidence', direction: 'upstream' | 'downstream') {
  return computeProjectionReach(revision, { kind: originKind, id: originId }, direction);
}

describe('Projection Reach v0 · pure core (exact directed edges only)', () => {
  it('Conversation downstream reaches executions, handoff target, and artifacts at exact minimum depths', () => {
    const revision = buildRevision();
    const result = reach(revision, C1, 'conversation', 'downstream');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      schemaVersion: 0,
      projectId: 'project-1',
      revisionId: revision.revisionId,
      origin: { kind: 'conversation', id: C1 },
      direction: 'downstream',
      maximumHops: 3,
    });
    // Deterministic node order: minimumDepth ascending, then stable id.
    expect(result.nodes.map((node) => [node.minimumDepth, node.id])).toEqual([
      [0, C1],
      [1, EX1],
      [1, EX2],
      [2, EXT],
      [2, A1],
      [3, A3],
    ]);
    expect(result.nodes.map((node) => node.kind)).toEqual([
      'conversation', 'runtimeExecution', 'runtimeExecution', 'runtimeExecution', 'artifactOrEvidence', 'artifactOrEvidence',
    ]);
    // Edges are the exact directed edges of the reachable subgraph, sorted
    // by stableEdgeKey (lexicographic over source, target, edgeKind,
    // relation identity).
    expect(result.edges.map((edge) => [edge.edgeKind, edge.source, edge.target])).toEqual([
      ['conversation-execution', C1, EX1],
      ['conversation-execution', C1, EX2],
      ['execution-artifact', EXT, A3],
      ['handoff', EX1, EXT],
      ['execution-artifact', EX1, A1],
    ]);
    expect(result.minimumDepthByNode).toEqual({
      [C1]: 0,
      [EX1]: 1,
      [EX2]: 1,
      [EXT]: 2,
      [A1]: 2,
      [A3]: 3,
    });
  });

  it('structural edges carry the exact structural source (entity id + field path), never synthetic evidence', () => {
    const revision = buildRevision();
    const result = reach(revision, C1, 'conversation', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    const conversationExecution = result.edges.find((edge) => edge.edgeKind === 'conversation-execution');
    expect(conversationExecution?.structuralSource).toEqual({ entityId: EX1, fieldPath: 'conversationRef' });
    const executionArtifact = result.edges.find((edge) => edge.edgeKind === 'execution-artifact' && edge.source === EXT);
    expect(executionArtifact?.structuralSource).toEqual({ entityId: A3, fieldPath: 'executionRef' });
    expect(executionArtifact?.relationId).toBeUndefined();
    expect(executionArtifact?.usedResultRef).toBeUndefined();
  });

  it('handoff edges carry the exact relationId / usedResultRef / evidenceRefs', () => {
    const revision = buildRevision();
    const result = reach(revision, C1, 'conversation', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    const handoffEdge = result.edges.find((edge) => edge.edgeKind === 'handoff');
    expect(handoffEdge).toMatchObject({
      edgeKind: 'handoff',
      source: EX1,
      target: EXT,
      relationId: HANDOFF_1,
      usedResultRef: A1,
      evidenceRefs: ['evidence:conversation-1', 'evidence:other'],
    });
    expect(handoffEdge?.structuralSource).toBeUndefined();
  });

  it('RuntimeExecution upstream is the exact reverse read: handoff source, then conversation; no reverse edges created', () => {
    const revision = buildRevision();
    const result = reach(revision, EXT, 'runtimeExecution', 'upstream');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.direction).toBe('upstream');
    expect(result.nodes.map((node) => [node.minimumDepth, node.id])).toEqual([
      [0, EXT],
      [1, EX1],
      [2, C1],
    ]);
    // Edges stay in their exact recorded direction even though traversal
    // read them in reverse.
    expect(result.edges.map((edge) => [edge.edgeKind, edge.source, edge.target])).toEqual([
      ['conversation-execution', C1, EX1],
      ['handoff', EX1, EXT],
    ]);
    expect(result.maximumHops).toBe(2);
  });

  it('Execution downstream reaches artifacts through the exact executionRef field; the conversation is not downstream', () => {
    const revision = buildRevision();
    const result = reach(revision, EX1, 'runtimeExecution', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    expect(result.nodes.map((node) => [node.minimumDepth, node.id])).toEqual([
      [0, EX1],
      [1, EXT],
      [1, A1],
      [2, A3],
    ]);
    // Edge direction is exact: a Conversation points at its execution, not
    // the other way around.
    expect(result.nodes.some((node) => node.id === C1)).toBe(false);
    expect(result.edges.some((edge) => edge.source === C1 && edge.target === EX1)).toBe(false);
  });

  it('Artifact upstream reaches its execution and the conversation', () => {
    const revision = buildRevision();
    const result = reach(revision, A1, 'artifactOrEvidence', 'upstream');
    if (!result.ok) throw new Error('expected ok');
    expect(result.nodes.map((node) => [node.minimumDepth, node.id])).toEqual([
      [0, A1],
      [1, EX1],
      [2, C1],
    ]);
  });

  it('Parallel relations do not participate in directional Reach and are never converted into edges', () => {
    const revision = buildRevision();
    const downstream = reach(revision, EX1, 'runtimeExecution', 'downstream');
    if (!downstream.ok) throw new Error('expected ok');
    expect(downstream.nodes.some((node) => node.id === EX2)).toBe(false);
    const upstream = reach(revision, EX1, 'runtimeExecution', 'upstream');
    if (!upstream.ok) throw new Error('expected ok');
    expect(upstream.nodes.map((node) => node.id)).toEqual([EX1, C1]);
    expect(upstream.edges.some((edge) => (edge.edgeKind as string) === 'parallel')).toBe(false);
  });

  it('a standalone artifact with no executionRef is part of the revision but reachable from nothing', () => {
    const revision = buildRevision();
    const result = reach(revision, AE, 'artifactOrEvidence', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    expect(result.nodes.map((node) => node.id)).toEqual([AE]);
    expect(result.edges).toEqual([]);
    expect(result.maximumHops).toBe(0);
  });

  it('edges between the same pair sort deterministically by stable relation identity', () => {
    const revision = buildRevision({
      relations: [
        handoff({ id: 'handoff:b-second' }),
        handoff({ id: 'handoff:a-first' }),
        parallelRel(),
      ],
    });
    const result = reach(revision, EX1, 'runtimeExecution', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    const handoffEdges = result.edges.filter((edge) => edge.edgeKind === 'handoff');
    expect(handoffEdges.map((edge) => edge.relationId)).toEqual(['handoff:a-first', 'handoff:b-second']);
    expect(handoffEdges.map((edge) => edge.stableEdgeKey)).toEqual(
      [...handoffEdges.map((edge) => edge.stableEdgeKey)].sort(),
    );
  });
});

// ===== fail closed =====

describe('Projection Reach v0 · fails closed', () => {
  it('unknown entity id: reach/entity-not-found', () => {
    const revision = buildRevision();
    const result = reach(revision, 'conversation:not-there', 'conversation', 'downstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/entity-not-found' });
  });

  it('EvidenceRef as origin: reach/unsupported-entity (provenance-only, never topology)', () => {
    const revision = buildRevision();
    const result = computeProjectionReach(revision, { kind: 'evidence', id: 'evidence:conversation-1' }, 'downstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/unsupported-entity' });
    if (result.ok) return;
    expect(result.evidence).toMatchObject({ navigableKinds: ['conversation', 'runtimeExecution', 'artifactOrEvidence'] });
  });

  it('collaborationRelation as origin: reach/unsupported-entity (relations are edges, not nodes)', () => {
    const revision = buildRevision();
    const result = computeProjectionReach(revision, { kind: 'collaborationRelation', id: HANDOFF_1 }, 'upstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/unsupported-entity' });
  });

  it('a revision with a broken schemaVersion: reach/invalid-revision', () => {
    const revision = buildRevision();
    const forged = { ...revision, schemaVersion: 1 } as unknown as VerifiedProjectionRevisionV0;
    const result = reach(forged, C1, 'conversation', 'downstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/invalid-revision' });
  });

  it('a tampered envelope: reach/invalid-revision', () => {
    const revision = buildRevision();
    const forged = { ...revision, semanticHash: '0'.repeat(64) };
    const result = reach(forged, C1, 'conversation', 'downstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/invalid-revision' });
  });

  it('a hidden candidate field with a recomputed envelope still fails closed through Foundation', () => {
    const revision = buildRevision();
    const candidate = JSON.parse(JSON.stringify(revision.candidate)) as ProjectionCandidateV0;
    // Smuggle a hidden field into an entity; recompute every envelope hash
    // so only Foundation's strict structural validation can catch it.
    (candidate.semanticFacts.conversations[0] as unknown as Record<string, unknown>).smuggled = 'inferred';
    const semanticHash = computeProjectionSemanticHash(candidate);
    const layoutHash = computeProjectionLayoutHash(candidate);
    const revisionHash = computeProjectionRevisionHash({
      scope: candidate.scope,
      sourceDigest: candidate.sourceBinding.sourceDigest,
      semanticHash,
      layoutHash,
    });
    const forged: VerifiedProjectionRevisionV0 = {
      ...revision,
      candidate,
      semanticHash,
      layoutHash,
      revisionHash,
      revisionId: `projection:${revisionHash}`,
    };
    const result = reach(forged, C1, 'conversation', 'downstream');
    expect(result).toMatchObject({ ok: false, code: 'reach/invalid-revision' });
  });
});

// ===== determinism, layout, provenance =====

describe('Projection Reach v0 · determinism and non-coupling', () => {
  it('two calls with the same inputs deep-equal each other', () => {
    const revision = buildRevision();
    const first = reach(revision, C1, 'conversation', 'downstream');
    const second = reach(revision, C1, 'conversation', 'downstream');
    expect(first).toEqual(second);
  });

  it('does not consult the system clock anywhere in the call graph', () => {
    const revision = buildRevision();
    const realDate = globalThis.Date;
    let clockTouches = 0;
    class ThrowDate {
      constructor(..._args: unknown[]) {
        clockTouches += 1;
        throw new Error('Projection Reach must not call the Date constructor');
      }
      static now(): number {
        clockTouches += 1;
        throw new Error('Projection Reach must not call Date.now()');
      }
    }
    (globalThis as unknown as { Date: unknown }).Date = ThrowDate;
    try {
      const result = reach(revision, C1, 'conversation', 'downstream');
      expect(clockTouches).toBe(0);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('computedAt' in result).toBe(false);
      expect('checkedAt' in result).toBe(false);
    } finally {
      (globalThis as unknown as { Date: unknown }).Date = realDate;
    }
  });

  it('a layout-only change (Canvas positions) does not affect Reach topology', () => {
    const base = buildRevision();
    const moved = buildRevision({
      layoutState: layout({
        [C1]: { x: 900, y: 900 },
        [EX1]: { x: -50, y: 20 },
      }),
    });
    expect(moved.revisionHash).not.toBe(base.revisionHash);
    const baseReach = reach(base, C1, 'conversation', 'downstream');
    const movedReach = reach(moved, C1, 'conversation', 'downstream');
    if (!baseReach.ok || !movedReach.ok) throw new Error('expected ok');
    expect(movedReach.nodes).toEqual(baseReach.nodes);
    expect(movedReach.edges).toEqual(baseReach.edges);
    expect(movedReach.minimumDepthByNode).toEqual(baseReach.minimumDepthByNode);
    expect(movedReach.maximumHops).toBe(baseReach.maximumHops);
  });

  it('Canvas geometry adjacency between unrelated entities never produces an edge', () => {
    const revision = buildRevision({
      // Position the standalone artifact next to the conversation; only the
      // exact structural fields can create edges.
      layoutState: layout({ [C1]: { x: 10, y: 10 }, [AE]: { x: 12, y: 12 } }),
    });
    const result = reach(revision, C1, 'conversation', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    expect(result.nodes.some((node) => node.id === AE)).toBe(false);
    expect(result.edges.some((edge) => edge.source === C1 && edge.target === AE)).toBe(false);
  });

  it('an evidence-only change does not change the Reach topology', () => {
    const base = buildRevision();
    const changed = buildRevision({
      evidence: [
        { ...baseEvidence(), currentness: 'STALE' },
        secondEvidence(),
      ],
    });
    expect(changed.revisionHash).not.toBe(base.revisionHash);
    const baseReach = reach(base, C1, 'conversation', 'downstream');
    const changedReach = reach(changed, C1, 'conversation', 'downstream');
    if (!baseReach.ok || !changedReach.ok) throw new Error('expected ok');
    expect(changedReach.nodes).toEqual(baseReach.nodes);
    expect(changedReach.edges).toEqual(baseReach.edges);
    expect(changedReach.maximumHops).toBe(baseReach.maximumHops);
  });

  it('every node and edge id comes verbatim from the verified revision (no raw Snapshot / Activity coupling)', () => {
    const revision = buildRevision();
    const result = reach(revision, C1, 'conversation', 'downstream');
    if (!result.ok) throw new Error('expected ok');
    const facts = revision.candidate.semanticFacts;
    const knownIds = new Set([
      ...facts.conversations.map((item) => item.id),
      ...facts.runtimeExecutions.map((item) => item.id),
      ...facts.artifactsOrEvidence.map((item) => item.id),
    ]);
    for (const node of result.nodes) {
      expect(knownIds.has(node.id)).toBe(true);
    }
    for (const edge of result.edges) {
      expect(knownIds.has(edge.source)).toBe(true);
      expect(knownIds.has(edge.target)).toBe(true);
      if (edge.edgeKind === 'handoff') {
        expect(facts.collaborationRelations.some((relation) => relation.id === edge.relationId)).toBe(true);
      }
    }
  });
});
