import { Fragment, useState } from 'react';
import { useWorkbench } from '../store';

const CYCLE: Record<string, 'available' | 'included' | 'excluded'> = {
  available: 'included',
  included: 'excluded',
  excluded: 'available',
};

export function ContextStagingView() {
  const {
    snapshot,
    projectId,
    conversation,
    staging,
    memoryBodies,
    contextMessage,
    setStagingState,
    togglePin,
    setView,
    loadMemoryBody,
    addProjectFile,
    addManualContext,
    clearDraft,
  } = useWorkbench();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');
  if (!projectId) return null;

  const boundGovernance = staging.filter((item) => item.source.startsWith('adapter:'));
  const workContext = staging.filter((item) => !item.source.startsWith('adapter:'));
  const counts = {
    included: workContext.filter((c) => c.state === 'included').length,
    available: workContext.filter((c) => c.state === 'available').length,
    excluded: workContext.filter((c) => c.state === 'excluded').length,
  };
  const adapter = snapshot?.projects.find((project) => project.projectId === projectId);
  const verification = adapter?.canonicalSource?.verification ?? adapter?.observed.verification ?? 'UNKNOWN';
  const boundRefs = [...new Set(boundGovernance.flatMap((item) => item.sourceRef ? [item.sourceRef] : []))];
  const resolvedBoundRefs = boundRefs.filter((sourceRef) => snapshot?.sourceFingerprints.some((item) => item.sourceRef === sourceRef)).length;
  const fingerprintSummary = boundRefs.length === 0
    ? 'no declared fingerprint'
    : resolvedBoundRefs === boundRefs.length
      ? 'fingerprint available'
      : `${resolvedBoundRefs}/${boundRefs.length} fingerprints available`;
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

  const renderItems = (items: typeof staging) => (
    <table className="staging">
      <thead>
        <tr><th>Item</th><th>Type</th><th>Source</th><th>State</th><th>Pin</th></tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <Fragment key={c.id}>
            <tr className={`row-${c.state}`}>
              <td title={c.body}><button className="linklike" onClick={() => expand(c.id)}>{c.title}</button></td>
              <td>
                <span className="kind-label">
                  {c.provenance === 'USER PROVIDED' ? 'USER PROVIDED · ' : ''}
                  {c.isReference ? 'Reference' : 'Context'}
                </span>
              </td>
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
  );

  return (
    <div className="panel">
      <h2>Context Staging</h2>
      <p className="hint">
        Preparing input for project: {projectId}
        {conversation ? ` · conversation: ${conversation.role}` : ' · （未选 Conversation，先回 Control Room 或 Canvas 点一个）'}
      </p>
      <div className="context-counts">
        <span className="state-included">{counts.included} Included</span>
        <span className="state-available">{counts.available} Available</span>
        <span className="state-excluded">{counts.excluded} Excluded</span>
      </div>
      <div className="context-actions">
        <button onClick={() => void addProjectFile(false)}>+ File Context</button>
        <button onClick={() => void addProjectFile(true)}>+ File Reference</button>
        <button onClick={() => setManualOpen((open) => !open)}>+ Manual Context</button>
        {conversation && (
          <button onClick={() => window.confirm('Clear this conversation draft?') && void clearDraft()}>
            Clear Draft
          </button>
        )}
      </div>
      {manualOpen && (
        <div className="manual-context-form">
          <label className="field">
            <span>Title</span>
            <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="What this context is" />
          </label>
          <label className="field">
            <span>USER PROVIDED content</span>
            <textarea value={manualBody} onChange={(event) => setManualBody(event.target.value)} rows={4} />
          </label>
          <button
            className="primary"
            onClick={() => {
              addManualContext(manualTitle, manualBody);
              if (manualTitle.trim() && manualBody.trim()) {
                setManualTitle('');
                setManualBody('');
                setManualOpen(false);
              }
            }}
          >
            Add to Included
          </button>
        </div>
      )}
      {contextMessage && <p className="context-message">{contextMessage}</p>}
      {boundGovernance.length > 0 && (
        <details className="governance-context">
          <summary>
            <strong>Bound Governance</strong>
            <span>{boundGovernance.length} items</span>
            <span>{[...new Set(boundGovernance.map((item) => item.source))].join(', ')}</span>
            <span className={`governance-verification ver-${verification.toLowerCase()}`}>{verification}</span>
            <span>{fingerprintSummary}</span>
          </summary>
          <p className="hint">System-bound Context and Reference items. Each dependency remains independently compiled.</p>
          {renderItems(boundGovernance)}
        </details>
      )}
      {groups.map((group) => {
        const items = workContext.filter((item) => item.state === group.state);
        return (
          <section className="context-group" key={group.state}>
            <h3>{group.label} <span className="section-count">{items.length}</span></h3>
            <p className="hint group-note">{group.note}</p>
            {items.length === 0 ? (
              <p className="empty-state">No items</p>
            ) : (
              renderItems(items)
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
