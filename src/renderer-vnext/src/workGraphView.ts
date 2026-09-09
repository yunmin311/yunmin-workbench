import type { Edge, Node, XYPosition } from 'reactflow';
import type { WorkGraphRevision } from '../../core/workgraph/revision';
import type { WorkGraphEdge, WorkGraphNode } from '../../core/workgraph/types';

export interface WorkGraphNodeData {
  semantic: WorkGraphNode;
  kind: WorkGraphNode['kind'];
  label: string;
  verification: WorkGraphNode['verification'];
  sourceRef: string;
}

export interface WorkGraphEdgeData {
  semantic: WorkGraphEdge;
  kind: WorkGraphEdge['kind'];
  evidenceCount: number;
}

export type CanvasNode = Node<WorkGraphNodeData>;
export type CanvasEdge = Edge<WorkGraphEdgeData>;

const columns: Record<WorkGraphNode['kind'], number> = {
  project: 0, work: 1, task: 2, conversation: 2, execution: 3, context: 4,
  'memory-source': 4, artifact: 4, evidence: 5, gate: 5, handoff: 4,
};

export function buildGraphElements(revision: WorkGraphRevision): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const rows = new Map<number, number>();
  const nodes = revision.candidate.semanticFacts.nodes.map((semantic) => {
    const column = columns[semantic.kind];
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: semantic.id,
      type: 'workgraph',
      position: { x: 60 + column * 230, y: 60 + row * 116 },
      data: {
        semantic,
        kind: semantic.kind,
        label: semantic.label,
        verification: semantic.verification,
        sourceRef: semantic.sourceRef,
      },
    };
  });
  const edges = revision.candidate.semanticFacts.edges.map((semantic) => ({
    id: semantic.id,
    type: 'workgraph',
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
}

export interface FocusDetail {
  label: string;
  kind: WorkGraphNode['kind'];
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
  const relations = facts.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      return { id: edge.id, kind: edge.kind, source: edge.source, target: edge.target, otherLabel: byId.get(otherId)?.label ?? otherId };
    });
  return {
    label: node.label,
    kind: node.kind,
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
