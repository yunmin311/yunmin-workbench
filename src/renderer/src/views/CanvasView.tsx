import { useMemo } from 'react';
import { Background, Controls, MarkerType, Panel, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildCanvasGraph } from '../../../core/project/canvas';
import type { WbEdgeKind } from '../../../core/types';
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
  const selectConversation = useWorkbench((state) => state.selectConversation);
  const setView = useWorkbench((state) => state.setView);

  const { nodes, edges, kinds } = useMemo(() => {
    if (!snapshot || !projectId) return { nodes: [] as Node[], edges: [] as Edge[], kinds: [] as WbEdgeKind[] };
    const graph = buildCanvasGraph(snapshot, projectId, runtimeSessions);
    const positioned = layoutProjection(graph.nodes, graph.edges);
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
    const edges: Edge[] = graph.edges.map((edge) => {
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
    return { nodes, edges, kinds: [...new Set(graph.edges.map((edge) => edge.kind))] };
  }, [snapshot, projectId, runtimeSessions]);

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
          if (!snapshot || !node.id.startsWith('conversation:')) return;
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
          <p>Projection graph</p>
          <span>Structure first. Runtime edges only when observed.</span>
        </Panel>
        <Panel position="top-right" className="canvas-legend">
          {kinds.map((kind) => <span key={kind}><i className={`legend-line legend-${kind}`} />{EDGE_LABEL[kind]}</span>)}
        </Panel>
      </ReactFlow>
    </div>
  );
}
