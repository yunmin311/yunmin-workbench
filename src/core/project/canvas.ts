import dagre from 'dagre';
import type { Conversation, OverlaySnapshot, WbEdge, WbNode } from '../types';

const NODE_W = 220;
const NODE_H = 64;

/**
 * Canvas projection (PDF §4): project + registered conversations + available
 * memory vault mount. Membership/mount are structural availability only.
 * Execution/Handoff requires Runtime/Intent evidence; Context/Data requires an
 * actual included/attached/observed flow. This snapshot has neither.
 * Canvas is projection only; dragging nodes never mutates external facts.
 */
export function buildCanvasGraph(
  snapshot: OverlaySnapshot,
  projectId: string,
): { nodes: WbNode[]; edges: WbEdge[] } {
  const nodes: WbNode[] = [];
  const edges: WbEdge[] = [];

  const adapter = snapshot.projects.find((p) => p.projectId === projectId);
  nodes.push({
    id: `project:${projectId}`,
    kind: 'project',
    label: adapter?.displayName ?? projectId,
    trust: adapter?.trust ?? 'DISCOVERED',
    x: 0,
    y: 0,
  });

  const convos: Conversation[] = snapshot.conversations.filter((c) => c.project === projectId);
  for (const c of convos) {
    nodes.push({
      id: `conversation:${c.key}`,
      kind: 'conversation',
      label: c.role,
      status: c.status,
      trust: c.verification === 'VERIFIED' ? 'VERIFIED' : 'REGISTERED',
      x: 0,
      y: 0,
    });
    edges.push({
      id: `member:${projectId}->${c.key}`,
      source: `project:${projectId}`,
      target: `conversation:${c.key}`,
      kind: 'membership',
    });
  }

  if (snapshot.memoryIndex.length > 0) {
    nodes.push({
      id: 'memory:vault',
      kind: 'memory',
      label: `Memory Vault (${snapshot.memoryIndex.length})`,
      trust: 'REGISTERED',
      x: 0,
      y: 0,
    });
    edges.push({
      id: `mount:memory->${projectId}`,
      source: 'memory:vault',
      target: `project:${projectId}`,
      kind: 'mount',
    });
  }

  return { nodes: layoutDagre(nodes, edges), edges };
}

/** dagre layout: Workbench owns node/edge semantics, not the layout engine (Reuse Map). */
export function layoutDagre(nodes: WbNode[], edges: WbEdge[]): WbNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, x: pos ? pos.x - NODE_W / 2 : 0, y: pos ? pos.y - NODE_H / 2 : 0 };
  });
}
