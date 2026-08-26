import { useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HarnessRail } from './components/HarnessRail';
import { InspectorPane } from './components/InspectorPane';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { CanvasView } from './views/CanvasView';
import { HomeOverview } from './views/HomeOverview';
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
  const handoffStatus = useWorkbench((state) => state.handoffStatus);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const initialize = useWorkbench((state) => state.initialize);
  const reloadAndRecheck = useWorkbench((state) => state.reloadAndRecheck);

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
    return () => {
      offOverlay();
      offFocus();
      offActivity();
      offActivityCleared();
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [initialize]);

  if (loading && !snapshot) return <div className="center">Loading workspace truth…</div>;
  if (!snapshot) return <div className="center">No overlay snapshot.</div>;

  const shellMode = view === 'canvas' ? 'canvas' : view === 'projects' ? 'home' : 'work';
  const currentRuntime = conversation
    ? runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1)
    : undefined;

  return (
    <div className="harness-app">
      <header className="harness-titlebar">
        <div className="titlebar-brand">
          <span className="brand-mark">YW</span>
          <span>Yunmin Workbench</span>
        </div>
        <div className="titlebar-workspace">
          <span>{projectId ?? 'No workspace'}</span>
          {conversation && <><i>/</i><strong>{conversation.role}</strong></>}
        </div>
        <div className="titlebar-actions">
          <button
            className="command-trigger"
            aria-label="Open command palette"
            onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}
          >
            Commands <kbd>Ctrl K</kbd>
          </button>
          <button className="icon-action" aria-label="Reload external truth" onClick={() => void reloadAndRecheck()}>↻</button>
        </div>
      </header>

      {snapshot.problems.length > 0 && (
        <div className="problems">
          {snapshot.problems.map((problem, index) => (
            <span key={index}>[{problem.source}] {problem.message}</span>
          ))}
        </div>
      )}

      <div className="harness-body">
        <HarnessRail mode={shellMode} />
        <WorkspaceSidebar />
        <main className={`active-surface active-surface-${shellMode}`}>
          <ErrorBoundary key={`surface:${shellMode}:${projectId ?? ''}:${conversation?.key ?? ''}`}>
            {shellMode === 'home' && <HomeOverview />}
            {shellMode === 'work' && <SessionSurface />}
            {shellMode === 'canvas' && <CanvasView />}
          </ErrorBoundary>
        </main>
        <ErrorBoundary key={`inspector:${view}:${projectId ?? ''}:${conversation?.key ?? ''}`}>
          <InspectorPane />
        </ErrorBoundary>
      </div>

      <footer className="status-bar" aria-label="Current workspace status">
        <span>{projectId ?? 'NO PROJECT'}</span>
        <span>{conversation?.role ?? 'NO SESSION'}</span>
        <span>Harness {currentRuntime?.binding.harness ?? conversation?.platform ?? 'UNKNOWN'}</span>
        <span>Runtime {currentRuntime?.state ?? 'UNKNOWN'}</span>
        <span>Packet {packetValidity}</span>
        <span>Draft {draftSaveState}</span>
        <span>Handoff {handoffStatus}</span>
        <span className="status-spacer" />
        <span title={snapshot.overlayRoot}>Truth {snapshot.overlayRoot ? 'LOADED' : 'UNKNOWN'}</span>
      </footer>
      <CommandPalette />
    </div>
  );
}
