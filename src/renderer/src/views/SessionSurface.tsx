import type { ActivityEvent } from '../../../core/types';
import { useWorkbench } from '../store';

const ACTIVITY_LABEL: Record<ActivityEvent['kind'], string> = {
  'handoff-dispatched': 'Handoff dispatched',
  'handoff-accepted': 'Handoff accepted',
  'handoff-failed': 'Handoff failed',
  'session-started': 'Session started',
  'turn-started': 'Turn started',
  'agent-response': 'Agent response',
  'tool-started': 'Tool started',
  'tool-completed': 'Tool completed',
  'file-change': 'File change',
  'turn-completed': 'Turn completed',
  'turn-error': 'Turn error',
};

const ACTIVITY_GLYPH: Record<ActivityEvent['kind'], string> = {
  'handoff-dispatched': '→',
  'handoff-accepted': '✓',
  'handoff-failed': '!',
  'session-started': 'S',
  'turn-started': 'T',
  'agent-response': 'A',
  'tool-started': '⌁',
  'tool-completed': '⌁',
  'file-change': 'Δ',
  'turn-completed': '✓',
  'turn-error': '!',
};

export function SessionSurface() {
  const {
    snapshot, projectId, conversation, runtimeSessions, activity, activityProblem,
    taskSummary, draftSaveState, setTaskSummary, setView, clearActivity,
  } = useWorkbench();
  if (!projectId) return null;
  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  if (!conversation) {
    return (
      <div className="surface-empty">
        <span className="empty-glyph">W</span>
        <h1>{project?.displayName ?? projectId}</h1>
        <p>Select a Conversation from the workspace sidebar to open its active session.</p>
      </div>
    );
  }
  const runtime = runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1);
  const events = activity.filter((event) =>
    event.projectId === projectId && event.conversationKey === conversation.key,
  );
  return (
    <div className="session-surface">
      <header className="session-header">
        <div>
          <p className="eyebrow">Active session</p>
          <h1>{conversation.role}</h1>
          <p className="session-meta">{project?.displayName ?? projectId} · {conversation.platform} · lifecycle {conversation.status}</p>
        </div>
        <div className="session-header-status">
          <span className={`session-runtime runtime-text-${runtime?.state ?? 'unknown'}`}>
            <i className={`runtime-dot runtime-${runtime?.state ?? 'unknown'}`} />
            Runtime {runtime?.state ?? 'UNKNOWN'}
          </span>
          {runtime?.binding.externalSessionRef && <small title={runtime.binding.externalSessionRef}>thread {runtime.binding.externalSessionRef.slice(0, 8)}</small>}
        </div>
      </header>

      <section className="session-activity" aria-label="Structured runtime activity">
        <div className="activity-toolbar">
          <div><span>Activity</span><small>{events.length} observed events</small></div>
          {events.length > 0 && <button onClick={() => void clearActivity()}>Clear local history</button>}
        </div>
        {activityProblem && <p className="surface-alert">{activityProblem}</p>}
        {events.length === 0 ? (
          <div className="activity-empty">
            <span className="empty-glyph">A</span>
            <strong>No structured runtime activity</strong>
            <p>Handoff, session, turn, tool, file-change, and response boundaries appear only when the adapter observes them.</p>
          </div>
        ) : (
          <ol className="session-timeline">
            {events.map((event) => (
              <li key={event.id} className={`activity-kind-${event.kind}`}>
                <div className="activity-marker" aria-hidden="true">{ACTIVITY_GLYPH[event.kind]}</div>
                <div className="activity-body">
                  <div className="activity-title">
                    <strong>{ACTIVITY_LABEL[event.kind]}</strong>
                    <time>{new Date(event.observed.observedAt).toLocaleTimeString()}</time>
                  </div>
                  <p>{event.summary}</p>
                  {(event.runtimeRef || event.turnRef) && (
                    <div className="activity-refs">
                      {event.runtimeRef && <span title={event.runtimeRef}>thread {event.runtimeRef.slice(0, 12)}</span>}
                      {event.turnRef && <span title={event.turnRef}>turn {event.turnRef.slice(0, 12)}</span>}
                    </div>
                  )}
                  <small title={event.observed.sourceRef}>{event.observed.source} · {event.observed.verification}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="session-composer" aria-label="Persistent session composer">
        <div className="composer-label">
          <span>Unsent intent</span>
          <small>Workbench-local draft · {draftSaveState} · not dispatched</small>
        </div>
        <textarea
          value={taskSummary}
          onChange={(event) => setTaskSummary(event.target.value)}
          rows={3}
          placeholder="Describe the next handoff intent. This edits the local Packet task summary; it does not send a runtime message."
        />
        <div className="composer-actions">
          <button onClick={() => setView('context')}>Context</button>
          <button className="primary" onClick={() => setView('packet')}>Review Packet</button>
          <button disabled title="TODO: requires a structured runtime input/steer backend seam">Follow up / Steer unavailable</button>
        </div>
      </section>
    </div>
  );
}
