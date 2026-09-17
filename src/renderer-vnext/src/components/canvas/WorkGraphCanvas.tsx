import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  relationWord,
  resolveCompactNavigate,
  type FocusDetail,
} from '../../workGraphView';
import { SpatialWorld, type SpatialWorldHandle } from './SpatialWorld';

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
  const nodes = initial.nodes;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const spatialWorldRef = useRef<SpatialWorldHandle | null>(null);
  const [preparationStage, setPreparationStage] = useState<'context' | 'preflight' | null>(null);
  const [preparedPacket, setPreparedPacket] = useState<{ conversationKey: string; packetId: string } | null>(null);
  const [dispatchReady, setDispatchReady] = useState(false);
  const [dispatchPreflight, setDispatchPreflight] = useState<DispatchPreflightState | null>(null);
  const [focusDockTab, setFocusDockTab] = useState<'context' | 'activity' | 'evidence'>('context');
  const [sendDockTab, setSendDockTab] = useState<'preflight' | 'packet' | 'evidence'>('preflight');
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());
  const [expandedRegionId, setExpandedRegionId] = useState<string | null>(null);
  // Narrow windows start with the work list folded so the floating nav never
  // buries the project anchor; the project switcher itself stays visible.
  const [navCollapsed, setNavCollapsed] = useState(() => window.innerWidth < 1100);
  const [startDismissed, setStartDismissed] = useState(false);

  useEffect(() => {
    setSelectedId((current) => current && initial.nodes.some((node) => node.id === current) ? current : null);
    setCollapsedRegions(new Set());
    setExpandedRegionId(null);
    setPreparedPacket(null);
    setDispatchReady(false);
    setDispatchPreflight(null);
    setPreparationStage(null);
  }, [initial]);

  useEffect(() => setFocusDockTab('context'), [selectedId]);
  useEffect(() => {
    if (preparationStage === 'preflight') setSendDockTab('preflight');
  }, [preparationStage]);

  // Compact → Full handoff: apply the navigation identity to the canvas.
  // A request for another known project switches first; the pending request
  // survives the revision change and applies once that project arrives.
  // Identity resolves against `initial` (always in sync with the revision);
  // the live `nodes` state only supplies the viewport position, so a
  // revision change can never clear the request on stale nodes.
  // Exact node ids only; unknown identities are ignored, never guessed.
  useEffect(() => {
    if (!navigateRequest || !spatialWorldRef.current) return;
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
      if (!target) return;
      setSelectedId(target.id);
      window.setTimeout(() => spatialWorldRef.current?.focus(target.id), 0);
      if (navigateRequest.action === 'prepare') {
        setPreparedPacket(null);
        setPreparationStage('context');
      }
    }
    onNavigated?.();
  }, [initial, navigateRequest, nodes, onNavigated, onSelectProject, projectIds, revision]);

  const selectedNode = nodes.find((node) => node.id === selectedId && node.type !== 'wb-region') ?? null;
  const detail = selectedId && selectedNode ? buildFocusDetail(revision, selectedId) : null;
  const executionStory = selectedId ? buildExecutionStory(revision, selectedId) : null;

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
    const targetId = selectedId ?? nodes.find((node) => node.data.kind === 'project')?.id;
    if (targetId) spatialWorldRef.current?.focus(targetId);
  }, [nodes, selectedId]);
  const attentionNodes = nodes.filter((node) => node.data.kind === 'gate');
  const workRegions = nodes.filter((node) => node.type === 'wb-region');
  const regionNavigation = useMemo(() => buildRegionNavigation(nodes, selectedId), [nodes, selectedId]);
  const expandedRegion = expandedRegionId
    ? regionNavigation.find((region) => region.regionId === expandedRegionId) ?? null
    : null;
  const projectNode = nodes.find((node) => node.data.kind === 'project');
  const expandedWorkIds = useMemo(() => new Set(
    expandedRegion ? [expandedRegion.workId].filter((value): value is string => Boolean(value)) : [],
  ), [expandedRegion]);
  const collapsedWorkIds = useMemo(() => new Set(
    regionNavigation.filter((region) => collapsedRegions.has(region.regionId))
      .map((region) => region.workId)
      .filter((value): value is string => Boolean(value)),
  ), [collapsedRegions, regionNavigation]);

  const focusRegion = useCallback((regionId: string) => {
    setCollapsedRegions((current) => {
      if (!current.has(regionId)) return current;
      const next = new Set(current);
      next.delete(regionId);
      return next;
    });
    const region = regionNavigation.find((candidate) => candidate.regionId === regionId);
    const work = region?.workId
      ? revision.candidate.semanticFacts.nodes.find((node) => node.kind === 'work' && node.workId === region.workId)
      : undefined;
    if (work) spatialWorldRef.current?.focus(work.id);
  }, [regionNavigation, revision]);

  const toggleRegion = useCallback((regionId: string) => {
    setCollapsedRegions((current) => {
      const next = new Set(current);
      if (next.has(regionId)) next.delete(regionId); else next.add(regionId);
      return next;
    });
    const region = regionNavigation.find((candidate) => candidate.regionId === regionId);
    const selected = revision.candidate.semanticFacts.nodes.find((node) => node.id === selectedId);
    if (region?.workId && selected && 'workId' in selected && selected.workId === region.workId) setSelectedId(null);
  }, [regionNavigation, revision, selectedId]);

  const toggleWorkDisclosure = useCallback((workId: string) => {
    const region = regionNavigation.find((candidate) => candidate.workId === workId);
    if (!region) return;
    setExpandedRegionId((current) => current === region.regionId ? null : region.regionId);
    setCollapsedRegions((current) => {
      if (!current.has(region.regionId)) return current;
      const next = new Set(current);
      next.delete(region.regionId);
      return next;
    });
  }, [regionNavigation]);

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
          <div className="approved-plane-title"><div><span className="approved-kicker">{mainKicker}</span><h1>{mainTitle}</h1></div><div className="approved-view-tools"><button type="button" onClick={focusCurrentOrProject}>⌖ Focus</button><button type="button" aria-label="Zoom out" onClick={() => spatialWorldRef.current?.zoomOut()}>−</button><button type="button" aria-label="Fit spatial world from header" onClick={() => spatialWorldRef.current?.fit()}>Fit</button><button type="button" aria-label="Zoom in" onClick={() => spatialWorldRef.current?.zoomIn()}>+</button></div></div>
        </header>
        <div className="approved-canvas-stack">
          <section className="approved-bounded-plane" aria-label="Work plane">
            <div className="approved-spatial-world">
              <SpatialWorld
                ref={spatialWorldRef}
                revision={revision}
                selectedId={selectedId}
                expandedWorkIds={expandedWorkIds}
                collapsedWorkIds={collapsedWorkIds}
                onSelect={setSelectedId}
                onToggleWork={toggleWorkDisclosure}
              />
              {expandedRegion && (
                <div className="approved-drill-exit">
                  <button type="button" aria-label={`Show fewer tasks in ${expandedRegion.label}`} onClick={() => setExpandedRegionId(null)}>
                    Show fewer · keep current
                  </button>
                </div>
              )}
              {workRegions.length === 0 && <div className="wb-canvas-note">No work areas yet — they appear when the project declares work.</div>}
              {workRegions.length > 0 && !selectedNode && preparationStage === null && !startDismissed && (
                <div className="wb-start-card"><section aria-label="Where to start"><button type="button" className="start-dismiss" aria-label="Dismiss getting started" onClick={() => setStartDismissed(true)}>×</button><p className="start-title">Start here</p><p className="start-body">Pick a task on the canvas, then <strong>Prepare</strong>.</p></section></div>
              )}
            </div>
          </section>
          <div className={`approved-action-surface${preparationStage ? ` is-${preparationStage}` : ''}`}>
            {preparationStage === 'preflight' && preparedPacket ? (
              <DispatchSurface projectId={revision.candidate.scope.projectId} selection={dispatchSelection} initialConversationKey={preparedPacket.conversationKey} initialPacketId={preparedPacket.packetId} onEditContext={() => setPreparationStage('context')} onClose={() => { setPreparationStage(null); void onRefresh(); }} onReadinessChange={setDispatchReady} onPreflightChange={setDispatchPreflight} />
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
