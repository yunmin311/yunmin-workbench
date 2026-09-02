import { discoverProjects } from '../../../core/project/discovery';
import { resolveWorkspaceTarget } from '../../../core/project/workspaceSession';
import { useWorkbench } from '../store';

function runtimeStateLabel(runtimeState: string, lifecycle: string): { label: string; state: string } {
  if (runtimeState === 'working') return { label: 'Running', state: 'working' };
  if (lifecycle === 'STANDBY') return { label: 'Standby', state: 'idle' };
  if (lifecycle === 'PAUSED') return { label: 'Paused', state: 'stopped' };
  if (runtimeState === 'error') return { label: 'Error', state: 'error' };
  if (runtimeState === 'idle') return { label: 'Idle', state: 'idle' };
  return { label: lifecycle || 'Unknown', state: 'unknown' };
}

export function WorkspaceSidebar({ onNavigate, isModal = false }: { onNavigate?: () => void; isModal?: boolean }) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const workspaceSession = useWorkbench((state) => state.workspaceSession);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const selectProject = useWorkbench((state) => state.selectProject);
  const selectConversation = useWorkbench((state) => state.selectConversation);
  const resumeWorkspace = useWorkbench((state) => state.resumeWorkspace);
  const setView = useWorkbench((state) => state.setView);
  if (!snapshot) return null;

  const projects = discoverProjects(snapshot);
  const conversations = projectId ? snapshot.conversations.filter((item) => item.project === projectId) : [];
  const recent = workspaceSession.recent
    .filter((target) => resolveWorkspaceTarget(snapshot, target).target)
    .slice(0, 4);
  const running = runtimeSessions.filter((session) => session.state === 'working');

  const openConversation = (key: string) => {
    const next = snapshot.conversations.find((item) => item.key === key);
    if (!next) return;
    if (projectId !== next.project) selectProject(next.project);
    selectConversation(next);
    setView('control');
    onNavigate?.();
  };

  if (isModal) {
    return (
      <aside className="workspace-sidebar" aria-label="Workspace browser">
        <header className="session-picker-heading">
          <div>
            <p>Workspaces</p>
            <span>Switch project or continue a session</span>
          </div>
          <button aria-label="Open command palette" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-command-palette'))}>⌕</button>
        </header>

        <label className="project-switcher">
          <span>Project</span>
          <select value={projectId ?? ''} onChange={(event) => event.target.value && selectProject(event.target.value)}>
            <option value="" disabled>Choose a project</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.displayName} · {project.conversationCount}
              </option>
            ))}
          </select>
        </label>

        <section className="sidebar-section sidebar-conversations">
          <h2>Sessions <span>{conversations.length}</span></h2>
          {projectId ? (
            conversations.length > 0 ? (
              <ul>
                {conversations.map((item) => {
                  const runtime = runtimeSessions.filter((session) => session.conversationKey === item.key).at(-1);
                  const runtimeState = runtime?.state ?? item.runtimeState;
                  return (
                    <li key={item.key}>
                      <button className={conversation?.key === item.key ? 'selected' : ''} onClick={() => openConversation(item.key)}>
                        <i className={`runtime-dot runtime-${runtimeState}`} />
                        <span><strong>{item.role}</strong><small>{item.platform}</small></span>
                        <em className={item.status === 'ACTIVE' ? undefined : `lifecycle-${item.status.toLowerCase()}`}>{runtime?.state === 'working' ? 'RUNNING' : item.status}</em>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="sidebar-empty">No projected conversations</p>
          ) : <p className="sidebar-empty">Choose a project to see its sessions.</p>}
        </section>

        {(running.length > 0 || recent.length > 0) && (
          <div className="session-picker-secondary">
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
                        <button onClick={() => { resumeWorkspace(target); onNavigate?.(); }}>
                          <span>{targetConversation?.role ?? target.projectId}</span>
                          <small>{targetConversation ? target.projectId : 'PROJECT'}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="workspace-rail" aria-label="Workspace and session rail">
      <div className="rail-header">
        <span>Workspaces</span>
        <button
          aria-label="Open session picker"
          title="Open full session picker"
          onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-session-picker'))}
        >+</button>
      </div>

      <ul className="rail-projects" role="list">
        {projects.map((project) => (
          <li key={project.projectId}>
            <button
              className={projectId === project.projectId ? 'is-current' : ''}
              onClick={() => {
                if (projectId !== project.projectId) selectProject(project.projectId);
              }}
              title={`${project.displayName} · ${project.conversationCount} session${project.conversationCount === 1 ? '' : 's'}`}
            >
              <i className={`runtime-pill ${project.trust === 'VERIFIED' ? 'idle' : project.trust === 'DISCOVERED' ? 'working' : 'unknown'}`} />
              <span className="name">{project.displayName}</span>
              <span className="count">{project.conversationCount}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="rail-section-title">
        <span>Sessions</span>
        <span>{conversations.length}</span>
      </div>

      {projectId ? (
        <ul className="rail-sessions" role="list">
          {conversations.length > 0 ? (
            conversations.map((item) => {
              const runtime = runtimeSessions.filter((session) => session.conversationKey === item.key).at(-1);
              const runtimeState = runtime?.state ?? item.runtimeState;
              const meta = runtimeStateLabel(runtimeState, item.status);
              return (
                <li key={item.key}>
                  <button
                    className={conversation?.key === item.key ? 'is-current' : ''}
                    onClick={() => openConversation(item.key)}
                    title={`${item.role} · ${item.platform} · ${meta.label}`}
                  >
                    <i className={`runtime-pill ${meta.state}`} />
                    <span className="name">{item.role}</span>
                    <span className="lifecycle">{meta.label}</span>
                  </button>
                </li>
              );
            })
          ) : (
            <p style={{ padding: '12px 14px', fontSize: 11, color: 'var(--wb-text-contrast)', opacity: 0.5 }}>No sessions</p>
          )}
        </ul>
      ) : (
        <p style={{ padding: '12px 14px', fontSize: 11, color: 'var(--wb-text-contrast)', opacity: 0.5 }}>Choose a project to see its sessions</p>
      )}

      {(running.length > 0 || recent.length > 0) && (
        <>
          <div className="rail-section-title">
            <span>Recent</span>
            <span>{recent.length}</span>
          </div>
          <ul className="rail-sessions" role="list">
            {running.slice(0, 3).map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => session.conversationKey && openConversation(session.conversationKey)}
                  title={`Running · ${session.binding.harness}`}
                >
                  <i className="runtime-pill working" />
                  <span className="name">{snapshot.conversations.find((item) => item.key === session.conversationKey)?.role ?? session.id}</span>
                  <span className="lifecycle">{session.binding.harness}</span>
                </button>
              </li>
            ))}
            {recent.slice(0, 3).map((target) => {
              const targetConversation = target.conversationScope
                ? snapshot.conversations.find((item) => item.key === target.conversationScope!.conversationKey)
                : undefined;
              return (
                <li key={`${target.projectId}:${target.conversationScope?.conversationKey ?? ''}`}>
                  <button onClick={() => { resumeWorkspace(target); }} title={targetConversation?.role ?? target.projectId}>
                    <i className="runtime-pill unknown" />
                    <span className="name">{targetConversation?.role ?? target.projectId}</span>
                    <span className="lifecycle">{targetConversation ? target.projectId.slice(0, 8) : 'PROJECT'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="rail-foot">
        Multi-project · Multi-session workspace
      </div>
    </aside>
  );
}
