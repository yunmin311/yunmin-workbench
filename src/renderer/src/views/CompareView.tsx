import { useMemo } from 'react';
import { projectCompareGroups } from '../../../core/project/executionRelations';
import { compareProjectionRevisions } from '../../../core/projection/delta';
import type {
  ProjectionDeltaConversationChangeV0,
  ProjectionDeltaEvidenceRefChangeV0,
  ProjectionDeltaFailureV0,
  ProjectionDeltaResultV0,
  ProjectionDeltaV0,
} from '../../../core/projection/types';
import { useWorkbench } from '../store';

function shortRevision(id: string | undefined): string {
  if (!id) return '—';
  return id.length > 30 ? `${id.slice(0, 28)}…` : id;
}

function changedIdsFromConversation(changes: ProjectionDeltaConversationChangeV0[]): string[] {
  return changes.filter((c) => c.status === 'changed').map((c) => c.id).sort();
}

function changedIdsFromEvidence(changes: ProjectionDeltaEvidenceRefChangeV0[]): string[] {
  return changes.map((c) => c.id).sort();
}

type DeltaSurfaceState =
  | { kind: 'no-current-verified-revision' }
  | { kind: 'no-previous-verified-revision' }
  | { kind: 'failure'; failure: ProjectionDeltaFailureV0 }
  | { kind: 'delta'; delta: ProjectionDeltaV0 };

export function CompareView() {
  const activity = useWorkbench((state) => state.activity);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);
  const addResultToContext = useWorkbench((state) => state.addResultToContext);
  const projection = useWorkbench((state) => state.projection);
  const projectionPrevious = useWorkbench((state) => state.projectionPrevious);

  const groups = useMemo(() => projectCompareGroups(activity.filter((event) =>
    event.projectId === projectId)),
  [activity, projectId]);
  const visible = groups.filter((group) => group.executions.length > 1
    && group.executions.some((execution) => execution.result || execution.failed));

  // Real Projection Delta surface. The current side must be a verified
  // revision (NEEDS_FIX / STALE do not count, even if a previous revision
  // exists); we never fall back to raw Snapshot / Activity.
  const deltaState = useMemo<DeltaSurfaceState>(() => {
    if (projection.status !== 'VERIFIED' || !projection.current) {
      return { kind: 'no-current-verified-revision' };
    }
    if (!projectionPrevious) {
      return { kind: 'no-previous-verified-revision' };
    }
    if (projectionPrevious.candidate.scope.projectId !== projection.current.candidate.scope.projectId) {
      return { kind: 'no-previous-verified-revision' };
    }
    if (projectionPrevious.revisionHash === projection.current.revisionHash) {
      return { kind: 'no-previous-verified-revision' };
    }
    const result = compareProjectionRevisions(projectionPrevious, projection.current);
    if (!result.ok) {
      return { kind: 'failure', failure: result };
    }
    return { kind: 'delta', delta: result };
  }, [projection.status, projection.current, projectionPrevious]);

  return (
    <section className="compare-surface" aria-label="Compare real Agent results">
      <header>
        <p>Same task · independent executions</p>
        <h1>Compare results</h1>
        <span>Results, tools, and files are shown as observed. Workbench does not choose a winner.</span>
      </header>
      <article className="compare-delta" aria-label="Verified Projection Delta">
        <header>
          <span>Projection Delta</span>
          <strong>
            {deltaState.kind === 'delta'
              ? `${shortRevision(deltaState.delta.baseRevisionId)} → ${shortRevision(deltaState.delta.headRevisionId)}`
              : 'No previous verified revision in this session'}
          </strong>
        </header>
        {deltaState.kind === 'no-current-verified-revision' ? (
          <p className="compare-delta-empty">
            Current verified projection is not available (status: {projection.status}). Delta is not produced from a STALE or NEEDS_FIX build.
          </p>
        ) : null}
        {deltaState.kind === 'no-previous-verified-revision' ? (
          <p className="compare-delta-empty">
            Verified revisions accumulate only inside the current Project scope; switching Project clears them, and an identical verified revision does not advance the seam.
          </p>
        ) : null}
        {deltaState.kind === 'failure' ? (
          <p className="compare-delta-empty">
            Delta could not be computed ({deltaState.failure.code}): {deltaState.failure.message}
          </p>
        ) : null}
        {deltaState.kind === 'delta' ? (
          <div className="compare-delta-body">
            <dl className="compare-delta-summary">
              <div><dt>semanticChanged</dt><dd>{String(deltaState.delta.summary.semanticChanged)}</dd></div>
              <div><dt>provenanceChanged</dt><dd>{String(deltaState.delta.summary.provenanceChanged)}</dd></div>
              <div><dt>layoutChanged</dt><dd>{String(deltaState.delta.summary.layoutChanged)}</dd></div>
              <div><dt>conversations</dt><dd>+{deltaState.delta.summary.conversations.added} −{deltaState.delta.summary.conversations.removed} ~{deltaState.delta.summary.conversations.changed}</dd></div>
              <div><dt>runtimeExecutions</dt><dd>+{deltaState.delta.summary.runtimeExecutions.added} −{deltaState.delta.summary.runtimeExecutions.removed} ~{deltaState.delta.summary.runtimeExecutions.changed}</dd></div>
              <div><dt>relations</dt><dd>+{deltaState.delta.summary.relations.added} −{deltaState.delta.summary.relations.removed} ~{deltaState.delta.summary.relations.changed}</dd></div>
              <div><dt>artifacts</dt><dd>+{deltaState.delta.summary.artifacts.added} −{deltaState.delta.summary.artifacts.removed} ~{deltaState.delta.summary.artifacts.changed} evidence:{deltaState.delta.summary.artifacts.evidenceChanged}</dd></div>
              <div><dt>evidence</dt><dd>{deltaState.delta.summary.evidence.changed}</dd></div>
              <div><dt>layout</dt><dd>moved {deltaState.delta.summary.layout.moved} · viewport {deltaState.delta.summary.layout.viewportChanged}</dd></div>
            </dl>
            <ul className="compare-delta-changed">
              {changedIdsFromConversation(deltaState.delta.changes.conversations).map((id) => (
                <li key={`c-${id}`}>conversation: {id}</li>
              ))}
              {deltaState.delta.changes.runtimeExecutions.map((c) => (
                <li key={`e-${c.id}`}>runtimeExecution [{c.status}]: {c.id}</li>
              ))}
              {deltaState.delta.changes.collaborationRelations.map((c) => (
                <li key={`r-${c.id}`}>relation [{c.status}]: {c.id}</li>
              ))}
              {deltaState.delta.changes.artifactsOrEvidence.map((c) => (
                <li key={`a-${c.id}`}>artifact [{c.status}]: {c.id}</li>
              ))}
              {changedIdsFromEvidence(deltaState.delta.changes.evidenceRefs).map((id) => (
                <li key={`ev-${id}`}>evidence: {id}</li>
              ))}
              {deltaState.delta.changes.layout.map((c) => (
                <li key={`l-${c.id}`}>layout [{c.status}]: {c.id}</li>
              ))}
            </ul>
            <p className="compare-delta-limitations">
              {deltaState.delta.limitations.join(' ')}
            </p>
          </div>
        ) : null}
      </article>
      {visible.length === 0 ? (
        <div className="compare-empty">
          <strong>No comparable results yet</strong>
          <span>Run the same task with two or more Agents from the Session composer.</span>
        </div>
      ) : visible.map((group) => (
        <article className="compare-group" key={group.groupId}>
          <div className="compare-group-label"><span>Run</span><code>{group.groupId.slice(0, 8)}</code></div>
          <div className="compare-grid">
            {group.executions.map((execution) => (
              <section className={`compare-card ${execution.failed ? 'is-failed' : ''}`} key={execution.executionId}>
                <header>
                  <span className={`agent-monogram agent-${execution.harness}`}>{execution.harness.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{execution.harness}</strong><small>{execution.executionId}</small></span>
                  <button onClick={() => openRuntimeInspector({ executionId: execution.executionId })}>Runtime</button>
                </header>
                <div className="compare-result-body">
                  {execution.result?.content
                    ? <p>{execution.result.simulated ? '[DEMO/SIMULATED · ' + execution.harness + '] ' : ''}{execution.result.content}</p>
                    : <p className="compare-missing">{execution.failed ? 'This execution failed. Other results remain intact.' : 'Waiting for a real assistant result…'}</p>}
                </div>
                {execution.evidence.length > 0 && (
                  <ul className="compare-evidence">
                    {execution.evidence.map((event) => <li key={event.id}><span>{event.kind === 'file-change' ? 'File' : 'Tool'}</span>{event.content ?? event.summary}</li>)}
                  </ul>
                )}
                {execution.result?.content && <button className="continue-result" onClick={() => { addResultToContext(execution.result!); window.dispatchEvent(new CustomEvent('workbench:return-session')); }}>Use as context</button>}
              </section>
            ))}
          </div>
        </article>
      ))}
      {conversation && projectId && (
        <p className="compare-session-meta">
          Session <code>{conversation.key}</code> · Project <code>{projectId}</code> · Verified projection status <code>{projection.status}</code>
        </p>
      )}
    </section>
  );
}