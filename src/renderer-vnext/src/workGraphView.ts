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
}

export interface WorkGraphEdgeData {
  semantic: WorkGraphEdge;
  kind: WorkGraphEdge['kind'];
  evidenceCount: number;
}

export type CanvasNode = Node<WorkGraphNodeData>;
export type CanvasEdge = Edge<WorkGraphEdgeData>;

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

export interface FocusRelation {
  id: string;
  kind: WorkGraphEdge['kind'];
  source: string;
  target: string;
  otherLabel: string;
  otherFamily: NodeFamily;
  direction: 'in' | 'out';
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
