import { useEffect, useMemo, useState } from 'react';
import { checkPacketValidity, compilePacket, renderAgentInput } from '../../../core/project/packet';
import { overlayFileSourceRef, projectFileSourceRef } from '../../../core/project/sourceIdentity';
import { useWorkbench } from '../store';

export function PacketPanel() {
  const {
    snapshot,
    projectId,
    conversation,
    staging,
    taskSummary,
    projectFingerprints,
    setTaskSummary,
    frozen,
    refreshFrozen,
    refreshProjectFiles,
  } = useWorkbench();
  const [lastFrozen, setLastFrozen] = useState<string>('');
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    void refreshProjectFiles();
  }, [projectId, conversation?.key, refreshProjectFiles]);

  const currentFingerprints = useMemo(() => {
    const merged = new Map(snapshot?.sourceFingerprints.map((item) => [item.sourceRef, item.sha256]) ?? []);
    for (const item of projectFingerprints) merged.set(item.sourceRef, item.sha256);
    return [...merged].map(([sourceRef, sha256]) => ({ sourceRef, sha256 }));
  }, [snapshot, projectFingerprints]);

  const packet = useMemo(() => {
    if (!projectId || !conversation || !snapshot) return null;
    const adapter = snapshot.projects.find((p) => p.projectId === projectId);
    const governanceRefs = [
      adapter?.canonicalSource?.path ? projectFileSourceRef(projectId, adapter.canonicalSource.path) : null,
      overlayFileSourceRef('memory/MEMORY.md'),
    ].filter((x): x is string => Boolean(x));
    return compilePacket({
      projectId,
      conversationKey: conversation.key,
      taskSummary,
      governanceRefs,
      staging,
      fingerprints: currentFingerprints,
    });
  }, [snapshot, projectId, conversation, staging, taskSummary, currentFingerprints]);

  if (!projectId) return null;
  if (!conversation || !packet || !snapshot) {
    return <div className="panel"><h2>Task Packet</h2><p className="hint">先在 Control Room / Canvas 选择一个 Conversation。</p></div>;
  }
  const previewValidity = checkPacketValidity(packet, currentFingerprints);
  const compiledText = renderAgentInput(packet);

  const freeze = async () => {
    const { frozen: f, path } = await window.wb.freezePacket(packet);
    setLastFrozen(`v${f.version} · ${f.hash.slice(0, 12)} → ${path}`);
    await refreshFrozen();
  };

  const copy = async () => {
    await window.wb.copyText(compiledText);
    setCopyMessage('Copied exact preview text.');
  };

  return (
    <div className="panel">
      <h2>Task Packet — {conversation.role}</h2>
      <label className="field">
        <span>Task summary（本轮真正要推进的事）</span>
        <textarea value={taskSummary} onChange={(e) => setTaskSummary(e.target.value)} rows={3} placeholder="例：把 INBOX 里 needs-user 项分诊到各对话" />
      </label>
      <div className="packet-preview">
        <div className="packet-heading">
          <div>
            <p className="eyebrow">Agent input</p>
            <h3>Agent 实际会收到什么</h3>
          </div>
          <span className={`validity validity-${previewValidity.toLowerCase()}`}>{previewValidity}</span>
        </div>
        <p className="packet-summary">
          ≈ {packet.roughTokens} tokens · {packet.included.length} context · {packet.references.length} references
        </p>
        {packet.unresolvedDependencies.length > 0 && (
          <p className="packet-alert">Cannot verify: {packet.unresolvedDependencies.join(', ')}</p>
        )}
        <pre className="agent-input-text">{compiledText}</pre>
        <div className="packet-copy-row">
          <button onClick={() => void copy()}>Copy Agent Input</button>
          {copyMessage && <span className="ok">{copyMessage}</span>}
        </div>
        <details className="source-details">
          <summary>Sources & validity details</summary>
          <p className="hint">Deterministic local assembly; no model summary.</p>
          <p className="source">Governance: {packet.governanceRefs.join(', ') || 'none'}</p>
          <p className="source">Dependencies: {packet.sourceFingerprints.length} resolved · {packet.unresolvedDependencies.length} unresolved</p>
        </details>
      </div>
      <button className="primary" onClick={() => void freeze()}>Freeze Current Task Packet</button>
      {lastFrozen && <p className="ok">frozen: {lastFrozen}</p>}
      {frozen.length > 0 && (
        <div>
          <h4>Frozen versions（不可变快照；变化只能产生新版本）</h4>
          <ul>
            {frozen.map((f) => {
              const validity = checkPacketValidity(f, currentFingerprints);
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
