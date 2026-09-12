import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Panel,
  useEdgesState,
  useNodesState,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { WorkGraphRevision } from '../../types';
import { ContextCabinet, type CabinetSelection } from '../cabinet/ContextCabinet';
import { DispatchSurface, type DispatchSelection } from '../dispatch/DispatchSurface';
import {
  buildFocusDetail,
  buildGraphElements,
  focusNeighborhood,
  type CanvasEdge,
  type FocusDetail,
  type WorkGraphNodeData,
} from '../../workGraphView';
import { wbNodeTypes } from './nodes';

function WorkspaceTally({ revision }: { revision: WorkGraphRevision }) {
  const nodes = revision.candidate.semanticFacts.nodes;
  const count = (predicate: (kind: string) => boolean) =>
    nodes.filter((node) => predicate(node.kind)).length;
  const running = count((kind) => kind === 'execution');
  const gates = count((kind) => kind === 'gate');
  return (
    <span className="wb-tally" aria-label="Workspace tally">
      <span>Works {count((kind) => kind === 'work')}</span>
      <span>Tasks {count((kind) => kind === 'task')}</span>
      <span>Artifacts {count((kind) => kind === 'artifact')}</span>
      <span className={running > 0 ? 'is-live' : ''}>Running {running}</span>
      {gates > 0 && <span className="is-gate">Gates {gates}</span>}
    </span>
  );
}

/* Edge language: structure is quiet, flow is alive, verification is secondary.
   Labels only appear on focus/hover. */

const EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string; flow?: boolean }> = {
  membership: { stroke: 'rgba(148,163,184,0.2)', width: 1, dash: '2 5' },
  'execution-of': { stroke: 'rgba(134,201,154,0.55)', width: 1.6, flow: true },
  'uses-context': { stroke: 'rgba(127,196,178,0.55)', width: 1.6, flow: true },
  produces: { stroke: 'rgba(216,164,106,0.6)', width: 1.6, flow: true },
  handoff: { stroke: 'rgba(143,168,232,0.6)', width: 1.6, flow: true },
  'derived-from': { stroke: 'rgba(167,163,224,0.5)', width: 1.4, flow: true },
  'blocked-by': { stroke: 'rgba(224,138,128,0.55)', width: 1.6 },
  evidences: { stroke: 'rgba(157,184,201,0.4)', width: 1.2, dash: '6 4' },
  'depends-on': { stroke: 'rgba(148,163,184,0.4)', width: 1.2, dash: '5 4' },
};

function styledEdges(edges: CanvasEdge[], focusId: string | null, neighborhood: Set<string> | null, hoveredEdgeId: string | null): CanvasEdge[] {
  return edges.map((edge) => {
    const base = EDGE_STYLE[edge.data?.kind ?? ''] ?? { stroke: 'rgba(148,163,184,0.35)', width: 1.2 };
    const touched = focusId === null
      || edge.source === focusId || edge.target === focusId
      || edge.id === hoveredEdgeId;
    return {
      ...edge,
      type: 'smoothstep',
      animated: Boolean(base.flow) && touched,
      label: (edge.id === hoveredEdgeId || (focusId !== null && (edge.source === focusId || edge.target === focusId)))
        ? edge.data?.kind
        : undefined,
      labelStyle: { fill: '#9aa4b2', fontSize: 9 },
      labelBgStyle: { fill: 'rgba(16,19,24,0.9)', fillOpacity: 0.92 },
      style: {
        stroke: base.stroke,
        strokeWidth: touched ? base.width + 0.4 : base.width,
        strokeDasharray: base.dash,
        opacity: focusId === null || touched ? 1 : 0.16,
      },
      ...(neighborhood ? {} : {}),
    };
  });
}

function FocusDetailPanel({ detail, onClose, onPrepare, onOpenCabinet }: {
  detail: FocusDetail;
  onClose: () => void;
  onPrepare: () => void;
  onOpenCabinet: () => void;
}) {
  const grouped = detail.relations.reduce<Record<string, FocusDetail['relations']>>((acc, relation) => {
    const key = relation.kind;
    (acc[key] ??= []).push(relation);
    return acc;
  }, {});
  const canPrepare = detail.kind === 'task' || detail.kind === 'work';
  return (
    <aside className="focus-panel wb-glass" role="complementary" aria-label="Focus Detail">
      <button className="focus-close" type="button" aria-label="Close Focus Detail" onClick={onClose}>×</button>
      <p className="wb-kicker">Focus · {detail.family}</p>
      <h2 className="focus-title">{detail.label}</h2>
      <div className="focus-chips">
        <span className="wb-chip">{detail.verification}</span>
        {detail.currentness && detail.currentness !== 'UNKNOWN' && (
          <span className={`wb-chip ${detail.currentness === 'CURRENT' ? 'is-green' : detail.currentness === 'STALE' ? 'is-amber' : detail.currentness === 'INVALID' ? 'is-red' : ''}`}>
            {detail.currentness}
          </span>
        )}
        {detail.taskState && detail.taskState !== 'unknown' && <span className="wb-chip">{detail.taskState}</span>}
        {detail.runtimeState && <span className="wb-chip is-blue">{detail.runtimeState}</span>}
        {detail.attentionState && detail.attentionState !== 'none' && detail.attentionState !== 'unknown' && <span className="wb-chip is-amber">{detail.attentionState}</span>}
      </div>
      <dl className="focus-meta">
        <dt>Source</dt><dd className="wb-mono">{detail.source}</dd>
        <dt>Source ref</dt><dd className="wb-mono">{detail.sourceRef || '—'}</dd>
      </dl>
      <div className="focus-actions">
        {canPrepare && (
          <button type="button" className="wb-btn is-accent" onClick={onPrepare}>
            Prepare Work
          </button>
        )}
        <button type="button" className="wb-btn" onClick={onOpenCabinet}>
          Context Cabinet
        </button>
      </div>
      <h3 className="wb-kicker">Relations</h3>
      {detail.relations.length === 0 && <p className="focus-empty">No direct relations.</p>}
      {Object.entries(grouped).map(([kind, relations]) => (
        <div className="focus-relation-group" key={kind}>
          <div className="focus-relation-kind">{kind}</div>
          <ul>
            {relations.map((relation) => (
              <li key={relation.id}>
                <span className={`wb-relation-arrow ${relation.direction === 'in' ? 'is-in' : ''}`} aria-hidden="true">
                  {relation.direction === 'in' ? '←' : '→'}
                </span>
                <span className="focus-relation-label">{relation.otherLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
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
      void instance.setCenter(target.position.x + 80, target.position.y + 36, { zoom: Math.max(instance.getZoom(), 0.85), duration: 320 });
    }
    onNavigated?.();
  }, [instance, navigateRequest, nodes, onNavigated, revision]);

  const selectedNode = nodes.find((node) => node.id === selectedId && node.type !== 'wb-region') ?? null;
  const detail = selectedId && selectedNode ? buildFocusDetail(revision, selectedId) : null;
  const neighborhood = useMemo(
    () => (selectedId ? focusNeighborhood(revision, selectedId) : null),
    [revision, selectedId],
  );
  const visibleEdges = useMemo(
    () => styledEdges(edges, selectedNode ? selectedId : null, neighborhood, hoveredEdgeId),
    [edges, selectedNode, selectedId, neighborhood, hoveredEdgeId],
  );
  const visibleNodes = useMemo(() => {
    if (!selectedId || !neighborhood) return nodes;
    return nodes.map((node) => ({
      ...node,
      className: neighborhood.has(node.id) ? 'is-neighbor' : node.className,
    }));
  }, [nodes, selectedId, neighborhood]);

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

  const focusCurrentOrProject = useCallback(() => {
    if (!instance) return;
    const targetId = selectedId ?? nodes.find((node) => node.data.kind === 'project')?.id;
    const target = nodes.find((node) => node.id === targetId);
    if (target) void instance.fitView({ nodes: [target], padding: 0.9, duration: 280 });
  }, [instance, nodes, selectedId]);
  const attentionNodes = nodes.filter((node) => node.data.kind === 'gate');
  const workRegions = nodes.filter((node) => node.type === 'wb-region');

  const dimmed = selectedNode !== null;

  return (
    <div className="workgraph-canvas-container">
      <div className={`wb-canvas-skin${dimmed ? ' is-focus-mode' : ''}`}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={setInstance}
          onNodeClick={(_event, node) => {
            if (node.type === 'wb-region') return;
            setSelectedId(node.id);
            void instance?.setCenter(node.positionAbsolute?.x ?? node.position.x + 80, (node.positionAbsolute?.y ?? node.position.y) + 36, { zoom: Math.max(instance.getZoom(), 0.85), duration: 280 });
          }}
          onPaneClick={() => setSelectedId(null)}
          onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          nodeTypes={wbNodeTypes as never}
          nodesConnectable={false}
          minZoom={0.25}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.16 }}
        >
          <Background color="#1a212b" gap={26} size={1} variant={BackgroundVariant.Dots} />
          <Panel position="top-left" className="wb-canvas-toolbar wb-glass" aria-label="Graph controls">
            <span className="wb-toolbar-brand">Yunmin <em>Workbench</em></span>
            <span className="wb-toolbar-sep" aria-hidden="true" />
            <button type="button" className="wb-tool" onClick={() => void instance?.fitView({ padding: 0.16, duration: 280 })}>Fit</button>
            <button type="button" className="wb-tool" onClick={focusCurrentOrProject}>Focus {selectedId ? 'current' : 'project'}</button>
            <button type="button" className="wb-tool" aria-pressed={cabinetOpen} onClick={() => setCabinetOpen((open) => !open)}>Context</button>
            <button
              type="button"
              className="wb-tool"
              aria-pressed={dispatchOpen}
              onClick={() => setDispatchOpen((open) => !open)}
              title={selectedNode && (selectedNode.data.kind === 'task' || selectedNode.data.kind === 'work') ? `Prepare · ${selectedNode.data.label}` : 'Prepare Work'}
            >
              Prepare
            </button>
            <button type="button" className="wb-tool" onClick={() => void onRefresh()}>Refresh</button>
            {attentionNodes.length > 0 && (
              <button type="button" className="wb-tool is-attention" aria-label="Attention" onClick={() => void instance?.fitView({ nodes: attentionNodes, padding: 0.9, duration: 280 })}>
                ⚑ {attentionNodes.length}
              </button>
            )}
            <span className="wb-toolbar-sep" aria-hidden="true" />
            <WorkspaceTally revision={revision} />
          </Panel>
          {workRegions.length === 0 && (
            <Panel position="bottom-center" className="wb-canvas-note">
              No Work regions yet — Work appears when a canonical source declares it.
            </Panel>
          )}
        </ReactFlow>
      </div>

      {detail && (
        <FocusDetailPanel
          detail={detail}
          onClose={() => setSelectedId(null)}
          onPrepare={() => { setDispatchOpen(true); setCabinetOpen(false); }}
          onOpenCabinet={() => { setCabinetOpen(true); setDispatchOpen(false); }}
        />
      )}
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
    </div>
  );
}
