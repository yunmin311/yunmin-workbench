import { useEffect } from 'react';
import { useWorkbench } from './store';
import { ProjectsView } from './views/ProjectsView';
import { ControlRoomView } from './views/ControlRoomView';
import { CanvasView } from './views/CanvasView';
import { ContextStagingView } from './views/ContextStagingView';
import { PacketPanel } from './components/PacketPanel';

export default function App() {
  const { snapshot, loading, view, projectId, initialize, reloadAndRecheck, setView } = useWorkbench();

  useEffect(() => {
    void initialize();
    // P4: overlay canonical files changed on disk -> cheap invalidation + reload
    const offOverlay = window.wb.onOverlayChanged(() => void useWorkbench.getState().reloadAndRecheck());
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const offFocus = window.wb.onAppFocus(() => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => void useWorkbench.getState().recheckSources(), 300);
    });
    return () => {
      offOverlay();
      offFocus();
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [initialize]);

  if (loading && !snapshot) return <div className="center">Loading overlay…</div>;
  if (!snapshot) return <div className="center">No overlay snapshot.</div>;

  const navItems = [
    { id: 'projects' as const, label: 'Projects', needsProject: false },
    { id: 'control' as const, label: 'Control Room', needsProject: true },
    { id: 'canvas' as const, label: 'Canvas', needsProject: true },
    { id: 'context' as const, label: 'Context', needsProject: true },
    { id: 'packet' as const, label: 'Packet', needsProject: true },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Yunmin Workbench</span>
        <span className="overlay" title={snapshot.overlayRoot}>
          overlay: {snapshot.overlayRoot || 'UNKNOWN'}
        </span>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => (!item.needsProject || projectId) && setView(item.id)}
              disabled={item.needsProject && !projectId}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="refresh" onClick={() => void reloadAndRecheck()}>↻ reload</button>
      </header>
      {snapshot.problems.length > 0 && (
        <div className="problems">
          {snapshot.problems.map((p, i) => (
            <span key={i}>[{p.source}] {p.message}</span>
          ))}
        </div>
      )}
      <main>
        {view === 'projects' && <ProjectsView />}
        {view === 'control' && <ControlRoomView />}
        {view === 'canvas' && <CanvasView />}
        {view === 'context' && <ContextStagingView />}
        {view === 'packet' && <PacketPanel />}
      </main>
    </div>
  );
}
