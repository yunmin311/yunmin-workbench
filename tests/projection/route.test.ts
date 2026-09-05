import { describe, expect, it } from 'vitest';
import { computeProjectionRoute } from '../../src/core/projection/route';
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
const A2 = 'harness-result:codex::execution:intent-2:result';
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
    evidenceRefs: [baseEvidence().id],
    ...overrides,
  } as CollaborationRelationProjectionV0;
}

function buildRevision(overrides: {
  executions?: RuntimeExecutionProjectionV0[];
  relations?: CollaborationRelationProjectionV0[];
  layoutState?: LayoutStateV0;
} = {}): VerifiedProjectionRevisionV0 {
  const candidateInput: ProjectionCandidateV0 = {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest: SOURCE_DIGEST },
    semanticFacts: {
      conversations: [conversation()],
      runtimeExecutions: overrides.executions ?? [
        execution({ executionId: 'codex::execution:intent-1' }),
        execution({ executionId: 'codex::execution:intent-2' }),
        execution({ executionId: 'claude::execution:intent-3', harness: 'claude', conversationRef: null }),
      ],
      collaborationRelations: overrides.relations ?? [handoff({ id: HANDOFF_1 })],
      artifactsOrEvidence: [
        artifact({ id: A1, executionRef: EX1 }),
        artifact({ id: A2, executionRef: EX2 }),
        artifact({ id: A3, executionRef: EXT }),
      ].map((item) => ({ ...item, projectId: 'project-1' })),
      evidenceRefs: [baseEvidence()],
    },
    layoutState: overrides.layoutState ?? { schemaVersion: 0, nodePositions: {} },
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

function route(revision: VerifiedProjectionRevisionV0, from: { kind: 'conversation' | 'runtimeExecution' | 'artifactOrEvidence'; id: string }, to: { kind: 'conversation' | 'runtimeExecution' | 'artifactOrEvidence'; id: string }) {
  return computeProjectionRoute(revision, from, to);
}

describe('Projection Route v0 · pure core (shortest exact path)', () => {
  it('multi-hop shortest route Conversation -> Execution -> Handoff target -> Artifact with exact step provenance', () => {
    const revision = buildRevision();
    const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      schemaVersion: 0,
      projectId: 'project-1',
      revisionId: revision.revisionId,
      from: { kind: 'conversation', id: C1 },
      to: { kind: 'artifactOrEvidence', id: A3 },
      found: true,
      hops: 3,
    });
    expect(result.steps.map((step) => [step.from, step.to, step.edge.edgeKind])).toEqual([
      [C1, EX1, 'conversation-execution'],
      [EX1, EXT, 'handoff'],
      [EXT, A3, 'execution-artifact'],
    ]);
    // Structural steps point at the exact entity + field path.
    expect(result.steps[0]?.edge.structuralSource).toEqual({ entityId: EX1, fieldPath: 'conversationRef' });
    expect(result.steps[2]?.edge.structuralSource).toEqual({ entityId: A3, fieldPath: 'executionRef' });
    // The handoff step carries the exact relation identity.
    expect(result.steps[1]?.edge).toMatchObject({
      relationId: HANDOFF_1,
      usedResultRef: A1,
      evidenceRefs: ['evidence:conversation-1'],
    });
    expect(result.steps).toHaveLength(result.hops ?? -1);
  });

  it('the route equals the Reach topology: every step edge exists in the origin downstream Reach', () => {
    const revision = buildRevision();
    const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    const downstream = computeProjectionReach(revision, { kind: 'conversation', id: C1 }, 'downstream');
    if (!result.ok || !downstream.ok) throw new Error('expected ok');
    const reachKeys = new Set(downstream.edges.map((edge) => edge.stableEdgeKey));
    for (const step of result.steps) {
      expect(reachKeys.has(step.edge.stableEdgeKey)).toBe(true);
    }
  });

  it('equal-hop paths tie-break on the lexicographically smallest stable edge key sequence, not "more plausible" ones', () => {
    // Two equal-length paths C1 -> EX? -> EXT. The handoff from EX2 carries
    // the lexically smaller relation id, but the first edge C1 -> EX1 has
    // the lexically smaller stable key, so the path via EX1 must win.
    const revision = buildRevision({
      relations: [
        handoff({ id: 'handoff:zzz-from-ex1' }),
        handoff({ id: 'handoff:aaa-from-ex2', sourceExecutionRef: EX2, usedResultRef: A2 }),
      ],
    });
    const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'runtimeExecution', id: EXT });
    if (!result.ok) throw new Error('expected ok');
    expect(result.found).toBe(true);
    expect(result.hops).toBe(2);
    expect(result.steps.map((step) => step.from)).toEqual([C1, EX1]);
    expect(result.steps[1]?.edge.relationId).toBe('handoff:zzz-from-ex1');
  });

  it('unreachable is a normal answer: found:false, hops:null, steps:[]', () => {
    const revision = buildRevision();
    // Edges point conversation -> execution -> artifact; the reverse
    // direction has no directed path.
    const result = route(revision, { kind: 'artifactOrEvidence', id: A1 }, { kind: 'conversation', id: C1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.found).toBe(false);
    expect(result.hops).toBeNull();
    expect(result.steps).toEqual([]);
  });

  it('from === to answers found:true with zero hops and zero steps', () => {
    const revision = buildRevision();
    const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'conversation', id: C1 });
    if (!result.ok) throw new Error('expected ok');
    expect(result.found).toBe(true);
    expect(result.hops).toBe(0);
    expect(result.steps).toEqual([]);
  });

  it('a layout-only change does not change the shortest route', () => {
    const base = buildRevision();
    const moved = buildRevision({
      layoutState: { schemaVersion: 0, nodePositions: { [C1]: { x: 400, y: -20 } } },
    });
    const baseRoute = route(base, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    const movedRoute = route(moved, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    if (!baseRoute.ok || !movedRoute.ok) throw new Error('expected ok');
    expect(movedRoute.steps).toEqual(baseRoute.steps);
    expect(movedRoute.hops).toBe(baseRoute.hops);
    expect(movedRoute.found).toBe(baseRoute.found);
  });
});

// ===== fail closed =====

describe('Projection Route v0 · fails closed', () => {
  it('unknown from entity: route/entity-not-found', () => {
    const revision = buildRevision();
    const result = route(revision, { kind: 'conversation', id: 'conversation:missing' }, { kind: 'conversation', id: C1 });
    expect(result).toMatchObject({ ok: false, code: 'route/entity-not-found' });
  });

  it('unknown to entity: route/entity-not-found', () => {
    const revision = buildRevision();
    const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: 'artifact:missing' });
    expect(result).toMatchObject({ ok: false, code: 'route/entity-not-found' });
  });

  it('EvidenceRef as endpoint: route/unsupported-entity', () => {
    const revision = buildRevision();
    const result = computeProjectionRoute(
      revision,
      { kind: 'conversation', id: C1 },
      { kind: 'evidence', id: 'evidence:conversation-1' },
    );
    expect(result).toMatchObject({ ok: false, code: 'route/unsupported-entity' });
  });

  it('invalid revision envelope: route/invalid-revision', () => {
    const revision = buildRevision();
    const forged = { ...revision, revisionHash: '0'.repeat(64) };
    const result = route(forged, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    expect(result).toMatchObject({ ok: false, code: 'route/invalid-revision' });
  });

  it('a hidden candidate field with a recomputed envelope still fails closed through Foundation', () => {
    const revision = buildRevision();
    const candidate = JSON.parse(JSON.stringify(revision.candidate)) as ProjectionCandidateV0;
    (candidate.semanticFacts.runtimeExecutions[0] as unknown as Record<string, unknown>).smuggled = true;
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
    const result = route(forged, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    expect(result).toMatchObject({ ok: false, code: 'route/invalid-revision' });
  });
});

// ===== determinism =====

describe('Projection Route v0 · pure (no clock, no hidden state)', () => {
  it('two calls with the same inputs deep-equal each other', () => {
    const revision = buildRevision();
    const first = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    const second = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
    expect(first).toEqual(second);
  });

  it('does not consult the system clock anywhere in the call graph', () => {
    const revision = buildRevision();
    const realDate = globalThis.Date;
    let clockTouches = 0;
    class ThrowDate {
      constructor(..._args: unknown[]) {
        clockTouches += 1;
        throw new Error('Projection Route must not call the Date constructor');
      }
      static now(): number {
        clockTouches += 1;
        throw new Error('Projection Route must not call Date.now()');
      }
    }
    (globalThis as unknown as { Date: unknown }).Date = ThrowDate;
    try {
      const result = route(revision, { kind: 'conversation', id: C1 }, { kind: 'artifactOrEvidence', id: A3 });
      expect(clockTouches).toBe(0);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('computedAt' in result).toBe(false);
    } finally {
      (globalThis as unknown as { Date: unknown }).Date = realDate;
    }
  });
});
