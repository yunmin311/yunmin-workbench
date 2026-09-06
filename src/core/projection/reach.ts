/**
 * ADAPT design principles from Archify
 * `archify/.../evidence-console` reachability surfaces at commit
 * 06dd052602dd9a369e4d034e24faef0917b5a60c (MIT).
 *
 * Reused ideas, none of the diagram-specific code:
 *   - authored-only reachability: traversal only over explicitly authored,
 *     exact relations, never inferred ones (ADAPT)
 *   - symmetric upstream / downstream traversal over the same edge set
 *     (ADAPT; implemented here as reverse reads of the exact directed edges,
 *     never as new reverse semantic edges)
 *   - stable node / edge identity and deterministic receipts (ADAPT)
 *   - minimum depth per node and maximum hops as first-class output (ADAPT)
 *   - focused viewer state driven by the same stable ids (ADAPT)
 *
 * REJECTED:
 *   - blast-radius language, impact / risk / causality semantics
 *   - SVG-specific traversal, share cards, repo proof
 *   - diagram boundary topology: container / membership edges as reach edges
 *   - layout-derived relationships: Canvas geometry never produces an edge
 *
 * No Archify source code is copied in this stage; THIRD_PARTY_NOTICES.md
 * needs no update.
 */

import type {
  ArtifactOrEvidenceProjectionV0,
  ConversationProjectionV0,
  ProjectionDiagnosticV0,
  ProjectionReachDirectionV0,
  ProjectionReachEdgeV0,
  ProjectionReachFailureCodeV0,
  ProjectionReachResultV0,
  ProjectionReachV0,
  RuntimeExecutionProjectionV0,
  SemanticPassportEntityRefV0,
  VerifiedProjectionRevisionV0,
} from './types';
import { PROJECTION_REACH_SCHEMA_VERSION } from './types';
import {
  computeProjectionLayoutHash,
  computeProjectionRevisionHash,
  computeProjectionSemanticHash,
  verifyProjectionCandidate,
} from './revision';

/**
 * Internal deterministic clock used only by the Foundation trust call. Its
 * value never reaches Reach output; it is consumed by Foundation to fill
 * `receipt.checkedAt` / `verifiedAt`, which Reach never surfaces. Pinning it
 * keeps the Reach call graph free of system clock reads.
 */
const REACH_VALIDATION_CLOCK: string = '1970-01-01T00:00:00.000Z';

const REACH_LIMITATIONS: string[] = [
  'Workbench Projection Reach v0 answers only "which verified entities are reachable along explicit exact relations in the current VerifiedProjectionRevisionV0"; it never infers impact, blast radius, risk, or causality.',
  'Only exact structural fields produce structural edges: RuntimeExecution.conversationRef (conversation-execution) and ArtifactOrEvidence.executionRef (execution-artifact). Handoff edges come only from explicit CollaborationRelation records of kind handoff.',
  'Parallel CollaborationRelations carry no directional semantics in v0; they are excluded from Reach traversal and are never silently converted into bidirectional edges.',
  'Upstream traversal reads the same exact directed edges in reverse during traversal; no reverse semantic edges are created.',
  'EvidenceRef entities are provenance-only and are not part of the navigable topology.',
  'Canvas layout geometry, labels, cwd, provider, time proximity, and text similarity never produce an edge; Canvas is not a source of truth.',
];

// ===== shared failure plumbing =====
//
// Internal helpers report a failure *reason*; each core (Reach, Route) owns
// its own failure-code vocabulary and maps reasons onto it, so no module
// ever casts a foreign code into its failure union.

export type NavigationFailureReasonV0 =
  | 'invalid-revision'
  | 'entity-not-found'
  | 'unsupported-entity';

export interface NavigationFailureV0 {
  ok: false;
  reason: NavigationFailureReasonV0;
  message: string;
  subject: Record<string, unknown>;
  evidence: Record<string, unknown>;
  supportedFixes: string[];
}

function navigationFailure(
  reason: NavigationFailureReasonV0,
  message: string,
  subject: Record<string, unknown>,
  evidence: Record<string, unknown>,
  supportedFixes: string[],
): NavigationFailureV0 {
  return { ok: false, reason, message, subject, evidence, supportedFixes };
}

// ===== exact navigable topology =====

/**
 * The navigable topology of one re-trusted verified revision: exact directed
 * edges only. Internal; shared verbatim with Route so both cores can never
 * disagree about what an edge is.
 */
export interface NavigableTopologyV0 {
  projectId: string;
  revisionId: string;
  conversationById: Map<string, ConversationProjectionV0>;
  executionById: Map<string, RuntimeExecutionProjectionV0>;
  artifactById: Map<string, ArtifactOrEvidenceProjectionV0>;
  /** All exact directed edges, sorted by stableEdgeKey. */
  edges: ProjectionReachEdgeV0[];
  outEdges: Map<string, ProjectionReachEdgeV0[]>;
  inEdges: Map<string, ProjectionReachEdgeV0[]>;
}

/**
 * Deterministic composite edge identity `[source, target, edgeKind,
 * relationIdentity]`. `relationIdentity` is the handoff relation id for
 * handoff edges, or `entityId#fieldPath` for structural edges. This key is
 * the edge sort order and the Route tie-break order. U+0000 separators
 * cannot occur in Workbench semantic ids.
 */
export function stableEdgeKey(
  source: string,
  target: string,
  edgeKind: ProjectionReachEdgeV0['edgeKind'],
  relationIdentity: string,
): string {
  // Sort order per contract: source, target, edgeKind, stable relation
  // identity.
  return [source, target, edgeKind, relationIdentity].join('\u0000');
}

/**
 * Exact edges of the v0 navigable topology:
 *   - conversation -> runtimeExecution, only when
 *     `execution.conversationRef === conversation.id`
 *   - runtimeExecution -> artifactOrEvidence, only when
 *     `artifact.executionRef === execution.id`
 *   - handoff, only from an existing CollaborationRelation of kind 'handoff',
 *     as the directed edge sourceExecutionRef -> targetExecutionRef carrying
 *     the exact relationId / usedResultRef / evidenceRefs.
 *
 * Parallel relations are excluded: they assert co-execution, not direction.
 * Foundation validation guarantees every referenced id resolves inside the
 * verified revision, so the lookups below cannot dangle post-trust.
 */
export function buildNavigableTopology(revision: VerifiedProjectionRevisionV0): NavigableTopologyV0 {
  const facts = revision.candidate.semanticFacts;
  const conversationById = new Map(facts.conversations.map((item) => [item.id, item] as const));
  const executionById = new Map(facts.runtimeExecutions.map((item) => [item.id, item] as const));
  const artifactById = new Map(facts.artifactsOrEvidence.map((item) => [item.id, item] as const));

  const edges: ProjectionReachEdgeV0[] = [];

  for (const execution of facts.runtimeExecutions) {
    if (!execution.conversationRef) continue;
    if (!conversationById.has(execution.conversationRef)) continue;
    const source = execution.conversationRef;
    const target = execution.id;
    edges.push({
      edgeKind: 'conversation-execution',
      source,
      target,
      stableEdgeKey: stableEdgeKey(source, target, 'conversation-execution', `${execution.id}#conversationRef`),
      structuralSource: { entityId: execution.id, fieldPath: 'conversationRef' },
    });
  }

  for (const artifact of facts.artifactsOrEvidence) {
    if (!artifact.executionRef) continue;
    if (!executionById.has(artifact.executionRef)) continue;
    const source = artifact.executionRef;
    const target = artifact.id;
    edges.push({
      edgeKind: 'execution-artifact',
      source,
      target,
      stableEdgeKey: stableEdgeKey(source, target, 'execution-artifact', `${artifact.id}#executionRef`),
      structuralSource: { entityId: artifact.id, fieldPath: 'executionRef' },
    });
  }

  for (const relation of facts.collaborationRelations) {
    if (relation.kind !== 'handoff') continue;
    if (!executionById.has(relation.sourceExecutionRef)) continue;
    if (!executionById.has(relation.targetExecutionRef)) continue;
    const source = relation.sourceExecutionRef;
    const target = relation.targetExecutionRef;
    edges.push({
      edgeKind: 'handoff',
      source,
      target,
      stableEdgeKey: stableEdgeKey(source, target, 'handoff', relation.id),
      relationId: relation.id,
      usedResultRef: relation.usedResultRef,
      evidenceRefs: [...relation.evidenceRefs].sort(),
    });
  }

  edges.sort((left, right) => left.stableEdgeKey.localeCompare(right.stableEdgeKey));

  const outEdges = new Map<string, ProjectionReachEdgeV0[]>();
  const inEdges = new Map<string, ProjectionReachEdgeV0[]>();
  for (const edge of edges) {
    const out = outEdges.get(edge.source);
    if (out) out.push(edge);
    else outEdges.set(edge.source, [edge]);
    const inn = inEdges.get(edge.target);
    if (inn) inn.push(edge);
    else inEdges.set(edge.target, [edge]);
  }

  return {
    projectId: revision.candidate.scope.projectId,
    revisionId: revision.revisionId,
    conversationById,
    executionById,
    artifactById,
    edges,
    outEdges,
    inEdges,
  };
}

export type NavigationTrustOutcomeV0 =
  | { ok: true; topology: NavigableTopologyV0 }
  | { ok: false; failure: NavigationFailureV0 };

/**
 * Trust gate shared by Reach and Route. Re-trusts the revision through
 * Foundation itself (`verifyProjectionCandidate` + the candidate's own
 * sourceDigest as the recheck anchor + a pinned deterministic clock), then
 * verifies the envelope against Foundation's recomputation. Any mismatch
 * fails closed; the caller maps the failure onto its own invalid-revision
 * code.
 */
export function trustRevisionForNavigation(
  revision: VerifiedProjectionRevisionV0,
): NavigationTrustOutcomeV0 {
  if (revision.schemaVersion !== 0) {
    return {
      ok: false,
      failure: navigationFailure(
        'invalid-revision',
        'Projection navigation v0 requires a VerifiedProjectionRevisionV0 (schemaVersion 0).',
        { revisionSchemaVersion: revision.schemaVersion },
        { expected: 0 },
        ['navigate only a verified projection revision produced by Workbench Verified Projection Foundation'],
      ),
    };
  }
  const foundation = verifyProjectionCandidate(revision.candidate, null, {
    recheckSourceDigest: () => revision.candidate.sourceBinding.sourceDigest,
    now: () => REACH_VALIDATION_CLOCK,
  });
  if (!foundation.current) {
    const first: ProjectionDiagnosticV0 | undefined = foundation.diagnostics[0];
    return {
      ok: false,
      failure: navigationFailure(
        'invalid-revision',
        `Projection navigation v0 rejected revision ${revision.revisionId}: Foundation validation failed — ${first?.message ?? 'unknown'}`,
        first?.subject ?? {},
        first?.evidence ?? {},
        first?.supportedFixes ?? ['discard the revision and rebuild from Foundation; only verified revisions are navigable'],
      ),
    };
  }
  const recomputedSemantic = computeProjectionSemanticHash(revision.candidate);
  const recomputedLayout = computeProjectionLayoutHash(revision.candidate);
  const recomputedRevision = computeProjectionRevisionHash({
    scope: revision.candidate.scope,
    sourceDigest: revision.candidate.sourceBinding.sourceDigest,
    semanticHash: recomputedSemantic,
    layoutHash: recomputedLayout,
  });
  if (recomputedSemantic !== revision.semanticHash
    || recomputedLayout !== revision.layoutHash
    || recomputedRevision !== revision.revisionHash
    || `projection:${recomputedRevision}` !== revision.revisionId
    || revision.candidate.sourceBinding.sourceDigest !== revision.sourceDigest) {
    return {
      ok: false,
      failure: navigationFailure(
        'invalid-revision',
        'Projection navigation v0 refuses a revision whose envelope does not match Foundation recomputation.',
        { revisionId: revision.revisionId },
        {
          revisionSemanticHash: revision.semanticHash,
          recomputedSemanticHash: recomputedSemantic,
          revisionLayoutHash: revision.layoutHash,
          recomputedLayoutHash: recomputedLayout,
          revisionRevisionHash: revision.revisionHash,
          recomputedRevisionHash: recomputedRevision,
        },
        ['discard the revision and rebuild from Foundation; only verified revisions produced by Workbench are navigable'],
      ),
    };
  }
  return { ok: true, topology: buildNavigableTopology(revision) };
}

export type NavigationResolvedOriginV0 =
  | { kind: 'conversation' | 'runtimeExecution' | 'artifactOrEvidence'; id: string }
  | { failure: NavigationFailureV0 };

/**
 * Resolve an input ref to a navigable entity. Refs reuse the Passport entity
 * ref shape so UI seams stay one type; kinds outside the navigable topology
 * fail closed as unsupported instead of being silently coerced.
 */
export function resolveNavigableOrigin(
  topology: NavigableTopologyV0,
  ref: SemanticPassportEntityRefV0,
): NavigationResolvedOriginV0 {
  switch (ref.kind) {
    case 'conversation':
      if (!topology.conversationById.has(ref.id)) {
        return {
          failure: navigationFailure(
            'entity-not-found',
            `Conversation '${ref.id}' does not exist in revision '${topology.revisionId}'.`,
            { kind: ref.kind, id: ref.id, revisionId: topology.revisionId },
            {},
            ['pick a stable id that already exists in the active verified projection'],
          ),
        };
      }
      return { kind: 'conversation', id: ref.id };
    case 'runtimeExecution':
      if (!topology.executionById.has(ref.id)) {
        return {
          failure: navigationFailure(
            'entity-not-found',
            `RuntimeExecution '${ref.id}' does not exist in revision '${topology.revisionId}'.`,
            { kind: ref.kind, id: ref.id, revisionId: topology.revisionId },
            {},
            ['pick a stable id that already exists in the active verified projection'],
          ),
        };
      }
      return { kind: 'runtimeExecution', id: ref.id };
    case 'artifactOrEvidence':
      if (!topology.artifactById.has(ref.id)) {
        return {
          failure: navigationFailure(
            'entity-not-found',
            `ArtifactOrEvidence '${ref.id}' does not exist in revision '${topology.revisionId}'.`,
            { kind: ref.kind, id: ref.id, revisionId: topology.revisionId },
            {},
            ['pick a stable id that already exists in the active verified projection'],
          ),
        };
      }
      return { kind: 'artifactOrEvidence', id: ref.id };
    case 'collaborationRelation':
    case 'evidence':
      return {
        failure: navigationFailure(
          'unsupported-entity',
          `Entity kind '${ref.kind}' is not part of the v0 navigable topology. Only conversation, runtimeExecution, and artifactOrEvidence are navigable; collaborationRelation is an exact edge (handoff), and evidence is provenance-only.`,
          { kind: ref.kind, id: ref.id },
          { navigableKinds: ['conversation', 'runtimeExecution', 'artifactOrEvidence'] },
          ['navigate from a conversation, runtimeExecution, or artifactOrEvidence entity'],
        ),
      };
  }
}

/**
 * Breadth-first traversal over the exact directed edges, following them
 * forward (downstream) or reading them in reverse (upstream). Unweighted
 * BFS, so first discovery is the minimum depth. Edge lists are pre-sorted
 * by stableEdgeKey, so discovery order is deterministic too.
 */
function traverse(
  topology: NavigableTopologyV0,
  originId: string,
  direction: ProjectionReachDirectionV0,
): { minimumDepthByNode: Map<string, number> } {
  const adjacency = direction === 'downstream' ? topology.outEdges : topology.inEdges;
  const minimumDepth = new Map<string, number>([[originId, 0]]);
  let frontier: string[] = [originId];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of adjacency.get(nodeId) ?? []) {
        const neighbour = direction === 'downstream' ? edge.target : edge.source;
        if (minimumDepth.has(neighbour)) continue;
        minimumDepth.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return { minimumDepthByNode: minimumDepth };
}

function navigableKindOf(
  topology: NavigableTopologyV0,
  id: string,
): 'conversation' | 'runtimeExecution' | 'artifactOrEvidence' {
  if (topology.conversationById.has(id)) return 'conversation';
  if (topology.executionById.has(id)) return 'runtimeExecution';
  return 'artifactOrEvidence';
}

function reachFailure(failure: NavigationFailureV0): ProjectionReachResultV0 {
  const code: ProjectionReachFailureCodeV0 = `reach/${failure.reason}`;
  return { ok: false, code, message: failure.message, subject: failure.subject, evidence: failure.evidence, supportedFixes: failure.supportedFixes };
}

export function computeProjectionReach(
  revision: VerifiedProjectionRevisionV0,
  originRef: SemanticPassportEntityRefV0,
  direction: ProjectionReachDirectionV0,
): ProjectionReachResultV0 {
  const trusted = trustRevisionForNavigation(revision);
  if (!trusted.ok) return reachFailure(trusted.failure);
  const topology = trusted.topology;

  const origin = resolveNavigableOrigin(topology, originRef);
  if ('failure' in origin) return reachFailure(origin.failure);

  const { minimumDepthByNode } = traverse(topology, origin.id, direction);

  // Deterministic node order: minimumDepth ascending, then stable id.
  const nodeIds = [...minimumDepthByNode.keys()].sort((left, right) => {
    const depthDelta = (minimumDepthByNode.get(left) ?? 0) - (minimumDepthByNode.get(right) ?? 0);
    if (depthDelta !== 0) return depthDelta;
    return left.localeCompare(right);
  });

  const nodes = nodeIds.map((id) => ({
    kind: navigableKindOf(topology, id),
    id,
    minimumDepth: minimumDepthByNode.get(id) ?? 0,
  }));

  // Edges of the reachable subgraph: both endpoints reachable. Traversal
  // direction only changes which nodes are reachable; the edges are always
  // reported in their exact recorded direction.
  const reachable = new Set(nodeIds);
  const edges = topology.edges.filter((edge) => reachable.has(edge.source) && reachable.has(edge.target));

  // minimumDepthByNode with keys inserted in sorted id order.
  const minimumDepthByNodeOut: Record<string, number> = {};
  for (const id of [...minimumDepthByNode.keys()].sort()) {
    minimumDepthByNodeOut[id] = minimumDepthByNode.get(id) ?? 0;
  }

  let maximumHops = 0;
  for (const node of nodes) {
    if (node.minimumDepth > maximumHops) maximumHops = node.minimumDepth;
  }

  const reach: ProjectionReachV0 = {
    ok: true,
    schemaVersion: PROJECTION_REACH_SCHEMA_VERSION,
    projectId: topology.projectId,
    revisionId: topology.revisionId,
    origin,
    direction,
    nodes,
    edges,
    minimumDepthByNode: minimumDepthByNodeOut,
    maximumHops,
    limitations: [...REACH_LIMITATIONS],
  };
  return reach;
}
