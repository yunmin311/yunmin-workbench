import { useEffect, useState } from 'react';
import { SNIPPET_MARK, type HistoryCatalogResult, type HistorySearchResult, type HistorySessionDetail } from '../../../core/history/types';

function MarkedSnippet({ text }: { text: string }) {
  return <>{text.split(SNIPPET_MARK).map((part, index) => index % 2 === 1 ? <mark key={index}>{part}</mark> : part)}</>;
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<HistoryCatalogResult | null>(null);
  const [result, setResult] = useState<HistorySearchResult | null>(null);
  const [detail, setDetail] = useState<HistorySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    void window.wb.listHistory().then(setCatalog).catch((reason) => setError(String(reason))).finally(() => setBusy(false));
  }, []);

  const search = async () => {
    setBusy(true);
    setDetail(null);
    setError(null);
    try {
      setResult(await window.wb.searchHistory({ text: query, limit: 100 }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const openDetail = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      setDetail(await window.wb.readHistoryDetail(sessionId));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const problems = result?.problems ?? catalog?.problems ?? [];

  return (
    <div className="history-layer" role="presentation" onMouseDown={onClose}>
      <section className="history-panel" role="dialog" aria-label="Read-only History search" onMouseDown={(event) => event.stopPropagation()}>
        <header className="history-panel-header">
          <div>
            <p>DERIVED · READ ONLY</p>
            <h2>History / Search</h2>
            <small>Finding history does not mean current Context, agent-read, or Runtime active.</small>
          </div>
          <button aria-label="Close History" onClick={onClose}>×</button>
        </header>

        <form className="history-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <input type="search" role="searchbox" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Claude Code and Codex history…" />
          <button type="submit" disabled={busy}>Search</button>
        </form>

        {error && <p className="surface-alert">{error}</p>}
        {problems.length > 0 && (
          <details className="history-problems">
            <summary>{problems.length} parser problem{problems.length === 1 ? '' : 's'}</summary>
            {problems.map((problem, index) => <p key={`${problem.fileKey}:${problem.lineNumber ?? index}`}>{problem.kind} · {problem.sourceRef}{problem.lineNumber ? `:${problem.lineNumber}` : ''} · {problem.message}</p>)}
          </details>
        )}

        <div className="history-body">
          <div className="history-results" aria-label="History results">
            {!result && !busy && <p className="history-hint">{catalog?.sessions.length ?? 0} indexed sessions. Search stays lexical and local.</p>}
            {result?.emptyReason && <p className="history-hint">Enter at least two characters.</p>}
            {result?.hits.map((hit) => (
              <button className="history-hit" key={hit.session.sessionId} onClick={() => void openDetail(hit.session.sessionId)}>
                <span><strong>{hit.session.harness}</strong><time>{hit.session.endedAt ?? hit.session.startedAt ?? 'time UNKNOWN'}</time></span>
                <b>{hit.session.title ?? (hit.session.preview || 'Untitled history')}</b>
                <p><MarkedSnippet text={hit.snippet} />{hit.snippetTruncated ? ' [excerpt]' : ''}</p>
                <small title={hit.session.observed.sourceRef}>{hit.session.cwd ?? 'cwd UNKNOWN'} · {hit.session.observed.verification}</small>
              </button>
            ))}
          </div>

          <article className="history-detail" aria-label="History detail">
            {!detail ? <p className="history-hint">Open a result to inspect its derived transcript and provenance.</p> : (
              <>
                <header>
                  <p>{detail.session.harness} · {detail.session.nativeId}</p>
                  <h3>{detail.session.title ?? (detail.session.preview || 'Untitled history')}</h3>
                  <small>{detail.session.observed.sourceRef}</small>
                </header>
                <ol>
                  {detail.messages.map((message) => (
                    <li key={message.id} className={`history-message history-role-${message.role}`}>
                      <span>{message.role}<time>{message.at ?? 'time UNKNOWN'}</time></span>
                      <p>{message.text}</p>
                      <small title={message.observed.sourceRef}>{message.observed.sourceRef}{message.truncated ? ' · excerpt truncated' : ''}</small>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
