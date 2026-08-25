import { Fragment, useState } from 'react';
import { useWorkbench } from '../store';

const CYCLE: Record<string, 'available' | 'included' | 'excluded'> = {
  available: 'included',
  included: 'excluded',
  excluded: 'available',
};

export function ContextStagingView() {
  const { projectId, conversation, staging, memoryBodies, setStagingState, togglePin, setView, loadMemoryBody } = useWorkbench();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!projectId) return null;

  const counts = {
    included: staging.filter((c) => c.state === 'included').length,
    available: staging.filter((c) => c.state === 'available').length,
    excluded: staging.filter((c) => c.state === 'excluded').length,
  };
  const groups = [
    { state: 'included' as const, label: 'Included', note: 'Agent will receive these items' },
    { state: 'available' as const, label: 'Available', note: 'Not injected until selected' },
    { state: 'excluded' as const, label: 'Excluded', note: 'Explicitly left out' },
  ];

  const expand = (id: string) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    // P4: memory bodies load lazily, only when the user actually opens one
    if (next?.startsWith('memory:')) void loadMemoryBody(next.slice('memory:'.length));
  };

  return (
    <div className="panel">
      <h2>Context Staging</h2>
      <p className="hint">
        project: {projectId}
        {conversation ? ` · conversation: ${conversation.role}` : ' · （未选 Conversation，先回 Control Room 或 Canvas 点一个）'}
      </p>
      <div className="context-counts">
        <span className="state-included">{counts.included} Included</span>
        <span className="state-available">{counts.available} Available</span>
        <span className="state-excluded">{counts.excluded} Excluded</span>
      </div>
      {groups.map((group) => {
        const items = staging.filter((item) => item.state === group.state);
        return (
          <section className="context-group" key={group.state}>
            <h3>{group.label} <span className="section-count">{items.length}</span></h3>
            <p className="hint group-note">{group.note}</p>
            {items.length === 0 ? (
              <p className="empty-state">No items</p>
            ) : (
              <table className="staging">
                <thead>
                  <tr><th>Item</th><th>Type</th><th>Source</th><th>State</th><th>Pin</th></tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <Fragment key={c.id}>
                      <tr className={`row-${c.state}`}>
                        <td title={c.body}><button className="linklike" onClick={() => expand(c.id)}>{c.title}</button></td>
                        <td><span className="kind-label">{c.isReference ? 'Reference' : 'Context'}</span></td>
                        <td className="source">{c.source}</td>
                        <td>
                          <button className={`state state-${c.state}`} onClick={() => setStagingState(c.id, CYCLE[c.state])}>
                            {c.state}
                          </button>
                        </td>
                        <td>
                          <button className={`pin ${c.pinned ? 'on' : ''}`} disabled={c.state !== 'included'} onClick={() => togglePin(c.id)}>
                            {c.pinned ? '★' : '☆'}
                          </button>
                        </td>
                      </tr>
                      {expanded === c.id && (
                        <tr className="body-row">
                          <td colSpan={5}>
                            <pre>{c.id.startsWith('memory:') ? memoryBodies[c.id.slice('memory:'.length)] ?? 'loading…' : c.body}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      <button className="primary" disabled={!conversation} onClick={() => setView('packet')}>
        → Packet Preview / Freeze
      </button>
    </div>
  );
}
