import dagre from 'dagre';
import type { Conversation, OverlaySnapshot, WbEdge, WbNode } from '../types';

const NODE_W = 220;
const NODE_H = 64;

/**
 * Canvas projection (PDF §4): project + its conversations + memory vault mount.
 * Execution edges: project -> conversation (who carries work).
 * Data/context edges: memory vault -> project (long-term memory flows in).
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
      id: `conversation:${c.id}`,
      kind: 'conversation',
      label: c.role,
      status: c.status,
      trust: c.verification === 'VERIFIED' ? 'VERIFIED' : 'REGISTERED',
      x: 0,
      y: 0,
    });
    edges.push({
      id: `exec:${projectId}->${c.id}`,
      source: `project:${projectId}`,
      target: `conversation:${c.id}`,
      kind: 'execution',
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
      id: `data:memory->${projectId}`,
      source: 'memory:vault',
      target: `project:${projectId}`,
      kind: 'data-context',
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
