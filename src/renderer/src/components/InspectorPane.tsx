import { ContextStagingView } from '../views/ContextStagingView';
import { PacketPanel } from './PacketPanel';
import { useWorkbench } from '../store';

export type InspectorTab = 'context' | 'packet' | 'changes' | 'evidence';

export function InspectorPane({
  tab,
  onSelect,
  onClose,
}: {
  tab: InspectorTab | null;
  onSelect: (tab: InspectorTab) => void;
  onClose: () => void;
}) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const sourceChanges = useWorkbench((state) => state.sourceChanges);
  const activity = useWorkbench((state) => state.activity);
  const runtimeSessions = useWorkbench((state) => state.runtimeSessions);
  const git = useWorkbench((state) => state.git);
  if (!tab) return null;
  const sessionActivity = activity.filter((event) =>
    (!projectId || event.projectId === projectId)
    && (!conversation || event.conversationKey === conversation.key),
  );
  const fileEvents = sessionActivity.filter((event) => event.kind === 'file-change');
  const runtime = conversation
    ? runtimeSessions.filter((session) => session.conversationKey === conversation.key).at(-1)
    : undefined;

  return (
    <div className="inspector-layer" role="presentation" onMouseDown={onClose}>
    <aside className="inspector-pane" data-tab={tab} aria-label="Workspace inspector" onMouseDown={(event) => event.stopPropagation()}>
      <div className="inspector-chrome">
        <div className="inspector-tabs" role="tablist" aria-label="Inspector views">
        {(['context', 'packet', 'changes', 'evidence'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            onClick={() => onSelect(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
        </div>
        <button className="inspector-close" aria-label="Close inspector" onClick={onClose}>×</button>
      </div>
      <div className="inspector-content" role="tabpanel">
        {!projectId && (
          <div className="inspector-empty"><strong>No workspace selected</strong><span>Choose a Project to inspect its Context and evidence.</span></div>
        )}
        {projectId && tab === 'context' && <ContextStagingView />}
        {projectId && tab === 'packet' && <PacketPanel />}
        {projectId && tab === 'changes' && (
          <div className="inspector-section">
            <header><p className="eyebrow">Observed</p><h2>Changes</h2></header>
            {sourceChanges.length === 0 && fileEvents.length === 0 ? (
              <p className="inspector-muted">No source or protocol file-change evidence for this workspace.</p>
            ) : (
              <ul className="inspector-list">
                {sourceChanges.map((source) => <li key={source}><strong>Source changed</strong><span>{source}</span></li>)}
                {fileEvents.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.observed.observedAt}</span></li>)}
              </ul>
            )}
          </div>
        )}
        {projectId && tab === 'evidence' && (
          <div className="inspector-section">
            <header><p className="eyebrow">Projection truth</p><h2>Evidence</h2></header>
            <dl className="evidence-list">
              <dt>Project</dt><dd>{snapshot?.projects.find((item) => item.projectId === projectId)?.observed.sourceRef ?? 'UNKNOWN'}</dd>
              <dt>Conversation</dt><dd>{conversation?.observed.sourceRef ?? 'UNKNOWN'}</dd>
              <dt>Runtime</dt><dd>{runtime?.observed.sourceRef ?? 'UNKNOWN'}</dd>
              <dt>Git</dt><dd>{git && 'observed' in git ? git.observed.sourceRef : 'UNKNOWN'}</dd>
              <dt>Harness</dt><dd>{runtime?.binding?.harness ? `${runtime.binding.harness} · ${runtime.observed.sourceRef}` : runtime ? runtime.observed.sourceRef : 'no active binding — harness not guessed from cwd/provider'}</dd>
            </dl>
            <p className="inspector-muted">UNKNOWN remains unknown; the Inspector does not infer missing runtime or flow. Runtime Binding belongs to one execution, not permanently to Conversation.</p>
          </div>
        )}
      </div>
    </aside>
    </div>
  );
}
