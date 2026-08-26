import { useMemo } from 'react';
import { Background, Controls, Panel, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildCanvasGraph } from '../../../core/project/canvas';
import { useWorkbench } from '../store';

export function CanvasView() {
  const { snapshot, projectId, runtimeSessions, selectConversation, setView } = useWorkbench();

  const { nodes, edges } = useMemo(() => {
    if (!snapshot || !projectId) return { nodes: [] as Node[], edges: [] as Edge[] };
    const g = buildCanvasGraph(snapshot, projectId, runtimeSessions);
    const nodes: Node[] = g.nodes.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: `${n.label}${n.status ? `\n${n.status} · ${n.trust}` : ''}`, kind: n.kind, status: n.status },
      className: `wb-node wb-${n.kind} status-${(n.status ?? '').toLowerCase()}`,
    }));
    const edges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: e.kind === 'execution' || e.kind === 'handoff',
      className: `wb-edge-${e.kind}`,
      style:
        e.kind === 'data-context'
          ? { strokeDasharray: '6 4' }
          : e.kind === 'mount'
            ? { strokeDasharray: '2 5' }
            : undefined,
    }));
    return { nodes, edges };
  }, [snapshot, projectId, runtimeSessions]);

  if (!projectId) return null;

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_e, node) => {
          if (!snapshot || !node.id.startsWith('conversation:')) return;
          const convoId = node.id.slice('conversation:'.length);
          const convo = snapshot.conversations.find((c) => c.key === convoId);
          if (convo) {
            selectConversation(convo);
            setView('control');
          }
        }}
      >
        <Background />
        <Controls />
        <Panel position="top-left" className="canvas-legend">
          <span><i className="legend-line" /> membership</span>
          <span><i className="legend-line legend-mount" /> mount</span>
          <span className="legend-note">Flow edges appear only with evidence</span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
