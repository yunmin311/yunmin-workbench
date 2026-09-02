import { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent } from '../../../core/types';
import { executionIdForEvent, projectRuntimeExecutions } from '../../../core/project/runtimeInspector';
import { latestRuntimeExecutionForConversation } from '../runtimeInspectorModel';
import { boundedTimeline, TIMELINE_PAGE_SIZE, visibleCountForTarget } from '../boundedTimeline';
import { useGovernanceView, useWorkbench } from '../store';
import { SessionComposer } from '../components/SessionComposer';

const ACTIVITY_LABEL: Record<ActivityEvent['kind'], string> = {
  'handoff-dispatched': 'Handoff dispatched',
  'handoff-accepted': 'Handoff accepted',
  'handoff-failed': 'Handoff failed',
  'handoff-cancelled': 'Handoff cancelled',
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
  'process-cancelled': 'Process cancelled',
};

const boundaryKinds = new Set<ActivityEvent['kind']>([
  'handoff-dispatched', 'handoff-accepted', 'handoff-failed', 'handoff-cancelled',
  'session-started', 'turn-started', 'turn-completed', 'turn-error',
  'approval-required', 'needs-user-input', 'harness-error', 'process-cancelled',
]);

import type { GovernanceSnapshot } from '../../../core/project/governanceBinding';

function GovernanceStrip({ governance, demoMode }: { governance: GovernanceSnapshot; demoMode: boolean }) {
  // Quiet, single-line at rest. We only surface problems or missing facts.
  const problemCount = governance.problems.length;
  const roleLabel = governance.dialogue.roleFromRegistry ?? 'role UNKNOWN';
  const lifecycle = governance.dialogue.lifecycle;
  const gateKeys = Object.keys(governance.gates.declared);
  const sessionId = governance.dialogue.sessionId ? ` · session ${governance.dialogue.sessionId}` : '';
  const defaultFlow = governance.gates.defaultFlow;
  const problem = problemCount > 0 ? ` · ${problemCount} problem${problemCount === 1 ? '' : 's'}` : '';
  const demo = demoMode ? ' · SIMULATED' : '';
  const title = `Role ${roleLabel} · ${lifecycle}${sessionId} · ${gateKeys.length} gate${gateKeys.length === 1 ? '' : 's'}${problem}${demo}`;
  return (
    <details className={`governance-strip ${problemCount > 0 ? 'has-problems' : ''}`} aria-label="Project governance summary">
      <summary>
        <strong>Governance</strong>
        <span className="governance-summary">{title}</span>
      </summary>
      <div className="governance-detail">
        {governance.canonicalSourceRef && (
          <p className="governance-line">Canonical source: <code>{governance.canonicalSourceRef}</code>{governance.canonicalSourceCommit ? ` @ ${governance.canonicalSourceCommit.slice(0, 8)}` : ''}</p>
        )}
        {governance.roles.length > 0 ? (
          <ul className="governance-roles">
            {governance.roles.map((role) => (
              <li key={role.role}>
                <strong>{role.role}</strong>
                <small>{role.responsibility}</small>
                <span className={`governance-lifecycle lifecycle-${role.lifecycle.toLowerCase()}`}>{role.lifecycle}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="governance-line">No roles declared by the adapter.</p>
        )}
        {gateKeys.length > 0 ? (
          <ul className="governance-gates">
            {gateKeys.map((key) => (
              <li key={key}><strong>{key}</strong> · <code>{governance.gates.declared[key]}</code></li>
            ))}
          </ul>
        ) : (
          <p className="governance-line">No <code>project_gates</code> declared by the adapter.</p>
        )}
        {defaultFlow && <p className="governance-line">Default flow: <code>{defaultFlow}</code></p>}
        {governance.gates.ownerConflicts.length > 0 && (
          <ul className="governance-conflicts">
            {governance.gates.ownerConflicts.map((conflict) => (
              <li key={conflict.key}>
                Hard conflict on <code>{conflict.key}</code>: {conflict.values.join(' | ')}
              </li>
            ))}
          </ul>
        )}
        {governance.problems.length > 0 && (
          <ul className="governance-problems">
            {governance.problems.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}

function ActivityCard({ event }: { event: ActivityEvent }) {
  const isTool = event.kind === 'tool-started' || event.kind === 'tool-completed';
  const isChange = event.kind === 'file-change';
  const isResponse = event.kind === 'agent-response';
  const isBoundary = boundaryKinds.has(event.kind);
  const openRuntimeInspector = useWorkbench((s) => s.openRuntimeInspector);
  const addResultToContext = useWorkbench((s) => s.addResultToContext);
  // Only events that explicitly name harness + native ref can target an exact execution.
  const executionId = executionIdForEvent(event);
  const inspectTarget = executionId ? { executionId } : null;

  const inspectButton = inspectTarget && (
    <button
      className="activity-inspect"
      title="Open this event's exact execution in the Runtime Inspector"
      onClick={() => openRuntimeInspector(inspectTarget)}
    >
      Inspect
    </button>
  );

  if (event.kind === 'handoff-dispatched' && event.content) {
    return (
      <li className="transcript-turn transcript-user" data-event-ref={event.id}>
        <div className="transcript-avatar">Y</div>
        <article><header><strong>You</strong><time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p>{event.content}</p></article>
      </li>
    );
  }

  if (isBoundary) {
    return (
      <li className={`activity-boundary activity-kind-${event.kind}`} data-event-ref={event.id} data-session-ref={event.runtimeRef} data-source-ref={event.observed.sourceRef}>
        <span>
          <i />{ACTIVITY_LABEL[event.kind]}
          {event.harness && <b className="harness-badge">{event.harness}</b>}
          {inspectButton}
        </span>
        <p>
          {event.summary}
          <small title={event.observed.sourceRef}>
            {event.adapter ?? event.observed.source} · {event.capability ?? 'observe'} · {event.observed.verification}
          </small>
        </p>
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </li>
    );
  }

  return (
    <li className={`activity-card activity-kind-${event.kind} ${isTool ? 'tool-call-card' : ''} ${isChange ? 'change-card' : ''} ${isResponse ? 'response-card' : ''}`} data-event-ref={event.id} data-session-ref={event.runtimeRef} data-source-ref={event.observed.sourceRef}>
      <header>
        <span className="activity-card-icon" aria-hidden="true">{isTool ? '›_' : isChange ? '±' : 'A'}</span>
        <strong>{ACTIVITY_LABEL[event.kind]}</strong>
        {event.harness && <span className="harness-badge" style={{ fontSize: 8, padding: '1px 4px', border: '1px solid var(--wb-border-color)', borderRadius: 4, background: 'var(--wb-surface-raised)', color: 'var(--wb-text-contrast)', marginLeft: 6 }}>{event.harness}</span>}
        {inspectButton}
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </header>
      <p>{event.content ?? event.summary}</p>
      {isResponse && event.content && (
        <button className="use-result" onClick={() => addResultToContext(event)}>Use as context</button>
      )}
      {(event.runtimeRef || event.turnRef) && (
        <details className="activity-detail">
          <summary>Observed detail</summary>
          {event.runtimeRef && <span title={event.runtimeRef}>runtime {event.runtimeRef}</span>}
          {event.turnRef && <span title={event.turnRef}>turn {event.turnRef}</span>}
          <span title={event.observed.sourceRef}>{event.observed.source} · {event.observed.verification}</span>
          {event.harness && <span>harness {event.harness}</span>}
          {event.adapter && <span>adapter {event.adapter}</span>}
          {event.capability && <span>capability {event.capability}</span>}
        </details>
      )}
    </li>
  );
}

export function SessionSurface({ onOpenSessions }: { onOpenSessions: () => void }) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const activity = useWorkbench((state) => state.activity);
  const liveExecutions = useWorkbench((state) => state.liveExecutions);
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);
  const activityProblem = useWorkbench((state) => state.activityProblem);
  const activityHasEarlier = useWorkbench((state) => state.activityHasEarlier);
  const loadEarlierActivity = useWorkbench((state) => state.loadEarlierActivity);
  const attentionItems = useWorkbench((s) => s.attentionItems);
  const clearActivity = useWorkbench((state) => state.clearActivity);
  const loadHarnessCapabilities = useWorkbench((state) => state.loadHarnessCapabilities);
  const demoMode = useWorkbench((state) => state.demoMode);
  const governance = useGovernanceView();

  useEffect(() => { void loadHarnessCapabilities(); }, [loadHarnessCapabilities, demoMode]);

  const events = useMemo(() => activity.filter((event) =>
    event.projectId === projectId && event.conversationKey === conversation?.key,
  ), [activity, projectId, conversation?.key]);
  const [visibleEventCount, setVisibleEventCount] = useState(TIMELINE_PAGE_SIZE);

  useEffect(() => setVisibleEventCount(TIMELINE_PAGE_SIZE), [conversation?.key]);

  useEffect(() => {
    const focusSource = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<{ eventRef?: string; sessionRef?: string; sourceRef: string }>).detail;
      setVisibleEventCount((current) => visibleCountForTarget(events, current, (event) =>
        (Boolean(detail.eventRef) && event.id === detail.eventRef)
          || (Boolean(detail.sessionRef) && event.runtimeRef === detail.sessionRef)
          || event.observed.sourceRef === detail.sourceRef));
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
  }, [events]);

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

  const runtimeExecutions = projectRuntimeExecutions(activity, liveExecutions.map((item) => item.executionId));
  const runtime = latestRuntimeExecutionForConversation(runtimeExecutions, conversation.key);
  const visibleEvents = boundedTimeline(events, visibleEventCount);
  const sessionAttention = attentionItems.filter(
    (item) => item.conversationKey === conversation.key || (!item.conversationKey && item.projectId === projectId),
  );
  const demoGroups = new Set(events.map((event) => event.groupId).filter(Boolean));
  const hasParallel = [...demoGroups].some((groupId) => new Set(events.filter((event) => event.groupId === groupId).map((event) => event.harness)).size > 1);
  const hasHandoff = events.some((event) => Boolean(event.parentSourceRef));

  return (
    <div className="session-surface">
      <header className="session-header">
        <div>
          <p className="session-path">{project?.displayName ?? projectId} / {conversation.platform}</p>
          <h1>{conversation.role}</h1>
        </div>
        <div className="session-header-actions">
          {runtime && <button data-testid="session-runtime-badge" onClick={() => openRuntimeInspector({ executionId: runtime.executionId })}><i className={`runtime-pulse runtime-${runtime.live ? runtime.state : 'unknown'}`} />{runtime.harness} · {runtime.live ? 'live' : 'historical'}</button>}
          <button aria-label="Open session commands" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}>•••</button>
        </div>
      </header>

      {demoMode && (
        <aside className="demo-walkthrough" aria-label="Demo walkthrough">
          <span>DEMO PATH</span>
          <ol>
            <li className={events.length > 0 ? 'done' : 'active'}>Single</li>
            <li className={hasParallel ? 'done' : events.length > 0 ? 'active' : ''}>Parallel</li>
            <li className={hasHandoff ? 'done' : hasParallel ? 'active' : ''}>Handoff</li>
            <li className={hasHandoff ? 'active' : ''}>Compare</li>
          </ol>
          <p>{events.length === 0 ? 'Send one task to an Agent.' : !hasParallel ? 'Select two Agents and run the same task.' : !hasHandoff ? 'Use a real result as context, then continue with another Agent.' : 'Open Compare to inspect both results and evidence.'}</p>
        </aside>
      )}

      {sessionAttention.length > 0 && (
        <div className="session-attention-strip" role="status" aria-label={`${sessionAttention.length} attention items`}>
          <span><strong>{sessionAttention[0].kind === 'approval-required' ? 'Approval' : sessionAttention[0].kind === 'needs-user-input' ? 'Needs input' : sessionAttention[0].level === 'alert' ? 'Attention' : 'Review'} · {sessionAttention.length}</strong> — {sessionAttention[0].title}</span>
          <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-attention'))}>Review</button>
        </div>
      )}

      <GovernanceStrip governance={governance} demoMode={demoMode} />

      <section className="session-activity" aria-label="Structured runtime activity">
        {activityProblem && <p className="surface-alert">{activityProblem}</p>}
        {events.length === 0 ? (
          <>
            <p className="activity-hint">
              <span className={`runtime-pulse runtime-${runtime?.state ?? 'unknown'}`} />
               No turns yet. Write the first task below; Runtime appears here only when an Adapter reports it.
            </p>
            {activityHasEarlier && <button className="timeline-load-earlier" onClick={() => void loadEarlierActivity()}>Search earlier activity</button>}
          </>
        ) : (
          <>
            {(visibleEvents.length < events.length || activityHasEarlier) && (
              <button
                className="timeline-load-earlier"
                onClick={() => void (async () => {
                  if (visibleEvents.length >= events.length && activityHasEarlier) await loadEarlierActivity();
                  setVisibleEventCount((count) => count + TIMELINE_PAGE_SIZE);
                })()}
              >
                Show earlier activity{visibleEvents.length < events.length ? ` · ${events.length - visibleEvents.length} hidden` : ''}
              </button>
            )}
            <ol className="session-timeline">
              {visibleEvents.map((event) => <ActivityCard key={event.id} event={event} />)}
            </ol>
          </>
        )}
      </section>

      <SessionComposer />
    </div>
  );
}
