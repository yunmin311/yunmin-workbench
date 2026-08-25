import { discoverProjects } from '../../../core/project/discovery';
import { useWorkbench } from '../store';

const COVERAGE_LABEL: Record<string, string> = {
  adapter: '治理适配',
  git: 'Git 仓',
  conversation: '仅对话',
};

export function ProjectsView() {
  const { snapshot, selectProject } = useWorkbench();
  if (!snapshot) return null;
  const trustOrder = { VERIFIED: 0, REGISTERED: 1, DISCOVERED: 2, UNKNOWN: 3 } as const;
  const projects = [...discoverProjects(snapshot)].sort(
    (a, b) => trustOrder[a.trust] - trustOrder[b.trust]
      || b.conversationCount - a.conversationCount
      || a.displayName.localeCompare(b.displayName),
  );
  const globalAttention = snapshot.inbox.filter((i) => i.attention && i.scope === 'global');
  return (
    <div className="panel">
      <h2>Projects</h2>
      <p className="hint">
        选择一个项目进入工作区。轻任务仍可直接在原 Harness 完成。
      </p>
      <ul className="project-list">
        {projects.map((p) => {
          const coverageDetails = p.coverage.map((source) => COVERAGE_LABEL[source]).join(' · ');
          return (
            <li key={p.projectId}>
              <button className="project-card" onClick={() => selectProject(p.projectId)}>
                <span className="project-identity">
                  <span className="name">{p.displayName}</span>
                  <span className="project-secondary">
                    <span>{p.conversationCount} conversations</span>
                    <span className="source-summary" title={`Coverage: ${coverageDetails}`}>
                      {p.coverage.length === 1 ? coverageDetails : `${p.coverage.length} sources`}
                    </span>
                  </span>
                </span>
                <span
                  className={`project-health health-${p.trust.toLowerCase()}`}
                  title={`Trust: ${p.trust} · Coverage: ${coverageDetails}`}
                >
                  <i aria-hidden="true" />{p.trust}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {globalAttention.length > 0 && (
        <details className="auxiliary-panel attention-summary">
          <summary>Global Needs Attention <span>{globalAttention.length}</span></summary>
          <p className="hint">来自 Overlay 根 INBOX；属于全局提醒，不会复制进单个项目。</p>
          <ul className="attention">
            {globalAttention.map((item) => (
              <li key={item.id} title={item.sourceRef}>{item.raw}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
