import { useWorkbench } from '../store';

export function SessionSurface() {
  const { snapshot, projectId, conversation, runtimeSessions } = useWorkbench();
  if (!projectId) return null;
  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  if (!conversation) {
    return (
      <div className="surface-empty">
        <span className="empty-glyph">W</span>
        <h1>{project?.displayName ?? projectId}</h1>
        <p>Select a Conversation from the workspace sidebar to open its active session.</p>
      </div>
    );
  }
  const runtime = runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1);
  return (
    <div className="session-surface">
      <header className="session-header">
        <div><p className="eyebrow">Active session</p><h1>{conversation.role}</h1></div>
        <div className="session-runtime"><i className={`runtime-dot runtime-${runtime?.state ?? 'unknown'}`} />{runtime?.state ?? 'UNKNOWN'}</div>
      </header>
      <div className="surface-empty session-placeholder">
        <span className="empty-glyph">S</span>
        <h2>Session work surface</h2>
        <p>The desktop shell is established. Structured runtime activity lands here in S2.</p>
      </div>
    </div>
  );
}
