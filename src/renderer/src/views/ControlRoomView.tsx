import type { Conversation } from '../../../core/types';
import { bindingCandidate } from '../../../core/project/binding';
import { buildControlRoom } from '../../../core/project/controlRoom';
import { useWorkbench } from '../store';

function ConvoRow({ c, onSelect, selected }: { c: Conversation; onSelect: () => void; selected: boolean }) {
  return (
    <li>
      <button
        className={`convo ${selected ? 'selected' : ''}`}
        onClick={onSelect}
        title={`${c.observed.sourceRef} · ${c.observed.observedAt} · ${c.observed.verification}`}
      >
        <span className="role">{c.role}</span>
        <span className={`badge status-${c.status.toLowerCase()}`}>{c.status}</span>
        <span className={`badge ver-${c.verification.toLowerCase()}`}>{c.verification}</span>
        <span className="platform">{c.platform}</span>
        {c.gitAuthority && <span className="git-auth" title={c.gitAuthority}>git</span>}
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

  const gitFacts = git && 'branch' in git ? git : null;
  const binding = conversation ? bindingCandidate(snapshot, conversation, gitFacts) : null;
  const show = (v: string | undefined) => v ?? 'UNKNOWN';

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
        {gitFacts && (
          <p className="hint" title={`${gitFacts.observed.sourceRef} · ${gitFacts.observed.observedAt}`}>
            git: {gitFacts.branch ?? '(detached)'} @ {gitFacts.head?.slice(0, 8) ?? '?'}
            {gitFacts.dirty ? ` · dirty(${gitFacts.modified})` : ' · clean'}
            {gitFacts.ahead ? ` · ↑${gitFacts.ahead}` : ''}
            {gitFacts.behind ? ` · ↓${gitFacts.behind}` : ''}
            {' '}· remote: {gitFacts.remotes.origin ?? 'none'}
          </p>
        )}
        {binding && (
          <p
            className="hint"
            title={`Execution Binding 候选证据：${binding.evidence.map((e) => `${e.source}:${e.sourceRef}`).join(' + ')}`}
          >
            binding[{conversation!.role.slice(0, 12)}…]: harness={binding.binding.harness} · machine={show(binding.binding.machine)} ·
            cwd={show(binding.binding.cwd)} · branch={show(binding.binding.branch)} · head={show(binding.binding.head?.slice(0, 8))} ·
            session={show(binding.binding.externalSessionRef)} · {binding.verification} · evidence={binding.evidence.map((e) => e.source).join('+')}
          </p>
        )}
      </section>

      <p className="hint">
        以下是 Conversation lifecycle（对话生命周期），不是 Task 状态；canonical Task source 尚未接入。
      </p>
      <section>
        <h3>Conversation · Active ({room.conversationLifecycle.ACTIVE.length})</h3>
        <ul>{room.conversationLifecycle.ACTIVE.map((c) => <ConvoRow key={c.key} c={c} selected={conversation?.key === c.key} onSelect={() => select(c)} />)}</ul>
      </section>
      <section>
        <h3>Conversation · Paused ({room.conversationLifecycle.PAUSED.length})</h3>
        <ul>{room.conversationLifecycle.PAUSED.map((c) => <ConvoRow key={c.key} c={c} selected={conversation?.key === c.key} onSelect={() => select(c)} />)}</ul>
      </section>
      <section>
        <h3>Conversation · Frozen ({room.conversationLifecycle.FROZEN.length})</h3>
        <ul>{room.conversationLifecycle.FROZEN.map((c) => <ConvoRow key={c.key} c={c} selected={conversation?.key === c.key} onSelect={() => select(c)} />)}</ul>
      </section>
      <section>
        <h3>Conversation · Standby ({room.conversationLifecycle.STANDBY.length})</h3>
        <ul>{room.conversationLifecycle.STANDBY.map((c) => <ConvoRow key={c.key} c={c} selected={conversation?.key === c.key} onSelect={() => select(c)} />)}</ul>
      </section>
      {room.conversationLifecycle.UNKNOWN.length > 0 && (
        <section>
          <h3>Conversation · Unknown ({room.conversationLifecycle.UNKNOWN.length})</h3>
          <ul>{room.conversationLifecycle.UNKNOWN.map((c) => <ConvoRow key={c.key} c={c} selected={conversation?.key === c.key} onSelect={() => select(c)} />)}</ul>
        </section>
      )}

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
