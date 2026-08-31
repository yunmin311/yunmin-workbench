import { useEffect } from 'react';
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
  'approval-required': 'Approval required',
  'needs-user-input': 'User input needed',
  'harness-error': 'Harness error',
};

const boundaryKinds = new Set<ActivityEvent['kind']>([
  'handoff-dispatched', 'handoff-accepted', 'handoff-failed',
  'session-started', 'turn-started', 'turn-completed', 'turn-error',
  'approval-required', 'needs-user-input', 'harness-error',
]);

function ActivityCard({ event }: { event: ActivityEvent }) {
  const isTool = event.kind === 'tool-started' || event.kind === 'tool-completed';
  const isChange = event.kind === 'file-change';
  const isResponse = event.kind === 'agent-response';
  const isBoundary = boundaryKinds.has(event.kind);

  if (isBoundary) {
    return (
      <li className={`activity-boundary activity-kind-${event.kind}`} data-event-ref={event.id} data-session-ref={event.runtimeRef} data-source-ref={event.observed.sourceRef}>
        <span><i />{ACTIVITY_LABEL[event.kind]}</span>
        <p>{event.summary}</p>
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </li>
    );
  }

  return (
    <li className={`activity-card activity-kind-${event.kind} ${isTool ? 'tool-call-card' : ''} ${isChange ? 'change-card' : ''} ${isResponse ? 'response-card' : ''}`} data-event-ref={event.id} data-session-ref={event.runtimeRef} data-source-ref={event.observed.sourceRef}>
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

  useEffect(() => {
    const focusSource = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<{ eventRef?: string; sessionRef?: string; sourceRef: string }>).detail;
      setTimeout(() => {
        const candidates = [...document.querySelectorAll<HTMLElement>('[data-event-ref], [data-session-ref], [data-source-ref]')];
        const target = candidates.find((node) => Boolean(detail.eventRef) && node.dataset.eventRef === detail.eventRef)
          ?? candidates.find((node) => Boolean(detail.sessionRef) && node.dataset.sessionRef === detail.sessionRef)
          ?? candidates.find((node) => node.dataset.sourceRef === detail.sourceRef);
        if (!target) return;
        target.scrollIntoView({ block: 'center' });
        target.classList.add('attention-source-focus');
        setTimeout(() => target.classList.remove('attention-source-focus'), 1_800);
      }, 80);
    };
    window.addEventListener('workbench:focus-attention-source', focusSource);
    return () => window.removeEventListener('workbench:focus-attention-source', focusSource);
  }, []);

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
  const pinned = staging.filter((item) => item.state === 'included' && item.pinned).length;
  const attentionItems = useWorkbench((s) => s.attentionItems);
  const sessionAttention = attentionItems.filter(
    (item) => item.conversationKey === conversation.key || (!item.conversationKey && item.projectId === projectId),
  );
  const harnessLabel = runtime?.binding ? `${runtime.binding.harness} · ${runtime.binding.cwd ? runtime.binding.cwd.split(/[\\/]/).pop() : runtime.binding.machine}` : null;

  return (
    <div className="session-surface">
      <header className="session-header">
        <div>
          <p className="session-path">{project?.displayName ?? projectId} / {conversation.platform}</p>
          <h1>{conversation.role}</h1>
        </div>
        <div className="session-header-actions">
          <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-history'))}>History</button>
          {events.length > 0 && <button onClick={() => void clearActivity()}>Clear local activity</button>}
          <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'evidence' }))}>Evidence</button>
        </div>
      </header>

      {sessionAttention.length > 0 && (
        <div className="session-attention-strip" role="status" aria-label={`${sessionAttention.length} attention items`}>
          <span><strong>{sessionAttention[0].kind === 'approval-required' ? 'Approval' : sessionAttention[0].kind === 'needs-user-input' ? 'Needs input' : sessionAttention[0].level === 'alert' ? 'Attention' : 'Review'} · {sessionAttention.length}</strong> — {sessionAttention[0].title}</span>
          <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-attention'))}>Review</button>
        </div>
      )}

      <section className="session-activity" aria-label="Structured runtime activity">
        {activityProblem && <p className="surface-alert">{activityProblem}</p>}
        {events.length === 0 ? (
          <p className="activity-hint">
            <span className={`runtime-pulse runtime-${runtime?.state ?? 'unknown'}`} />
            No observed activity yet. Runtime boundaries appear here only when the adapter reports them; nothing is invented.
          </p>
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
          placeholder="Prepare the next handoff intent… (Add Context → Freeze → Send)"
        />
        <div className="composer-row">
          <div className="composer-context">
            <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' }))} title="Open Context staging drawer">+ Context</button>
            <button onClick={() => setView('context')} title="Agent will receive these items">
              {included} included{pinned ? ` · ${pinned} pinned` : ''}
            </button>
            <span className="composer-sep" aria-hidden="true" />
            <button className={`composer-packet-status validity-${packetValidity.toLowerCase()}`} onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' }))}>
              Packet {packetValidity}
            </button>
            <span>Draft {draftSaveState}</span>
            {harnessLabel && <span className="composer-harness" title={runtime?.binding.cwd ?? ''}>{harnessLabel}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              aria-label="Search History"
              title="Search History (⌘K → History)"
              onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-history'))}
              style={{ padding: '2px 6px', fontSize: 10 }}
            >
              History
            </button>
            <button
              aria-label="Search Memory"
              title="Search Memory (⌘K → Memory)"
              onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-memory'))}
              style={{ padding: '2px 6px', fontSize: 10 }}
            >
              Memory
            </button>
            <button className="composer-send" disabled title="No structured follow-up / steer backend is available">
              Follow up unavailable
            </button>
          </div>
        </div>
        <p style={{ margin: '6px 2px 0', fontSize: 9, color: 'var(--wb-text-contrast)', opacity: 0.45 }}>
          Context → Packet: included items + task summary become immutable Agent Input only after Freeze.
        </p>
      </section>
    </div>
  );
}
