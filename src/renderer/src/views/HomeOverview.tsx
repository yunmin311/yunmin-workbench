import { discoverProjects } from '../../../core/project/discovery';
import { useWorkbench } from '../store';

export function HomeOverview() {
  const { snapshot, projectId, workspaceSession, runtimeSessions, resumeProblem, resumeWorkspace, setView } = useWorkbench();
  if (!snapshot) return null;
  const projects = discoverProjects(snapshot);
  const attention = snapshot.inbox.filter((item) => item.attention);
  const selected = projects.find((project) => project.projectId === projectId);
  return (
    <div className="surface-scroll overview-surface">
      <header className="surface-header">
        <div><p className="eyebrow">Home</p><h1>Workspace overview</h1></div>
        {workspaceSession.last && <button onClick={() => resumeWorkspace()}>Resume last workspace</button>}
      </header>
      {resumeProblem && <p className="surface-alert">{resumeProblem}</p>}
      <div className="overview-metrics">
        <article><strong>{projects.length}</strong><span>Projects</span></article>
        <article><strong>{snapshot.conversations.length}</strong><span>Conversations</span></article>
        <article><strong>{runtimeSessions.filter((session) => session.state === 'working').length}</strong><span>Running</span></article>
        <article><strong>{attention.length}</strong><span>Attention</span></article>
      </div>
      <section className="overview-section">
        <h2>{selected ? 'Current workspace' : 'Start working'}</h2>
        {selected ? (
          <button className="overview-workspace" onClick={() => setView('control')}>
            <span><strong>{selected.displayName}</strong><small>{selected.conversationCount} conversations · {selected.trust}</small></span>
            <span>Open work →</span>
          </button>
        ) : (
          <p>Select a project in the workspace sidebar. Projects are navigation, not a destination page.</p>
        )}
      </section>
      <section className="overview-section">
        <h2>Continuity</h2>
        {workspaceSession.recent.length > 0 ? (
          <ul className="overview-recents">
            {workspaceSession.recent.slice(0, 6).map((target) => (
              <li key={`${target.projectId}:${target.conversationScope?.conversationKey ?? ''}`}>
                <button onClick={() => resumeWorkspace(target)}>
                  <span>{target.projectId}</span>
                  <small>{target.conversationScope?.conversationKey ?? 'project workspace'}</small>
                  <time>{new Date(target.usedAt).toLocaleString()}</time>
                </button>
              </li>
            ))}
          </ul>
        ) : <p>No recent workspace yet.</p>}
      </section>
    </div>
  );
}
