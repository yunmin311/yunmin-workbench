import type { ActivityEvent } from '../../../core/types';
import { useWorkbench } from '../store';

const ACTIVITY_LABEL: Record<ActivityEvent['kind'], string> = {
  'handoff-dispatched': 'Handoff dispatched',
  'handoff-accepted': 'Handoff accepted',
  'handoff-failed': 'Handoff failed',
  'session-started': 'Session started',
  'turn-started': 'Turn started',
  'agent-response': 'Agent response',
  'tool-started': 'Tool call',
  'tool-completed': 'Tool completed',
  'file-change': 'File changed',
  'turn-completed': 'Turn completed',
  'turn-error': 'Turn failed',
};

const boundaryKinds = new Set<ActivityEvent['kind']>([
  'handoff-dispatched', 'handoff-accepted', 'handoff-failed',
  'session-started', 'turn-started', 'turn-completed', 'turn-error',
]);

function ActivityCard({ event }: { event: ActivityEvent }) {
  const isTool = event.kind === 'tool-started' || event.kind === 'tool-completed';
  const isChange = event.kind === 'file-change';
  const isResponse = event.kind === 'agent-response';
  const isBoundary = boundaryKinds.has(event.kind);

  if (isBoundary) {
    return (
      <li className={`activity-boundary activity-kind-${event.kind}`}>
        <span><i />{ACTIVITY_LABEL[event.kind]}</span>
        <p>{event.summary}</p>
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </li>
    );
  }

  return (
    <li className={`activity-card activity-kind-${event.kind} ${isTool ? 'tool-call-card' : ''} ${isChange ? 'change-card' : ''} ${isResponse ? 'response-card' : ''}`}>
      <header>
        <span className="activity-card-icon" aria-hidden="true">{isTool ? '›_' : isChange ? '±' : 'A'}</span>
        <strong>{ACTIVITY_LABEL[event.kind]}</strong>
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </header>
      <p>{event.summary}</p>
      {(event.runtimeRef || event.turnRef) && (
        <details className="activity-detail">
          <summary>Observed detail</summary>
          {event.runtimeRef && <span title={event.runtimeRef}>runtime {event.runtimeRef}</span>}
          {event.turnRef && <span title={event.turnRef}>turn {event.turnRef}</span>}
          <span title={event.observed.sourceRef}>{event.observed.source} · {event.observed.verification}</span>
        </details>
      )}
    </li>
  );
}

export function SessionSurface({ onOpenSessions }: { onOpenSessions: () => void }) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const activity = useWorkbench((state) => state.activity);
  const activityProblem = useWorkbench((state) => state.activityProblem);
  const taskSummary = useWorkbench((state) => state.taskSummary);
  const draftSaveState = useWorkbench((state) => state.draftSaveState);
  const staging = useWorkbench((state) => state.staging);
  const packetValidity = useWorkbench((state) => state.packetValidity);
  const setTaskSummary = useWorkbench((state) => state.setTaskSummary);
  const setView = useWorkbench((state) => state.setView);
  const clearActivity = useWorkbench((state) => state.clearActivity);

  if (!projectId) {
    return (
      <div className="session-welcome">
        <span className="welcome-mark">YW</span>
        <h1>Start from a session</h1>
        <p>Choose a workspace and conversation. Context and Packet stay out of the way until you ask for them.</p>
        <button className="primary" onClick={onOpenSessions}>Open workspace</button>
      </div>
    );
  }

  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  if (!conversation) {
    return (
      <div className="session-welcome">
        <span className="welcome-mark">{project?.displayName?.slice(0, 2) ?? 'W'}</span>
        <h1>{project?.displayName ?? projectId}</h1>
        <p>Choose the conversation you want to continue.</p>
        <button className="primary" onClick={onOpenSessions}>Choose session</button>
      </div>
    );
  }

  const runtime = runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1);
  const events = activity.filter((event) =>
    event.projectId === projectId && event.conversationKey === conversation.key,
  );
  const included = staging.filter((item) => item.state === 'included').length;

  return (
    <div className="session-surface">
      <header className="session-header">
        <div>
          <p className="session-path">{project?.displayName ?? projectId} / {conversation.platform}</p>
          <h1>{conversation.role}</h1>
        </div>
        <div className="session-header-actions">
          {events.length > 0 && <button onClick={() => void clearActivity()}>Clear local activity</button>}
          <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'evidence' }))}>Evidence</button>
        </div>
      </header>

      <section className="session-activity" aria-label="Structured runtime activity">
        {activityProblem && <p className="surface-alert">{activityProblem}</p>}
        {events.length === 0 ? (
          <div className="activity-empty">
            <span className={`runtime-pulse runtime-${runtime?.state ?? 'unknown'}`} />
            <strong>No observed activity yet</strong>
            <p>Runtime boundaries appear here only when the adapter reports them. No transcript has been invented.</p>
          </div>
        ) : (
          <ol className="session-timeline">
            {events.map((event) => <ActivityCard key={event.id} event={event} />)}
          </ol>
        )}
      </section>

      <section className="session-composer" aria-label="Persistent session composer">
        <textarea
          value={taskSummary}
          onChange={(event) => setTaskSummary(event.target.value)}
          rows={2}
          placeholder="Prepare the next handoff intent…"
        />
        <div className="composer-row">
          <div className="composer-context">
            <button onClick={() => setView('context')}>{included} included</button>
            <button className={`validity-${packetValidity.toLowerCase()}`} onClick={() => setView('packet')}>Packet {packetValidity}</button>
            <span>Draft {draftSaveState}</span>
          </div>
          <button className="composer-send" disabled title="No structured follow-up / steer backend is available">
            Follow up unavailable
          </button>
        </div>
      </section>
    </div>
  );
}
