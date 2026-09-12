import { useCallback, useEffect, useState } from 'react';
import { WorkGraphCanvas } from './components/canvas/WorkGraphCanvas';

import '../../../src/design/tokens.css';
import './styles/index.css';
import type { WorkGraphRevision } from './types';
import { projectIdsFromOverlay } from './workGraphView';

function App() {
  const [revision, setRevision] = useState<WorkGraphRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [navigateRequest, setNavigateRequest] = useState<{ projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' } | null>(null);
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const load = useCallback(async (projectId?: string) => {
    setError(null);
    // TEST FIXTURE scene: explicit dev flag, clearly badged in the UI, and
    // never mixed with real facts. The real read model stays the default.
    if (new URLSearchParams(window.location.search).has('fixture')) {
      try {
        const response = await window.wb.getFixtureWorkGraph();
        if (response.error) throw new Error(response.error);
        setRevision(response.revision);
        setIsFixture(response.revision !== null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const [response, overlay] = await Promise.all([
        window.wb.getWorkGraphRevision(projectId),
        window.wb.loadOverlay(),
      ]);
      if (response.error) throw new Error(response.error);
      setRevision(response.revision);
      setProjectIds(projectIdsFromOverlay(overlay));
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
      <div className="wb-boot">
        <div className="wb-boot-mark" aria-hidden="true">◎</div>
        <p>Opening workspace…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wb-boot is-error">
        <h2>Workspace unavailable</h2>
        <pre>{error}</pre>
        <button type="button" className="wb-btn is-accent" onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  if (!revision) {
    return (
      <div className="wb-boot">
        <h2>No workspace yet</h2>
        <p>Open an overlay or bind a project to begin.</p>
      </div>
    );
  }

  return (
    <div className={`vnext-app${isFixture ? ' is-fixture' : ''}`}>
      {isFixture && (
        <div className="wb-fixture-badge" role="status">TEST FIXTURE — synthetic scene, not real facts</div>
      )}
      <main className="vnext-main">
        <WorkGraphCanvas
          revision={revision}
          projectIds={projectIds}
          onSelectProject={(projectId) => void load(projectId)}
          onRefresh={() => load(revision.candidate.scope.projectId)}
          navigateRequest={navigateRequest}
          onNavigated={() => setNavigateRequest(null)}
        />
      </main>
    </div>
  );
}

export default App;
