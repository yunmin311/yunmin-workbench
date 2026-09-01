/*
 * Adapted from DeepSeek-Reasonix desktop/frontend/src/components/AppChrome.tsx
 * (MIT, esengine/DeepSeek-Reasonix, main-v2). See THIRD_PARTY_NOTICES.md.
 */
import type { View } from '../store';

export function AppChrome({
  workspaceName,
  sessionName,
  view,
  demo,
  attentionCount,
  onOpenSessions,
  onView,
  onOpenCommands,
  onOpenAttention,
  onResetDemo,
  onExitDemo,
}: {
  workspaceName: string;
  sessionName: string;
  view: View;
  demo: boolean;
  attentionCount: number;
  onOpenSessions: () => void;
  onView: (view: View) => void;
  onOpenCommands: () => void;
  onOpenAttention: () => void;
  onResetDemo: () => void;
  onExitDemo: () => void;
}) {
  return (
    <header className="rebuild-chrome prototype-chrome">
      <button className="chrome-workspace" aria-label="Open workspace and session switcher" onClick={onOpenSessions}>
        <span className="chrome-logo" aria-hidden="true">Y</span>
        <span>
          <strong>{workspaceName}</strong>
          <small>{sessionName}</small>
        </span>
        <i aria-hidden="true">⌄</i>
      </button>

      <nav className="chrome-tabs" aria-label="Workspace view">
        <button aria-current={view !== 'canvas' && view !== 'compare' ? 'page' : undefined} onClick={() => onView('control')}>Session</button>
        <button aria-current={view === 'canvas' ? 'page' : undefined} onClick={() => onView('canvas')}>Map</button>
        <button aria-current={view === 'compare' ? 'page' : undefined} onClick={() => onView('compare')}>Compare</button>
      </nav>

      <div className="chrome-utilities">
        {demo && <span className="demo-ribbon" data-testid="demo-live-badge">DEMO · SIMULATED</span>}
        {demo && <button className="quiet-action" onClick={onResetDemo}>Reset</button>}
        {demo && <button className="quiet-action" aria-label="Exit demo workspace" onClick={onExitDemo}>Exit demo</button>}
        <button className={`attention-orb ${attentionCount === 0 ? 'is-quiet' : ''}`} aria-label={`Attention, ${attentionCount} active items`} onClick={onOpenAttention}>
          {attentionCount > 0 ? attentionCount : '·'}
        </button>
        <button className="command-trigger" aria-label="Open command palette" onClick={onOpenCommands}>
          <span>Search or run</span><kbd>Ctrl K</kbd>
        </button>
      </div>
    </header>
  );
}
