import { useMemo } from 'react';
import { Background, Controls, MarkerType, Panel, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { projectionStateToCanvas } from '../../../core/projection/canvasProjection';
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
  const projectId = useWorkbench((state) => state.projectId);
  const projection = useWorkbench((state) => state.projection);
  const selectProjectedConversation = useWorkbench((state) => state.selectProjectedConversation);
  const setView = useWorkbench((state) => state.setView);
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);

  const { nodes, edges, kinds } = useMemo(() => {
    const canvas = projectionStateToCanvas(projection);
    if (!canvas.graph || !projection.current) {
      return { nodes: [] as Node[], edges: [] as Edge[], kinds: [] as WbEdgeKind[] };
    }
    const semanticEdges = canvas.graph.edges;
    const generated = layoutProjection(canvas.graph.nodes, semanticEdges);
    const positions = projection.current.candidate.layoutState.nodePositions;
    const memoryLayoutId = projection.current.candidate.semanticFacts.artifactsOrEvidence
      .find((item) => item.kind === 'memory-index')?.id;
    const positioned = generated.map((node) => {
      const layoutId = node.id === 'memory:vault' ? memoryLayoutId : node.id;
      const stored = layoutId ? positions[layoutId] : undefined;
      return stored ? { ...node, ...stored } : node;
    });
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
  }, [projection]);

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
          if (node.id.startsWith('execution:')) {
            openRuntimeInspector({ executionId: node.id.slice('execution:'.length) });
            return;
          }
          if (!node.id.startsWith('conversation:')) return;
          selectProjectedConversation(node.id);
          setView('control');
        }}
      >
        <Background color="var(--prototype-grid)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="canvas-title">
          <p>Session trajectory</p>
          <span>
            {projection.status === 'VERIFIED'
              ? `Verified projection · ${projection.current?.revisionId.slice(0, 28) ?? 'no revision'}`
              : projection.current
                ? `${projection.status} · showing last verified revision`
                : `${projection.status} · no verified projection available`}
          </span>
          {projection.diagnostics[0]
            ? <span>{projection.diagnostics[0].code}: {projection.diagnostics[0].message}</span>
            : null}
          <span>Native executions and explicit handoffs. Card position never defines lineage.</span>
        </Panel>
        <Panel position="top-right" className="canvas-legend">
          {kinds.map((kind) => <span key={kind}><i className={`legend-line legend-${kind}`} />{EDGE_LABEL[kind]}</span>)}
        </Panel>
      </ReactFlow>
    </div>
  );
}
