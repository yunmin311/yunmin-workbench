import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyCabinetPin,
  applyCabinetState,
  buildCabinetItems,
  cabinetItemCurrentness,
  cabinetScopeKey,
  cabinetStaging,
  cabinetSummary,
  type CabinetItem,
  type CabinetItemCurrentness,
  type CabinetSourceGroup,
} from '../../../../core/project/cabinet';
import { buildWorkbenchDraft, restoreWorkbenchDraft } from '../../../../core/project/draft';
import { checkPacketValidity, compilePacket } from '../../../../core/project/packet';
import { governanceRefsForPacket } from '../../../../core/project/governanceBinding';
import type { OverlaySnapshot, PacketValidity } from '../../../../core/types';

/**
 * Context Cabinet (vNext) — "what knowledge does this work carry".
 *
 * Source-first staging surface over the real Overlay. The Canvas stays the
 * main view: the Cabinet is a closable bottom sheet that opens from a
 * Work/Task selection and never replaces the graph.
 */

const GROUP_LABELS: Record<CabinetSourceGroup, string> = {
  governance: 'Governance',
  inbox: 'Inbox · project-bound',
  memory: 'Memory · unbound',
  other: 'Other',
};

const GROUP_ORDER: CabinetSourceGroup[] = ['governance', 'inbox', 'memory', 'other'];

export interface CabinetSelection {
  kind: string;
  label: string;
  conversationKey?: string;
  canonicalConversationId?: string;
}

interface PacketResult {
  packetId: string;
  version: number;
  hash: string;
  validity: PacketValidity;
  included: number;
  references: number;
  fingerprints: number;
  unresolved: string[];
  roughTokens: number;
}

interface RecheckOutcome {
  currentness: CabinetItemCurrentness;
  detail?: string;
}

function deterministicReason(item: CabinetItem, userDecided: boolean): string {
  if (userDecided) {
    const pin = item.pinned ? ', pinned' : '';
    return `User staging decision: ${item.state}${pin}.`;
  }
  switch (item.group) {
    case 'governance':
      return 'Source default: the project adapter declares this governance context; it enters staging included.';
    case 'inbox':
      return 'Source default: a project-scoped INBOX line the source flags for attention; available until included.';
    case 'memory':
      return 'Source default: global Memory with no declared project binding; available until included. It is never auto-attached.';
    default:
      return 'Available until included; no staging decision recorded.';
  }
}

const BODY_PREVIEW_CHARS = 400;

export function ContextCabinet({ projectId, selection, onClose }: {
  projectId: string;
  selection: CabinetSelection | null;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [userDecidedIds, setUserDecidedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memoryBodies, setMemoryBodies] = useState<Record<string, string>>({});
  const [rechecks, setRechecks] = useState<Record<string, RecheckOutcome>>({});
  const [error, setError] = useState('');
  const [packet, setPacket] = useState<PacketResult | null>(null);
  const [packetError, setPacketError] = useState('');
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    let alive = true;
    setError('');
    setPacket(null);
    setPacketError('');
    setSelectedId(null);
    setRechecks({});
    void (async () => {
      try {
        const loaded = await window.wb.loadOverlay();
        const fresh = buildCabinetItems(loaded, projectId);
        const stored = await window.wb.loadDraft(projectId, cabinetScopeKey(projectId));
        if (!alive) return;
        setSnapshot(loaded);
        setItems(fresh);
        if (stored.draft) {
          const restored = restoreWorkbenchDraft(cabinetStaging(fresh), stored.draft, []);
          const decisions = new Map(restored.staging.map((item) => [item.id, item]));
          setUserDecidedIds(new Set(stored.draft.projectedDecisions.map((decision) => decision.itemId)));
          setItems(fresh.map((item) => {
            const decision = decisions.get(item.id);
            return decision ? { ...item, state: decision.state, pinned: decision.pinned } : item;
          }));
        } else {
          setUserDecidedIds(new Set());
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // Persist through the existing Workbench draft seam; never a new SOT.
  const persist = useCallback((next: CabinetItem[], source: OverlaySnapshot) => {
    void (async () => {
      try {
        await window.wb.saveDraft(buildWorkbenchDraft(
          projectId,
          cabinetScopeKey(projectId),
          undefined,
          '',
          cabinetStaging(next),
          source.sourceFingerprints,
        ));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [projectId]);

  const decideState = useCallback((id: string, state: CabinetItem['state']) => {
    if (!snapshot) return;
    setItems((current) => {
      const next = applyCabinetState(current, id, state);
      persist(next, snapshot);
      return next;
    });
    setUserDecidedIds((current) => new Set(current).add(id));
  }, [persist, snapshot]);

  const togglePin = useCallback((id: string) => {
    if (!snapshot) return;
    setItems((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (!item) return current;
      const next = applyCabinetPin(current, id, !item.pinned);
      persist(next, snapshot);
      return next;
    });
    setUserDecidedIds((current) => new Set(current).add(id));
  }, [persist, snapshot]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const summary = useMemo(() => cabinetSummary(items), [items]);

  const openDetail = useCallback((item: CabinetItem) => {
    setSelectedId(item.id);
    setRechecks((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    if (item.id.startsWith('memory:') && memoryBodies[item.id] === undefined) {
      const memoryId = item.id.slice('memory:'.length);
      void window.wb.readMemory(memoryId).then((body) => {
        setMemoryBodies((current) => ({ ...current, [item.id]: body ?? '(body unavailable)' }));
      });
    }
  }, [memoryBodies]);

  const recheckSelected = useCallback(() => {
    if (!selected || !snapshot) return;
    if (!selected.sourceRef) {
      setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'UNVERIFIED', detail: 'no source locator to recheck' } }));
      return;
    }
    void (async () => {
      try {
        const result = await window.wb.recheckSources(projectId, [selected.sourceRef!]);
        if (result.errors.length > 0) {
          setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'INVALID', detail: result.errors[0].message } }));
          return;
        }
        setRechecks((current) => ({
          ...current,
          [selected.id]: { currentness: cabinetItemCurrentness(selected, snapshot.sourceFingerprints, result.fingerprints) },
        }));
      } catch (e) {
        setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'INVALID', detail: String(e) } }));
      }
    })();
  }, [projectId, selected, snapshot]);

  const compileTarget = selection?.conversationKey
    ? snapshot?.conversations.find((conversation) => conversation.key === selection.conversationKey)
    : undefined;

  const compilePacketAction = useCallback(() => {
    if (!snapshot || compiling) return;
    if (!compileTarget) {
      setPacketError('Packet needs an explicit conversation target — select one on the Canvas.');
      return;
    }
    setCompiling(true);
    setPacketError('');
    try {
      const compiled = compilePacket({
        projectId,
        conversationKey: compileTarget.key,
        conversationId: compileTarget.conversationId,
        taskSummary: selection?.kind === 'task' ? selection.label : '',
        governanceRefs: governanceRefsForPacket(snapshot, projectId, compileTarget.key, false),
        staging: cabinetStaging(items),
        fingerprints: snapshot.sourceFingerprints,
      });
      const validity = checkPacketValidity(compiled, snapshot.sourceFingerprints);
      void (async () => {
        try {
          const { frozen } = await window.wb.freezePacket(compiled);
          setPacket({
            packetId: frozen.packetId,
            version: frozen.version,
            hash: frozen.hash,
            validity,
            included: compiled.included.length,
            references: compiled.references.length,
            fingerprints: compiled.sourceFingerprints.length,
            unresolved: compiled.unresolvedDependencies,
            roughTokens: compiled.roughTokens,
          });
        } catch (e) {
          setPacketError(e instanceof Error ? e.message : String(e));
        } finally {
          setCompiling(false);
        }
      })();
    } catch (e) {
      setPacketError(e instanceof Error ? e.message : String(e));
      setCompiling(false);
    }
  }, [compileTarget, compiling, items, projectId, selection, snapshot]);

  const stateButton = (item: CabinetItem, value: CabinetItem['state'], label: string) => (
    <button
      type="button"
      className={`cabinet-state${item.state === value ? ' is-active' : ` is-${value}`}`}
      aria-pressed={item.state === value}
      aria-label={`${label}: ${item.title}`}
      onClick={() => decideState(item.id, value)}
    >
      {label}
    </button>
  );

  return (
    <section className="context-cabinet" role="region" aria-label="Context Cabinet">
      <header className="cabinet-header">
        <div className="cabinet-title">
          <h2>Context Cabinet</h2>
          <span className="cabinet-scope">{projectId}</span>
          {selection && (selection.kind === 'work' || selection.kind === 'task') && (
            <span className="cabinet-for">staging for · {selection.label}</span>
          )}
        </div>
        <div className="cabinet-summary" aria-label="Staging summary">
          <span className="sum-included">Included {summary.included}</span>
          <span className="sum-size">~{summary.roughTokens} tok</span>
          <span className="sum-pinned">Pinned {summary.pinned}</span>
          <span className="sum-available">Available {summary.available}</span>
        </div>
        <div className="cabinet-actions">
          <button
            type="button"
            className="cabinet-compile"
            disabled={!snapshot || compiling}
            onClick={compilePacketAction}
            title={compileTarget ? 'Compile and freeze via the deterministic packet compiler' : 'Select a conversation node on the Canvas first'}
          >
            Compile Packet
          </button>
          <button type="button" className="cabinet-close" aria-label="Close Context Cabinet" onClick={onClose}>×</button>
        </div>
      </header>
      {error && <p className="cabinet-error">{error}</p>}
      <div className="cabinet-body">
        <div className="cabinet-groups">
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <section className="cabinet-group" key={group}>
                <h3>{GROUP_LABELS[group]} <span className="group-count">{groupItems.length}</span></h3>
                <ul>
                  {groupItems.map((item) => (
                    <li key={item.id} className={`cabinet-row is-${item.state}${item.pinned ? ' is-pinned' : ''}`}>
                      <div className="cabinet-states" role="group" aria-label={`Staging state for ${item.title}`}>
                        {stateButton(item, 'available', 'Available')}
                        {stateButton(item, 'included', 'Included')}
                        {stateButton(item, 'excluded', 'Excluded')}
                      </div>
                      <button type="button" className="cabinet-item-title" onClick={() => openDetail(item)} title={item.title}>
                        {item.title}
                      </button>
                      {item.binding === 'unbound' && <span className="cabinet-unbound">unbound</span>}
                      <button
                        type="button"
                        className={`cabinet-pin${item.pinned ? ' is-on' : ''}`}
                        disabled={item.state !== 'included'}
                        aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                        title={item.state === 'included' ? 'Pin into packet head' : 'Pinning requires included'}
                        onClick={() => togglePin(item.id)}
                      >
                        {item.pinned ? '★' : '☆'}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {items.length === 0 && !error && <p className="cabinet-empty">No context candidates from the bound sources.</p>}
        </div>
        <aside className="cabinet-detail" aria-label="Context detail">
          {!selected && <p className="cabinet-empty">Select a context to inspect its identity and source.</p>}
          {selected && (
            <>
              <h3>{selected.title}</h3>
              <dl>
                <dt>Identity</dt><dd>{selected.id}</dd>
                <dt>Source</dt><dd>{selected.source}</dd>
                <dt>Source ref</dt><dd>{selected.sourceRef ?? '—'}</dd>
                <dt>Kind</dt><dd>{selected.isReference ? 'Reference' : 'Context'}</dd>
                <dt>Provenance</dt><dd>{selected.provenance ?? 'EXTERNAL'}</dd>
                <dt>Binding</dt><dd>{selected.binding}</dd>
                <dt>State</dt><dd>{selected.state}{selected.pinned ? ' · pinned' : ''}</dd>
                <dt>Fingerprint</dt><dd>{selected.fingerprintAvailable ? 'in current snapshot' : 'not in snapshot'}</dd>
                <dt>Currentness</dt>
                <dd>
                  {rechecks[selected.id]
                    ? <span className={`currentness is-${rechecks[selected.id].currentness.toLowerCase()}`}>{rechecks[selected.id].currentness}</span>
                    : <button type="button" className="cabinet-recheck" onClick={recheckSelected}>Recheck source</button>}
                  {rechecks[selected.id]?.detail && <span className="recheck-detail"> {rechecks[selected.id].detail}</span>}
                </dd>
              </dl>
              <p className="cabinet-reason">{deterministicReason(selected, userDecidedIds.has(selected.id))}</p>
              {selected.id.startsWith('memory:') && (
                <pre className="cabinet-preview">
                  {(memoryBodies[selected.id] ?? 'loading…').slice(0, BODY_PREVIEW_CHARS)}
                </pre>
              )}
              {!selected.id.startsWith('memory:') && selected.body && (
                <pre className="cabinet-preview">{selected.body.slice(0, BODY_PREVIEW_CHARS)}</pre>
              )}
            </>
          )}
        </aside>
      </div>
      {(packet || packetError) && (
        <footer className="cabinet-packet" role="status" aria-label="Compiled packet">
          {packetError && <p className="cabinet-error">{packetError}</p>}
          {packet && (
            <dl>
              <dt>packetId</dt><dd>{packet.packetId}</dd>
              <dt>Validity</dt><dd className={`currentness is-${packet.validity.toLowerCase()}`}>{packet.validity}</dd>
              <dt>Included</dt><dd>{packet.included} context · {packet.references} references</dd>
              <dt>Fingerprints</dt><dd>{packet.fingerprints} resolved{packet.unresolved.length > 0 ? ` · ${packet.unresolved.length} unresolved` : ''}</dd>
              <dt>Size</dt><dd>~{packet.roughTokens} tokens (chars/4, deterministic)</dd>
              <dt>Version</dt><dd>v{packet.version} · {packet.hash.slice(0, 12)}…</dd>
            </dl>
          )}
          <p className="cabinet-hint">Frozen for the record — nothing is dispatched. uses-context only appears after a real dispatch consumes it.</p>
        </footer>
      )}
    </section>
  );
}
