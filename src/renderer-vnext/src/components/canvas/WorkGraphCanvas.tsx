import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  buildExecutionStory,
  buildGraphElements,
  buildRegionNavigation,
  currentSelectionForNode,
  focusNeighborhood,
  projectRegionVisibility,
  resolveCompactNavigate,
  workRegionFitIds,
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

function FocusDetailPanel({ detail, story, onClose, onPrepare }: {
  detail: FocusDetail;
  story: ReturnType<typeof buildExecutionStory>;
  onClose: () => void;
  onPrepare: () => void;
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
      </div>
      {story && (
        <section className="execution-story" aria-label="Execution story">
          <p className="wb-kicker">Running now</p>
          <dl>
            <dt>Doing</dt><dd>{story.doing}</dd>
            <dt>Using</dt><dd>{story.context.length > 0 ? story.context.join(' · ') : 'No consumed Context fact'}</dd>
            <dt>Output</dt><dd>{story.outputs.length > 0 ? story.outputs.join(' · ') : 'No produced Artifact fact yet'}</dd>
            <dt>Next</dt><dd>{story.next}</dd>
          </dl>
          {(story.packetId || story.intentId) && (
            <p className="execution-trace wb-mono">
              {story.packetId ? `packet ${story.packetId}` : ''}{story.packetId && story.intentId ? ' · ' : ''}{story.intentId ? `intent ${story.intentId}` : ''}
            </p>
          )}
        </section>
      )}
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

export function WorkGraphCanvas({ revision, projectIds, onSelectProject, onRefresh, navigateRequest, onNavigated }: {
  revision: WorkGraphRevision;
  projectIds: string[];
  onSelectProject: (projectId: string) => void;
  onRefresh: () => Promise<void>;
  navigateRequest?: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' } | null;
  onNavigated?: () => void;
}) {
  const initial = useMemo(() => buildGraphElements(revision), [revision]);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkGraphNodeData>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [preparationStage, setPreparationStage] = useState<'context' | 'preflight' | null>(null);
  const [preparedPacket, setPreparedPacket] = useState<{ conversationKey: string; packetId: string } | null>(null);
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());
  const [navCollapsed, setNavCollapsed] = useState(false);
  const fittedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedId((current) => current && initial.nodes.some((node) => node.id === current) ? current : null);
    setCollapsedRegions(new Set());
    setPreparedPacket(null);
    setPreparationStage(null);
  }, [initial, setEdges, setNodes]);

  // Compact → Full handoff: apply the navigation identity to the canvas.
  // A request for another known project switches first; the pending request
  // survives the revision change and applies once that project arrives.
  // Identity resolves against `initial` (always in sync with the revision);
  // the live `nodes` state only supplies the viewport position, so a
  // revision change can never clear the request on stale nodes.
  // Exact node ids only; unknown identities are ignored, never guessed.
  useEffect(() => {
    if (!navigateRequest || !instance) return;
    const projectId = revision.candidate.scope.projectId;
    const resolved = resolveCompactNavigate(
      navigateRequest,
      projectId,
      projectIds,
      new Set(initial.nodes.map((node) => node.id)),
    );
    if (resolved.resolution === 'switch-project') {
      onSelectProject(resolved.projectId);
      return;
    }
    if (resolved.resolution === 'apply') {
      const target = nodes.find((node) => node.id === resolved.nodeId);
      // Nodes state still syncing to the new revision: keep pending, retry
      // when the synced nodes arrive instead of dropping the request.
      if (!target) return;
      setSelectedId(target.id);
      void instance.setCenter(target.position.x + 80, target.position.y + 36, { zoom: Math.max(instance.getZoom(), 0.85), duration: 320 });
      if (navigateRequest.action === 'prepare') {
        setPreparedPacket(null);
        setPreparationStage('context');
      }
    }
    onNavigated?.();
  }, [initial, instance, navigateRequest, nodes, onNavigated, onSelectProject, projectIds, revision]);

  // Work-first viewport: switching projects frames the Work regions (+ the
  // project anchor), never the project-scoped knowledge wall. A tall
  // peripheral column in a 1-Work project used to shrink the current Work
  // into a corner and leave 2-Work targets outside the viewport. The Compact
  // handoff owns the viewport while its request is pending, and a repeated
  // effect run for the same scope never refits (no fighting the user).
  const scopeProjectId = revision.candidate.scope.projectId;
  useEffect(() => {
    if (!instance || navigateRequest) {
      if (!instance) fittedScopeRef.current = null;
      return;
    }
    if (fittedScopeRef.current === scopeProjectId) return;
    fittedScopeRef.current = scopeProjectId;
    const frame = window.setTimeout(() => {
      const wanted = new Set(workRegionFitIds(initial.nodes));
      const framed = initial.nodes.filter((node) => wanted.has(node.id));
      if (framed.length > 0) {
        void instance.fitView({ nodes: framed, padding: 0.2, duration: 320 });
      }
    }, 60);
    return () => window.clearTimeout(frame);
  }, [initial, instance, navigateRequest, scopeProjectId]);

  // Explicit region-visibility gestures refit to what stays visible, so
  // Keep current always lands on the current Work instead of empty canvas.
  const fitVisibleRegions = useCallback((visibleRegionIds: readonly string[]) => {
    if (!instance || visibleRegionIds.length === 0) return;
    const framed = nodes.filter((node) => visibleRegionIds.includes(node.id));
    if (framed.length === 0) return;
    void instance.fitView({ nodes: framed, padding: 0.2, duration: 320 });
  }, [instance, nodes]);

  const selectedNode = nodes.find((node) => node.id === selectedId && node.type !== 'wb-region') ?? null;
  const detail = selectedId && selectedNode ? buildFocusDetail(revision, selectedId) : null;
  const executionStory = selectedId ? buildExecutionStory(revision, selectedId) : null;
  const neighborhood = useMemo(
    () => (selectedId ? focusNeighborhood(revision, selectedId) : null),
    [revision, selectedId],
  );
  const visibility = useMemo(
    () => projectRegionVisibility(nodes, edges, collapsedRegions),
    [collapsedRegions, edges, nodes],
  );
  const visibleEdges = useMemo(
    () => styledEdges(visibility.edges, selectedNode ? selectedId : null, neighborhood, hoveredEdgeId),
    [visibility.edges, selectedNode, selectedId, neighborhood, hoveredEdgeId],
  );
  const visibleNodes = useMemo(() => {
    if (!selectedId || !neighborhood) return visibility.nodes;
    return visibility.nodes.map((node) => ({
      ...node,
      className: neighborhood.has(node.id) ? 'is-neighbor' : node.className,
    }));
  }, [visibility.nodes, selectedId, neighborhood]);

  // Explicit Full-Workbench Work/Task selection updates the thin local
  // current-selection bookmark the Compact surface reads. Never written
  // from recency/cwd/activity — only from this explicit click — and never
  // re-scoped onto another project by a stale node mid project-switch.
  useEffect(() => {
    const semantic = selectedNode?.data.semantic;
    if (!semantic || (semantic.kind !== 'work' && semantic.kind !== 'task')) return;
    const selection = currentSelectionForNode(semantic, revision.candidate.scope.projectId);
    if (!selection) return;
    void window.wb.setCurrentSelection(selection).catch(() => undefined);
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
  const regionNavigation = useMemo(() => buildRegionNavigation(nodes, selectedId), [nodes, selectedId]);
  const projectNode = nodes.find((node) => node.data.kind === 'project');

  const focusRegion = useCallback((regionId: string) => {
    setCollapsedRegions((current) => {
      if (!current.has(regionId)) return current;
      const next = new Set(current);
      next.delete(regionId);
      return next;
    });
    const region = nodes.find((node) => node.id === regionId);
    if (region && instance) void instance.fitView({ nodes: [region], padding: 0.18, duration: 320 });
  }, [instance, nodes]);

  const toggleRegion = useCallback((regionId: string) => {
    setCollapsedRegions((current) => {
      const next = new Set(current);
      if (next.has(regionId)) next.delete(regionId); else next.add(regionId);
      return next;
    });
    const selected = nodes.find((node) => node.id === selectedId);
    if (selected?.parentNode === regionId) setSelectedId(null);
  }, [nodes, selectedId]);

  const openPreparation = useCallback(() => {
    setPreparedPacket(null);
    setPreparationStage('context');
  }, []);

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
            <button
              type="button"
              className="wb-tool"
              aria-pressed={preparationStage !== null}
              onClick={openPreparation}
              title={selectedNode && (selectedNode.data.kind === 'task' || selectedNode.data.kind === 'work') ? `Prepare · ${selectedNode.data.label}` : 'Prepare Work'}
            >
              Prepare work
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

      {(projectNode || projectIds.length > 0) && (
        <nav className="wb-region-nav wb-glass" aria-label="Work regions">
          <div className="region-nav-project">
            <span className="region-nav-kicker">
              <span>Current project</span>
              <button
                type="button"
                className="region-nav-toggle"
                aria-expanded={!navCollapsed}
                aria-label={navCollapsed ? 'Expand work list' : 'Collapse work list'}
                title={navCollapsed ? 'Expand work list' : 'Collapse work list'}
                onClick={() => setNavCollapsed((collapsed) => !collapsed)}
              >
                {navCollapsed ? '▸' : '▾'}
              </button>
            </span>
            <strong>{projectNode?.data.label ?? revision.candidate.scope.projectId}</strong>
            <select
              aria-label="Switch project"
              value={revision.candidate.scope.projectId}
              disabled={projectIds.length < 2}
              onChange={(event) => onSelectProject(event.target.value)}
            >
              {(projectIds.includes(revision.candidate.scope.projectId) ? projectIds : [revision.candidate.scope.projectId, ...projectIds]).map((projectId) => (
                <option key={projectId} value={projectId}>{projectId}</option>
              ))}
            </select>
          </div>
          {!navCollapsed && (
          <div className="region-nav-list">
            {regionNavigation.length === 0 && <p className="region-nav-empty">No canonical Work in this project.</p>}
            {regionNavigation.map((region, index) => (
              <div className={`region-nav-row${region.active ? ' is-active' : ''}`} key={region.regionId}>
                <button type="button" className="region-nav-focus" onClick={() => focusRegion(region.regionId)}>
                  <span className="region-nav-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="region-nav-name" title={region.label}>{region.label}</span>
                  <span className="region-nav-count">{region.taskCount}</span>
                </button>
                <button
                  type="button"
                  className="region-nav-collapse"
                  aria-label={`${collapsedRegions.has(region.regionId) ? 'Expand' : 'Collapse'} ${region.label}`}
                  onClick={() => toggleRegion(region.regionId)}
                >
                  {collapsedRegions.has(region.regionId) ? '+' : '−'}
                </button>
              </div>
            ))}
          </div>
          )}
          {!navCollapsed && (
          <div className="region-nav-actions">
            <button
              type="button"
              onClick={() => {
                setCollapsedRegions(new Set());
                fitVisibleRegions(regionNavigation.map((region) => region.regionId));
              }}
            >Show all</button>
            <button
              type="button"
              disabled={!regionNavigation.some((region) => region.active)}
              onClick={() => {
                const active = regionNavigation.find((region) => region.active);
                if (!active) return;
                setCollapsedRegions(new Set(regionNavigation.filter((region) => region.regionId !== active.regionId).map((region) => region.regionId)));
                fitVisibleRegions([active.regionId]);
              }}
            >Keep current</button>
          </div>
          )}
        </nav>
      )}

      {detail && (
        <FocusDetailPanel
          detail={detail}
          story={executionStory}
          onClose={() => setSelectedId(null)}
          onPrepare={openPreparation}
        />
      )}
      {preparationStage === 'preflight' && preparedPacket && (
        <DispatchSurface
          projectId={revision.candidate.scope.projectId}
          selection={dispatchSelection}
          initialConversationKey={preparedPacket.conversationKey}
          initialPacketId={preparedPacket.packetId}
          onEditContext={() => setPreparationStage('context')}
          onClose={() => setPreparationStage(null)}
        />
      )}
      {preparationStage === 'context' && (
        <ContextCabinet
          projectId={revision.candidate.scope.projectId}
          selection={cabinetSelection}
          onPrepared={(packet) => {
            setPreparedPacket(packet);
            setPreparationStage('preflight');
          }}
          onClose={() => setPreparationStage(null)}
        />
      )}
    </div>
  );
}
