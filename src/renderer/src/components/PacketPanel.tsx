import { useMemo, useState } from 'react';
import { checkPacketValidity, compilePacket } from '../../../core/project/packet';
import { useWorkbench } from '../store';

export function PacketPanel() {
  const { snapshot, projectId, conversation, staging, taskSummary, setTaskSummary, frozen, refreshFrozen } = useWorkbench();
  const [lastFrozen, setLastFrozen] = useState<string>('');

  const packet = useMemo(() => {
    if (!projectId || !conversation || !snapshot) return null;
    const adapter = snapshot.projects.find((p) => p.projectId === projectId);
    const governanceRefs = [
      adapter?.canonicalSource?.path ? `project-constitution:${adapter.canonicalSource.path}` : null,
      'overlay:MEMORY.md',
    ].filter((x): x is string => Boolean(x));
    return compilePacket({
      projectId,
      conversationKey: conversation.key,
      taskSummary,
      governanceRefs,
      staging,
      fingerprints: snapshot.sourceFingerprints,
    });
  }, [snapshot, projectId, conversation, staging, taskSummary]);

  if (!projectId) return null;
  if (!conversation || !packet || !snapshot) {
    return <div className="panel"><h2>Task Packet</h2><p className="hint">先在 Control Room / Canvas 选择一个 Conversation。</p></div>;
  }

  const freeze = async () => {
    const { frozen: f, path } = await window.wb.freezePacket(packet);
    setLastFrozen(`v${f.version} · ${f.hash.slice(0, 12)} → ${path}`);
    await refreshFrozen();
  };

  return (
    <div className="panel">
      <h2>Task Packet — {conversation.role}</h2>
      <label className="field">
        <span>Task summary（本轮真正要推进的事）</span>
        <textarea value={taskSummary} onChange={(e) => setTaskSummary(e.target.value)} rows={3} placeholder="例：把 INBOX 里 needs-user 项分诊到各对话" />
      </label>
      <div className="packet-preview">
        <h3>Agent 实际会收到什么（确定性装配，非模型总结）</h3>
        <p>
          rough tokens ≈ {packet.roughTokens} · governance refs: {packet.governanceRefs.join(', ')} ·
          dependencies: {packet.sourceFingerprints.length} resolved · {packet.unresolvedDependencies.length} unresolved
        </p>
        {packet.unresolvedDependencies.length > 0 && (
          <p className="problems">
            INVALID until dependencies resolve: {packet.unresolvedDependencies.join(', ')}
          </p>
        )}
        <h4>Included context（{packet.included.length}）</h4>
        <ul>{packet.included.map((c) => <li key={c.id}>{c.pinned ? '★ ' : ''}{c.title} — {c.body.slice(0, 120)}</li>)}</ul>
        <h4>References（{packet.references.length}）</h4>
        <ul>{packet.references.map((c) => <li key={c.id}>{c.title} <span className="source">({c.source})</span></li>)}</ul>
      </div>
      <button className="primary" onClick={() => void freeze()}>Freeze Current Task Packet</button>
      {lastFrozen && <p className="ok">frozen: {lastFrozen}</p>}
      {frozen.length > 0 && (
        <div>
          <h4>Frozen versions（不可变快照；变化只能产生新版本）</h4>
          <ul>
            {frozen.map((f) => {
              const validity = checkPacketValidity(f, snapshot.sourceFingerprints);
              return (
                <li key={f.hash}>
                  v{f.version} · {f.frozenAt} · {f.hash.slice(0, 12)} · ≈{f.roughTokens} tok ·{' '}
                  <span className={`validity validity-${validity.toLowerCase()}`}>{validity}</span>
                </li>
              );
            })}
          </ul>
          <p className="hint">CURRENT=依赖未变 · STALE=依赖文件已改 · INVALID=依赖已不存在（本地确定性比较，不重建 Packet）</p>
        </div>
      )}
    </div>
  );
}
