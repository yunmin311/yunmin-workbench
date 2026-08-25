import { useEffect } from 'react';
import { useWorkbench } from './store';
import { ProjectsView } from './views/ProjectsView';
import { ControlRoomView } from './views/ControlRoomView';
import { CanvasView } from './views/CanvasView';
import { ContextStagingView } from './views/ContextStagingView';
import { PacketPanel } from './components/PacketPanel';

export default function App() {
  const { snapshot, loading, view, projectId, load, setView } = useWorkbench();

  useEffect(() => {
    void load();
    // P4: overlay canonical files changed on disk -> cheap invalidation + reload
    const off = window.wb.onOverlayChanged(() => void useWorkbench.getState().load(true));
    return off;
  }, [load]);

  if (loading && !snapshot) return <div className="center">Loading overlay…</div>;
  if (!snapshot) return <div className="center">No overlay snapshot.</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Yunmin Workbench</span>
        <span className="overlay" title={snapshot.overlayRoot}>
          overlay: {snapshot.overlayRoot || 'UNKNOWN'}
        </span>
        <nav>
          <button onClick={() => setView('projects')} disabled={view === 'projects'}>Projects</button>
          <button onClick={() => projectId && setView('control')} disabled={!projectId || view === 'control'}>Control Room</button>
          <button onClick={() => projectId && setView('canvas')} disabled={!projectId || view === 'canvas'}>Canvas</button>
          <button onClick={() => projectId && setView('context')} disabled={!projectId || view === 'context'}>Context</button>
          <button onClick={() => projectId && setView('packet')} disabled={!projectId || view === 'packet'}>Packet</button>
        </nav>
        <button className="refresh" onClick={() => void load(true)}>↻ reload</button>
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
