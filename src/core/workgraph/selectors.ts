/**
 * Work Graph selectors — pure helpers over a verified revision.
 * No layout, no UI state. All functions are total and deterministic.
 */

import type { WorkGraphRevision } from './revision';
import type {
  WorkGraphEdge,
  WorkGraphEdgeId,
  WorkGraphNode,
  WorkGraphNodeId,
  WorkGraphProjectId,
} from './types';

/** All nodes in scope (revision is already project-scoped; filter is a guard). */
export function filterByProject(revision: WorkGraphRevision, projectId: WorkGraphProjectId): WorkGraphNode[] {
  return revision.candidate.semanticFacts.nodes.filter((n) => n.projectId === projectId);
}

/** All edges in scope. */
export function edgesByProject(revision: WorkGraphRevision, projectId: WorkGraphProjectId): WorkGraphEdge[] {
  return revision.candidate.semanticFacts.edges.filter((e) => e.projectId === projectId);
}

export interface FocusResult {
  node: WorkGraphNode | null;
  inbound: WorkGraphEdge[];
  outbound: WorkGraphEdge[];
}

/** The focused node plus its direct inbound/outbound edges. */
export function focusNode(revision: WorkGraphRevision, nodeId: WorkGraphNodeId): FocusResult {
  const facts = revision.candidate.semanticFacts;
  const node = facts.nodes.find((n) => n.id === nodeId) ?? null;
  if (!node) return { node: null, inbound: [], outbound: [] };
  const inbound = facts.edges
    .filter((e) => e.target === nodeId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const outbound = facts.edges
    .filter((e) => e.source === nodeId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { node, inbound, outbound };
}

export interface NeighborResult {
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
}

/**
 * Breadth-first neighborhood up to `depth` hops (default 1).
 * Deterministic order: node id ascending within each ring.
 */
export function neighbors(
  revision: WorkGraphRevision,
  nodeId: WorkGraphNodeId,
  depth = 1,
): NeighborResult {
  const facts = revision.candidate.semanticFacts;
  const byId = new Map(facts.nodes.map((n) => [n.id, n]));
  if (!byId.has(nodeId)) return { nodes: [], edges: [] };
  const seenNodes = new Set<WorkGraphNodeId>([nodeId]);
  const seenEdges = new Set<WorkGraphEdgeId>();
  const edgeOut: WorkGraphEdge[] = [];
  let frontier = [nodeId];
  for (let d = 0; d < Math.max(1, depth); d++) {
    const next: WorkGraphNodeId[] = [];
    for (const edge of facts.edges) {
      const touches = frontier.includes(edge.source) || frontier.includes(edge.target);
      if (!touches || seenEdges.has(edge.id)) continue;
      seenEdges.add(edge.id);
      edgeOut.push(edge);
      for (const endpoint of [edge.source, edge.target]) {
        if (!seenNodes.has(endpoint) && byId.has(endpoint)) {
          seenNodes.add(endpoint);
          next.push(endpoint);
        }
      }
    }
    frontier = [...new Set(next)].sort();
    if (frontier.length === 0) break;
  }
  const nodes = [...seenNodes]
    .map((id) => byId.get(id))
    .filter((n): n is WorkGraphNode => n !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  edgeOut.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { nodes, edges: edgeOut };
}

/** Gate nodes plus the blocked-by edges that reference them. */
export function attentionSubset(revision: WorkGraphRevision): { gates: WorkGraphNode[]; edges: WorkGraphEdge[] } {
  const facts = revision.candidate.semanticFacts;
  const gates = facts.nodes.filter((n) => n.kind === 'gate').sort((a, b) => (a.id < b.id ? -1 : 1));
  const gateIds = new Set(gates.map((g) => g.id));
  const edges = facts.edges
    .filter((e) => gateIds.has(e.source) || gateIds.has(e.target))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { gates, edges };
}
