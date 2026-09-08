import React, { useEffect, useState } from 'react';
import { WorkGraphCanvas } from './components/canvas/WorkGraphCanvas';
import './styles/index.css';
import type { WorkGraphRevision, WorkGraphNode, WorkGraphEdge } from './types';

function App() {
  const [revision, setRevision] = useState<WorkGraphRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const rev = await window.wb.getWorkGraphRevision();
        setRevision(rev);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
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
        <div className="header-right">
          <div className="revision-info">
            rev <code>{revision.revisionId}</code> · {revision.candidate.semanticFacts.nodes.length} nodes · {revision.candidate.semanticFacts.edges.length} edges
          </div>
        </div>
      </header>
      <main className="vnext-main">
        <WorkGraphCanvas revision={revision} />
      </main>
    </div>
  );
}

export default App;