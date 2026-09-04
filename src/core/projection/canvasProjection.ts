import type { TrustLevel, WbEdge, WbNode } from '../types';
import type {
  EvidenceRefV0,
  ProjectionBuildStateV0,
  ProjectionDiagnosticV0,
  VerifiedProjectionRevisionV0,
} from './types';

function trustForEvidence(
  refs: readonly string[],
  evidenceById: ReadonlyMap<string, EvidenceRefV0>,
  fallback: TrustLevel,
): TrustLevel {
  if (refs.some((ref) => evidenceById.get(ref)?.verification === 'VERIFIED')) return 'VERIFIED';
  if (refs.some((ref) => evidenceById.has(ref))) return 'REGISTERED';
  return fallback;
}

/**
 * Read-only display adapter. Its input type intentionally excludes Snapshot,
 * Activity, and ProjectionCandidate: Canvas may consume only a verified
 * revision and cannot rebuild or repair semantic facts.
 */
export function projectionToCanvasGraph(
  revision: VerifiedProjectionRevisionV0,
): { nodes: WbNode[]; edges: WbEdge[] } {
  const { candidate } = revision;
  const { semanticFacts, layoutState } = candidate;
  const evidenceById = new Map(semanticFacts.evidenceRefs.map((item) => [item.id, item]));
  const position = (id: string): { x: number; y: number } => layoutState.nodePositions[id] ?? { x: 0, y: 0 };
  const nodes: WbNode[] = [];
  const edges: WbEdge[] = [];

  const governance = semanticFacts.artifactsOrEvidence.find((item) => item.kind === 'governance-record');
  nodes.push({
    id: `project:${candidate.scope.projectId}`,
    kind: 'project',
    label: governance?.title ?? candidate.scope.projectId,
    trust: governance
      ? trustForEvidence(governance.evidenceRefs, evidenceById, 'DISCOVERED')
      : 'DISCOVERED',
    ...position(`project:${candidate.scope.projectId}`),
  });

  for (const conversation of semanticFacts.conversations) {
    nodes.push({
      id: conversation.id,
      kind: 'conversation',
      label: conversation.role,
      status: conversation.lifecycleState,
      trust: conversation.verification === 'VERIFIED' ? 'VERIFIED' : 'REGISTERED',
      ...position(conversation.id),
    });
    edges.push({
      id: `member:${candidate.scope.projectId}->${conversation.conversationKey}`,
      source: `project:${candidate.scope.projectId}`,
      target: conversation.id,
      kind: 'membership',
    });
  }

  for (const execution of semanticFacts.runtimeExecutions) {
    nodes.push({
      id: execution.id,
      kind: 'execution',
      label: `${execution.harness} · ${execution.runtimeState}`,
      trust: trustForEvidence(execution.evidenceRefs, evidenceById, 'DISCOVERED'),
      ...position(execution.id),
    });
    if (execution.conversationRef) {
      edges.push({
        id: `execution:${execution.conversationRef}->${execution.id}`,
        source: execution.conversationRef,
        target: execution.id,
        kind: 'execution',
      });
    }
  }

  for (const relation of semanticFacts.collaborationRelations) {
    if (relation.kind !== 'handoff') continue;
    edges.push({
      id: relation.id,
      source: relation.sourceExecutionRef,
      target: relation.targetExecutionRef,
      kind: 'handoff',
    });
  }

  const memory = semanticFacts.artifactsOrEvidence.find((item) => item.kind === 'memory-index');
  if (memory) {
    nodes.push({
      id: 'memory:vault',
      kind: 'memory',
      label: memory.title,
      trust: trustForEvidence(memory.evidenceRefs, evidenceById, 'REGISTERED'),
      ...position(memory.id),
    });
    edges.push({
      id: `mount:memory->${candidate.scope.projectId}`,
      source: 'memory:vault',
      target: `project:${candidate.scope.projectId}`,
      kind: 'mount',
    });
  }

  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export interface ProjectionCanvasStateV0 {
  status: ProjectionBuildStateV0['status'];
  revisionId: string | null;
  graph: { nodes: WbNode[]; edges: WbEdge[] } | null;
  diagnostics: ProjectionDiagnosticV0[];
}

/** A missing last-good remains visibly empty; raw facts are never a fallback. */
export function projectionStateToCanvas(state: ProjectionBuildStateV0): ProjectionCanvasStateV0 {
  return {
    status: state.status,
    revisionId: state.current?.revisionId ?? null,
    graph: state.current ? projectionToCanvasGraph(state.current) : null,
    diagnostics: state.diagnostics,
  };
}
