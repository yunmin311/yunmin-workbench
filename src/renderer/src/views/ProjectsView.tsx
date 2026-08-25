import { listProjects } from '../../../core/project/controlRoom';
import { useWorkbench } from '../store';

export function ProjectsView() {
  const { snapshot, selectProject } = useWorkbench();
  if (!snapshot) return null;
  const projects = listProjects(snapshot);
  return (
    <div className="panel">
      <h2>Projects</h2>
      <p className="hint">轻任务直接在原 Harness 完成；这里只展开需要多对话/复杂 Context 的项目。</p>
      <ul className="project-list">
        {projects.map((p) => (
          <li key={p.projectId}>
            <button className="project-card" onClick={() => selectProject(p.projectId)}>
              <span className="name">{p.displayName}</span>
              <span className={`trust trust-${p.trust.toLowerCase()}`}>{p.trust}</span>
              <span className="count">{p.conversationCount} conversations</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
