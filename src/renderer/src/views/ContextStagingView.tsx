import { useState } from 'react';
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
      <p className="hint">included {counts.included} · available {counts.available} · excluded {counts.excluded}（点击状态切换；★ = Pinned，仅对 included 有效；Available ≠ Injected）</p>
      <table className="staging">
        <thead>
          <tr><th>state</th><th>pin</th><th>title</th><th>source</th><th>kind</th></tr>
        </thead>
        <tbody>
          {staging.map((c) => (
            <>
              <tr key={c.id} className={`row-${c.state}`}>
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
                <td title={c.body}>
                  <button className="linklike" onClick={() => expand(c.id)}>{c.title}</button>
                </td>
                <td className="source">{c.source}</td>
                <td>{c.isReference ? 'reference' : 'body'}</td>
              </tr>
              {expanded === c.id && (
                <tr key={`${c.id}:body`} className="body-row">
                  <td colSpan={5}>
                    <pre>{c.id.startsWith('memory:') ? memoryBodies[c.id.slice('memory:'.length)] ?? 'loading…' : c.body}</pre>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <button className="primary" disabled={!conversation} onClick={() => setView('packet')}>
        → Packet Preview / Freeze
      </button>
    </div>
  );
}
