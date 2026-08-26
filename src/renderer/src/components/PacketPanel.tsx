import { useEffect, useMemo, useState } from 'react';
import { checkPacketValidity, compilePacket, renderAgentInput } from '../../../core/project/packet';
import { applyHandoffReceipt, createHandoffIntent, markHandoffDispatched } from '../../../core/project/handoff';
import { overlayFileSourceRef, projectFileSourceRef } from '../../../core/project/sourceIdentity';
import type { HandoffReceipt, HarnessCapabilities, UserIntent } from '../../../core/types';
import { useWorkbench } from '../store';

export function PacketPanel() {
  const {
    snapshot,
    projectId,
    conversation,
    staging,
    taskSummary,
    projectFingerprints,
    recheckedSourceRefs,
    recheckedFingerprints,
    sourceChanges,
    setTaskSummary,
    frozen,
    refreshFrozen,
    recheckSources,
  } = useWorkbench();
  const [lastFrozen, setLastFrozen] = useState<string>('');
  const [copyMessage, setCopyMessage] = useState('');
  const [capabilities, setCapabilities] = useState<HarnessCapabilities | null>(null);
  const [intent, setIntent] = useState<UserIntent | null>(null);
  const [receipt, setReceipt] = useState<HandoffReceipt | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  useEffect(() => {
    void recheckSources();
    void window.wb.loadHarnessCapabilities().then(setCapabilities);
  }, [projectId, conversation?.key, recheckSources]);

  const currentFingerprints = useMemo(() => {
    const merged = new Map(snapshot?.sourceFingerprints.map((item) => [item.sourceRef, item.sha256]) ?? []);
    for (const sourceRef of recheckedSourceRefs) merged.delete(sourceRef);
    for (const item of recheckedFingerprints) merged.set(item.sourceRef, item.sha256);
    for (const item of projectFingerprints) merged.set(item.sourceRef, item.sha256);
    return [...merged].map(([sourceRef, sha256]) => ({ sourceRef, sha256 }));
  }, [snapshot, projectFingerprints, recheckedSourceRefs, recheckedFingerprints]);

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
      conversationId: conversation.conversationId,
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

  const handoff = async () => {
    if (handoffPending || previewValidity !== 'CURRENT' || !capabilities?.canDispatch) return;
    const draftIntent = createHandoffIntent(globalThis.crypto.randomUUID(), {
      projectId,
      conversationKey: conversation.key,
      packetText: compiledText,
      harness: 'codex',
    });
    const dispatched = markHandoffDispatched(draftIntent);
    setIntent(dispatched);
    setReceipt(null);
    setHandoffPending(true);
    const nextReceipt = await window.wb.dispatchToHarness({
      intentId: draftIntent.id,
      projectId,
      conversationKey: conversation.key,
      packetText: compiledText,
    });
    setReceipt(nextReceipt);
    setIntent(applyHandoffReceipt(dispatched, nextReceipt));
    setHandoffPending(false);
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
        {sourceChanges.length > 0 && (
          <p className="packet-alert">
            Source changed since the prior draft observation: {sourceChanges.join(', ')}. Current Draft content was refreshed; Frozen bodies were not changed.
          </p>
        )}
        <pre className="agent-input-text">{compiledText}</pre>
        <div className="packet-copy-row">
          <button onClick={() => void copy()}>Copy Agent Input</button>
          <button
            className="primary"
            disabled={handoffPending || previewValidity !== 'CURRENT' || !capabilities?.canDispatch}
            onClick={() => void handoff()}
          >
            {handoffPending ? 'Sending…' : 'Send to Codex'}
          </button>
          {copyMessage && <span className="ok">{copyMessage}</span>}
        </div>
        {intent && (
          <p className="hint handoff-status">
            Handoff intent: {intent.state.toUpperCase()}
            {receipt?.runtimeRef ? ` · thread ${receipt.runtimeRef}` : ''}
            {receipt?.turnRef ? ` · turn ${receipt.turnRef}` : ''}
            {receipt?.message ? ` · ${receipt.message}` : ''}
          </p>
        )}
        <details className="source-details">
          <summary>Sources & validity details</summary>
          <p className="hint">Deterministic local assembly; no model summary.</p>
          <p className="source">Governance: {packet.governanceRefs.join(', ') || 'none'}</p>
          <p className="source">Dependencies: {packet.sourceFingerprints.length} resolved · {packet.unresolvedDependencies.length} unresolved</p>
          <p className="source">
            Handoff: {capabilities?.protocol ?? 'checking Codex app-server'} · {capabilities?.evidence ?? 'UNKNOWN'}
          </p>
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
