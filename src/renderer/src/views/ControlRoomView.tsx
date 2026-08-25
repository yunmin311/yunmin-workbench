import type { Conversation } from '../../../core/types';
import { buildControlRoom } from '../../../core/project/controlRoom';
import { useWorkbench } from '../store';

function ConvoRow({ c, onSelect, selected }: { c: Conversation; onSelect: () => void; selected: boolean }) {
  return (
    <li>
      <button className={`convo ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <span className="role">{c.role}</span>
        <span className={`badge status-${c.status.toLowerCase()}`}>{c.status}</span>
        <span className={`badge ver-${c.verification.toLowerCase()}`}>{c.verification}</span>
        <span className="platform">{c.platform}</span>
        {c.gitAuthority && <span className="git-auth" title={c.gitAuthority}>git</span>}
        <span className="source" title={`${c.observed.sourceRef} · ${c.observed.observedAt}`}>
          {c.observed.verification}
        </span>
      </button>
    </li>
  );
}

export function ControlRoomView() {
  const { snapshot, projectId, conversation, git, selectConversation, setView } = useWorkbench();
  if (!snapshot || !projectId) return null;
  const room = buildControlRoom(snapshot, projectId);
  if (!room) return <div className="panel">No data for project {projectId}.</div>;

  const select = (c: Conversation) => {
    selectConversation(c);
    setView('context');
  };

  return (
    <div className="panel">
      <h2>
        {room.displayName}
        <span className={`trust trust-${room.trust.toLowerCase()}`}>{room.trust}</span>
      </h2>
      {room.canonicalSource?.path && (
        <p className="hint">
          canonical: {room.canonicalSource.repository}/{room.canonicalSource.path}
          {room.canonicalSource.commit ? ` @ ${room.canonicalSource.commit.slice(0, 8)}` : ''}
          {room.canonicalSource.verification ? ` (${room.canonicalSource.verification})` : ''}
        </p>
      )}

      {/* P3: only a health/binding summary here; full machine/harness goes to Inspector later */}
      <section className="binding-summary">
        <h3>Binding / Health 摘要</h3>
        <p className="hint">
          {room.machine ? `machine: ${room.machine.displayName}` : 'machine: UNKNOWN'}
          {room.localRoot ? ` · local: ${room.localRoot}` : ' · local: 未绑定'}
          {snapshot.harness.length > 0 &&
            ` · harness: ${snapshot.harness.map((h) => `${h.harness}${h.model ? `(${h.model})` : ''}`).join(', ')}`}
        </p>
        {git && 'error' in git && <p className="hint">git: {git.error}</p>}
        {git && 'branch' in git && (
          <p className="hint" title={`${git.observed.sourceRef} · ${git.observed.observedAt}`}>
            git: {git.branch ?? '(detached)'} @ {git.head?.slice(0, 8) ?? '?'}
            {git.dirty ? ` · dirty(${git.modified})` : ' · clean'}
            {git.ahead ? ` · ↑${git.ahead}` : ''}
            {git.behind ? ` · ↓${git.behind}` : ''}
            {' '}· remote: {git.remotes.origin ?? 'none'}
          </p>
        )}
      </section>

      <section>
        <h3>Current Focus · Active ({room.active.length})</h3>
        <ul>{room.active.map((c) => <ConvoRow key={c.id} c={c} selected={conversation?.id === c.id} onSelect={() => select(c)} />)}</ul>
      </section>
      <section>
        <h3>Waiting ({room.waiting.length})</h3>
        <ul>{room.waiting.map((c) => <ConvoRow key={c.id} c={c} selected={conversation?.id === c.id} onSelect={() => select(c)} />)}</ul>
      </section>
      <section>
        <h3>Blocked / Frozen ({room.blocked.length})</h3>
        <ul>{room.blocked.map((c) => <ConvoRow key={c.id} c={c} selected={conversation?.id === c.id} onSelect={() => select(c)} />)}</ul>
      </section>

      {room.needsAttention.length > 0 && (
        <section>
          <h3>Needs Attention（INBOX 投影，回正本核验）</h3>
          <ul className="attention">
            {room.needsAttention.map((i) => (
              <li key={i.id} title={i.sourceRef}>{i.raw}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
