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
  const projects = discoverProjects(snapshot);
  const globalAttention = snapshot.inbox.filter((i) => i.attention && i.scope === 'global');
  return (
    <div className="panel">
      <h2>Projects</h2>
      <p className="hint">
        覆盖级别显式分层：VERIFIED/REGISTERED=治理项目，DISCOVERED=有 Git 绑定，UNKNOWN=仅对话声明。
        轻任务直接在原 Harness 完成；这里只展开需要多对话/复杂 Context 的项目。
      </p>
      {globalAttention.length > 0 && (
        <section>
          <h3>Global Needs Attention（Overlay 根 INBOX）</h3>
          <ul className="attention">
            {globalAttention.map((item) => (
              <li key={item.id} title={item.sourceRef}>{item.raw}</li>
            ))}
          </ul>
        </section>
      )}
      <ul className="project-list">
        {projects.map((p) => (
          <li key={p.projectId}>
            <button className="project-card" onClick={() => selectProject(p.projectId)}>
              <span className="name">{p.displayName}</span>
              <span className={`trust trust-${p.trust.toLowerCase()}`}>{p.trust}</span>
              <span className="coverage">
                {p.coverage.map((c) => (
                  <span key={c} className="coverage-tag">{COVERAGE_LABEL[c]}</span>
                ))}
              </span>
              <span className="count">{p.conversationCount} conversations</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
