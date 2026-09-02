import { useState } from 'react';
import type { MemoryEvidenceExpansion, MemorySearchHit, MemorySearchResult } from '../../../core/memory/types';
import { useWorkbench } from '../store';

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<MemorySearchResult | null>(null);
  const [detail, setDetail] = useState<MemoryEvidenceExpansion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addMemoryContext = useWorkbench((state) => state.addMemoryContext);
  const conversation = useWorkbench((state) => state.conversation);
  const searchMemory = useWorkbench((state) => state.searchMemory);
  const expandMemory = useWorkbench((state) => state.expandMemory);

  const search = async () => {
    setBusy(true); setError(null); setDetail(null);
    try { setResult(await searchMemory({ text: query, limit: 50 })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const inspect = async (hit: MemorySearchHit) => {
    setBusy(true); setError(null);
    try { setDetail(await expandMemory(hit.id)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const selected = result?.hits.find((hit) => hit.id === (detail?.record.id));

  return (
    <div className="history-layer" role="presentation" onMouseDown={onClose}>
      <section className="history-panel memory-panel" role="dialog" aria-label="Derived Memory search" onMouseDown={(event) => event.stopPropagation()}>
        <header className="history-panel-header">
          <div><p>DERIVED · SOURCE FIRST</p><h2>Memory Search</h2><small>Retrieved does not mean used, sufficient, current, or included in Context.</small></div>
          <button aria-label="Close Memory" onClick={onClose}>×</button>
        </header>
        <form className="history-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <input type="search" role="searchbox" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search verified Memory projections…" />
          <button type="submit" disabled={busy}>Search</button>
        </form>
        {error && <p className="surface-alert">{error}</p>}
        {(result?.problems.length ?? 0) > 0 && <p className="surface-alert">{result!.problems.length} History source problem(s); unaffected sources remain searchable.</p>}
        <div className="history-body">
          <div className="history-results" aria-label="Memory results">
            {result?.emptyReason && <p className="history-hint">Enter at least two characters.</p>}
            {result?.hits.map((hit) => (
              <button className="history-hit memory-hit" key={hit.id} onClick={() => void inspect(hit)}>
                <span><strong>{hit.recordType}</strong><time>{hit.mentionedAt ?? 'mentioned time UNKNOWN'}</time></span>
                <b>{hit.summary}</b>
                <small>{hit.currentness} · {hit.verification} · used {hit.useCount}</small>
              </button>
            ))}
          </div>
          <article className="history-detail memory-detail" aria-label="Memory detail">
            {!detail ? <p className="history-hint">Open a compact result to expand its raw History evidence.</p> : <>
              <header><p>{'statement' in detail.record ? `FACT · ${detail.record.status}` : 'EVENT'} · {('currentness' in detail.record ? detail.record.currentness : detail.record.status)}</p>
                <h3>{'statement' in detail.record ? detail.record.statement : detail.record.summary}</h3>
                <small>{detail.record.sourceRefs.join(' · ')}</small></header>
              {'statement' in detail.record && (detail.record.supersedes.length > 0 || detail.record.conflicts.length > 0) && (
                <p className="memory-relations">Supersedes: {detail.record.supersedes.join(', ') || 'none'} · Conflicts: {detail.record.conflicts.join(', ') || 'none'}</p>
              )}
              <p className={`memory-evidence verdict-${detail.evidence.verdict.toLocaleLowerCase()}`}>Evidence {detail.evidence.verdict} · next: {detail.evidence.nextStrategy}</p>
              {detail.missingSourceRefs.length > 0 && <p className="surface-alert">Missing source: {detail.missingSourceRefs.join(', ')}</p>}
              <ol>{detail.messages.map((message) => <li key={message.id} className="history-message"><span>{message.role}<time>{message.at ?? 'time UNKNOWN'}</time></span><p>{message.text}</p><small>{message.observed.sourceRef}</small></li>)}</ol>
              <div className="memory-actions">
                <button disabled={!selected || !conversation || detail.evidence.verdict !== 'SUFFICIENT'} onClick={() => selected && void addMemoryContext(selected)}>Add to Context</button>
                <button disabled={!selected || !conversation || detail.evidence.verdict !== 'SUFFICIENT'} onClick={() => selected && void addMemoryContext(selected, true)}>Pin</button>
                <button disabled={detail.messages.length === 0} onClick={() => {
                  const sessionId = detail.messages[0]?.sessionId;
                  if (sessionId) window.dispatchEvent(new CustomEvent('workbench:open-history-source', { detail: sessionId }));
                }}>Inspect Source</button>
              </div>
            </>}
          </article>
        </div>
      </section>
    </div>
  );
}
