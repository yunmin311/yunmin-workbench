import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createDispatchDraft,
  isCanonicalTaskDispatch,
  preflightDispatch,
  setDispatchConversation,
  setDispatchExecutor,
  setDispatchInstruction,
  setDispatchPacket,
  type DispatchDraftV1,
} from '../../../../core/project/dispatchDraft';
import { checkPacketValidity, renderAgentInput } from '../../../../core/project/packet';
import type { FrozenPacket, FrozenPacketSummary, HarnessCapabilities, OverlaySnapshot, PacketValidity } from '../../../../core/types';
import { composeDispatchInput } from '../../dispatchInput';

/**
 * Explicit Dispatch Surface (PHASE 3D.1) —
 * "which Task, with which snapshot, to which chat / runner".
 *
 * A temporary preparation surface, not a chat composer, scheduler, or
 * router. It only assembles an explicit dispatch; the Execution /
 * uses-context / produces graph facts are produced by the runtime adapters
 * after a real dispatch, never by this component.
 */

export interface DispatchSelection {
  kind: string;
  label: string;
  workId?: string;
  taskId?: string;
  taskState?: string;
  sourceRef?: string;
  conversationKey?: string;
}

export interface PreflightView {
  id: string;
  label: string;
  status: 'PASS' | 'BLOCK';
  detail: string;
}

export interface DispatchPreflightState {
  ready: boolean;
  checking: boolean;
  checks: PreflightView[];
}

function mergeFingerprints(groups: { sourceRef: string; sha256: string }[][]): { sourceRef: string; sha256: string }[] {
  const merged = new Map<string, string>();
  for (const group of groups) {
    for (const fingerprint of group) merged.set(fingerprint.sourceRef, fingerprint.sha256);
  }
  return [...merged].map(([sourceRef, sha256]) => ({ sourceRef, sha256 }));
}

export function DispatchSurface({ projectId, selection, initialConversationKey, initialPacketId, onEditContext, onClose, onReadinessChange, onPreflightChange }: {
  projectId: string;
  selection: DispatchSelection | null;
  initialConversationKey?: string;
  initialPacketId?: string;
  onEditContext?: () => void;
  onClose: () => void;
  onReadinessChange?: (ready: boolean) => void;
  onPreflightChange?: (state: DispatchPreflightState) => void;
}) {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [draft, setDraft] = useState<DispatchDraftV1>(() => {
    const base = createDispatchDraft(projectId, {
      ...(selection?.workId !== undefined ? { workId: selection.workId } : {}),
      ...(selection?.taskId !== undefined ? { taskId: selection.taskId } : {}),
    });
    const withConversation = initialConversationKey ? setDispatchConversation(base, initialConversationKey) : base;
    return initialPacketId ? setDispatchPacket(withConversation, initialPacketId) : withConversation;
  });
  const [capabilities, setCapabilities] = useState<Partial<Record<HarnessCapabilities['harness'], HarnessCapabilities>>>({});
  const [frozenList, setFrozenList] = useState<FrozenPacketSummary[]>([]);
  const [packetDetail, setPacketDetail] = useState<FrozenPacket | null>(null);
  const [packetValidity, setPacketValidity] = useState<PacketValidity | null>(null);
  const [packetNote, setPacketNote] = useState('');
  const [error, setError] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [receipt, setReceipt] = useState<{ status: string; detail: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const overlay = await window.wb.loadOverlay();
        const caps = await window.wb.loadAllHarnessCapabilities();
        if (!alive) return;
        setSnapshot(overlay);
        setCapabilities(caps);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  // A conversation selection loads ITS frozen packets; nothing else.
  useEffect(() => {
    let alive = true;
    setFrozenList([]);
    setPacketDetail(null);
    setPacketValidity(null);
    setPacketNote('');
    if (draft.conversationKey === undefined) return;
    void (async () => {
      try {
        const listed = await window.wb.listFrozen(projectId, draft.conversationKey!);
        if (!alive) return;
        setFrozenList(listed.packets);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [draft.conversationKey, projectId]);

  // Selected packet: read the immutable frozen detail and re-check validity
  // against fresh fingerprints via the existing recheck path.
  useEffect(() => {
    let alive = true;
    setPacketDetail(null);
    setPacketValidity(null);
    setPacketNote('');
    if (!snapshot || draft.conversationKey === undefined || draft.packetId === undefined) return;
    void (async () => {
      try {
        const summary = frozenList.find((item) => item.packetId === draft.packetId);
        if (!summary) return;
        const detail = await window.wb.readFrozenDetail(projectId, draft.conversationKey!, { version: summary.version });
        if (!detail) {
          if (alive) { setPacketValidity('INVALID'); setPacketNote('frozen detail unreadable'); }
          return;
        }
        if (!alive) return;
        setPacketDetail(detail);
        const recheck = await window.wb.recheckSources(
          projectId,
          detail.sourceFingerprints.map((fingerprint) => fingerprint.sourceRef),
        );
        if (!alive) return;
        if (recheck.errors.length > 0) {
          setPacketValidity('INVALID');
          setPacketNote(`unverifiable source: ${recheck.errors[0].sourceRef}`);
          return;
        }
        const merged = mergeFingerprints([snapshot.sourceFingerprints, recheck.fingerprints]);
        setPacketValidity(checkPacketValidity(detail, merged));
      } catch (e) {
        if (alive) { setPacketValidity('INVALID'); setPacketNote(String(e)); }
      }
    })();
    return () => { alive = false; };
  }, [draft.conversationKey, draft.packetId, frozenList, projectId, snapshot]);

  // A root binding counts from either source: the machine profile's declared
  // projectRoots or an explicit Workbench-local rebind.
  const projectRootBound = Boolean(
    snapshot?.machine?.projectRoots[projectId] ?? snapshot?.workbenchProjectRoots?.[projectId],
  );
  const preflight = useMemo(() => preflightDispatch(draft, {
    capabilities,
    packetValidity: draft.packetId !== undefined ? packetValidity ?? undefined : undefined,
    packetId: packetDetail?.packetId,
    projectRootBound,
  }), [capabilities, draft, packetDetail, packetValidity, projectRootBound]);

  const conversations = (snapshot?.conversations ?? []).filter((conversation) => conversation.project === projectId);

  const pickConversation = useCallback((conversationKey: string | null) => {
    setDraft((current) => setDispatchPacket(setDispatchConversation(current, conversationKey), null));
    setReceipt(null);
  }, []);

  const pickExecutor = useCallback((harness: HarnessCapabilities['harness']) => {
    setDraft((current) => setDispatchExecutor(current, 'native', harness));
    setReceipt(null);
  }, []);

  const canDispatch = preflight.ok && packetDetail !== null && !dispatching;
  const runChatShort = draft.conversationKey?.includes('::')
    ? draft.conversationKey.split('::').pop()!
    : (draft.conversationKey ?? '…');
  const setupReady = snapshot !== null
    && packetDetail !== null
    && packetValidity !== null
    && Object.keys(capabilities).length > 0;

  useEffect(() => {
    onReadinessChange?.(preflight.ok && packetDetail !== null);
  }, [onReadinessChange, packetDetail, preflight.ok]);

  useEffect(() => {
    onPreflightChange?.({
      ready: preflight.ok && packetDetail !== null,
      checking: !setupReady,
      checks: preflight.checks,
    });
  }, [onPreflightChange, packetDetail, preflight.checks, preflight.ok, setupReady]);

  const dispatch = useCallback(() => {
    if (!canDispatch || !packetDetail) return;
    setDispatching(true);
    setError('');
    setReceipt(null);
    // One click = one intent = one dispatch request. The intent is
    // deduplicated upstream by the HandoffDispatchRegistry.
    const intentId = globalThis.crypto.randomUUID();
    void (async () => {
      try {
        const result = await window.wb.dispatchToHarness({
          intentId,
          projectId,
          conversationKey: draft.conversationKey!,
          packetText: composeDispatchInput(draft.instruction, renderAgentInput(packetDetail)),
          harness: draft.provider!,
          environment: { kind: 'real' },
          groupId: globalThis.crypto.randomUUID(),
          workId: draft.workId,
          taskId: draft.taskId,
          packetId: draft.packetId,
        });
        setReceipt({
          status: result.status,
          detail: `${result.status === 'ACCEPTED' ? `runtimeRef ${result.runtimeRef ?? '—'}` : result.message ?? result.protocolEvidence} · intent ${intentId.slice(0, 8)}…`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDispatching(false);
      }
    })();
  }, [canDispatch, draft, packetDetail, projectId]);

  const canonical = isCanonicalTaskDispatch(draft);
  const passedChecks = preflight.checks.filter((check) => check.status === 'PASS').length;

  return (
    <section className="dispatch-surface approved-dispatch-composer" role="region" aria-label="Dispatch">
      <button type="button" className="cabinet-close approved-dispatch-close" aria-label="Close Dispatch" onClick={onClose}>×</button>
      <div className="approved-dispatch-review">
        <span className="dispatch-label">SEND-READY · {draft.provider ?? 'CHOOSE RUNNER'}</span>
        <p>{selection?.label ?? 'Context-only dispatch'} · immutable snapshot review</p>
        <span className="cabinet-scope">{projectId}</span>
        {canonical
          ? <span className="dispatch-lineage is-canonical">Task {draft.taskId} · Work {draft.workId}</span>
          : (draft.workId !== undefined || draft.taskId !== undefined)
            ? <span className="dispatch-lineage is-partial">Needs a task</span>
            : <span className="dispatch-lineage is-quick">No task attached</span>}
      </div>
      {error && <p className="cabinet-error">{error}</p>}
      {packetDetail && (
        <div className="approved-dispatch-shelf" aria-label="Snapshot context">
          {[...packetDetail.included, ...packetDetail.references].slice(0, 3).map((item) => (
            <span key={item.id}><i>{item.isReference ? 'REF' : 'CTX'}</i>{item.title}</span>
          ))}
          <em>{packetDetail.included.length + packetDetail.references.length} sources · ~{packetDetail.roughTokens} tok</em>
        </div>
      )}
      <div className="approved-target-meta-strip" aria-label="Dispatch target and metadata">
        <label htmlFor="dispatch-conversation"><span>Chat</span><select id="dispatch-conversation" className="dispatch-select" value={draft.conversationKey ?? ''} onChange={(event) => pickConversation(event.target.value || null)}><option value="">Choose chat…</option>{draft.conversationKey && !conversations.some((conversation) => conversation.key === draft.conversationKey) && <option value={draft.conversationKey}>Checking conversation…</option>}{conversations.map((conversation) => <option key={conversation.key} value={conversation.key}>{conversation.role} · {conversation.platform}</option>)}</select></label>
        <label htmlFor="dispatch-packet"><span>Snapshot</span><select id="dispatch-packet" className="dispatch-select" value={draft.packetId ?? ''} disabled={draft.conversationKey === undefined} onChange={(event) => { setDraft((current) => setDispatchPacket(current, event.target.value || null)); setReceipt(null); }}><option value="">Choose snapshot…</option>{frozenList.map((item) => <option key={item.packetId} value={item.packetId}>v{item.version} · {item.packetId.slice(0, 8)}… · ~{item.roughTokens} tok</option>)}</select></label>
        <div className="dispatch-executors" role="group" aria-label="Executor selection">
          {(Object.entries(capabilities) as [HarnessCapabilities['harness'], HarnessCapabilities][]).map(([harness, caps]) => <button key={harness} type="button" className={`dispatch-executor${draft.provider === harness ? ' is-active' : ''}`} disabled={!caps.canDispatch} aria-pressed={draft.provider === harness} onClick={() => pickExecutor(harness)} title={caps.canDispatch ? `Send this run to ${harness}` : `Unavailable: ${caps.evidence}`}><span className="executor-provider">{harness}</span><span className="executor-backend">{caps.canDispatch ? 'Ready' : 'Unavailable'}</span></button>)}
        </div>
        <span className={`approved-preflight-summary ${setupReady ? 'dispatch-ready' : 'dispatch-checking'}${canDispatch ? ' is-ready' : ''}`} role="status">
          <b>{setupReady ? `${passedChecks}/${preflight.checks.length}` : '…'}</b>
          <span>{setupReady ? (preflight.ok ? 'Preflight ready' : 'Needs review') : 'Checking'}</span>
        </span>
        <ul className="dispatch-preflight approved-dispatch-preflight" aria-label="Dispatch preflight evidence">
          {preflight.checks.map((check) => <li key={check.id} className={`preflight-check is-${check.status.toLowerCase()}`}><span className="preflight-status">{check.status}</span><span className="preflight-label">{check.label}</span><span className="preflight-detail">{check.detail}</span></li>)}
        </ul>
      </div>
      <label className="approved-instruction-surface approved-dispatch-instruction" htmlFor="dispatch-instruction"><span>Instruction</span><textarea id="dispatch-instruction" className="dispatch-instruction" rows={1} value={draft.instruction} onChange={(event) => setDraft((current) => setDispatchInstruction(current, event.target.value))} placeholder="What should this run do?" /></label>
      <footer className="approved-dispatch-actions">
        <span>{packetDetail ? <><b>{packetDetail.included.length + packetDetail.references.length}</b> sources · <b>1</b> target</> : 'Checking snapshot…'}</span>
        <button type="button" className="secondary-button" onClick={onEditContext} aria-label="Back to Context">Back to edit</button>
        <button type="button" className="dispatch-button" disabled={!canDispatch} onClick={dispatch} title={canDispatch ? 'Send the snapshot and instruction now' : 'Finish the checklist above first'}>{dispatching ? 'Sending…' : 'Send packet'}</button>
      </footer>
      <p className="dispatch-consequence" role="status">{canDispatch && packetDetail ? `Sends ${packetDetail.included.length + packetDetail.references.length} items to ${draft.provider} in ${runChatShort}.` : 'Pick an available runner to finish preflight.'}</p>
      {receipt && <p className={`dispatch-receipt is-${receipt.status.toLowerCase()}`} role="status" aria-label="Dispatch receipt">{receipt.status} · {receipt.detail}</p>}
    </section>
  );
}
