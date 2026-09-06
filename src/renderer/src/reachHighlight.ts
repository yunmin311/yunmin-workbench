import type { ProjectionReachV0 } from '../../core/projection/types';
import { encodeEdgeTuple } from '../../core/projection/reach';

/**
 * Viewer-only reach highlight, directly observed in Archify's authored
 * reachability (tt-a1i/archify, `archify/test/authored-reachability.test.mjs`
 * and `docs/research-authored-reachability-2026-07-23.md`): reach state is
 * canvas presentation, never a new panel, and never reaches canonical
 * output. Workbench equivalent: classes computed from the Reach result at
 * render time; layout, Projection IR, and semantic hashes stay untouched.
 */
export interface ReachHighlightV0 {
  originId: string;
  reachableIds: ReadonlySet<string>;
  /** Encoded `[source, target]` pairs of the reachable-subgraph edges. */
  edgePairs: ReadonlySet<string>;
  direction: 'upstream' | 'downstream';
}

export function computeReachHighlight(reach: ProjectionReachV0): ReachHighlightV0 {
  return {
    originId: reach.origin.id,
    reachableIds: new Set(reach.nodes.map((node) => node.id)),
    edgePairs: new Set(reach.edges.map((edge) => encodeEdgeTuple([edge.source, edge.target]))),
    direction: reach.direction,
  };
}

/**
 * Focused origin plus the complete reachable subgraph stay strong; unrelated
 * topology recedes (Archify: "origin strong, reachable subgraph complete,
 * unrelated topology recedes").
 */
export function reachCanvasNodeClass(nodeId: string, highlight: ReachHighlightV0 | null): string {
  if (!highlight) return '';
  if (nodeId === highlight.originId) return ' reach-origin';
  return highlight.reachableIds.has(nodeId) ? ' reach-hit' : ' reach-dim';
}

export function reachCanvasEdgeClass(source: string, target: string, highlight: ReachHighlightV0 | null): string {
  if (!highlight) return '';
  return highlight.edgePairs.has(encodeEdgeTuple([source, target])) ? ' reach-edge-hit' : ' reach-edge-dim';
}
