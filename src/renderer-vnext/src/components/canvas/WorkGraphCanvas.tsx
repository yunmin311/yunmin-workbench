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
import type { AttentionItem, HarnessSessionPresence } from '../../../../core/types';
import type { LiveExecutionPresence } from '../../presenceFreshness';
import { ContextCabinet, type CabinetSelection } from '../cabinet/ContextCabinet';
import { DispatchSurface, type DispatchPreflightState, type DispatchSelection } from '../dispatch/DispatchSurface';
import {
  buildFocusDetail,
  buildExecutionStory,
  buildGraphElements,
  buildRegionNavigation,
  currentSelectionForNode,
  focusNeighborhood,
  projectRegionVisibility,
  relationWord,
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
        ? relationWord(edge.data?.kind ?? 'membership')
        : undefined,
      labelStyle: { fill: '#9aa4b2', fontSize: 9 },
      labelBgStyle: { fill: 'rgba(16,19,24,0.9)', fillOpacity: 0.92 },
      style: {
        stroke: base.stroke,
        strokeWidth: touched ? base.width + 0.4 : base.width,
        strokeDasharray: base.dash,
        opacity: focusId === null || touched ? 1 : 0.55,
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
      <p className="wb-kicker">Selected {detail.kind}</p>
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
      <div className="focus-actions">
        {canPrepare && (
          <button type="button" className="wb-btn is-accent" onClick={onPrepare}>
            Prepare Work
          </button>
        )}
      </div>
      <details className="focus-source">
        <summary>Where this comes from</summary>
        <dl className="focus-meta">
          <dt>Source</dt><dd className="wb-mono">{detail.source}</dd>
          <dt>Source ref</dt><dd className="wb-mono">{detail.sourceRef || '—'}</dd>
        </dl>
      </details>
      {story && (
        <section className="execution-story" aria-label="Execution story">
          <p className="wb-kicker">Latest result</p>
          <dl>
            <dt>Doing</dt><dd>{story.doing}</dd>
            <dt>Using</dt><dd>{story.context.length > 0 ? story.context.join(' · ') : 'No consumed Context fact'}</dd>
            <dt>Output</dt><dd>{story.latestOutput ?? 'No produced Artifact fact yet'}</dd>
            <dt>Next</dt><dd>{story.next}</dd>
          </dl>
          {story.outputs.length > 1 && <details className="execution-chronology"><summary>Full response chronology · {story.outputs.length}</summary>{story.outputs.map((output, index) => <p key={`${index}:${output.slice(0, 32)}`}>{output}</p>)}</details>}
          {(story.packetId || story.intentId) && (
            <p className="execution-trace wb-mono">
              {story.packetId ? `packet ${story.packetId}` : ''}{story.packetId && story.intentId ? ' · ' : ''}{story.intentId ? `intent ${story.intentId}` : ''}
            </p>
          )}
        </section>
      )}
      <h3 className="wb-kicker">Connected to</h3>
      {detail.relations.length === 0 && <p className="focus-empty">Nothing connected yet.</p>}
      {Object.entries(grouped).map(([kind, relations]) => (
        <div className="focus-relation-group" key={kind}>
          <div className="focus-relation-kind">{relationWord(kind as FocusDetail['relations'][number]['kind'])}</div>
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

export function WorkGraphCanvas({ revision, harnessSessions, liveExecutions, runtimeAttention, projectIds, onSelectProject, onRefresh, navigateRequest, onNavigated }: {
  revision: WorkGraphRevision;
  harnessSessions: HarnessSessionPresence[];
  liveExecutions: LiveExecutionPresence[];
  runtimeAttention: AttentionItem[];
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
  const [dispatchReady, setDispatchReady] = useState(false);
  const [dispatchPreflight, setDispatchPreflight] = useState<DispatchPreflightState | null>(null);
  const [focusDockTab, setFocusDockTab] = useState<'context' | 'activity' | 'evidence'>('context');
  const [sendDockTab, setSendDockTab] = useState<'preflight' | 'packet' | 'evidence'>('preflight');
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());
  const [expandedRegionId, setExpandedRegionId] = useState<string | null>(null);
  // Narrow windows start with the work list folded so the floating nav never
  // buries the project anchor; the project switcher itself stays visible.
  const [navCollapsed, setNavCollapsed] = useState(() => window.innerWidth < 1100);
  const [startDismissed, setStartDismissed] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(() => window.innerWidth < 1100);
  const fittedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedId((current) => current && initial.nodes.some((node) => node.id === current) ? current : null);
    setCollapsedRegions(new Set());
    setExpandedRegionId(null);
    setPreparedPacket(null);
    setDispatchReady(false);
    setDispatchPreflight(null);
    setPreparationStage(null);
    setDraggedPositions({});
  }, [initial, setEdges, setNodes]);

  useEffect(() => setFocusDockTab('context'), [selectedId]);
  useEffect(() => {
    if (preparationStage === 'preflight') setSendDockTab('preflight');
  }, [preparationStage]);

  useEffect(() => {
    const update = () => setNarrowViewport(window.innerWidth < 1100);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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

  // Window resizes leave a fitted viewport behind (content drifts off-screen
  // at narrow widths). While the user is just browsing — no selection, no
  // preparation open — reframe the Work regions. An active focus is never
  // yanked.
  useEffect(() => {
    if (!instance) return;
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (preparationStage !== null) {
          const regions = nodes.filter((node) => node.type === 'wb-region');
          if (regions.length > 0) void instance.fitView({ nodes: regions, padding: 0.12, duration: 240 });
          return;
        }
        if (selectedId !== null) {
          const selected = nodes.find((node) => node.id === selectedId);
          const regions = nodes.filter((node) => node.type === 'wb-region');
          const framed = window.innerWidth < 1100 && regions.length > 0 ? regions : (selected ? [selected] : []);
          if (framed.length > 0) void instance.fitView({ nodes: framed, padding: window.innerWidth < 1100 ? 0.12 : 0.8, duration: 240 });
          return;
        }
        const wanted = new Set(workRegionFitIds(initial.nodes));
        const framed = initial.nodes.filter((node) => wanted.has(node.id));
        if (framed.length > 0) void instance.fitView({ nodes: framed, padding: 0.2, duration: 240 });
      }, 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, [initial, instance, preparationStage, selectedId]);

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
  const visibleEdges = useMemo(() => {
    const taskIds = new Set(visibility.nodes.filter((node) => node.data.kind === 'task').map((node) => node.id));
    return styledEdges(
      visibility.edges.filter((edge) => taskIds.has(edge.source) && taskIds.has(edge.target)),
      selectedNode ? selectedId : null,
      neighborhood,
      hoveredEdgeId,
    );
  }, [visibility.edges, visibility.nodes, selectedNode, selectedId, neighborhood, hoveredEdgeId]);
  const visibleNodes = useMemo(() => {
    const regions = visibility.nodes.filter((node) => node.type === 'wb-region');
    const tasksByRegion = new Map<string, typeof visibility.nodes>();
    const visibleTaskIds = new Set<string>();
    const restingOrder = new Map<string, number>();
    for (const region of regions) {
      const tasks = visibility.nodes.filter((node) => node.parentNode === region.id && node.data.kind === 'task');
      tasksByRegion.set(region.id, tasks);
      if (expandedRegionId === region.id) {
        for (const task of tasks) visibleTaskIds.add(task.id);
      } else {
        const selectedIndex = tasks.findIndex((task) => task.id === selectedId);
        const resting = selectedIndex >= 3 ? [...tasks.slice(0, 2), tasks[selectedIndex]] : tasks.slice(0, 3);
        resting.forEach((task, index) => {
          visibleTaskIds.add(task.id);
          restingOrder.set(task.id, index);
        });
      }
    }
    const expandedTasks = expandedRegionId ? tasksByRegion.get(expandedRegionId) ?? [] : [];
    const expandedOrder = new Map(expandedTasks.map((task, index) => [task.id, index]));
    const candidates = expandedRegionId
      ? visibility.nodes.filter((node) => node.id === expandedRegionId || node.parentNode === expandedRegionId)
      : visibility.nodes;
    return candidates
      .filter((node) => node.type === 'wb-region' || (node.data.kind === 'task' && visibleTaskIds.has(node.id)))
      .map((node, regionIndex) => {
        const focusedClass = selectedId && neighborhood?.has(node.id) ? 'is-neighbor' : node.className;
        if (node.type === 'wb-region') {
          const tasks = tasksByRegion.get(node.id) ?? [];
          const expanded = expandedRegionId === node.id;
          const hiddenCount = expanded ? 0 : Math.max(0, tasks.length - tasks.filter((task) => visibleTaskIds.has(task.id)).length);
          return {
            ...node,
            position: expanded ? { x: 24, y: 24 } : draggedPositions[node.id] ?? (narrowViewport ? { x: 0, y: regionIndex * 360 } : { x: 24, y: regionIndex * 500 + 24 }),
            style: expanded ? { width: 900, height: Math.max(430, 62 + Math.ceil(tasks.length / 3) * 174) } : narrowViewport ? { width: 820, height: 315 } : { width: 850, height: 430 },
            className: `${focusedClass ?? ''}${expanded ? ' is-region-expanded' : ''}`.trim(),
            data: {
              ...node.data,
              disclosure: {
                hiddenCount,
                expanded,
                onToggle: () => setExpandedRegionId((current) => current === node.id ? null : node.id),
              },
            },
          };
        }
        const regionTasks = node.parentNode ? tasksByRegion.get(node.parentNode) ?? [] : [];
        const index = expandedRegionId ? expandedOrder.get(node.id) ?? 0 : restingOrder.get(node.id) ?? 0;
        if (expandedRegionId) {
          const column = index % 3;
          const row = Math.floor(index / 3);
          return {
            ...node,
            position: { x: 260 + column * 206, y: 34 + row * 174 },
            style: { width: 190, height: 156 },
            className: focusedClass,
          };
        }
        return {
          ...node,
          position: draggedPositions[node.id] ?? (narrowViewport
            ? (index === 2 ? { x: 640, y: 52 } : { x: 226 + index * 220, y: 18 + index * 100 })
            : (index === 2 ? { x: 620, y: 160 } : { x: 296 + index * 26, y: 62 + index * 196 })),
          style: narrowViewport ? { width: index === 0 ? 204 : index === 1 ? 196 : 166, height: 154 } : { width: index === 2 ? 190 : 222, height: 156 },
          className: `${focusedClass ?? ''}${index === 2 ? ' approved-third-object' : ''}`.trim(),
        };
      });
  }, [visibility.nodes, selectedId, neighborhood, narrowViewport, draggedPositions, expandedRegionId]);

  useEffect(() => {
    if (!instance || !expandedRegionId) return;
    // React Flow applies the expanded parent/children on this commit. Move
    // the camera on the next frame so its internal node measurement cannot
    // replace the readable drill-in zoom with a fit-all viewport.
    const frame = window.setTimeout(() => {
      const zoom = Math.max(instance.getZoom(), 0.72);
      void instance.setCenter(474, 284, { zoom, duration: 320 });
    }, 60);
    return () => window.clearTimeout(frame);
  }, [expandedRegionId, instance]);

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

  const relatedContextIds = selectedNode
    ? revision.candidate.semanticFacts.edges.flatMap((edge) => {
      if (edge.source !== selectedNode.id) return [];
      if (edge.kind === 'uses-context' && edge.target.startsWith(`context:${revision.candidate.scope.projectId}:`)) {
        return [edge.target.slice(`context:${revision.candidate.scope.projectId}:`.length)];
      }
      if (edge.kind === 'blocked-by' && edge.target.startsWith(`gate:${revision.candidate.scope.projectId}:`)) {
        return [`gate:${revision.candidate.scope.projectId}:${edge.target.slice(`gate:${revision.candidate.scope.projectId}:`.length)}`];
      }
      return [];
    })
    : [];
  const cabinetSelection: CabinetSelection | null = selectedNode
    ? {
      kind: selectedNode.data.kind,
      label: selectedNode.data.label,
      relatedContextIds: [...new Set(relatedContextIds)],
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
  const expandedRegion = expandedRegionId
    ? regionNavigation.find((region) => region.regionId === expandedRegionId) ?? null
    : null;
  const projectNode = nodes.find((node) => node.data.kind === 'project');

  const focusRegion = useCallback((regionId: string) => {
    setCollapsedRegions((current) => {
      if (!current.has(regionId)) return current;
      const next = new Set(current);
      next.delete(regionId);
      return next;
    });
    const region = nodes.find((node) => node.id === regionId);
    if (region && instance) {
      if (expandedRegionId === regionId) {
        void instance.setCenter(region.position.x + 450, region.position.y + 260, {
          zoom: Math.max(instance.getZoom(), 0.72),
          duration: 320,
        });
      } else {
        void instance.fitView({ nodes: [region], padding: 0.18, duration: 320 });
      }
    }
  }, [expandedRegionId, instance, nodes]);

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
    setDispatchReady(false);
    setDispatchPreflight(null);
    setPreparationStage('context');
  }, []);

  // ESC walks one layer back: preparation surface, then selection. Typing in
  // a field is never hijacked.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (preparationStage !== null) {
        setPreparationStage(null);
        return;
      }
      if (selectedId !== null) setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preparationStage, selectedId]);

  const dimmed = selectedNode !== null;
  const semanticNodes = revision.candidate.semanticFacts.nodes;
  const semanticProject = semanticNodes.find((node) => node.kind === 'project');
  const semanticWork = semanticNodes.find((node) => node.kind === 'work');
  const includedContext = semanticNodes.filter((node) => node.kind === 'context' && node.state === 'included');
  const conversationRows = semanticNodes.filter((node) => node.kind === 'conversation').slice(0, 4);
  const mainTitle = preparationStage === 'preflight'
    ? 'Prepare & send'
    : detail?.label ?? semanticWork?.label ?? semanticProject?.label ?? revision.candidate.scope.projectId;
  const mainKicker = preparationStage === 'preflight' ? 'SEND / READY' : detail ? 'TASK / CONTEXT' : 'WORK / ACTIVE';
  const passedPreflightChecks = dispatchPreflight?.checks.filter((check) => check.status === 'PASS').length ?? 0;
  const selectableProjectIds = projectIds.includes(revision.candidate.scope.projectId)
    ? projectIds
    : [revision.candidate.scope.projectId, ...projectIds];
  const preparationSelection: CabinetSelection | null = preparedPacket
    ? { ...(cabinetSelection ?? { kind: 'context', label: 'Context-only preparation' }), conversationKey: preparedPacket.conversationKey }
    : cabinetSelection;

  return (
    <div className={`workgraph-canvas-container approved-shell${dimmed ? ' is-focus-mode' : ''}`} data-stage={preparationStage ?? (detail ? 'focus' : 'hero')}>
      <aside className="approved-presence-rail" aria-label="Workbench surfaces">
        <span className="approved-brand">Y</span>
        <nav className="approved-rail-actions">
          <button type="button" className="is-active" aria-label="Work">▦</button>
          <button type="button" aria-label="Locate current work" onClick={focusCurrentOrProject}>⌖</button>
          <button type="button" aria-label="Refresh workspace" onClick={() => void onRefresh()}>⌕</button>
        </nav>
        <button type="button" className="approved-avatar" aria-label="Profile">LQ</button>
      </aside>

      <aside className="approved-work-rail" aria-label="Work regions">
        <header className="approved-side-head"><span>YUNMIN / WORKBENCH</span><button type="button" onClick={() => void window.wb.toggleCompactWindow()} aria-label="Open Compact overview">⌘</button></header>
        <section className="approved-current-work">
          <span className="approved-kicker">CURRENT WORK</span>
          <h2>{semanticWork?.label ?? 'Project workspace'}</h2>
          <select className="approved-project-switch" aria-label="Switch project" value={revision.candidate.scope.projectId} disabled={selectableProjectIds.length < 2} onChange={(event) => onSelectProject(event.target.value)}>
            {selectableProjectIds.map((projectId) => <option key={projectId} value={projectId}>{projectId === revision.candidate.scope.projectId ? semanticProject?.label ?? projectId : projectId}</option>)}
          </select>
          <div className="approved-phase-track" aria-label="Product path"><span className="done"/><span className="done"/><span className="active"/><span/><span/><span/><span/></div>
          <div className="approved-phase-copy"><b>Task</b><span>Context → Prepare → Send</span></div>
        </section>
        <nav className="approved-work-list">
          {regionNavigation.length === 0 && <p className="approved-empty">No declared Work in this project.</p>}
          {regionNavigation.map((region, index) => (
            <div className={`approved-work-row${region.active ? ' is-selected' : ''}`} key={region.regionId}>
              <button type="button" className="approved-work-focus" onClick={() => focusRegion(region.regionId)}>
                <i>{String(index + 1).padStart(2, '0')}</i><span><b>{region.label}</b><small>{region.taskCount} tasks · {region.currentness.toLowerCase()}</small></span>{region.taskCount > 0 && <em>{region.taskCount}</em>}
              </button>
              <button type="button" className="approved-work-collapse" aria-label={`${collapsedRegions.has(region.regionId) ? 'Expand' : 'Collapse'} ${region.label}`} onClick={() => toggleRegion(region.regionId)}>{collapsedRegions.has(region.regionId) ? '+' : '−'}</button>
            </div>
          ))}
        </nav>
        <footer className="approved-side-foot"><span><i className="approved-presence live"/>Projection current</span><small>REAL</small></footer>
      </aside>

      <main className="approved-main-surface">
        <header className="approved-plane-head">
          <div className="approved-crumb"><span>{semanticProject?.label ?? revision.candidate.scope.projectId}</span><i>/</i><span>Workbench</span><i>/</i><b>{preparationStage === 'preflight' ? 'Prepare & send' : detail ? 'Task focus' : 'Work plane'}</b></div>
          <div className="approved-plane-title"><div><span className="approved-kicker">{mainKicker}</span><h1>{mainTitle}</h1></div><div className="approved-view-tools"><button type="button" onClick={focusCurrentOrProject}>⌖ Focus</button><button type="button" onClick={() => void instance?.zoomOut()}>−</button><span>{Math.round((instance?.getZoom() ?? .86) * 100)}%</span><button type="button" onClick={() => void instance?.zoomIn()}>+</button></div></div>
        </header>
        <div className="approved-canvas-stack">
          <section className="approved-bounded-plane" aria-label="Work plane">
            <div className="approved-spatial-world">
              <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onInit={setInstance}
                onNodeClick={(_event, node) => {
                  if (node.type === 'wb-region') return;
                  setSelectedId(node.id);
                }}
                onNodeDrag={(_event, node) => setDraggedPositions((current) => ({
                  ...current,
                  [node.id]: node.position,
                }))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  const element = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
                  const nodeId = element?.dataset.id;
                  const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;
                  if (!node || node.type === 'wb-region') return;
                  event.preventDefault();
                  setSelectedId(node.id);
                }}
                onPaneClick={() => setSelectedId(null)}
                onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
                onEdgeMouseLeave={() => setHoveredEdgeId(null)}
                nodeTypes={wbNodeTypes as never}
                nodesConnectable={false}
                panOnScroll
                panActivationKeyCode={null}
                zoomOnScroll={false}
                zoomOnPinch
                zoomActivationKeyCode="Control"
                minZoom={expandedRegionId ? 0.62 : 0.25}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                proOptions={{ hideAttribution: true }}
                fitView
                fitViewOptions={{ padding: 0.16 }}
              >
                <Background color="#a7aeba" gap={32} size={1} variant={BackgroundVariant.Lines} />
                {expandedRegion && (
                  <Panel position="top-right" className="approved-drill-exit">
                    <button
                      type="button"
                      aria-label={`Show fewer tasks in ${expandedRegion.label}`}
                      onClick={() => setExpandedRegionId(null)}
                    >
                      Show fewer · keep current
                    </button>
                  </Panel>
                )}
                {workRegions.length === 0 && <Panel position="bottom-center" className="wb-canvas-note">No work areas yet — they appear when the project declares work.</Panel>}
                {workRegions.length > 0 && !selectedNode && preparationStage === null && !startDismissed && (
                  <Panel position="bottom-left" className="wb-start-card"><section aria-label="Where to start"><button type="button" className="start-dismiss" aria-label="Dismiss getting started" onClick={() => setStartDismissed(true)}>×</button><p className="start-title">Start here</p><p className="start-body">Pick a task on the canvas, then <strong>Prepare</strong>.</p></section></Panel>
                )}
              </ReactFlow>
            </div>
          </section>
          <div className={`approved-action-surface${preparationStage ? ` is-${preparationStage}` : ''}`}>
            {preparationStage === 'preflight' && preparedPacket ? (
              <DispatchSurface projectId={revision.candidate.scope.projectId} selection={dispatchSelection} initialConversationKey={preparedPacket.conversationKey} initialPacketId={preparedPacket.packetId} onEditContext={() => setPreparationStage('context')} onClose={() => setPreparationStage(null)} onReadinessChange={setDispatchReady} onPreflightChange={setDispatchPreflight} />
            ) : preparationStage === 'context' ? (
              <ContextCabinet projectId={revision.candidate.scope.projectId} selection={preparationSelection} onPrepared={(packet) => { setPreparedPacket(packet); setPreparationStage('preflight'); }} onClose={() => setPreparationStage(null)} />
            ) : (
              <section className="approved-composer" aria-label="Composer">
                <button className="approved-resize-handle" type="button" aria-label="Resize composer" />
                {detail && <div className="approved-context-shelf">{includedContext.slice(0, 3).map((item) => <span key={item.id}><i>{item.kind === 'context' && item.isReference ? 'REF' : 'CTX'}</i>{item.label}<button type="button" aria-label={`Open ${item.label}`}>×</button></span>)}</div>}
                <div className="approved-composer-input"><textarea readOnly value={detail ? `Prepare ${detail.label} with verified Context…` : 'Ask the team or prepare this Work…'} /><button type="button" className="approved-send" aria-label="Prepare Work" onClick={openPreparation}>➤</button></div>
                <footer><span>＋ Context</span><span>/ commands</span><em>{conversationRows[0]?.label ?? 'Choose a target in Prepare'}</em></footer>
              </section>
            )}
          </div>
        </div>
      </main>

      <aside className="approved-team-dock" aria-label="Team and runtime">
        <header className="approved-dock-head"><div><span className="approved-kicker">TEAM / RUNTIME</span><h3>{preparationStage === 'preflight' ? 'Send review' : detail ? 'Task detail' : 'Session presence'}</h3></div><button type="button" aria-label="Dock options">···</button></header>
        {detail && preparationStage === null ? (
          <><nav className="approved-dock-tabs" aria-label="Task detail views"><button type="button" className={focusDockTab === 'context' ? 'active' : ''} aria-pressed={focusDockTab === 'context'} onClick={() => setFocusDockTab('context')}>Context</button><button type="button" className={focusDockTab === 'activity' ? 'active' : ''} aria-pressed={focusDockTab === 'activity'} onClick={() => setFocusDockTab('activity')}>Activity</button><button type="button" className={focusDockTab === 'evidence' ? 'active' : ''} aria-pressed={focusDockTab === 'evidence'} onClick={() => setFocusDockTab('evidence')}>Evidence</button></nav><div className="approved-dock-scroll approved-detail-scroll">{focusDockTab === 'context' ? <FocusDetailPanel detail={detail} story={executionStory} onClose={() => setSelectedId(null)} onPrepare={openPreparation}/> : focusDockTab === 'activity' ? <aside className="focus-panel wb-glass" role="complementary" aria-label="Focus Detail"><p className="wb-kicker">ACTIVITY</p><h2 className="focus-title">{detail.label}</h2>{executionStory ? <section className="execution-story" aria-label="Execution story"><dl><dt>Doing</dt><dd>{executionStory.doing}</dd><dt>Using</dt><dd>{executionStory.context.length > 0 ? executionStory.context.join(' · ') : 'No consumed Context fact'}</dd><dt>Latest</dt><dd>{executionStory.latestOutput ?? 'No produced Artifact fact yet'}</dd><dt>Next</dt><dd>{executionStory.next}</dd></dl>{executionStory.outputs.length > 1 && <details className="execution-chronology"><summary>Full response chronology · {executionStory.outputs.length}</summary>{executionStory.outputs.map((output, index) => <p key={`${index}:${output.slice(0, 32)}`}>{output}</p>)}</details>}</section> : <p className="focus-empty">No execution linked to this selection.</p>}</aside> : <aside className="focus-panel wb-glass" role="complementary" aria-label="Focus Detail"><p className="wb-kicker">EVIDENCE</p><h2 className="focus-title">{detail.label}</h2><dl className="focus-meta"><dt>Verification</dt><dd>{detail.verification}</dd><dt>Source</dt><dd className="wb-mono">{detail.source}</dd><dt>Source ref</dt><dd className="wb-mono">{detail.sourceRef || '—'}</dd></dl>{detail.relations.length === 0 ? <p className="focus-empty">No linked evidence fact.</p> : <p className="focus-empty">{detail.relations.length} verified relation{detail.relations.length === 1 ? '' : 's'} available in Context.</p>}</aside>}</div></>
        ) : preparationStage === 'preflight' ? (
          <><nav className="approved-dock-tabs" aria-label="Send review views"><button type="button" className={sendDockTab === 'preflight' ? 'active' : ''} aria-pressed={sendDockTab === 'preflight'} onClick={() => setSendDockTab('preflight')}>Preflight</button><button type="button" className={sendDockTab === 'packet' ? 'active' : ''} aria-pressed={sendDockTab === 'packet'} onClick={() => setSendDockTab('packet')}>Packet</button><button type="button" className={sendDockTab === 'evidence' ? 'active' : ''} aria-pressed={sendDockTab === 'evidence'} onClick={() => setSendDockTab('evidence')}>Evidence</button></nav><div className="approved-dock-scroll approved-send-review"><section className="approved-send-runtime" aria-label="Live execution and attention"><span className={`approved-session-status ${liveExecutions.length > 0 ? 'working' : runtimeAttention.length > 0 ? 'attention' : 'idle'}`}/><b>{liveExecutions.length > 0 ? `${liveExecutions.length} running` : runtimeAttention.length > 0 ? `${runtimeAttention.length} needs you` : 'Runtime idle'}</b><small>{liveExecutions[0] ? `${liveExecutions[0].harness} · ${liveExecutions[0].externalSessionRef}` : runtimeAttention[0]?.summary ?? 'No live execution or attention fact.'}</small></section>{runtimeAttention.map((item) => <details className="approved-attention-detail" key={item.id}><summary>{item.summary}</summary><p>{item.provenance ?? item.sourceRef}</p></details>)}{sendDockTab === 'preflight' ? <><section className="approved-readiness"><span>{dispatchPreflight?.checking ? '…' : `${passedPreflightChecks}/${dispatchPreflight?.checks.length ?? '—'}`}</span><div><label>{dispatchReady ? 'READY TO SEND' : dispatchPreflight?.checking ? 'CHECKING' : 'NEEDS REVIEW'}</label><h4>{mainTitle}</h4></div></section><div className="approved-check-list">{dispatchPreflight?.checking || !dispatchPreflight ? <p><b>○ Preflight</b><span>Checking real snapshot and runner facts…</span></p> : dispatchPreflight.checks.map((check) => <p key={check.id} className={`is-${check.status.toLowerCase()}`}><b>{check.status === 'PASS' ? '✓' : '○'} {check.label}</b><span>{check.detail}</span></p>)}</div></> : sendDockTab === 'packet' ? <section className="approved-review-panel" aria-label="Packet review"><span className="approved-kicker">FROZEN PACKET</span><h4>{mainTitle}</h4><dl className="focus-meta"><dt>Packet</dt><dd className="wb-mono">{preparedPacket?.packetId ?? 'No frozen packet'}</dd><dt>Target</dt><dd className="wb-mono">{preparedPacket?.conversationKey ?? 'No conversation selected'}</dd></dl></section> : <section className="approved-review-panel" aria-label="Preflight evidence"><span className="approved-kicker">EVIDENCE</span><div className="approved-check-list">{dispatchPreflight?.checking || !dispatchPreflight ? <p><b>Preflight</b><span>Checking real facts…</span></p> : dispatchPreflight.checks.map((check) => <p key={check.id} className={`is-${check.status.toLowerCase()}`}><b>{check.label}</b><span>{check.detail}</span></p>)}</div></section>}<section><span className="approved-kicker">PROVENANCE</span><p className="wb-mono">{preparedPacket?.packetId ?? 'No frozen packet'}</p></section></div></>
        ) : (
          <><div className="approved-dock-scroll">
            <section className="approved-session-group approved-presence-group"><label>PRESENCE <em>{conversationRows.length + harnessSessions.length}</em></label>{conversationRows.length === 0 && harnessSessions.length === 0 ? <p className="approved-runtime-empty">No bound conversation or native session fact.</p> : <>{conversationRows.map((node) => <button type="button" className="approved-session-row" key={node.id} onClick={() => setSelectedId(node.id)}><span className={`approved-session-status ${node.attentionState !== 'none' && node.attentionState !== 'unknown' ? 'attention' : node.runtimeState === 'working' ? 'working' : 'idle'}`}/><span><b>{node.label}</b><small>{node.platform} · {node.lifecycleState} · {node.runtimeState}</small></span>{node.attentionState !== 'none' && node.attentionState !== 'unknown' && <em className="approved-session-attention">{node.attentionState}</em>}</button>)}{harnessSessions.map((session) => <div role="listitem" className="approved-session-row" key={`${session.harness}:${session.nativeRef}`} title={session.sourceRef}><span className={`approved-session-status ${session.runtimeState === 'working' ? 'working' : 'idle'}`}/><span><b>{session.label}</b><small>{session.harness} · {session.agent ?? 'agent UNKNOWN'} · {session.runtimeState}</small></span></div>)}</>}</section>
            {runtimeAttention.length > 0 && <section className="approved-session-group approved-attention-group"><label>NEEDS YOU <em>{runtimeAttention.length}</em></label>{runtimeAttention.map((item) => <details className="approved-attention-detail" key={item.id}><summary>{item.summary}</summary><p>{item.provenance ?? item.sourceRef}</p></details>)}</section>}
            <section className="approved-runtime-summary" aria-label="Runtime summary"><span>RUNNING</span><b>{liveExecutions.length}</b><small>{liveExecutions.length === 0 ? 'No live execution fact.' : liveExecutions.map((item) => `${item.harness} · ${item.externalSessionRef}`).join(' / ')}</small></section>
          </div><footer className="approved-dock-foot"><span><i className="approved-presence live"/>{liveExecutions.length} working</span><span>{runtimeAttention.length} needs you</span></footer></>
        )}
      </aside>
    </div>
  );
}
