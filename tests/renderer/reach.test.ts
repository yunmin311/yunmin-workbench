import { beforeAll, describe, expect, it } from 'vitest';
import {
  deriveProjectionReachState,
  deriveProjectionRouteState,
  deriveSemanticPassportState,
  useWorkbench,
} from '../../src/renderer/src/store';
import {
  emptyProjectionBuildState,
  verifyProjectionCandidate,
} from '../../src/core/projection/revision';
import type {
  ProjectionBuildStateV0,
  ProjectionCandidateV0,
  SemanticPassportEntityRefV0,
  VerifiedProjectionRevisionV0,
} from '../../src/core/projection/types';

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { wb: {} },
  });
});

const NOW = '2026-09-05T02:00:00.000Z';

const C1 = 'conversation:conversation-1';
const EX1 = 'execution:codex::execution:intent-1';
const A1 = 'harness-result:codex::execution:intent-1:result';

function verifiedRevision(): VerifiedProjectionRevisionV0 {
  const evidence = {
    id: 'evidence:conversation-1',
    source: 'canonical-file' as const,
    sourceRef: 'dialogues/project-1.yaml',
    observedAt: '2026-09-05T00:00:00.000Z',
    verification: 'VERIFIED' as const,
    currentness: 'CURRENT' as const,
  };
  const candidate: ProjectionCandidateV0 = {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest: 'a'.repeat(64) },
    semanticFacts: {
      conversations: [{
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
        evidenceRefs: [evidence.id],
      }],
      runtimeExecutions: [{
        id: EX1,
        executionId: 'codex::execution:intent-1',
        nativeRef: 'thread-1',
        harness: 'codex',
        projectId: 'project-1',
        conversationRef: C1,
        binding: null,
        runtimeState: 'idle',
        live: false,
        startedAt: null,
        endedAt: null,
        intentId: 'intent-1',
        intentState: 'accepted',
        receipt: null,
        evidenceRefs: [evidence.id],
      }],
      collaborationRelations: [],
      artifactsOrEvidence: [{
        id: A1,
        kind: 'agent-result',
        projectId: 'project-1',
        executionRef: EX1,
        title: 'Result',
        evidenceRefs: [evidence.id],
      }],
      evidenceRefs: [evidence],
    },
    layoutState: { schemaVersion: 0, nodePositions: {} },
  };
  const state = verifyProjectionCandidate(candidate, null, {
    recheckSourceDigest: () => candidate.sourceBinding.sourceDigest,
    now: () => NOW,
  });
  if (!state.current) throw new Error('fixture must verify');
  return state.current;
}

function verifiedState(current: VerifiedProjectionRevisionV0): ProjectionBuildStateV0 {
  return { ...emptyProjectionBuildState(), status: 'VERIFIED', current, diagnostics: [] };
}

function staleState(current: VerifiedProjectionRevisionV0): ProjectionBuildStateV0 {
  return {
    ...emptyProjectionBuildState(),
    status: 'STALE',
    current,
    diagnostics: [{
      code: 'projection/input-changed',
      severity: 'error',
      message: 'Projection source facts changed while the candidate was being verified.',
      subject: {},
      evidence: {},
      supportedFixes: ['compile a fresh candidate from the latest source facts'],
    }],
  };
}

describe('renderer Projection Reach v0 · seam', () => {
  it('openReach/closeReach round-trips the seam without mutating projection', () => {
    useWorkbench.getState().enterDemo();
    const ref: SemanticPassportEntityRefV0 = { kind: 'conversation', id: C1 };
    useWorkbench.getState().openReach(ref, 'downstream');
    expect(useWorkbench.getState().reachOpen).toEqual({ entityRef: ref, direction: 'downstream' });
    useWorkbench.getState().closeReach();
    expect(useWorkbench.getState().reachOpen).toBeNull();
  });

  it('Project switch clears the open reach and route seams', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().openReach({ kind: 'conversation', id: C1 }, 'upstream');
    useWorkbench.getState().openRoute(
      { kind: 'conversation', id: C1 },
      { kind: 'artifactOrEvidence', id: A1 },
    );
    expect(useWorkbench.getState().reachOpen).not.toBeNull();
    expect(useWorkbench.getState().routeOpen).not.toBeNull();
    useWorkbench.getState().selectProject('governance');
    expect(useWorkbench.getState().reachOpen).toBeNull();
    expect(useWorkbench.getState().routeOpen).toBeNull();
  });

  it('VERIFIED current: deriveProjectionReachState computes the reach from the seam inputs', () => {
    const verified = verifiedRevision();
    const result = deriveProjectionReachState({
      reachOpen: { entityRef: { kind: 'conversation', id: C1 }, direction: 'downstream' },
      projection: verifiedState(verified),
    });
    expect(result.kind).toBe('reach');
    if (result.kind !== 'reach') return;
    expect(result.reach.nodes.map((node) => [node.minimumDepth, node.id])).toEqual([
      [0, C1],
      [1, EX1],
      [2, A1],
    ]);
    expect(result.reach.maximumHops).toBe(2);
  });

  it('STALE current with retained last-known-good: deriveProjectionReachState refuses Reach', () => {
    // Same gate as the Passport: the retained last-known-good is displayed
    // elsewhere, but it is never promoted into fresh Reach truth.
    const retained = verifiedRevision();
    const result = deriveProjectionReachState({
      reachOpen: { entityRef: { kind: 'conversation', id: C1 }, direction: 'downstream' },
      projection: staleState(retained),
    });
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toBe('no-verified-revision');
  });

  it('closed seam returns kind closed; unknown entity surfaces the failure code', () => {
    const verified = verifiedRevision();
    const closed = deriveProjectionReachState({
      reachOpen: null,
      projection: verifiedState(verified),
    });
    expect(closed.kind).toBe('closed');

    const missing = deriveProjectionReachState({
      reachOpen: { entityRef: { kind: 'conversation', id: 'conversation:missing' }, direction: 'downstream' },
      projection: verifiedState(verified),
    });
    expect(missing.kind).toBe('failure');
    if (missing.kind !== 'failure') return;
    expect(missing.failure.code).toBe('reach/entity-not-found');
  });
});

describe('renderer Projection Route v0 · seam', () => {
  it('VERIFIED current: deriveProjectionRouteState computes the shortest route', () => {
    const verified = verifiedRevision();
    const result = deriveProjectionRouteState({
      routeOpen: {
        from: { kind: 'conversation', id: C1 },
        to: { kind: 'artifactOrEvidence', id: A1 },
      },
      projection: verifiedState(verified),
    });
    expect(result.kind).toBe('route');
    if (result.kind !== 'route') return;
    expect(result.route.found).toBe(true);
    expect(result.route.hops).toBe(2);
    expect(result.route.steps.map((step) => step.edge.edgeKind)).toEqual([
      'conversation-execution',
      'execution-artifact',
    ]);
  });

  it('STALE current: deriveProjectionRouteState refuses Route', () => {
    const retained = verifiedRevision();
    const result = deriveProjectionRouteState({
      routeOpen: {
        from: { kind: 'conversation', id: C1 },
        to: { kind: 'artifactOrEvidence', id: A1 },
      },
      projection: staleState(retained),
    });
    expect(result.kind).toBe('unavailable');
  });

  it('openRoute leaves an open Reach surface untouched; closeRoute returns to it', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().openReach({ kind: 'conversation', id: C1 }, 'downstream');
    useWorkbench.getState().openRoute(
      { kind: 'conversation', id: C1 },
      { kind: 'runtimeExecution', id: EX1 },
    );
    expect(useWorkbench.getState().reachOpen).not.toBeNull();
    expect(useWorkbench.getState().routeOpen).not.toBeNull();
    useWorkbench.getState().closeRoute();
    expect(useWorkbench.getState().reachOpen).not.toBeNull();
    expect(useWorkbench.getState().routeOpen).toBeNull();
  });
});

describe('Reach node clicks reuse the existing Semantic Passport', () => {
  it('the reach source opens a Passport through the same seam with source "reach"', () => {
    const verified = verifiedRevision();
    useWorkbench.setState({
      projection: verifiedState(verified),
      projectionPrevious: null,
      passportOpen: null,
    });
    // The Reach surface's node buttons call openPassport(ref, 'reach'); the
    // derivation must still produce a Passport (delta optional for this
    // source) exactly as it does for the canvas source.
    useWorkbench.getState().openPassport({ kind: 'runtimeExecution', id: EX1 }, 'reach');
    expect(useWorkbench.getState().passportOpen).toEqual({
      entityRef: { kind: 'runtimeExecution', id: EX1 },
      source: 'reach',
    });
    const state = deriveSemanticPassportState({
      passportOpen: useWorkbench.getState().passportOpen,
      projection: verifiedState(verified),
      previous: null,
    });
    expect(state.kind).toBe('passport');
    if (state.kind !== 'passport') return;
    expect(state.passport.entityType).toBe('runtimeExecution');
  });
});
