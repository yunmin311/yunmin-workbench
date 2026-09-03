import { discoverProjects } from '../../../core/project/discovery';
import { resolveWorkspaceTarget } from '../../../core/project/workspaceSession';
import { useWorkbench } from '../store';

interface ConversationStatusProjection {
  runtime: { label: string; className: string };
  lifecycle: { label: string; className: string };
  attention: { label: string; className: string } | null;
}

/** Single pure projection helper: computes runtime/lifecycle/attention for a conversation.
 * Runtime: latest matching RuntimeSession state; fallback to Conversation.runtimeState only if no session.
 * Lifecycle: directly from Conversation.status.
 * Attention: from AttentionItems (approval/input/review).
 */
export function projectConversationStatus(
  conversationKey: string,
  runtimeSessions: readonly { conversationKey?: string; state: string }[],
  attentionItems: readonly { conversationKey?: string; kind: string; level: string }[],
  conversationRuntimeState: string, // for runtime fallback only
  conversationStatus: string // for lifecycle only
): ConversationStatusProjection {
  // Runtime: prefer latest matching RuntimeSession
  const matchingSessions = runtimeSessions.filter((s) => s.conversationKey === conversationKey);
  const latestSession = matchingSessions.length > 0 ? matchingSessions[matchingSessions.length - 1] : null;
  let runtime: ConversationStatusProjection['runtime'];
  if (latestSession) {
    switch (latestSession.state) {
      case 'working': runtime = { label: 'Running', className: 'runtime-working' }; break;
      case 'error': runtime = { label: 'Error', className: 'runtime-error' }; break;
      case 'idle': runtime = { label: 'Idle', className: 'runtime-idle' }; break;
      case 'stopped': runtime = { label: 'Stopped', className: 'runtime-stopped' }; break;
      default: runtime = { label: 'Unknown', className: 'runtime-unknown' };
    }
  } else {
    // Fallback to Conversation.runtimeState only when no RuntimeSession evidence
    switch (conversationRuntimeState) {
      case 'idle': runtime = { label: 'Idle', className: 'runtime-idle' }; break;
      case 'working': runtime = { label: 'Running', className: 'runtime-working' }; break;
      case 'error': runtime = { label: 'Error', className: 'runtime-error' }; break;
      case 'stopped': runtime = { label: 'Stopped', className: 'runtime-stopped' }; break;
      default: runtime = { label: 'Unknown', className: 'runtime-unknown' };
    }
  }

  // Lifecycle: directly from Conversation.status
  let lifecycle: ConversationStatusProjection['lifecycle'];
  switch (conversationStatus) {
    case 'ACTIVE': lifecycle = { label: 'Active', className: 'lifecycle-active' }; break;
    case 'PAUSED': lifecycle = { label: 'Paused', className: 'lifecycle-paused' }; break;
    case 'STANDBY': lifecycle = { label: 'Standby', className: 'lifecycle-standby' }; break;
    case 'FROZEN': lifecycle = { label: 'Frozen', className: 'lifecycle-frozen' }; break;
    default: lifecycle = { label: conversationStatus || 'Unknown', className: 'lifecycle-unknown' };
  }

  // Attention: from AttentionItems (only explicit kinds)
  const attn = attentionItems.find(
    (a) => a.conversationKey === conversationKey &&
           (a.kind === 'approval-required' || a.kind === 'needs-user-input' || a.kind === 'execution-review')
  );
  let attention: ConversationStatusProjection['attention'] = null;
  if (attn) {
    if (attn.kind === 'approval-required') attention = { label: 'Needs Approval', className: 'attention-approval' };
    else if (attn.kind === 'needs-user-input') attention = { label: 'Needs Input', className: 'attention-input' };
    else if (attn.kind === 'execution-review') attention = { label: 'Ready Review', className: 'attention-review' };
  }

  return { runtime, lifecycle, attention };
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
                  const proj = projectConversationStatus(item.key, runtimeSessions, attentionItems, item.runtimeState, item.status);
                  return (
                    <li key={item.key}>
                      <button className={conversation?.key === item.key ? 'selected' : ''} onClick={() => openConversation(item.key)}>
                        <i className={`runtime-dot ${proj.runtime.className}`} />
                        <span><strong>{item.role}</strong><small>{item.platform}</small></span>
                        <span className="status-badges">
                          <em className={proj.lifecycle.className}>{proj.lifecycle.label}</em>
                          {proj.attention && <em className={proj.attention.className}>{proj.attention.label}</em>}
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
                  {running.map((session) => {
                    const targetConversation = snapshot.conversations.find((item) => item.key === session.conversationKey);
                    const proj = targetConversation ? projectConversationStatus(targetConversation.key, runtimeSessions, attentionItems, targetConversation.runtimeState, targetConversation.status) : { runtime: { label: 'Running', className: 'runtime-working' }, lifecycle: { label: 'Unknown', className: 'lifecycle-unknown' }, attention: null };
                    return (
                      <li key={session.id}>
                        <button onClick={() => session.conversationKey && openConversation(session.conversationKey)}>
                          <i className={`runtime-dot ${proj.runtime.className}`} />
                          <span>{targetConversation?.role ?? session.id}</span>
                          <small>{session.binding.harness}</small>
                        </button>
                      </li>
                    );
                  })}
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
                    const proj = targetConversation ? projectConversationStatus(targetConversation.key, runtimeSessions, attentionItems, targetConversation.runtimeState, targetConversation.status) : { runtime: { label: 'Unknown', className: 'runtime-unknown' }, lifecycle: { label: 'Project', className: 'lifecycle-unknown' }, attention: null };
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
              const proj = projectConversationStatus(item.key, runtimeSessions, attentionItems, item.runtimeState, item.status);
              return (
                <li key={item.key}>
                  <button
                    className={conversation?.key === item.key ? 'is-current' : ''}
                    onClick={() => openConversation(item.key)}
                    title={`${item.role} · ${item.platform} · ${proj.lifecycle.label} · ${proj.runtime.label}${proj.attention ? ` · ${proj.attention.label}` : ''}`}
                  >
                    <i className={`runtime-pill ${proj.runtime.className}`} />
                    <span className="name">{item.role}</span>
                    <span className="status-badges">
                      <em className={proj.lifecycle.className}>{proj.lifecycle.label}</em>
                      {proj.attention && <em className={proj.attention.className}>{proj.attention.label}</em>}
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
              const proj = targetConversation ? projectConversationStatus(targetConversation.key, runtimeSessions, attentionItems, targetConversation.runtimeState, targetConversation.status) : { runtime: { label: 'Running', className: 'runtime-working' }, lifecycle: { label: 'Unknown', className: 'lifecycle-unknown' }, attention: null };
              return (
                <li key={session.id}>
                  <button
                    onClick={() => session.conversationKey && openConversation(session.conversationKey)}
                    title={`Running · ${session.binding.harness}`}
                  >
                    <i className={`runtime-pill ${proj.runtime.className}`} />
                    <span className="name">{targetConversation?.role ?? session.id}</span>
                    <span className="status-badges">
                      <em className={proj.lifecycle.className}>{proj.lifecycle.label}</em>
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
              const proj = targetConversation ? projectConversationStatus(targetConversation.key, runtimeSessions, attentionItems, targetConversation.runtimeState, targetConversation.status) : { runtime: { label: 'Unknown', className: 'runtime-unknown' }, lifecycle: { label: 'Project', className: 'lifecycle-unknown' }, attention: null };
              return (
                <li key={`${target.projectId}:${target.conversationScope?.conversationKey ?? ''}`}>
                  <button onClick={() => { resumeWorkspace(target); }} title={targetConversation?.role ?? target.projectId}>
                    <i className={`runtime-pill ${proj.runtime.className}`} />
                    <span className="name">{targetConversation?.role ?? target.projectId}</span>
                    <span className="status-badges">
                      <em className={proj.lifecycle.className}>{proj.lifecycle.label}</em>
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
