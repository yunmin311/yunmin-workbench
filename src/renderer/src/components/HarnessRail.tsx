import { useWorkbench } from '../store';

export function HarnessRail({ mode }: { mode: 'home' | 'work' | 'canvas' }) {
  const { projectId, setView } = useWorkbench();
  const items = [
    { id: 'home' as const, label: 'Home', glyph: 'H', action: () => setView('projects') },
    { id: 'work' as const, label: 'Work', glyph: 'W', action: () => projectId && setView('control'), disabled: !projectId },
    { id: 'canvas' as const, label: 'Canvas', glyph: 'C', action: () => projectId && setView('canvas'), disabled: !projectId },
  ];
  return (
    <nav className="harness-rail" aria-label="Workspace modes">
      {items.map((item) => (
        <button
          key={item.id}
          className={mode === item.id ? 'active' : ''}
          aria-current={mode === item.id ? 'page' : undefined}
          aria-label={item.label}
          title={item.label}
          disabled={item.disabled}
          onClick={item.action}
        >
          <span aria-hidden="true">{item.glyph}</span>
          <small>{item.label}</small>
        </button>
      ))}
    </nav>
  );
}
