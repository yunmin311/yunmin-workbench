import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkGraphCanvas } from './components/canvas/WorkGraphCanvas';

import '../../../src/design/tokens.css';
import './styles/index.css';
import './styles/approved-blue.css';
import type { WorkGraphRevision } from './types';
import type { AttentionItem, HarnessSessionPresence } from '../../core/types';
import { applyAttentionLocalState, reduceAttention } from '../../core/attention/reducer';
import { projectIdsFromOverlay } from './workGraphView';
import { projectLiveExecutionActivity, startHarnessPresenceRefresh, type LiveExecutionPresence, type RuntimePresenceSnapshot } from './presenceFreshness';

async function loadRuntimePresence(projectId: string): Promise<RuntimePresenceSnapshot> {
  const [liveExecutions, activity, local] = await Promise.all([
    window.wb.loadLiveExecutions(),
    window.wb.loadActivity({ limit: 200 }),
    window.wb.loadAttentionLocal(),
  ]);
  return {
    liveExecutions,
    attention: applyAttentionLocalState(reduceAttention({ activity: activity.events, limit: 200 }), local)
      .filter((item) => item.projectId === projectId),
  };
}

function App() {
  const [revision, setRevision] = useState<WorkGraphRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [navigateRequest, setNavigateRequest] = useState<{ projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' } | null>(null);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [overlayEmpty, setOverlayEmpty] = useState(false);
  const [hasBinding, setHasBinding] = useState(false);
  const [harnessSessions, setHarnessSessions] = useState<HarnessSessionPresence[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionPresence[]>([]);
  const [runtimeAttention, setRuntimeAttention] = useState<AttentionItem[]>([]);
  const presenceProjectId = useRef<string | null>(null);

  const load = useCallback(async (projectId?: string) => {
    setError(null);
    // TEST FIXTURE scene: explicit dev flag, clearly badged in the UI, and
    // never mixed with real facts. The real read model stays the default.
    if (new URLSearchParams(window.location.search).has('fixture')) {
      presenceProjectId.current = null;
      try {
        const response = await window.wb.getFixtureWorkGraph();
        if (response.error) throw new Error(response.error);
        setRevision(response.revision);
        setHarnessSessions([]);
        setLiveExecutions([]);
        setRuntimeAttention([]);
        setIsFixture(response.revision !== null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const [response, overlay, binding] = await Promise.all([
        window.wb.getWorkGraphRevision(projectId),
        window.wb.loadOverlay(),
        window.wb.loadOverlayBinding().catch(() => null),
      ]);
      setRevision(response.revision ?? null);
      const loadedProjectId = response.revision?.candidate.scope.projectId ?? null;
      presenceProjectId.current = loadedProjectId;
      if (loadedProjectId) {
        const [sessions, runtime] = await Promise.all([
          window.wb.listHarnessSessions(loadedProjectId),
          loadRuntimePresence(loadedProjectId),
        ]);
        setHarnessSessions(sessions);
        setLiveExecutions(runtime.liveExecutions);
        setRuntimeAttention(runtime.attention);
      } else {
        setHarnessSessions([]);
        setLiveExecutions([]);
        setRuntimeAttention([]);
      }
      setProjectIds(projectIdsFromOverlay(overlay));
      setOverlayEmpty(overlay.projects.length === 0);
      setHasBinding(binding !== null);
      // The main process reports exactly 'No project selected' when the
      // overlay exposes zero projects: that is the welcome state, not a
      // failure. Anything else with no revision is a real error.
      if (response.error && !(response.error === 'No project selected' && overlay.projects.length === 0)) {
        throw new Error(response.error);
      }
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
  }, [load]);

  useEffect(() => {
    const presence = startHarnessPresenceRefresh({
      currentProjectId: () => presenceProjectId.current,
      listSessions: (projectId) => window.wb.listHarnessSessions(projectId),
      apply: setHarnessSessions,
      loadRuntime: loadRuntimePresence,
      applyRuntime: (runtime) => {
        setLiveExecutions(runtime.liveExecutions);
        setRuntimeAttention(runtime.attention);
      },
      observeActivity: (event) => {
        const projectId = presenceProjectId.current;
        if (!projectId) return;
        setLiveExecutions((current) => projectLiveExecutionActivity(current, event, projectId));
      },
      subscribeActivity: (listener) => window.wb.onActivityChanged(listener),
    });
    return presence.dispose;
  }, []);

  const chooseFolder = useCallback(async () => {
    setError(null);
    try {
      const chosen = await window.wb.chooseOverlay();
      if (chosen.error) {
        setError(chosen.error);
        return;
      }
      if (!chosen.canceled) await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

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
        <p className="wb-boot-hint">Your files are untouched. Point at the right folder and retry.</p>
        <pre>{error}</pre>
        <div className="wb-boot-actions">
          <button type="button" className="wb-btn is-accent" onClick={() => void load()}>Retry</button>
          <button type="button" className="wb-btn" onClick={() => void chooseFolder()}>Choose folder…</button>
        </div>
      </div>
    );
  }

  if (!revision) {
    if (!hasBinding || overlayEmpty) {
      return (
        <div className="wb-boot">
          <div className="wb-boot-mark" aria-hidden="true">◎</div>
          <h2>Welcome to Workbench</h2>
          <p className="wb-boot-hint">Choose the folder that holds your work registry to begin —<br />your projects, tasks and chats will appear here.</p>
          <div className="wb-boot-actions">
            <button type="button" className="wb-btn is-accent" onClick={() => void chooseFolder()}>Choose folder…</button>
          </div>
        </div>
      );
    }
    return (
      <div className="wb-boot">
        <div className="wb-boot-mark" aria-hidden="true">◎</div>
        <h2>Nothing to show yet</h2>
        <p className="wb-boot-hint">This folder doesn&apos;t expose any work yet.</p>
        <div className="wb-boot-actions">
          <button type="button" className="wb-btn is-accent" onClick={() => void load()}>Retry</button>
          <button type="button" className="wb-btn" onClick={() => void chooseFolder()}>Choose folder…</button>
        </div>
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
          harnessSessions={harnessSessions}
          liveExecutions={liveExecutions}
          runtimeAttention={runtimeAttention}
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
