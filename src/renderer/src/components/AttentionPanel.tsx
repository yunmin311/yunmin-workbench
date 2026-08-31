import type { AttentionItem } from '../../../core/types';
import { useWorkbench } from '../store';

const kindLabel: Record<AttentionItem['kind'], string> = {
  'approval-required': 'Approval',
  'needs-user-input': 'Needs input',
  'receipt-failed': 'Receipt failed',
  'runtime-error': 'Runtime error',
  'packet-stale': 'Packet stale',
  'packet-invalid': 'Packet invalid',
  'gate-attention': 'Gate',
  'execution-review': 'Review',
};

export function AttentionPanel({ onClose }: { onClose: () => void }) {
  const items = useWorkbench((state) => state.attentionItems);
  const problem = useWorkbench((state) => state.attentionProblem);
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const selectProject = useWorkbench((state) => state.selectProject);
  const selectConversation = useWorkbench((state) => state.selectConversation);
  const setView = useWorkbench((state) => state.setView);
  const dismissAttention = useWorkbench((state) => state.dismissAttention);

  const openSource = (item: AttentionItem) => {
    if (!snapshot) return;
    const exactConversation = item.conversationKey
      ? snapshot.conversations.find((candidate) =>
        candidate.key === item.conversationKey
          && (!item.projectId || candidate.project === item.projectId))
      : undefined;
    const targetProjectId = exactConversation?.project ?? item.projectId;
    const exactProject = targetProjectId
      ? snapshot.projects.some((candidate) => candidate.projectId === targetProjectId)
      : false;
    if (targetProjectId && projectId !== targetProjectId && exactProject) selectProject(targetProjectId);
    if (exactConversation) selectConversation(exactConversation);
    if (exactConversation || exactProject) setView('control');
    onClose();
    if (item.kind === 'packet-stale' || item.kind === 'packet-invalid') {
      setTimeout(() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' })), 0);
    } else if (item.kind === 'gate-attention' && !item.eventRef) {
      setTimeout(() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'evidence' })), 0);
    }
    setTimeout(() => window.dispatchEvent(new CustomEvent('workbench:focus-attention-source', {
      detail: { eventRef: item.eventRef, sessionRef: item.sessionRef, sourceRef: item.sourceRef },
    })), 30);
  };

  return (
    <div className="attention-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="attention-panel"
        role="dialog"
        aria-label="Attention requiring review"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="attention-heading">
          <div><p className="eyebrow">Projection</p><h2>Attention</h2></div>
          <button className="icon-action" aria-label="Close Attention" onClick={onClose}>×</button>
        </header>
        <p className="hint">Explicit signals only. This list does not change task, runtime, or source truth.</p>
        {problem && <p className="packet-alert">{problem}</p>}
        {items.length === 0 ? (
          <p className="attention-empty">Nothing needs review right now.</p>
        ) : (
          <ul className="attention-list">
            {items.map((item) => (
              <li key={item.id} className={`attention-item attention-${item.level}`}>
                <button className="attention-item-main" onClick={() => openSource(item)}>
                  <span className="attention-meta">{kindLabel[item.kind]} · {item.level} · {item.verification}</span>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                  <small>{item.projectId ?? 'Project not supplied'}{item.sessionRef ? ` · ${item.sessionRef}` : ''}</small>
                  <small className="source">{item.sourceRef}{item.eventRef ? ` · event ${item.eventRef}` : ''}</small>
                </button>
                <button
                  className="attention-dismiss"
                  aria-label="Dismiss this observation"
                  title="Dismiss this observation locally"
                  onClick={() => void dismissAttention(item)}
                >Dismiss</button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
