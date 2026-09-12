import { useCallback, useEffect, useState } from 'react';
import { WorkGraphCanvas } from './components/canvas/WorkGraphCanvas';
import './styles/index.css';
import type { WorkGraphRevision } from './types';

function App() {
  const [revision, setRevision] = useState<WorkGraphRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigateRequest, setNavigateRequest] = useState<{ projectId: string; workId?: string; taskId?: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await window.wb.getWorkGraphRevision();
      if (response.error) throw new Error(response.error);
      setRevision(response.revision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Compact → Full handoff: navigation identity only (no graph payload).
    return window.wb.onCompactNavigate((identity) => {
      setNavigateRequest(identity);
    });
  }, []);

  if (loading) {
    return (
      <div className="vnext-loading">
        <div className="spinner" />
        <p>Loading Work Graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vnext-error">
        <h2>Failed to load Work Graph</h2>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!revision) {
    return (
      <div className="vnext-empty">
        <h2>No Work Graph available</h2>
        <p>Open an overlay or bind a project to get started.</p>
      </div>
    );
  }

  return (
    <div className="vnext-app">
      <header className="vnext-header">
        <div className="header-left">
          <h1 className="app-title">Workbench vNext</h1>
          <span className="project-badge">{revision.candidate.scope.projectId}</span>
        </div>
      </header>
      <main className="vnext-main">
        <WorkGraphCanvas
          revision={revision}
          onRefresh={load}
          navigateRequest={navigateRequest}
          onNavigated={() => setNavigateRequest(null)}
        />
      </main>
    </div>
  );
}

export default App;
