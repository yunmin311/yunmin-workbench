/**
 * Work Graph schema validation (PHASE 3A).
 *
 * Pure validators for WorkGraphCandidate. No I/O, no layout, no UI.
 * Reuses the trust posture of src/core/projection/schema.ts:
 * bad candidates never replace last-good; problems are diagnostics.
 */

import {
  expectedSourceKind,
  expectedTargetKind,
  getNodeId,
  getNodeKind,
  type WorkGraphEdge,
  type WorkGraphNode,
  type WorkGraphNodeId,
} from './types';
import type {
  WorkGraphCandidate,
  WorkGraphCandidateValidation,
  WorkGraphDiagnostic,
} from './revision';

function diag(
  code: string,
  message: string,
  subject: Record<string, unknown>,
): WorkGraphDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    subject,
    evidence: {},
    supportedFixes: [],
  };
}

const NODE_IDS = new Set([
  'project',
  'work',
  'conversation',
  'execution',
  'context',
  'memory-source',
  'artifact',
  'gate',
  'handoff',
]);

function validateNodes(
  nodes: WorkGraphNode[],
  diagnostics: WorkGraphDiagnostic[],
): Map<WorkGraphNodeId, WorkGraphNode> {
  const byId = new Map<WorkGraphNodeId, WorkGraphNode>();
  for (const node of nodes) {
    if (!NODE_IDS.has(node.kind)) {
      diagnostics.push(
        diag('workgraph/unknown-node-kind', `Unknown node kind "${(node as { kind: string }).kind}"`, {
          nodeId: (node as { id: string }).id,
        }),
      );
      continue;
    }
    const id = getNodeId(node);
    if (!id || typeof id !== 'string') {
      diagnostics.push(diag('workgraph/node-missing-id', 'Node id is missing or empty', { node }));
      continue;
    }
    if (byId.has(id)) {
      diagnostics.push(diag('workgraph/duplicate-node-id', `Duplicate node id "${id}"`, { nodeId: id }));
      continue;
    }
    if (!node.projectId || typeof node.projectId !== 'string') {
      diagnostics.push(diag('workgraph/node-missing-project', `Node "${id}" has no projectId`, { nodeId: id }));
      continue;
    }
    if (!node.sourceRef || typeof node.sourceRef !== 'string') {
      diagnostics.push(
        diag('workgraph/node-missing-sourceref', `Node "${id}" has no sourceRef; identity is unverifiable`, {
          nodeId: id,
        }),
      );
      continue;
    }
    byId.set(id, node);
  }
  return byId;
}

function validateEdges(
  edges: WorkGraphEdge[],
  byId: Map<WorkGraphNodeId, WorkGraphNode>,
  diagnostics: WorkGraphDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edge.id || typeof edge.id !== 'string') {
      diagnostics.push(diag('workgraph/edge-missing-id', 'Edge id is missing or empty', { edge }));
      continue;
    }
    if (seen.has(edge.id)) {
      diagnostics.push(diag('workgraph/duplicate-edge-id', `Duplicate edge id "${edge.id}"`, { edgeId: edge.id }));
      continue;
    }
    seen.add(edge.id);
    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode) {
      diagnostics.push(
        diag('workgraph/edge-dangling-source', `Edge "${edge.id}" references unknown source "${edge.source}"`, {
          edgeId: edge.id,
        }),
      );
      continue;
    }
    if (!targetNode) {
      diagnostics.push(
        diag('workgraph/edge-dangling-target', `Edge "${edge.id}" references unknown target "${edge.target}"`, {
          edgeId: edge.id,
        }),
      );
      continue;
    }
    if (sourceNode.projectId !== edge.projectId || targetNode.projectId !== edge.projectId) {
      diagnostics.push(
        diag('workgraph/edge-scope-mismatch', `Edge "${edge.id}" crosses project scope`, { edgeId: edge.id }),
      );
    }
    const wantSource = expectedSourceKind(edge.kind);
    const wantTarget = expectedTargetKind(edge.kind);
    if (wantSource.length > 0 && !wantSource.includes(getNodeKind(sourceNode))) {
      diagnostics.push(
        diag('workgraph/edge-source-kind', `Edge "${edge.id}" kind "${edge.kind}" cannot start at "${getNodeKind(sourceNode)}"`, {
          edgeId: edge.id,
        }),
      );
    }
    if (wantTarget.length > 0 && !wantTarget.includes(getNodeKind(targetNode))) {
      diagnostics.push(
        diag('workgraph/edge-target-kind', `Edge "${edge.id}" kind "${edge.kind}" cannot end at "${getNodeKind(targetNode)}"`, {
          edgeId: edge.id,
        }),
      );
    }
    if (edge.kind === 'handoff') {
      const rel = edge as { usedResultRef?: string };
      if (!rel.usedResultRef || typeof rel.usedResultRef !== 'string') {
        diagnostics.push(
          diag('workgraph/handoff-missing-result', `Handoff edge "${edge.id}" has no exact usedResultRef`, {
            edgeId: edge.id,
          }),
        );
      }
    }
    if (edge.kind === 'uses-context') {
      const rel = edge as { inclusionAction?: string };
      if (rel.inclusionAction !== 'included' && rel.inclusionAction !== 'attached' && rel.inclusionAction !== 'sent') {
        diagnostics.push(
          diag('workgraph/uses-context-no-evidence', `uses-context edge "${edge.id}" has no explicit inclusion action`, {
            edgeId: edge.id,
          }),
        );
      }
    }
  }
}

export function validateWorkGraphCandidate(candidate: WorkGraphCandidate): WorkGraphCandidateValidation {
  const diagnostics: WorkGraphDiagnostic[] = [];
  if (candidate.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [diag('workgraph/schema-version-mismatch', 'Unsupported WorkGraphCandidate schemaVersion', {})],
    };
  }
  if (candidate.projectionKind !== 'workgraph') {
    return {
      ok: false,
      diagnostics: [diag('workgraph/projection-kind-mismatch', 'projectionKind must be "workgraph"', {})],
    };
  }
  const facts = candidate.semanticFacts;
  if (!facts || facts.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [diag('workgraph/semantic-facts-mismatch', 'semanticFacts missing or wrong schemaVersion', {})],
    };
  }
  const byId = validateNodes(facts.nodes, diagnostics);
  validateEdges(facts.edges, byId, diagnostics);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, candidate, diagnostics: [] };
}
