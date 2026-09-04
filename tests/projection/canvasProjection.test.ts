import { describe, expect, it } from 'vitest';
import {
  projectionStateToCanvas,
  projectionToCanvasGraph,
} from '../../src/core/projection/canvasProjection';
import { emptyProjectionBuildState, verifyProjectionCandidate } from '../../src/core/projection/revision';
import type {
  ProjectionCandidateV0,
  VerifiedProjectionRevisionV0,
} from '../../src/core/projection/types';

const digest = 'a'.repeat(64);

function candidate(): ProjectionCandidateV0 {
  const evidence = {
    id: 'evidence:verified',
    source: 'protocol' as const,
    sourceRef: 'protocol:fixture',
    observedAt: '2026-09-04T00:00:00.000Z',
    verification: 'VERIFIED' as const,
    currentness: 'CURRENT' as const,
    revision: { kind: 'activity-event' as const, value: 'event-1' },
  };
  return {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest: digest },
    semanticFacts: {
      conversations: [{
        id: 'conversation:conversation-1',
        conversationKey: 'conversation-1',
        projectId: 'project-1',
        role: 'builder',
        platform: 'codex',
        lifecycleState: 'ACTIVE',
        taskState: 'active',
        runtimeState: 'working',
        attentionState: 'none',
        verification: 'VERIFIED',
        evidenceRefs: [evidence.id],
      }],
      runtimeExecutions: [
        {
          id: 'execution:codex::execution:intent-source',
          executionId: 'codex::execution:intent-source',
          nativeRef: 'thread-source',
          harness: 'codex',
          projectId: 'project-1',
          conversationRef: 'conversation:conversation-1',
          binding: null,
          runtimeState: 'idle',
          live: false,
          startedAt: null,
          endedAt: null,
          intentId: 'intent-source',
          intentState: 'accepted',
          receipt: null,
          evidenceRefs: [evidence.id],
        },
        {
          id: 'execution:claude::execution:intent-target',
          executionId: 'claude::execution:intent-target',
          nativeRef: 'session-target',
          harness: 'claude',
          projectId: 'project-1',
          conversationRef: 'conversation:conversation-1',
          binding: null,
          runtimeState: 'working',
          live: true,
          startedAt: null,
          endedAt: null,
          intentId: 'intent-target',
          intentState: 'accepted',
          receipt: null,
          evidenceRefs: [evidence.id],
        },
      ],
      collaborationRelations: [
        {
          id: 'parallel:group-1',
          kind: 'parallel',
          groupId: 'group-1',
          executionRefs: [
            'execution:codex::execution:intent-source',
            'execution:claude::execution:intent-target',
          ],
          evidenceRefs: [evidence.id],
        },
        {
          id: 'handoff:source->target',
          kind: 'handoff',
          sourceExecutionRef: 'execution:codex::execution:intent-source',
          targetExecutionRef: 'execution:claude::execution:intent-target',
          usedResultRef: 'harness-result:codex::execution:intent-source:result',
          evidenceRefs: [evidence.id],
        },
      ],
      artifactsOrEvidence: [
        {
          id: 'governance:project:project-1',
          kind: 'governance-record',
          projectId: 'project-1',
          title: 'Project One',
          evidenceRefs: [evidence.id],
        },
        {
          id: 'harness-result:codex::execution:intent-source:result',
          kind: 'agent-result',
          projectId: 'project-1',
          executionRef: 'execution:codex::execution:intent-source',
          eventRef: 'result',
          title: 'Source result',
          content: 'Exact result',
          evidenceRefs: [evidence.id],
        },
        {
          id: 'memory:index:project-1',
          kind: 'memory-index',
          projectId: 'project-1',
          title: 'Memory Vault (3)',
          evidenceRefs: [evidence.id],
        },
      ],
      evidenceRefs: [evidence],
    },
    layoutState: {
      schemaVersion: 0,
      nodePositions: {
        'project:project-1': { x: 10, y: 20 },
        'conversation:conversation-1': { x: 30, y: 40 },
        'execution:codex::execution:intent-source': { x: 50, y: 60 },
        'execution:claude::execution:intent-target': { x: 70, y: 80 },
        'memory:index:project-1': { x: 90, y: 100 },
      },
    },
  };
}

function verified(): VerifiedProjectionRevisionV0 {
  const state = verifyProjectionCandidate(candidate(), null, {
    recheckSourceDigest: () => digest,
    now: () => '2026-09-04T01:00:00.000Z',
  });
  if (!state.current) throw new Error('fixture must verify');
  return state.current;
}

// Compile-time contract: Canvas's adapter cannot accept raw candidates.
function typeContract(raw: ProjectionCandidateV0): void {
  // @ts-expect-error ProjectionCandidateV0 is not a verified revision.
  projectionToCanvasGraph(raw);
}
void typeContract;

describe('verified projection to Canvas adapter', () => {
  it('maps only a verified revision to existing Canvas nodes and explicit edges', () => {
    const graph = projectionToCanvasGraph(verified());
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:project-1', label: 'Project One', x: 10, y: 20 }),
      expect.objectContaining({ id: 'conversation:conversation-1', kind: 'conversation', x: 30, y: 40 }),
      expect.objectContaining({ id: 'execution:codex::execution:intent-source', kind: 'execution', x: 50, y: 60 }),
      expect.objectContaining({ id: 'execution:claude::execution:intent-target', kind: 'execution', x: 70, y: 80 }),
      expect.objectContaining({ id: 'memory:vault', kind: 'memory', label: 'Memory Vault (3)', x: 90, y: 100 }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'member:project-1->conversation-1',
        source: 'project:project-1',
        target: 'conversation:conversation-1',
        kind: 'membership',
      }),
      expect.objectContaining({
        source: 'conversation:conversation-1',
        target: 'execution:codex::execution:intent-source',
        kind: 'execution',
      }),
      expect.objectContaining({
        id: 'handoff:source->target',
        source: 'execution:codex::execution:intent-source',
        target: 'execution:claude::execution:intent-target',
        kind: 'handoff',
      }),
    ]));
    expect(graph.edges.some((edge) => edge.id === 'parallel:group-1')).toBe(false);
  });

  it('does not let layout changes alter Canvas lineage', () => {
    const first = verified();
    const moved = structuredClone(first);
    moved.candidate.layoutState.nodePositions['execution:codex::execution:intent-source'] = { x: 900, y: 800 };
    const before = projectionToCanvasGraph(first);
    const after = projectionToCanvasGraph(moved);
    expect(after.edges).toEqual(before.edges);
    expect(after.nodes.find((node) => node.id === 'execution:codex::execution:intent-source'))
      .toMatchObject({ x: 900, y: 800 });
  });

  it('returns no graph when there is no last-known-good revision', () => {
    const state = emptyProjectionBuildState();
    const canvas = projectionStateToCanvas(state);
    expect(canvas).toEqual({
      status: 'NEEDS_FIX',
      revisionId: null,
      graph: null,
      diagnostics: [],
    });
  });
});
