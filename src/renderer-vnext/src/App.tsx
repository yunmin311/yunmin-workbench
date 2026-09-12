import { useCallback, useEffect, useState } from 'react';
import { WorkGraphCanvas } from './components/canvas/WorkGraphCanvas';

import '../../../src/design/tokens.css';
import './styles/index.css';
import type { WorkGraphRevision } from './types';

function App() {
  const [revision, setRevision] = useState<WorkGraphRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [navigateRequest, setNavigateRequest] = useState<{ projectId: string; workId?: string; taskId?: string } | null>(null);

  const load = useCallback(async () => {
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
          onRefresh={load}
          navigateRequest={navigateRequest}
          onNavigated={() => setNavigateRequest(null)}
        />
      </main>
    </div>
  );
}

export default App;
