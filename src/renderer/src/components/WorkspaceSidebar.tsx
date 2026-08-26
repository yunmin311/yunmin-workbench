import { discoverProjects } from '../../../core/project/discovery';
import { resolveWorkspaceTarget } from '../../../core/project/workspaceSession';
import { useWorkbench } from '../store';

export function WorkspaceSidebar() {
  const {
    snapshot, projectId, conversation, workspaceSession, runtimeSessions,
    selectProject, selectConversation, resumeWorkspace, setView,
  } = useWorkbench();
  if (!snapshot) return null;
  const projects = discoverProjects(snapshot);
  const conversations = projectId ? snapshot.conversations.filter((item) => item.project === projectId) : [];
  const recent = workspaceSession.recent
    .filter((target) => resolveWorkspaceTarget(snapshot, target).target)
    .slice(0, 5);
  const running = runtimeSessions.filter((session) => session.state === 'working');
  const attention = snapshot.inbox.filter((item) => item.attention && (
    item.scope === 'global' || (item.scope === 'project' && item.projectId === projectId)
  ));

  const openConversation = (key: string) => {
    const next = snapshot.conversations.find((item) => item.key === key);
    if (!next) return;
    if (projectId !== next.project) selectProject(next.project);
    selectConversation(next);
    setView('control');
  };

  return (
    <aside className="workspace-sidebar" aria-label="Workspace browser">
      <div className="sidebar-heading">
        <span>Workspace</span>
        <button aria-label="Open quick switcher" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}>⌕</button>
      </div>

      <section className="sidebar-section sidebar-projects">
        <h2>Projects <span>{projects.length}</span></h2>
        <ul>
          {projects.map((project) => (
            <li key={project.projectId}>
              <button className={project.projectId === projectId ? 'selected' : ''} onClick={() => selectProject(project.projectId)}>
                <i className={`health-dot health-${project.trust.toLowerCase()}`} />
                <span>{project.displayName}</span>
                <small>{project.conversationCount}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar-section sidebar-conversations">
        <h2>Conversations <span>{conversations.length}</span></h2>
        {projectId ? (
          conversations.length > 0 ? (
            <ul>
              {conversations.map((item) => {
                const runtime = runtimeSessions.filter((session) => session.conversationKey === item.key).at(-1);
                return (
                  <li key={item.key}>
                    <button className={conversation?.key === item.key ? 'selected' : ''} onClick={() => openConversation(item.key)}>
                      <i className={`runtime-dot runtime-${runtime?.state ?? 'unknown'}`} />
                      <span>{item.role}</span>
                      <small>{runtime?.state === 'working' ? 'RUN' : item.status}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="sidebar-empty">No projected conversations</p>
        ) : <p className="sidebar-empty">Select a project</p>}
      </section>

      {recent.length > 0 && (
        <section className="sidebar-section sidebar-recent">
          <h2>Recent</h2>
          <ul>
            {recent.map((target) => {
              const targetConversation = target.conversationScope
                ? snapshot.conversations.find((item) => item.key === target.conversationScope!.conversationKey)
                : undefined;
              return (
                <li key={`${target.projectId}:${target.conversationScope?.conversationKey ?? ''}`}>
                  <button onClick={() => resumeWorkspace(target)}>
                    <span>{targetConversation?.role ?? target.projectId}</span>
                    <small>{targetConversation ? target.projectId : 'PROJECT'}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {running.length > 0 && (
        <section className="sidebar-section sidebar-running">
          <h2>Running <span>{running.length}</span></h2>
          <ul>
            {running.map((session) => (
              <li key={session.id}>
                <button onClick={() => session.conversationKey && openConversation(session.conversationKey)}>
                  <i className="runtime-dot runtime-working" />
                  <span>{snapshot.conversations.find((item) => item.key === session.conversationKey)?.role ?? session.id}</span>
                  <small>{session.binding.harness}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {attention.length > 0 && (
        <section className="sidebar-section sidebar-attention">
          <h2>Attention <span>{attention.length}</span></h2>
          <ul>
            {attention.slice(0, 4).map((item) => <li key={item.id} title={item.sourceRef}>{item.raw}</li>)}
          </ul>
        </section>
      )}
    </aside>
  );
}
