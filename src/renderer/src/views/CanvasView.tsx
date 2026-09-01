import { useMemo } from 'react';
import { Background, Controls, MarkerType, Panel, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildCanvasGraph } from '../../../core/project/canvas';
import { projectCompareGroups, projectTrajectory } from '../../../core/project/executionRelations';
import type { WbEdge, WbEdgeKind, WbNode } from '../../../core/types';
import { useWorkbench } from '../store';
import { layoutProjection } from './reasonixProjectionLayout';

const EDGE_LABEL: Record<WbEdgeKind, string> = {
  membership: 'membership',
  mount: 'mount',
  execution: 'observed execution',
  handoff: 'observed handoff',
  'data-context': 'observed context',
};

export function CanvasView() {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const activity = useWorkbench((state) => state.activity);
  const selectConversation = useWorkbench((state) => state.selectConversation);
  const setView = useWorkbench((state) => state.setView);
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);

  const { nodes, edges, kinds } = useMemo(() => {
    if (!snapshot || !projectId) return { nodes: [] as Node[], edges: [] as Edge[], kinds: [] as WbEdgeKind[] };
    const graph = buildCanvasGraph(snapshot, projectId, []);
    const projectActivity = activity.filter((event) => event.projectId === projectId);
    const compareGroups = projectCompareGroups(projectActivity);
    const executionNodes: WbNode[] = compareGroups.flatMap((group) => group.executions.map((execution) => ({
      id: `execution:${execution.executionId}`,
      kind: 'execution' as const,
      label: `${execution.harness} · ${execution.result ? 'result' : execution.failed ? 'failed' : 'running'}`,
      trust: 'VERIFIED' as const,
      x: 0,
      y: 0,
    })));
    const executionEdges: WbEdge[] = executionNodes.map((node) => {
      const executionId = node.id.slice('execution:'.length);
      const observedEvent = projectActivity.find((event) => event.harness && event.runtimeRef && `${event.harness}::${event.runtimeRef}` === executionId);
      return {
        id: `execution:${observedEvent?.conversationKey ?? 'unknown'}->${executionId}`,
        source: `conversation:${observedEvent?.conversationKey ?? ''}`,
        target: node.id,
        kind: 'execution' as const,
      };
    }).filter((edge) => graph.nodes.some((node) => node.id === edge.source));
    const handoffEdges: WbEdge[] = projectTrajectory(projectActivity).relations.map((relation) => ({
      id: relation.id,
      source: `execution:${relation.sourceExecutionId}`,
      target: `execution:${relation.targetExecutionId}`,
      kind: 'handoff',
    }));
    const semanticNodes = [...graph.nodes, ...executionNodes];
    const semanticEdges = [...graph.edges, ...executionEdges, ...handoffEdges];
    const positioned = layoutProjection(semanticNodes, semanticEdges);
    const nodes: Node[] = positioned.map((node) => ({
      id: node.id,
      position: { x: node.x, y: node.y },
      data: {
        label: (
          <span className="canvas-node-copy">
            <strong>{node.label}</strong>
            <small>{node.kind}{node.status ? ` · ${node.status}` : ''}</small>
          </span>
        ),
        kind: node.kind,
        status: node.status,
      },
      className: `wb-node wb-${node.kind} status-${(node.status ?? '').toLowerCase()}`,
    }));
    const edges: Edge[] = semanticEdges.map((edge) => {
      const evidenced = edge.kind === 'execution' || edge.kind === 'handoff' || edge.kind === 'data-context';
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Structural availability (membership/mount) reads as a fan from its
        // anchor; observed runtime edges keep routed arrows.
        type: evidenced ? 'smoothstep' : 'default',
        className: `wb-edge-${edge.kind}`,
        markerEnd: { type: evidenced ? MarkerType.ArrowClosed : MarkerType.Arrow, width: 10, height: 10 },
        style: {
          strokeWidth: evidenced ? 1.7 : 1.1,
          strokeDasharray: edge.kind === 'mount' ? '3 5' : undefined,
        },
      };
    });
    return { nodes, edges, kinds: [...new Set(semanticEdges.map((edge) => edge.kind))] };
  }, [snapshot, projectId, runtimeSessions, activity]);

  if (!projectId) return null;

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.55, maxZoom: 1.15 }}
        minZoom={0.35}
        maxZoom={1.8}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_event, node) => {
          if (!snapshot) return;
          if (node.id.startsWith('execution:')) {
            openRuntimeInspector({ executionId: node.id.slice('execution:'.length) });
            return;
          }
          if (!node.id.startsWith('conversation:')) return;
          const conversationKey = node.id.slice('conversation:'.length);
          const next = snapshot.conversations.find((conversation) => conversation.key === conversationKey);
          if (next) {
            selectConversation(next);
            setView('control');
          }
        }}
      >
        <Background color="var(--prototype-grid)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="canvas-title">
          <p>Session trajectory</p>
          <span>Native executions and explicit handoffs. Card position never defines lineage.</span>
        </Panel>
        <Panel position="top-right" className="canvas-legend">
          {kinds.map((kind) => <span key={kind}><i className={`legend-line legend-${kind}`} />{EDGE_LABEL[kind]}</span>)}
        </Panel>
      </ReactFlow>
    </div>
  );
}
