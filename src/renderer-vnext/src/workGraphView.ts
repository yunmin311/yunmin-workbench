import type { Edge, Node, XYPosition } from 'reactflow';
import type { WorkGraphRevision } from '../../core/workgraph/revision';
import type { WorkGraphEdge, WorkGraphNode } from '../../core/workgraph/types';
import { buildWorkspaceLayout, familyOf, type NodeFamily, type WorkspaceRegion } from './workspace/workspaceLayout';

export type { NodeFamily };

export interface WorkGraphNodeData {
  semantic: WorkGraphNode;
  kind: WorkGraphNode['kind'];
  family: NodeFamily;
  label: string;
  verification: WorkGraphNode['verification'];
  sourceRef: string;
  /** Set on synthetic region containers. */
  region?: WorkspaceRegion;
  /** Renderer-only progressive disclosure for a Work region. */
  disclosure?: {
    hiddenCount: number;
    expanded: boolean;
    onToggle: () => void;
  };
}

export interface WorkGraphEdgeData {
  semantic: WorkGraphEdge;
  kind: WorkGraphEdge['kind'];
  evidenceCount: number;
}

export type CanvasNode = Node<WorkGraphNodeData>;
export type CanvasEdge = Edge<WorkGraphEdgeData>;

export interface RegionNavigationItem {
  regionId: string;
  workId: string | null;
  label: string;
  currentness: string;
  taskCount: number;
  active: boolean;
}

export function projectIdsFromOverlay(snapshot: { projects: { projectId: string }[] }): string[] {
  return [...new Set(snapshot.projects.map((project) => project.projectId))].sort((a, b) => a.localeCompare(b));
}

export interface CompactNavigateRequest {
  projectId: string;
  workId?: string;
  taskId?: string;
  action?: 'continue' | 'prepare';
}

/**
 * Current-selection write guard. An explicit Work/Task click bookmarks ONLY
 * its own project: a stale node from another project (observable mid
 * project-switch, before the selection resets) must never be re-scoped onto
 * the newly displayed project. Returns null when nothing may be written.
 */
export function currentSelectionForNode(
  node: WorkGraphNode,
  scopeProjectId: string,
): { projectId: string; workId?: string; taskId?: string } | null {
  if (node.projectId !== scopeProjectId) return null;
  if (node.kind === 'work') return { projectId: node.projectId, workId: node.workId };
  if (node.kind === 'task') {
    return {
      projectId: node.projectId,
      ...(node.workId !== undefined ? { workId: node.workId } : {}),
      taskId: node.taskId,
    };
  }
  return null;
}

export type CompactNavigateResolution =
  | { resolution: 'switch-project'; projectId: string }
  | { resolution: 'apply'; nodeId: string }
  | { resolution: 'ignore' };

/**
 * Compact → Full handoff across projects. Exact node ids only: a request for
 * another known project switches first and applies once that revision
 * arrives — never silently dropped, never guessed. Unknown projects and
 * unknown nodes resolve to ignore.
 */
export function resolveCompactNavigate(
  request: CompactNavigateRequest,
  scopeProjectId: string,
  knownProjectIds: readonly string[],
  nodeIds: ReadonlySet<string>,
): CompactNavigateResolution {
  if (request.projectId !== scopeProjectId) {
    return knownProjectIds.includes(request.projectId)
      ? { resolution: 'switch-project', projectId: request.projectId }
      : { resolution: 'ignore' };
  }
  const candidates = [
    request.taskId !== undefined ? `task:${request.projectId}:${request.taskId}` : null,
    request.workId !== undefined ? `work:${request.projectId}:${request.workId}` : null,
    `project:${request.projectId}`,
  ].filter((id): id is string => id !== null);
  const target = candidates.find((id) => nodeIds.has(id));
  return target ? { resolution: 'apply', nodeId: target } : { resolution: 'ignore' };
}

/**
 * Workspace graph elements: semantic regions (Work containers) + tiered
 * node cards placed by the workspace layout. Node ids stay the semantic
 * ids — Focus, Compact navigation and E2E all address the same identity.
 */
export function buildGraphElements(revision: WorkGraphRevision): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const layout = buildWorkspaceLayout(revision);
  const nodes: CanvasNode[] = [];

  for (const region of layout.regions) {
    nodes.push({
      id: region.id,
      type: 'wb-region',
      position: { x: region.x, y: region.y },
      style: { width: region.width, height: region.height },
      data: {
        semantic: revision.candidate.semanticFacts.nodes[0],
        kind: 'work',
        family: 'work',
        label: region.label,
        verification: 'UNKNOWN',
        sourceRef: '',
        region,
      },
      draggable: true,
      selectable: false,
    });
  }

  for (const placed of layout.nodes) {
    const isGrouped = placed.regionId !== null;
    nodes.push({
      id: placed.id,
      type: `wb-${placed.family}`,
      position: { x: placed.x, y: placed.y },
      // Project-scoped knowledge beside the anchor renders at full fidelity
      // but carries a peripheral mark so the canvas can demote it visually.
      // Never a semantic judgment — only a viewport/emphasis hint.
      ...(placed.lane === 'knowledge' ? { className: 'is-peripheral' } : {}),
      ...(isGrouped ? { parentNode: placed.regionId!, extent: 'parent' as const } : {}),
      data: {
        semantic: placed.node,
        kind: placed.node.kind,
        family: placed.family,
        label: placed.label,
        verification: placed.node.verification,
        sourceRef: placed.node.sourceRef,
      },
    });
  }

  const edges = revision.candidate.semanticFacts.edges.map((semantic) => ({
    id: semantic.id,
    type: 'wb-edge',
    source: semantic.source,
    target: semantic.target,
    data: { semantic, kind: semantic.kind, evidenceCount: semantic.evidenceRefs.length },
  }));
  return { nodes, edges };
}

export function moveGraphNode(nodes: CanvasNode[], nodeId: string, position: XYPosition): CanvasNode[] {
  return nodes.map((node) => node.id === nodeId ? { ...node, position } : node);
}

/** Canvas-only region index. It reads parent ids already produced by the
 * deterministic layout and never creates Work identity from coordinates. */
export function buildRegionNavigation(nodes: CanvasNode[], selectedId: string | null): RegionNavigationItem[] {
  const selected = selectedId ? nodes.find((node) => node.id === selectedId) : undefined;
  const activeRegionId = selected?.type === 'wb-region' ? selected.id : selected?.parentNode ?? null;
  return nodes
    .filter((node) => node.type === 'wb-region' && node.data.region)
    .map((node) => ({
      regionId: node.id,
      workId: node.data.region!.workId,
      label: node.data.region!.label,
      currentness: node.data.region!.currentness,
      taskCount: node.data.region!.taskCount,
      active: node.id === activeRegionId,
    }));
}

/**
 * Viewport anchor ids for Work-first framing. Work regions (+ the project
 * anchor) define the initial and post-switch viewport; the project-scoped
 * knowledge column beside the anchor is deliberately excluded so a tall
 * peripheral wall can never shrink the current Work into a corner.
 * Presentation only — every semantic node stays rendered and pannable.
 */
export function workRegionFitIds(nodes: CanvasNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'wb-region') ids.push(node.id);
  }
  const project = nodes.find((node) => node.data.kind === 'project');
  if (project) ids.unshift(project.id);
  return ids;
}

/** Collapse is a presentation projection only. Semantic nodes and edges stay
 * intact; React Flow receives hidden children/edges and a compact region. */
export function projectRegionVisibility(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  collapsedRegionIds: ReadonlySet<string>,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const hiddenNodeIds = new Set(
    nodes.filter((node) => node.parentNode && collapsedRegionIds.has(node.parentNode)).map((node) => node.id),
  );
  return {
    nodes: nodes.map((node) => {
      if (node.type === 'wb-region') {
        const collapsed = collapsedRegionIds.has(node.id);
        return {
          ...node,
          hidden: false,
          className: `${node.className ?? ''}${collapsed ? ' is-region-collapsed' : ''}`.trim(),
          style: { ...node.style, ...(collapsed ? { height: 54 } : {}) },
        };
      }
      return { ...node, hidden: hiddenNodeIds.has(node.id) };
    }),
    edges: edges.map((edge) => ({ ...edge, hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target) })),
  };
}

export interface FocusRelation {
  id: string;
  kind: WorkGraphEdge['kind'];
  source: string;
  target: string;
  otherLabel: string;
  otherFamily: NodeFamily;
  direction: 'in' | 'out';
}

/**
 * Product words for edge kinds. The canvas and Focus Detail speak these;
 * the semantic kinds underneath stay exact for projection and tests.
 */
const RELATION_WORDS: Record<WorkGraphEdge['kind'], string> = {
  membership: 'Part of',
  'execution-of': 'Run of',
  'uses-context': 'Uses',
  produces: 'Makes',
  handoff: 'Handoff',
  'derived-from': 'Built from',
  'blocked-by': 'Blocked by',
  evidences: 'Backed by',
  'depends-on': 'Needs',
};

export function relationWord(kind: WorkGraphEdge['kind']): string {
  return RELATION_WORDS[kind] ?? kind;
}

export interface FocusDetail {
  label: string;
  kind: WorkGraphNode['kind'];
  family: NodeFamily;
  source: string;
  sourceRef: string;
  verification: WorkGraphNode['verification'];
  currentness?: string;
  taskState?: string;
  runtimeState?: string;
  attentionState?: string;
  relations: FocusRelation[];
}

export interface ExecutionStory {
  doing: string;
  context: string[];
  outputs: string[];
  latestOutput?: string;
  evidence: string[];
  next: string;
  packetId?: string;
  intentId?: string;
}

/** Human-readable execution depth made only from exact fields/edges already in
 * the graph. Missing facts remain explicit instead of being narrated. */
export function buildExecutionStory(revision: WorkGraphRevision, nodeId: string): ExecutionStory | null {
  const facts = revision.candidate.semanticFacts;
  const selected = facts.nodes.find((candidate) => candidate.id === nodeId);
  if (!selected) return null;
  const outputTime = (executionId: string) => facts.edges
    .filter((edge) => edge.kind === 'produces' && edge.source === executionId)
    .map((edge) => facts.nodes.find((candidate) => candidate.id === edge.target))
    .filter((candidate): candidate is Extract<WorkGraphNode, { kind: 'artifact' }> => candidate?.kind === 'artifact')
    .reduce((latest, artifact) => artifact.observedAt > latest ? artifact.observedAt : latest, '');
  const linkedExecutions = selected.kind === 'task'
    ? facts.edges
      .filter((edge) => edge.kind === 'execution-of' && edge.source === selected.id)
      .map((edge) => facts.nodes.find((candidate) => candidate.id === edge.target))
      .filter((candidate): candidate is Extract<WorkGraphNode, { kind: 'execution' }> => candidate?.kind === 'execution')
      .sort((a, b) => outputTime(b.id).localeCompare(outputTime(a.id)) || a.id.localeCompare(b.id))
    : [];
  const node = selected.kind === 'execution' ? selected : linkedExecutions[0];
  if (!node) return null;
  const executionNodeId = node.id;
  const byId = new Map(facts.nodes.map((candidate) => [candidate.id, candidate]));
  const labelsFor = (kind: WorkGraphEdge['kind'], direction: 'out' | 'in' = 'out') => facts.edges
    .filter((edge) => edge.kind === kind && (direction === 'out' ? edge.source === executionNodeId : edge.target === executionNodeId))
    .map((edge) => {
      const related = byId.get(direction === 'out' ? edge.target : edge.source);
      return kind === 'produces' && related?.kind === 'artifact' && related.content?.trim()
        ? related.content.trim()
        : related?.label;
    })
    .filter((label): label is string => Boolean(label));
  const task = node.taskId
    ? facts.nodes.find((candidate) => candidate.kind === 'task' && candidate.taskId === node.taskId)
    : undefined;
  const directNext = labelsFor('blocked-by');
  const taskNext = task
    ? facts.edges
      .filter((edge) => edge.kind === 'blocked-by' && edge.source === task.id)
      .map((edge) => byId.get(edge.target)?.label)
      .filter((label): label is string => Boolean(label))
    : [];
  const nextFacts = [...new Set([...directNext, ...taskNext])];
  const chronologyExecutionIds = selected.kind === 'task'
    ? new Set(linkedExecutions.map((execution) => execution.id))
    : new Set([executionNodeId]);
  const orderedOutputs = facts.edges
    .filter((edge) => edge.kind === 'produces' && chronologyExecutionIds.has(edge.source))
    .map((edge) => byId.get(edge.target))
    .filter((candidate): candidate is Extract<WorkGraphNode, { kind: 'artifact' }> => candidate?.kind === 'artifact')
    .filter((artifact) => Boolean(artifact.content?.trim()))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id))
    .map((artifact) => artifact.content!.trim());
  return {
    doing: task?.label ?? 'No canonical Task linked',
    context: labelsFor('uses-context'),
    outputs: orderedOutputs,
    ...(orderedOutputs.length > 0 ? { latestOutput: orderedOutputs.at(-1) } : {}),
    evidence: labelsFor('evidences', 'in'),
    next: nextFacts.length > 0 ? nextFacts.join(' · ') : 'No next-step fact yet',
    ...(node.packetId ? { packetId: node.packetId } : {}),
    ...(node.intentId ? { intentId: node.intentId } : {}),
  };
}

export function buildFocusDetail(revision: WorkGraphRevision, nodeId: string): FocusDetail | null {
  const facts = revision.candidate.semanticFacts;
  const node = facts.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const byId = new Map(facts.nodes.map((candidate) => [candidate.id, candidate]));
  const relations: FocusRelation[] = facts.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      const other = byId.get(otherId);
      return {
        id: edge.id,
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        otherLabel: other?.label ?? otherId,
        otherFamily: other ? familyOf(other) : 'context',
        direction: edge.source === nodeId ? 'out' : 'in',
      };
    });
  return {
    label: node.label,
    kind: node.kind,
    family: familyOf(node),
    source: node.source,
    sourceRef: node.sourceRef,
    verification: node.verification,
    ...('currentness' in node ? { currentness: node.currentness } : {}),
    ...('taskState' in node ? { taskState: node.taskState } : {}),
    ...('runtimeState' in node ? { runtimeState: node.runtimeState } : {}),
    ...('attentionState' in node ? { attentionState: node.attentionState } : {}),
    relations,
  };
}

/** Neighbor ids of the focused node — everything else dims in Focus mode. */
export function focusNeighborhood(revision: WorkGraphRevision, nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId]);
  for (const edge of revision.candidate.semanticFacts.edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}
