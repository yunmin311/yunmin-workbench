import { useEffect, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InspectorPane, type InspectorTab } from './components/InspectorPane';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { HistoryPanel } from './components/HistoryPanel';
import { AttentionPanel } from './components/AttentionPanel';
import { PortabilityPanel } from './components/PortabilityPanel';
import { MemoryPanel } from './components/MemoryPanel';
import { MaterialSettings } from './components/MaterialSettings';
import { DoctorPanel } from './components/DoctorPanel';
import { CanvasView } from './views/CanvasView';
import { SessionSurface } from './views/SessionSurface';
import { useWorkbench } from './store';
import { DemoWelcomeScreen } from './demo/DemoWelcomeScreen';
import { AppChrome } from './components/AppChrome';
import { CompareView } from './views/CompareView';
import { ApprovalModal } from './components/ApprovalModal';
import { startDemoEnvironmentWatcher } from './demo/demoEnvironment';
import type { ActivityEvent } from '../../core/types';

export default function App() {
  const snapshot = useWorkbench((state) => state.snapshot);
  const loading = useWorkbench((state) => state.loading);
  const view = useWorkbench((state) => state.view);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const attentionItems = useWorkbench((state) => state.attentionItems);
  const initialize = useWorkbench((state) => state.initialize);
  const setView = useWorkbench((state) => state.setView);
  const syncIslandAttention = useWorkbench((state) => state.syncIslandAttention);
  const demoMode = useWorkbench((state) => state.demoMode);
  const exitDemo = useWorkbench((state) => state.exitDemo);
  const resetDemo = useWorkbench((state) => state.resetDemo);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [portabilityOpen, setPortabilityOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [historySourceSessionId, setHistorySourceSessionId] = useState<string | undefined>();
  const [approvalEvent, setApprovalEvent] = useState<ActivityEvent | null>(null);

  useEffect(() => {
    void initialize();
    startDemoEnvironmentWatcher();
    const offOverlay = window.wb.onOverlayChanged(() => void useWorkbench.getState().reloadAndRecheck());
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const offFocus = window.wb.onAppFocus(() => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => void useWorkbench.getState().recheckSources(), 300);
    });
    const offActivity = window.wb.onActivityChanged((event) => {
      useWorkbench.getState().ingestActivity(event);
      if ((event.kind === 'approval-required' || event.kind === 'needs-user-input') && event.attentionStatus !== 'resolved') {
        setApprovalEvent(event);
      }
    });
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
    const returnSession = () => setView('control');
    window.addEventListener('workbench:return-session', returnSession);
    return () => window.removeEventListener('workbench:return-session', returnSession);
  }, [setView]);

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
    const open = () => setDoctorOpen(true);
    window.addEventListener('workbench:open-doctor', open);
    return () => window.removeEventListener('workbench:open-doctor', open);
  }, []);

  useEffect(() => {
    const open = () => setMaterialOpen(true);
    window.addEventListener('workbench:open-material', open);
    return () => window.removeEventListener('workbench:open-material', open);
  }, []);

  useEffect(() => {
    const open = () => setSessionPickerOpen(true);
    window.addEventListener('workbench:open-session-picker', open);
    return () => window.removeEventListener('workbench:open-session-picker', open);
  }, []);

  if (loading) return <div className="center">Loading workspace truth…</div>;
  // First-run choice: show the Demo entry when there is no real content to work
  // with (null snapshot, or an empty overlay with no projects/conversations).
  // DEMO mode carries its own data and never needs this gate.
  const isEmptyReal = !snapshot || (snapshot.projects.length === 0 && snapshot.conversations.length === 0);
  if (!demoMode && isEmptyReal) {
    return (
      <DemoWelcomeScreen
        onOpenReal={() => void useWorkbench.getState().initialize()}
        note={snapshot?.problems?.[0]?.message}
      />
    );
  }
  if (!snapshot) return <DemoWelcomeScreen onOpenReal={() => void useWorkbench.getState().initialize()} />;

  const project = snapshot.projects.find((item) => item.projectId === projectId);
  const openInspector = (tab: InspectorTab) => {
    setInspectorTab(tab);
    if (tab === 'context' || tab === 'packet') setView(tab);
  };
  const closeInspector = () => {
    setInspectorTab(null);
    if (view === 'context' || view === 'packet') setView('control');
  };

  return (
    <div className="prototype-app is-with-sidebar">
      <AppChrome
        workspaceName={project?.displayName ?? 'Open workspace'}
        sessionName={conversation?.role ?? 'Choose a session'}
        view={view}
        demo={demoMode}
        attentionCount={attentionItems.length}
        onOpenSessions={() => setSessionPickerOpen(true)}
        onView={setView}
        onOpenCommands={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}
        onOpenAttention={() => setAttentionOpen(true)}
        onResetDemo={resetDemo}
        onExitDemo={() => void exitDemo()}
      />

      {snapshot.problems.length > 0 && (
        <details className="prototype-problems">
          <summary>{snapshot.problems.length} source problem{snapshot.problems.length === 1 ? '' : 's'}</summary>
          {snapshot.problems.map((problem, index) => <p key={index}>[{problem.source}] {problem.message}</p>)}
        </details>
      )}

      <WorkspaceSidebar
        onNavigate={() => setSessionPickerOpen(false)}
        isModal={false}
      />

      <main className={`prototype-surface ${view === 'canvas' ? 'is-canvas' : view === 'compare' ? 'is-compare' : 'is-session'}`}>
        <ErrorBoundary key={`surface:${view}:${projectId ?? ''}:${conversation?.key ?? ''}`}>
          {view === 'canvas' ? <CanvasView /> : view === 'compare' ? <CompareView /> : <SessionSurface onOpenSessions={() => setSessionPickerOpen(true)} />}
        </ErrorBoundary>
      </main>

      {sessionPickerOpen && (
        <div className="session-picker-layer" role="presentation" onMouseDown={() => setSessionPickerOpen(false)}>
          <div className="session-picker" role="dialog" aria-label="Switch workspace or session" onMouseDown={(event) => event.stopPropagation()}>
            <WorkspaceSidebar onNavigate={() => setSessionPickerOpen(false)} isModal />
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
      {materialOpen && <MaterialSettings onClose={() => setMaterialOpen(false)} />}
      {doctorOpen && <DoctorPanel onClose={() => setDoctorOpen(false)} />}
      {approvalEvent && <ApprovalModal event={approvalEvent} onClose={() => setApprovalEvent(null)} />}
    </div>
  );
}
