import { useMemo } from 'react';
import { projectCompareGroups } from '../../../core/project/executionRelations';
import { useWorkbench } from '../store';

function shortRevision(id: string | undefined): string {
  if (!id) return '—';
  return id.length > 30 ? `${id.slice(0, 28)}…` : id;
}

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

  // Projection Delta is purely a field-level comparison; this surface never
  // invents impact, causality, or risk, and never falls back to raw Snapshot.
  const delta = useMemo(() => {
    if (!projection.current || !projectionPrevious) return null;
    if (projectionPrevious.candidate.scope.projectId !== projection.current.candidate.scope.projectId) {
      return null;
    }
    if (projectionPrevious.revisionHash === projection.current.revisionHash) return null;
    return { previous: projectionPrevious, current: projection.current };
  }, [projection.current, projectionPrevious]);

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
            {delta
              ? `${shortRevision(delta.previous.revisionId)} → ${shortRevision(delta.current.revisionId)}`
              : 'No previous verified revision in this session'}
          </strong>
        </header>
        {!delta ? (
          <p className="compare-delta-empty">
            Verified revisions accumulate only inside the current Project scope; switching Project clears them, and an identical verified revision does not advance the seam.
          </p>
        ) : (
          <p className="compare-delta-summary">
            Both revisions passed Workbench Verified Projection validation. This surface exposes only the bounded previous → current delta for the active Project; it does not read raw Snapshot / Activity and never infers runtime impact, downstream impact, causality, or mergeability.
          </p>
        )}
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