/**
 * ADAPT design principles from Archify
 * `archify/.../evidence-console` reachability surfaces at commit
 * 06dd052602dd9a369e4d034e24faef0917b5a60c (MIT).
 *
 * Reused ideas, none of the diagram-specific code:
 *   - shortest-path over explicitly authored edges only (ADAPT)
 *   - deterministic tie-break on stable edge identity (ADAPT)
 *   - exact step receipts: every traversed edge with its exact structural
 *     provenance, never a synthetic explanation (ADAPT)
 *   - "not reachable" as a normal, structured answer (ADAPT)
 *
 * REJECTED:
 *   - "more plausible" / weighted path selection; v0 has no edge weights and
 *     must never prefer a path because it looks more reasonable
 *   - blast-radius language, impact / risk / causality semantics
 *   - SVG-specific traversal, share cards, repo proof
 *   - layout-derived relationships; Canvas geometry never produces an edge
 *
 * No Archify source code is copied in this stage; THIRD_PARTY_NOTICES.md
 * needs no update.
 */

import type {
  ProjectionReachEdgeV0,
  ProjectionRouteFailureCodeV0,
  ProjectionRouteResultV0,
  ProjectionRouteV0,
  SemanticPassportEntityRefV0,
  VerifiedProjectionRevisionV0,
} from './types';
import { PROJECTION_ROUTE_SCHEMA_VERSION } from './types';
import {
  resolveNavigableOrigin,
  trustRevisionForNavigation,
  type NavigationFailureV0,
} from './reach';

const ROUTE_LIMITATIONS: string[] = [
  'Workbench Projection Route v0 answers only "whether a directed path of exact relations exists between two verified entities, and which exact steps it takes"; it never infers impact, blast radius, risk, or causality.',
  'Route v0 traverses the same exact directed edges as Reach, only in their recorded direction. An opposite-direction query returns found:false instead of reversing edges.',
  'Among minimum-hop paths the tie-break is the lexicographically smallest sequence of stableEdgeKey values; no semantic preference ("more plausible" paths) is ever applied.',
  'Parallel CollaborationRelations carry no directional semantics in v0; they are excluded from Route traversal and are never silently converted into bidirectional edges.',
  'EvidenceRef entities are provenance-only and are not part of the navigable topology.',
  'Canvas layout geometry, labels, cwd, provider, time proximity, and text similarity never produce an edge; Canvas is not a source of truth.',
];

function routeFailure(failure: NavigationFailureV0): ProjectionRouteResultV0 {
  const code: ProjectionRouteFailureCodeV0 = `route/${failure.reason}`;
  return { ok: false, code, message: failure.message, subject: failure.subject, evidence: failure.evidence, supportedFixes: failure.supportedFixes };
}

/**
 * Reverse breadth-first distances from `to` over the exact directed edges:
 * distTo[v] = minimum number of directed edges from v to `to`. Edges are
 * read in reverse during the search; no reverse semantic edges are created.
 */
function distancesToTarget(
  inEdges: Map<string, ProjectionReachEdgeV0[]>,
  targetId: string,
): Map<string, number> {
  const distTo = new Map<string, number>([[targetId, 0]]);
  let frontier: string[] = [targetId];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of inEdges.get(nodeId) ?? []) {
        const predecessor = edge.source;
        if (distTo.has(predecessor)) continue;
        distTo.set(predecessor, depth);
        next.push(predecessor);
      }
    }
    frontier = next;
  }
  return distTo;
}

export function computeProjectionRoute(
  revision: VerifiedProjectionRevisionV0,
  fromRef: SemanticPassportEntityRefV0,
  toRef: SemanticPassportEntityRefV0,
): ProjectionRouteResultV0 {
  const trusted = trustRevisionForNavigation(revision);
  if (!trusted.ok) return routeFailure(trusted.failure);
  const topology = trusted.topology;

  const from = resolveNavigableOrigin(topology, fromRef);
  if ('failure' in from) return routeFailure(from.failure);
  const to = resolveNavigableOrigin(topology, toRef);
  if ('failure' in to) return routeFailure(to.failure);

  // Foundation rejects duplicate semantic ids, so id equality across the
  // whole revision means from and to are the same entity.
  if (from.id === to.id) {
    const route: ProjectionRouteV0 = {
      ok: true,
      schemaVersion: PROJECTION_ROUTE_SCHEMA_VERSION,
      projectId: topology.projectId,
      revisionId: topology.revisionId,
      from,
      to,
      found: true,
      hops: 0,
      steps: [],
      limitations: [...ROUTE_LIMITATIONS],
    };
    return route;
  }

  const distTo = distancesToTarget(topology.inEdges, to.id);
  if (!distTo.has(from.id)) {
    // Unreachable is a normal answer, not a failure.
    const unreachable: ProjectionRouteV0 = {
      ok: true,
      schemaVersion: PROJECTION_ROUTE_SCHEMA_VERSION,
      projectId: topology.projectId,
      revisionId: topology.revisionId,
      from,
      to,
      found: false,
      hops: null,
      steps: [],
      limitations: [...ROUTE_LIMITATIONS],
    };
    return unreachable;
  }

  // Greedy forward walk along some shortest path. At each step the
  // candidate edges are exactly those that keep the remaining hop budget
  // (distTo of the candidate target equals the remaining distance), so the
  // chosen edge-key sequence is the lexicographically smallest among all
  // minimum-hop paths. Edge lists are pre-sorted by stableEdgeKey.
  const steps: ProjectionRouteV0['steps'] = [];
  let current = from.id;
  let remaining = distTo.get(from.id) ?? 0;
  while (current !== to.id) {
    let chosen: ProjectionReachEdgeV0 | null = null;
    for (const edge of topology.outEdges.get(current) ?? []) {
      if ((distTo.get(edge.target) ?? Number.POSITIVE_INFINITY) === remaining - 1) {
        chosen = edge;
        break;
      }
    }
    if (!chosen) {
      // Unreachable in practice: distTo guarantees a feasible edge exists.
      // Fail soft into a found:false answer rather than inventing a step.
      const fallback: ProjectionRouteV0 = {
        ok: true,
        schemaVersion: PROJECTION_ROUTE_SCHEMA_VERSION,
        projectId: topology.projectId,
        revisionId: topology.revisionId,
        from,
        to,
        found: false,
        hops: null,
        steps: [],
        limitations: [...ROUTE_LIMITATIONS],
      };
      return fallback;
    }
    steps.push({ from: chosen.source, to: chosen.target, edge: chosen });
    current = chosen.target;
    remaining -= 1;
  }

  const route: ProjectionRouteV0 = {
    ok: true,
    schemaVersion: PROJECTION_ROUTE_SCHEMA_VERSION,
    projectId: topology.projectId,
    revisionId: topology.revisionId,
    from,
    to,
    found: true,
    hops: steps.length,
    steps,
    limitations: [...ROUTE_LIMITATIONS],
  };
  return route;
}
