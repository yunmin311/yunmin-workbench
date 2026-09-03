import { discoverProjects } from '../../../core/project/discovery';
import { resolveWorkspaceTarget } from '../../../core/project/workspaceSession';
import { useWorkbench } from '../store';

function lifecycleLabel(status: string): { label: string; className: string } {
  switch (status) {
    case 'ACTIVE': return { label: 'Active', className: 'lifecycle-active' };
    case 'PAUSED': return { label: 'Paused', className: 'lifecycle-paused' };
    case 'STANDBY': return { label: 'Standby', className: 'lifecycle-standby' };
    case 'FROZEN': return { label: 'Frozen', className: 'lifecycle-frozen' };
    default: return { label: status || 'Unknown', className: 'lifecycle-unknown' };
  }
}

function runtimeStateLabel(state: string): { label: string; className: string } {
  switch (state) {
    case 'working': return { label: 'Running', className: 'runtime-working' };
    case 'error': return { label: 'Error', className: 'runtime-error' };
    case 'idle': return { label: 'Idle', className: 'runtime-idle' };
    case 'stopped': return { label: 'Stopped', className: 'runtime-stopped' };
    default: return { label: 'Unknown', className: 'runtime-unknown' };
  }
}

function attentionLabel(item: { kind: string; level: string }): { label: string; className: string } | null {
  if (item.kind === 'approval-required') return { label: 'Needs Approval', className: 'attention-approval' };
  if (item.kind === 'needs-user-input') return { label: 'Needs Input', className: 'attention-input' };
  if (item.kind === 'execution-review') return { label: 'Ready Review', className: 'attention-review' };
  return null;
}

export function WorkspaceSidebar({ onNavigate, isModal = false }: { onNavigate?: () => void; isModal?: boolean }) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const workspaceSession = useWorkbench((state) => state.workspaceSession);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const attentionItems = useWorkbench((state) => state.attentionItems);
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

  const conversationAttention = (key: string) =>
    attentionItems.find((a) => a.conversationKey === key && (a.kind === 'approval-required' || a.kind === 'needs-user-input' || a.kind === 'execution-review'));

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
                  const rState = runtime?.state ?? item.runtimeState;
                  const rLabel = runtimeStateLabel(rState);
                  const lLabel = lifecycleLabel(item.status);
                  const attn = conversationAttention(item.key);
                  const aLabel = attn ? attentionLabel(attn) : null;
                  return (
                    <li key={item.key}>
                      <button className={conversation?.key === item.key ? 'selected' : ''} onClick={() => openConversation(item.key)}>
                        <i className={`runtime-dot ${rLabel.className}`} />
                        <span><strong>{item.role}</strong><small>{item.platform}</small></span>
                        <span className="status-badges">
                          <em className={lLabel.className}>{lLabel.label}</em>
                          {aLabel && <em className={aLabel.className}>{aLabel.label}</em>}
                        </span>
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
              <i className={`trust-pill trust-${project.trust?.toLowerCase() ?? 'unknown'}`} />
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
              const rState = runtime?.state ?? item.runtimeState;
              const rLabel = runtimeStateLabel(rState);
              const lLabel = lifecycleLabel(item.status);
              const attn = conversationAttention(item.key);
              const aLabel = attn ? attentionLabel(attn) : null;
              return (
                <li key={item.key}>
                  <button
                    className={conversation?.key === item.key ? 'is-current' : ''}
                    onClick={() => openConversation(item.key)}
                    title={`${item.role} · ${item.platform} · ${lLabel.label} · ${rLabel.label}${aLabel ? ` · ${aLabel.label}` : ''}`}
                  >
                    <i className={`runtime-pill ${rLabel.className}`} />
                    <span className="name">{item.role}</span>
                    <span className="status-badges">
                      <em className={lLabel.className}>{lLabel.label}</em>
                      {aLabel && <em className={aLabel.className}>{aLabel.label}</em>}
                    </span>
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
            <span>Running</span>
            <span>{running.length}</span>
          </div>
          <ul className="rail-sessions" role="list">
            {running.slice(0, 3).map((session) => {
              const targetConversation = snapshot.conversations.find((item) => item.key === session.conversationKey);
              const rLabel = runtimeStateLabel(session.state);
              const lLabel = targetConversation ? lifecycleLabel(targetConversation.status) : { label: 'Unknown', className: 'lifecycle-unknown' };
              return (
                <li key={session.id}>
                  <button
                    onClick={() => session.conversationKey && openConversation(session.conversationKey)}
                    title={`Running · ${session.binding.harness}`}
                  >
                    <i className={`runtime-pill ${rLabel.className}`} />
                    <span className="name">{targetConversation?.role ?? session.id}</span>
                    <span className="status-badges">
                      <em className={lLabel.className}>{lLabel.label}</em>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="rail-section-title">
            <span>Recent</span>
            <span>{recent.length}</span>
          </div>
          <ul className="rail-sessions" role="list">
            {recent.slice(0, 3).map((target) => {
              const targetConversation = target.conversationScope
                ? snapshot.conversations.find((item) => item.key === target.conversationScope!.conversationKey)
                : undefined;
              const rLabel = targetConversation ? runtimeStateLabel(targetConversation.runtimeState) : { label: 'Unknown', className: 'runtime-unknown' };
              const lLabel = targetConversation ? lifecycleLabel(targetConversation.status) : { label: 'Project', className: 'lifecycle-unknown' };
              return (
                <li key={`${target.projectId}:${target.conversationScope?.conversationKey ?? ''}`}>
                  <button onClick={() => { resumeWorkspace(target); }} title={targetConversation?.role ?? target.projectId}>
                    <i className={`runtime-pill ${rLabel.className}`} />
                    <span className="name">{targetConversation?.role ?? target.projectId}</span>
                    <span className="status-badges">
                      <em className={lLabel.className}>{lLabel.label}</em>
                    </span>
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
