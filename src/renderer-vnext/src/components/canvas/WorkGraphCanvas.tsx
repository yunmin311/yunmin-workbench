import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Handle,
  Panel,
  Position,
  useEdgesState,
  useNodesState,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { WorkGraphRevision } from '../../types';
import { ContextCabinet, type CabinetSelection } from '../cabinet/ContextCabinet';
import { DispatchSurface, type DispatchSelection } from '../dispatch/DispatchSurface';
import {
  buildFocusDetail,
  buildGraphElements,
  type CanvasEdge,
  type WorkGraphNodeData,
} from '../../workGraphView';

const kindColor: Record<WorkGraphNodeData['kind'], string> = {
  project: '#8b5cf6', work: '#6366f1', task: '#a855f7', conversation: '#06b6d4',
  execution: '#f59e0b', context: '#84cc16', 'memory-source': '#ec4899', artifact: '#f97316',
  gate: '#ef4444', evidence: '#14b8a6', handoff: '#eab308',
};

function WorkGraphNodeCard({ data, selected }: NodeProps<WorkGraphNodeData>) {
  return (
    <div className={`workgraph-node${selected ? ' is-selected' : ''}`} style={{ borderColor: kindColor[data.kind] }} data-kind={data.kind}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="node-header">
        <span className="node-kind-badge" style={{ backgroundColor: kindColor[data.kind] }}>{data.kind}</span>
        <span className="verification-badge">{data.verification}</span>
      </div>
      <div className="node-label" title={data.label}>{data.label}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { workgraph: WorkGraphNodeCard };

const edgeColors: Record<string, string> = {
  membership: '#475569', 'depends-on': '#64748b', 'uses-context': '#84cc16', produces: '#f59e0b',
  evidences: '#14b8a6', 'blocked-by': '#ef4444', handoff: '#eab308', 'execution-of': '#f59e0b',
  'derived-from': '#6366f1',
};

function styledEdges(edges: CanvasEdge[], selectedId: string | null, hoveredEdgeId: string | null): CanvasEdge[] {
  return edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: edge.data?.kind === 'handoff' || edge.data?.kind === 'uses-context',
    label: (edge.id === hoveredEdgeId || edge.source === selectedId || edge.target === selectedId)
      ? (edge.data?.evidenceCount ? `${edge.data.kind} · ◇${edge.data.evidenceCount}` : edge.data?.kind)
      : undefined,
    labelStyle: { fill: '#94a3b8', fontSize: 9 },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.88 },
    style: {
      stroke: edgeColors[edge.data?.kind ?? ''] ?? '#64748b',
      strokeWidth: edge.data?.kind === 'membership' ? 1 : 1.8,
      strokeDasharray: edge.data?.kind === 'membership' ? '4 4' : undefined,
    },
  }));
}

export function WorkGraphCanvas({ revision, onRefresh, navigateRequest, onNavigated }: {
  revision: WorkGraphRevision;
  onRefresh: () => Promise<void>;
  navigateRequest?: { projectId: string; workId?: string; taskId?: string } | null;
  onNavigated?: () => void;
}) {
  const initial = useMemo(() => buildGraphElements(revision), [revision]);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkGraphNodeData>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedId((current) => current && initial.nodes.some((node) => node.id === current) ? current : null);
  }, [initial, setEdges, setNodes]);

  // Compact → Full handoff: apply the navigation identity to the canvas.
  // Exact node ids only; unknown identities are ignored, never guessed.
  useEffect(() => {
    if (!navigateRequest || !instance) return;
    const projectId = revision.candidate.scope.projectId;
    if (navigateRequest.projectId !== projectId) {
      onNavigated?.();
      return;
    }
    const candidates = [
      navigateRequest.taskId !== undefined ? `task:${projectId}:${navigateRequest.taskId}` : null,
      navigateRequest.workId !== undefined ? `work:${projectId}:${navigateRequest.workId}` : null,
      `project:${projectId}`,
    ].filter((id): id is string => id !== null);
    const target = candidates
      .map((id) => nodes.find((node) => node.id === id))
      .find((node) => node !== undefined);
    if (target) {
      setSelectedId(target.id);
      void instance.setCenter(target.position.x + 80, target.position.y + 36, { zoom: Math.max(instance.getZoom(), 0.7), duration: 250 });
    }
    onNavigated?.();
  }, [instance, navigateRequest, nodes, onNavigated, revision]);

  const detail = selectedId ? buildFocusDetail(revision, selectedId) : null;
  const visibleEdges = useMemo(() => styledEdges(edges, selectedId, hoveredEdgeId), [edges, hoveredEdgeId, selectedId]);
  const focusCurrentOrProject = useCallback(() => {
    if (!instance) return;
    const targetId = selectedId ?? nodes.find((node) => node.data.kind === 'project')?.id;
    const target = nodes.find((node) => node.id === targetId);
    if (target) void instance.fitView({ nodes: [target], padding: 0.8, duration: 250 });
  }, [instance, nodes, selectedId]);
  const attentionNodes = nodes.filter((node) => node.data.kind === 'gate');
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const cabinetSelection: CabinetSelection | null = selectedNode
    ? {
      kind: selectedNode.data.kind,
      label: selectedNode.data.label,
      ...((selectedNode.data.semantic.kind === 'conversation')
        ? {
          conversationKey: selectedNode.data.semantic.conversationKey,
          ...(selectedNode.data.semantic.canonicalConversationId
            ? { canonicalConversationId: selectedNode.data.semantic.canonicalConversationId }
            : {}),
        }
        : {}),
    }
    : null;
  const dispatchSelection: DispatchSelection | null = selectedNode
    ? {
      kind: selectedNode.data.kind,
      label: selectedNode.data.label,
      sourceRef: selectedNode.data.sourceRef,
      ...((selectedNode.data.semantic.kind === 'task')
        ? {
          workId: selectedNode.data.semantic.workId,
          taskId: selectedNode.data.semantic.taskId,
          taskState: selectedNode.data.semantic.taskState,
        }
        : {}),
      ...((selectedNode.data.semantic.kind === 'work')
        ? { workId: selectedNode.data.semantic.workId }
        : {}),
      ...((selectedNode.data.semantic.kind === 'conversation')
        ? { conversationKey: selectedNode.data.semantic.conversationKey }
        : {}),
    }
    : null;

  // Explicit Full-Workbench Work/Task selection updates the thin local
  // current-selection bookmark the Compact surface reads. Never written
  // from recency/cwd/activity — only from this explicit click.
  useEffect(() => {
    const semantic = selectedNode?.data.semantic;
    if (!semantic || (semantic.kind !== 'work' && semantic.kind !== 'task')) return;
    void window.wb.setCurrentSelection({
      projectId: revision.candidate.scope.projectId,
      ...(semantic.kind === 'work' ? { workId: semantic.workId } : {}),
      ...(semantic.kind === 'task' ? { workId: semantic.workId, taskId: semantic.taskId } : {}),
    }).catch(() => undefined);
  }, [selectedNode, revision]);

  return (
    <div className="workgraph-canvas-container">
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={setInstance}
        onNodeClick={(_event, node) => {
          setSelectedId(node.id);
          void instance?.setCenter(node.position.x + 80, node.position.y + 36, { zoom: Math.max(instance.getZoom(), 0.7), duration: 250 });
        }}
        onPaneClick={() => setSelectedId(null)}
        onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.2}
      >
        <Background color="#334155" gap={24} size={1} />
        <Panel position="top-left" className="graph-controls" aria-label="Graph controls">
          <button type="button" onClick={() => void instance?.fitView({ padding: 0.18, duration: 250 })}>Fit</button>
          <button type="button" onClick={focusCurrentOrProject}>Focus {selectedId ? 'current' : 'project'}</button>
          <button
            type="button"
            aria-pressed={cabinetOpen}
            onClick={() => setCabinetOpen((open) => !open)}
            title={selectedNode && (selectedNode.data.kind === 'work' || selectedNode.data.kind === 'task')
              ? `Context Cabinet — staging for ${selectedNode.data.label}`
              : 'Context Cabinet'}
          >
            Cabinet
          </button>
          <button type="button" onClick={() => void onRefresh()}>Refresh</button>
          <button
            type="button"
            aria-pressed={dispatchOpen}
            onClick={() => setDispatchOpen((open) => !open)}
            title={selectedNode && (selectedNode.data.kind === 'task' || selectedNode.data.kind === 'work')
              ? `Dispatch ${selectedNode.data.label}`
              : 'Dispatch — QUICK (no canonical Task)'}
          >
            Dispatch
          </button>
          {attentionNodes.length > 0 && (
            <button type="button" onClick={() => void instance?.fitView({ nodes: attentionNodes, padding: 0.8, duration: 250 })}>Attention</button>
          )}
        </Panel>
      </ReactFlow>
      {dispatchOpen && (
        <DispatchSurface
          projectId={revision.candidate.scope.projectId}
          selection={dispatchSelection}
          onClose={() => setDispatchOpen(false)}
        />
      )}
      {cabinetOpen && (
        <ContextCabinet
          projectId={revision.candidate.scope.projectId}
          selection={cabinetSelection}
          onClose={() => setCabinetOpen(false)}
        />
      )}
      {detail && (
        <aside className="focus-detail" role="complementary" aria-label="Focus Detail">
          <button className="focus-close" type="button" aria-label="Close Focus Detail" onClick={() => setSelectedId(null)}>×</button>
          <p className="detail-kicker">Focus Detail</p>
          <h2>{detail.label}</h2>
          <dl>
            <dt>Kind</dt><dd>{detail.kind}</dd>
            <dt>Source</dt><dd>{detail.source}</dd>
            <dt>Source ref</dt><dd>{detail.sourceRef}</dd>
            <dt>Verification</dt><dd>{detail.verification}</dd>
            {detail.currentness && <><dt>Currentness</dt><dd>{detail.currentness}</dd></>}
            {detail.taskState && <><dt>Task</dt><dd>{detail.taskState}</dd></>}
            {detail.runtimeState && <><dt>Runtime</dt><dd>{detail.runtimeState}</dd></>}
            {detail.attentionState && <><dt>Attention</dt><dd>{detail.attentionState}</dd></>}
          </dl>
          <h3>Direct relations</h3>
          {detail.relations.length > 0
            ? <ul>{detail.relations.map((relation) => <li key={relation.id}><span>{relation.kind}</span>{relation.otherLabel}</li>)}</ul>
            : <p className="detail-empty">None</p>}
        </aside>
      )}
    </div>
  );
}
