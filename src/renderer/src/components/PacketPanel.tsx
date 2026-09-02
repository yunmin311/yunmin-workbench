import { useEffect, useMemo, useState } from 'react';
import { checkPacketValidity, compilePacket, renderAgentInput } from '../../../core/project/packet';
import { dispatchableHarnesses, resolveHarnessTarget, type HarnessCapabilityMatrix, type HarnessTarget } from '../../../core/project/harnessSelection';
import { overlayFileSourceRef, projectFileSourceRef } from '../../../core/project/sourceIdentity';
import { governanceRefsForPacket } from '../../../core/project/governanceBinding';
import type { FrozenPacketSummary, HandoffReceipt, HarnessCapabilities, SourceFingerprint } from '../../../core/types';
import { useWorkbench } from '../store';

const COPY_CHAR_LIMIT = 5_000_000;

function FrozenRow({
  summary,
  currentFingerprints,
}: {
  summary: FrozenPacketSummary;
  currentFingerprints: SourceFingerprint[];
}) {
  const detail = useWorkbench((s) => s.frozenDetails[summary.hash]);
  const loadFrozenDetail = useWorkbench((s) => s.loadFrozenDetail);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const validity = checkPacketValidity(summary, currentFingerprints);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      void loadFrozenDetail(summary).then((loaded) => {
        if (!loaded) setProblem('Frozen body could not be loaded (file missing or corrupt). Other versions are unaffected.');
      });
    }
  };

  const copyFrozen = async () => {
    if (!detail) return;
    try {
      await window.wb.copyText(renderAgentInput(detail));
      setMessage('Copied frozen input.');
    } catch (error) {
      setMessage(`Copy failed: ${String(error)}`);
    }
  };

  return (
    <li className="frozen-row" data-source-ref={`workbench-frozen-packet:${summary.projectId}:${summary.conversationKey}:${summary.version}:${summary.hash}`}>
      <button className="frozen-toggle" aria-expanded={open} onClick={toggle}>
        v{summary.version} · {summary.frozenAt} · {summary.hash.slice(0, 12)} · ≈{summary.roughTokens} tok ·{' '}
        <span className={`validity validity-${validity.toLowerCase()}`}>{validity}</span>
      </button>
      {open && (
        <div className="frozen-detail">
          {problem && <p className="packet-alert">{problem}</p>}
          {!problem && !detail && <p className="hint">Loading frozen body…</p>}
          {detail && (
            <>
              <p className="source">{summary.taskSummary || '(no task summary)'}</p>
              <div className="packet-copy-row">
                <button onClick={() => void copyFrozen()}>Copy frozen input</button>
                {message && <span className={message.startsWith('Copied') ? 'ok' : 'packet-alert'}>{message}</span>}
              </div>
              <pre className="agent-input-text">{renderAgentInput(detail)}</pre>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function PacketPanel() {
  const snapshot = useWorkbench((s) => s.snapshot);
  const projectId = useWorkbench((s) => s.projectId);
  const conversation = useWorkbench((s) => s.conversation);
  const demoMode = useWorkbench((s) => s.demoMode);
  const demoSessionId = useWorkbench((s) => s.demoSessionId);
  const staging = useWorkbench((s) => s.staging);
  const taskSummary = useWorkbench((s) => s.taskSummary);
  const projectFingerprints = useWorkbench((s) => s.projectFingerprints);
  const recheckedSourceRefs = useWorkbench((s) => s.recheckedSourceRefs);
  const recheckedFingerprints = useWorkbench((s) => s.recheckedFingerprints);
  const sourceChanges = useWorkbench((s) => s.sourceChanges);
  const frozen = useWorkbench((s) => s.frozen);
  const frozenProblems = useWorkbench((s) => s.frozenProblems);
  const setTaskSummary = useWorkbench((s) => s.setTaskSummary);
  const refreshFrozen = useWorkbench((s) => s.refreshFrozen);
  const recheckSources = useWorkbench((s) => s.recheckSources);
  const setPacketValidity = useWorkbench((s) => s.setPacketValidity);
  const setHandoffStatus = useWorkbench((s) => s.setHandoffStatus);
  const sendTask = useWorkbench((s) => s.sendTask);

  const [lastFrozen, setLastFrozen] = useState('');
  const [freezePending, setFreezePending] = useState(false);
  const [freezeError, setFreezeError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [capabilities, setCapabilities] = useState<HarnessCapabilities | null>(null);
  const [allCapabilities, setAllCapabilities] = useState<HarnessCapabilityMatrix | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<HarnessTarget | null>(null);
  const [receipt, setReceipt] = useState<HandoffReceipt | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [handoffError, setHandoffError] = useState('');

  useEffect(() => {
    void recheckSources();
    void window.wb.loadHarnessCapabilities().then(setCapabilities);
    const environment = demoMode && demoSessionId
      ? { kind: 'demo' as const, sessionId: demoSessionId }
      : { kind: 'real' as const };
    void (window.wb.loadAllHarnessCapabilities ? window.wb.loadAllHarnessCapabilities(environment).then((all) => {
      const matrix = all as HarnessCapabilityMatrix;
      setAllCapabilities(matrix);
      setSelectedHarness((current) => current && dispatchableHarnesses(matrix).includes(current) ? current : null);
    }) : Promise.resolve());
  }, [projectId, conversation?.key, recheckSources, demoMode, demoSessionId]);

  const availableHarnesses = allCapabilities ? dispatchableHarnesses(allCapabilities) : [];
  const targetHarness = allCapabilities
    ? resolveHarnessTarget(allCapabilities, selectedHarness)
    : null;

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
    const governanceRefs = governanceRefsForPacket(snapshot, projectId, demoMode);
    return compilePacket({
      projectId,
      conversationKey: conversation.key,
      conversationId: conversation.conversationId,
      taskSummary,
      governanceRefs,
      staging,
      fingerprints: currentFingerprints,
    });
  }, [snapshot, projectId, conversation, staging, taskSummary, currentFingerprints, demoMode]);

  const previewValidity = packet ? checkPacketValidity(packet, currentFingerprints) : 'INVALID';
  const compiledText = useMemo(() => (packet ? renderAgentInput(packet) : ''), [packet]);
  useEffect(() => {
    setPacketValidity(packet ? previewValidity : 'UNKNOWN');
  }, [packet, previewValidity, setPacketValidity]);

  const freeze = async () => {
    if (!packet || freezePending) return;
    setFreezePending(true);
    setFreezeError('');
    try {
      const { frozen: f, path } = await window.wb.freezePacket(packet);
      setLastFrozen(`v${f.version} · ${f.hash.slice(0, 12)} → ${path}`);
      await refreshFrozen();
    } catch (error) {
      setFreezeError(`Freeze failed — nothing was written. ${String(error)}`);
    } finally {
      setFreezePending(false);
    }
  };

  const copy = async () => {
    if (!compiledText) return;
    if (compiledText.length > COPY_CHAR_LIMIT) {
      setCopyMessage(`Copy blocked: agent input is ${(compiledText.length / 1_000_000).toFixed(1)} MB, over the 5 MB clipboard guard.`);
      return;
    }
    try {
      await window.wb.copyText(compiledText);
      setCopyMessage('Copied exact preview text.');
    } catch (error) {
      setCopyMessage(`Copy failed: ${String(error)}`);
    }
  };

  const handoff = async () => {
    const effectiveCaps = targetHarness ? allCapabilities?.[targetHarness] : null;
    if (!targetHarness || !projectId || !conversation || !compiledText || handoffPending || previewValidity !== 'CURRENT' || !effectiveCaps?.canDispatch) return;
    setReceipt(null);
    setHandoffError('');
    setHandoffPending(true);
    setHandoffStatus('DISPATCHED');
    try {
      const [outcome] = await sendTask(taskSummary, targetHarness);
      if (outcome.status === 'accepted') {
        setReceipt(outcome.receipt);
      } else {
        setHandoffError(`Dispatch did not reach ${targetHarness}. ${outcome.error}`);
      }
    } catch (error) {
      setHandoffStatus('FAILED');
      setHandoffError(`Dispatch failed: ${String(error)}`);
    } finally {
      setHandoffPending(false);
    }
  };

  useEffect(() => {
    const onCopy = () => void copy();
    const onHandoff = () => void handoff();
    window.addEventListener('workbench:copy-agent-input', onCopy);
    window.addEventListener('workbench:handoff-agent-input', onHandoff);
    return () => {
      window.removeEventListener('workbench:copy-agent-input', onCopy);
      window.removeEventListener('workbench:handoff-agent-input', onHandoff);
    };
  });

  if (!projectId) return null;
  if (!conversation || !packet || !snapshot) {
    return <div className="panel"><h2>Task Packet</h2><p className="hint">先在 Control Room / Canvas 选择一个 Conversation。</p></div>;
  }

  return (
    <div className="panel">
      <p className="eyebrow">CONTEXT → PACKET · WIDE REVIEW · NOT A PERMANENT COLUMN</p>
      <h2>Task Packet — {conversation.role}</h2>
      <p className="hint">Packet compiles Context + task summary into immutable Agent Input. Review sources & CURRENT/STALE/INVALID before handoff. Copy ≠ Dispatch.</p>
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
        {allCapabilities && availableHarnesses.length > 1 && (
          <div className="harness-selector" style={{ margin: '10px 0 8px', padding: '8px 10px', border: '1px solid var(--wb-border-color)', borderRadius: 6, background: 'var(--wb-surface-raised)', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, color: 'var(--wb-text-contrast)' }}>Dispatch target</span>
              <span style={{ color: 'var(--wb-text-contrast)', opacity: 0.6, fontSize: 9 }}>explicit user choice, not guessed</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {availableHarnesses.map((h) => {
                const c = allCapabilities[h];
                if (!c) return null;
                const label = h === 'codex' ? 'Codex' : h === 'claude' ? 'Claude' : 'DeepSeek';
                const detail = `${c.canDispatch ? 'Dispatch' : 'No Dispatch'} · ${c.canObserveRuntime ? 'Observe' : 'No Observe'} · ${c.canReceiveReceipt ? 'Receipt' : 'No Receipt'}`;
                const disabled = !c.canDispatch;
                return (
                  <button
                    key={h}
                    disabled={disabled}
                    onClick={() => setSelectedHarness(h)}
                    title={`${label}: ${detail} — ${c.evidence}`}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: `1px solid ${selectedHarness === h ? 'var(--wb-border-color)' : 'transparent'}`,
                      background: selectedHarness === h ? 'var(--wb-surface-overlay)' : 'transparent',
                      color: disabled ? 'var(--wb-text-contrast)' : 'var(--wb-text-contrast)',
                      opacity: disabled ? 0.45 : 1,
                      fontSize: 11,
                    }}
                    aria-pressed={selectedHarness === h}
                  >
                    <strong>{label}</strong> <span style={{ fontSize: 9, opacity: 0.7 }}>{detail}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 9, color: 'var(--wb-text-contrast)', opacity: 0.6 }}>
              Selected: <strong>{targetHarness ?? 'none'}</strong>
              {targetHarness && <> · {allCapabilities[targetHarness].evidence}</>}
              {targetHarness && allCapabilities[targetHarness].support.resume === 'NO' && <span> · Resume NO</span>}
            </div>
          </div>
        )}
        <div className="packet-copy-row">
          <button onClick={() => void copy()}>Copy Agent Input</button>
          <button
            className="primary"
            disabled={handoffPending || previewValidity !== 'CURRENT' || !targetHarness || !(allCapabilities?.[targetHarness] ?? capabilities)?.canDispatch}
            onClick={() => void handoff()}
          >
            {handoffPending
              ? 'Sending…'
              : targetHarness
                ? `Send to ${targetHarness === 'codex' ? 'Codex' : targetHarness === 'claude' ? 'Claude' : 'DeepSeek'}`
                : capabilities?.harness === 'codex' ? 'Send to Codex' : 'Choose Harness'}
          </button>
          {copyMessage && <span className={copyMessage.startsWith('Copied') ? 'ok' : 'packet-alert'}>{copyMessage}</span>}
        </div>
        {handoffError && <p className="packet-alert">{handoffError}</p>}
        {receipt && (
          <p className="hint handoff-status">
            Dispatch: {receipt.status}
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
      <button className="primary" disabled={freezePending} onClick={() => void freeze()}>
        {freezePending ? 'Freezing…' : 'Freeze Current Task Packet'}
      </button>
      {freezeError && <p className="packet-alert">{freezeError}</p>}
      {lastFrozen && !freezeError && <p className="ok">frozen: {lastFrozen}</p>}
      {frozenProblems.length > 0 && (
        <div className="problems">
          {frozenProblems.map((p) => (
            <span key={p.file}>[frozen-store] {p.file}: {p.message}</span>
          ))}
        </div>
      )}
      {frozen.length > 0 && (
        <div>
          <h4>Frozen versions（不可变快照；变化只能产生新版本）</h4>
          <ul>
            {frozen.map((f) => (
              <FrozenRow key={f.hash} summary={f} currentFingerprints={currentFingerprints} />
            ))}
          </ul>
          <p className="hint">CURRENT=依赖未变 · STALE=依赖文件已改 · INVALID=依赖已不存在（本地确定性比较，不重建 Packet）</p>
        </div>
      )}
    </div>
  );
}
