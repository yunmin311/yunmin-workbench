import { useEffect, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InspectorPane, type InspectorTab } from './components/InspectorPane';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { HistoryPanel } from './components/HistoryPanel';
import { AttentionPanel } from './components/AttentionPanel';
import { PortabilityPanel } from './components/PortabilityPanel';
import { MemoryPanel } from './components/MemoryPanel';
import { CanvasView } from './views/CanvasView';
import { SessionSurface } from './views/SessionSurface';
import { useWorkbench } from './store';

export default function App() {
  const snapshot = useWorkbench((state) => state.snapshot);
  const loading = useWorkbench((state) => state.loading);
  const view = useWorkbench((state) => state.view);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const draftSaveState = useWorkbench((state) => state.draftSaveState);
  const packetValidity = useWorkbench((state) => state.packetValidity);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const attentionItems = useWorkbench((state) => state.attentionItems);
  const initialize = useWorkbench((state) => state.initialize);
  const reloadAndRecheck = useWorkbench((state) => state.reloadAndRecheck);
  const setView = useWorkbench((state) => state.setView);
  const syncIslandAttention = useWorkbench((state) => state.syncIslandAttention);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [portabilityOpen, setPortabilityOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [historySourceSessionId, setHistorySourceSessionId] = useState<string | undefined>();

  useEffect(() => {
    void initialize();
    const offOverlay = window.wb.onOverlayChanged(() => void useWorkbench.getState().reloadAndRecheck());
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const offFocus = window.wb.onAppFocus(() => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => void useWorkbench.getState().recheckSources(), 300);
    });
    const offActivity = window.wb.onActivityChanged((event) => useWorkbench.getState().ingestActivity(event));
    const offActivityCleared = window.wb.onActivityCleared(() => void useWorkbench.getState().loadActivity());
    const offIslandSourceSelected = window.wb.onIslandSourceSelected((target) => {
      const state = useWorkbench.getState();
      const snap = state.snapshot;
      if (!snap) {
        window.dispatchEvent(new CustomEvent('workbench:island-target-unavailable', { detail: target }));
        return;
      }
      // Strict identity: no guessing. Both project and conversation must exist verbatim in snapshot.
      let resolvedProject = false;
      let resolvedConversation = false;
      if (target.projectId) {
        resolvedProject = snap.projects.some((p) => p.projectId === target.projectId);
        if (!resolvedProject) {
          window.dispatchEvent(new CustomEvent('workbench:island-target-unavailable', { detail: target }));
          return;
        }
        if (state.projectId !== target.projectId) state.selectProject(target.projectId);
      }
      if (target.conversationKey) {
        const exactConversation = snap.conversations.find((candidate) =>
          candidate.key === target.conversationKey
            && (!target.projectId || candidate.project === target.projectId));
        if (!exactConversation) {
          window.dispatchEvent(new CustomEvent('workbench:island-target-unavailable', { detail: target }));
          // still ensure project view if project was resolvable
          if (resolvedProject) state.setView('control');
          return;
        }
        state.selectConversation(exactConversation);
        resolvedConversation = true;
      }
      if (resolvedProject || resolvedConversation) state.setView('control');
      // Only emit focus if at least one identity was verifiably resolved; source/session alone is unavailable
      if (!resolvedProject && !resolvedConversation) {
        // Covers source-only or session-only stale targets: already dispatched unavailable or will dispatch now
        if (!(target.sourceRef && !target.projectId && !target.conversationKey)) {
          // Already handled for project/conversation failures; ensure unavailable for pure session case
          window.dispatchEvent(new CustomEvent('workbench:island-target-unavailable', { detail: target }));
        } else {
          window.dispatchEvent(new CustomEvent('workbench:island-target-unavailable', { detail: target }));
        }
        return;
      }
      if (target.eventRef || target.sessionRef) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('workbench:focus-attention-source', {
          detail: { eventRef: target.eventRef, sessionRef: target.sessionRef, sourceRef: target.sourceRef },
        })), 30);
      }
    });
    return () => {
      offOverlay();
      offFocus();
      offActivity();
      offActivityCleared();
      offIslandSourceSelected();
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [initialize]);

  useEffect(() => {
    syncIslandAttention();
  }, [syncIslandAttention]);

  useEffect(() => {
    if (view === 'context' || view === 'packet') setInspectorTab(view);
    if (view === 'canvas') setInspectorTab(null);
  }, [view]);

  useEffect(() => {
    const open = (event: Event) => {
      const tab = (event as CustomEvent<InspectorTab>).detail;
      if (tab) setInspectorTab(tab);
    };
    window.addEventListener('workbench:open-inspector', open);
    return () => window.removeEventListener('workbench:open-inspector', open);
  }, []);

  useEffect(() => {
    const open = () => setHistoryOpen(true);
    window.addEventListener('workbench:open-history', open);
    return () => window.removeEventListener('workbench:open-history', open);
  }, []);

  useEffect(() => {
    const open = () => setMemoryOpen(true);
    const openSource = (event: Event) => {
      setMemoryOpen(false);
      setHistorySourceSessionId((event as CustomEvent<string>).detail);
      setHistoryOpen(true);
    };
    window.addEventListener('workbench:open-memory', open);
    window.addEventListener('workbench:open-history-source', openSource);
    return () => {
      window.removeEventListener('workbench:open-memory', open);
      window.removeEventListener('workbench:open-history-source', openSource);
    };
  }, []);

  useEffect(() => {
    const open = () => setAttentionOpen(true);
    window.addEventListener('workbench:open-attention', open);
    return () => window.removeEventListener('workbench:open-attention', open);
  }, []);

  useEffect(() => {
    const open = () => setPortabilityOpen(true);
    window.addEventListener('workbench:open-portability', open);
    return () => window.removeEventListener('workbench:open-portability', open);
  }, []);

  useEffect(() => {
    const open = () => setSessionPickerOpen(true);
    window.addEventListener('workbench:open-session-picker', open);
    return () => window.removeEventListener('workbench:open-session-picker', open);
  }, []);

  if (loading && !snapshot) return <div className="center">Loading workspace truth…</div>;
  if (!snapshot) return <div className="center">No overlay snapshot.</div>;

  const canvasMode = view === 'canvas';
  const project = snapshot.projects.find((item) => item.projectId === projectId);
  const currentRuntime = conversation
    ? runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1)
    : undefined;
  const openInspector = (tab: InspectorTab) => {
    setInspectorTab(tab);
    if (tab === 'context' || tab === 'packet') setView(tab);
  };
  const closeInspector = () => {
    setInspectorTab(null);
    if (view === 'context' || view === 'packet') setView('control');
  };

  return (
    <div className="prototype-app">
      <header className="prototype-chrome">
        <button
          className="workspace-trigger"
          aria-label="Open workspace and session switcher"
          aria-expanded={sessionPickerOpen}
          onClick={() => setSessionPickerOpen((open) => !open)}
        >
          <span className="brand-mark">YW</span>
          <span className="workspace-trigger-copy">
            <strong>{project?.displayName ?? 'Open workspace'}</strong>
            <small>{conversation?.role ?? 'Choose a session'}</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>

        <nav className="surface-tabs" aria-label="Session surface mode">
          <button aria-current={!canvasMode ? 'page' : undefined} onClick={() => setView('control')}>Session</button>
          <button disabled={!projectId} aria-current={canvasMode ? 'page' : undefined} onClick={() => setView('canvas')}>Canvas</button>
        </nav>

        <div className="chrome-status" aria-label="Actionable session status">
          {conversation && currentRuntime?.state === 'error' && (
            <span className="runtime-inline runtime-error"><i />runtime error</span>
          )}
          {conversation && (packetValidity === 'STALE' || packetValidity === 'INVALID') && (
            <button className={`validity-inline validity-${packetValidity.toLowerCase()}`} onClick={() => openInspector('packet')}>
              Packet {packetValidity}
            </button>
          )}
          {conversation && draftSaveState === 'error' && <span className="draft-inline draft-error">Draft save failed</span>}
        </div>

        <div className="chrome-tools">
          <button
            className={attentionItems.length > 0 ? 'attention-trigger has-items' : 'attention-trigger'}
            aria-label={`Attention, ${attentionItems.length} active item${attentionItems.length === 1 ? '' : 's'}`}
            aria-expanded={attentionOpen}
            onClick={() => setAttentionOpen((open) => !open)}
          >Attention{attentionItems.length > 0 && <span>{attentionItems.length}</span>}</button>
          <button onClick={() => setHistoryOpen(true)}>History</button>
          <button onClick={() => setMemoryOpen(true)}>Memory</button>
          <button disabled={!projectId} aria-pressed={inspectorTab === 'context'} onClick={() => openInspector('context')}>Context</button>
          <button disabled={!conversation} aria-pressed={inspectorTab === 'packet'} onClick={() => openInspector('packet')}>Packet</button>
          <button
            className="icon-action"
            aria-label="Open command palette"
            onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}
          >⌘</button>
          <button className="icon-action" aria-label="Reload external truth" onClick={() => void reloadAndRecheck()}>↻</button>
        </div>
      </header>

      {snapshot.problems.length > 0 && (
        <details className="prototype-problems">
          <summary>{snapshot.problems.length} source problem{snapshot.problems.length === 1 ? '' : 's'}</summary>
          {snapshot.problems.map((problem, index) => <p key={index}>[{problem.source}] {problem.message}</p>)}
        </details>
      )}

      <main className={`prototype-surface ${canvasMode ? 'is-canvas' : 'is-session'}`}>
        <ErrorBoundary key={`surface:${canvasMode}:${projectId ?? ''}:${conversation?.key ?? ''}`}>
          {canvasMode ? <CanvasView /> : <SessionSurface onOpenSessions={() => setSessionPickerOpen(true)} />}
        </ErrorBoundary>
      </main>

      {sessionPickerOpen && (
        <div className="session-picker-layer" role="presentation" onMouseDown={() => setSessionPickerOpen(false)}>
          <div className="session-picker" role="dialog" aria-label="Switch workspace or session" onMouseDown={(event) => event.stopPropagation()}>
            <WorkspaceSidebar onNavigate={() => setSessionPickerOpen(false)} />
          </div>
        </div>
      )}

      <ErrorBoundary key={`inspector:${inspectorTab ?? 'closed'}:${projectId ?? ''}:${conversation?.key ?? ''}`}>
        <InspectorPane tab={inspectorTab} onSelect={openInspector} onClose={closeInspector} />
      </ErrorBoundary>
      <CommandPalette />
      {historyOpen && <HistoryPanel initialSessionId={historySourceSessionId} onClose={() => { setHistoryOpen(false); setHistorySourceSessionId(undefined); }} />}
      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
      {attentionOpen && <AttentionPanel onClose={() => setAttentionOpen(false)} />}
      {portabilityOpen && <PortabilityPanel onClose={() => setPortabilityOpen(false)} />}
    </div>
  );
}
