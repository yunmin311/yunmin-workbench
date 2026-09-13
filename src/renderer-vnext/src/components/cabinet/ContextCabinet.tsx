import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyCabinetPin,
  applyCabinetState,
  asCabinetItem,
  buildCabinetItems,
  cabinetFileOrigin,
  cabinetItemCurrentness,
  cabinetStaging,
  cabinetSummary,
  type CabinetItem,
  type CabinetItemCurrentness,
  type CabinetSourceGroup,
} from '../../../../core/project/cabinet';
import {
  buildCabinetStaging,
  refreshExplicitDecision,
  type CabinetFileSelectionV1,
  type CabinetSourceDefault,
  type CabinetStagingV1,
} from '../../../../core/project/cabinetStaging';
import { checkPacketValidity, compilePacket } from '../../../../core/project/packet';
import { governanceRefsForPacket } from '../../../../core/project/governanceBinding';
import type { ContextItem, OverlaySnapshot, PacketValidity, SourceFingerprint } from '../../../../core/types';

/**
 * Context Cabinet (vNext) — "what knowledge does this work carry".
 *
 * Source-first staging surface over the real Overlay plus explicitly
 * user-added project files. The Canvas stays the main view: the Cabinet is
 * a closable bottom sheet that opens from a Work/Task selection and never
 * replaces the graph. Staging persists under the formal
 * `project-context-cabinet` scope via the dedicated cabinet-staging seam.
 */

const GROUP_LABELS: Record<CabinetSourceGroup, string> = {
  governance: 'Governance',
  inbox: 'Inbox · project-bound',
  file: 'Project Files',
  memory: 'Memory · unbound',
  other: 'Other',
};

const GROUP_ORDER: CabinetSourceGroup[] = ['governance', 'inbox', 'file', 'memory', 'other'];

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
  includedIds: string[];
}

interface RecheckOutcome {
  currentness: CabinetItemCurrentness;
  detail?: string;
}

interface AtomOutcome {
  resolved: boolean;
  sha256?: string;
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
    case 'file':
      return cabinetFileOrigin(item) === 'pinned'
        ? 'User added: the pinned canonical source, read at its verified commit; available until included.'
        : 'User added: an explicitly picked working-tree file; available until included.';
    case 'memory':
      return 'Source default: global Memory with no declared project binding; available until included. It is never auto-attached.';
    default:
      return 'Available until included; no staging decision recorded.';
  }
}

const BODY_PREVIEW_CHARS = 400;

function mergeFingerprints(groups: SourceFingerprint[][]): SourceFingerprint[] {
  const merged = new Map<string, string>();
  for (const group of groups) {
    for (const fingerprint of group) merged.set(fingerprint.sourceRef, fingerprint.sha256);
  }
  return [...merged].map(([sourceRef, sha256]) => ({ sourceRef, sha256 }));
}

export function ContextCabinet({ projectId, selection, onPrepared, onClose }: {
  projectId: string;
  selection: CabinetSelection | null;
  onPrepared: (packet: { conversationKey: string; packetId: string }) => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [items, setItems] = useState<CabinetItem[]>([]);
  const [userDecidedIds, setUserDecidedIds] = useState<Set<string>>(new Set());
  const [fileSelections, setFileSelections] = useState<CabinetFileSelectionV1[]>([]);
  const [pinnedSelected, setPinnedSelected] = useState(false);
  const [fileFingerprints, setFileFingerprints] = useState<SourceFingerprint[]>([]);
  const [stagingProblem, setStagingProblem] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memoryBodies, setMemoryBodies] = useState<Record<string, string>>({});
  const [memoryAtoms, setMemoryAtoms] = useState<Record<string, AtomOutcome>>({});
  const [rechecks, setRechecks] = useState<Record<string, RecheckOutcome>>({});
  const [error, setError] = useState('');
  const [packet, setPacket] = useState<PacketResult | null>(null);
  const [packetError, setPacketError] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerMatches, setPickerMatches] = useState<string[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [conversationKey, setConversationKey] = useState(selection?.conversationKey ?? '');
  const [expandedGroups, setExpandedGroups] = useState<Set<CabinetSourceGroup>>(new Set());
  // Sparse-override bookkeeping. baseDefaultsRef captures the inherited/source
  // defaults the Cabinet resolved at open (before stored overrides apply);
  // decidedRef mirrors userDecidedIds for synchronous persist calls. Only ids
  // in this set may enter persisted decisions — untouched contexts stay out.
  const baseDefaultsRef = useRef(new Map<string, CabinetSourceDefault>());
  const decidedRef = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    setError('');
    setPacket(null);
    setPacketError('');
    setSelectedId(null);
    setRechecks({});
    setMemoryAtoms({});
    setPickerOpen(false);
    setPickerQuery('');
    setPickerMatches([]);
    setExpandedGroups(new Set());
    void (async () => {
      try {
        const loaded = await window.wb.loadOverlay();
        if (!alive) return;
        setSnapshot(loaded);
        const base = buildCabinetItems(loaded, projectId);
        const stored = await window.wb.loadCabinetStaging(projectId);
        if (!alive) return;
        setStagingProblem(stored.problem ?? '');
        const staging = stored.staging;
        setFileSelections(staging?.projectFiles ?? []);
        setPinnedSelected(staging?.pinnedCanonicalFile ?? false);
        // Stored decisions ARE the explicit overrides under sparse persistence:
        // untouched contexts leave no record, so this set is exact for new
        // writes. Bloated stores from the pre-sparse era keep their records
        // untouched here — they are reported, never silently rewritten.
        decidedRef.current = new Set(staging?.decisions.map((decision) => decision.contextId) ?? []);
        setUserDecidedIds(new Set(decidedRef.current));

        // Explicit file selections resolve fresh from disk every open.
        const freshFiles: ContextItem[] = [];
        const freshFingerprints: SourceFingerprint[] = [];
        if (staging && staging.projectFiles.length > 0) {
          const resolved = await window.wb.refreshProjectFiles(
            projectId,
            staging.projectFiles.map((file) => ({ relativePath: file.relativePath, asReference: file.asReference })),
          );
          for (const entry of resolved.entries) {
            freshFiles.push(entry.item);
            freshFingerprints.push(entry.fingerprint);
          }
        }
        let pinnedItem: ContextItem | null = null;
        if (staging?.pinnedCanonicalFile) {
          const pinned = await window.wb.readPinnedProjectFile(projectId);
          if (pinned.item && pinned.fingerprint) {
            pinnedItem = pinned.item;
            freshFingerprints.push(pinned.fingerprint);
          } else if (pinned.error) {
            setStagingProblem((current) => current || `pinned canonical source unavailable: ${pinned.error}`);
          }
        }
        if (!alive) return;
        setFileFingerprints(freshFingerprints);

        const withFiles = [
          ...base,
          ...freshFiles.map((file) => asCabinetItem(file, freshFingerprints)),
          ...(pinnedItem ? [asCabinetItem(pinnedItem, freshFingerprints)] : []),
        ];
        // Inherited defaults snapshot: pre-override states. Reverting an item
        // to these values deletes its override instead of persisting it.
        baseDefaultsRef.current = new Map(
          withFiles.map((item) => [item.id, { state: item.state, pinned: item.pinned }]),
        );
        const decisions = new Map((staging?.decisions ?? []).map((decision) => [decision.contextId, decision]));
        const hydratedItems = withFiles.map((item) => {
          const decision = decisions.get(item.id);
          return decision
            ? { ...item, state: decision.state, pinned: decision.state === 'included' ? decision.pinned : false }
            : item;
        });
        setItems(hydratedItems);
        setExpandedGroups(new Set(GROUP_ORDER.filter((group) =>
          hydratedItems.some((item) => item.group === group && item.state !== 'available'))));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const currentFingerprints = useMemo(
    () => (snapshot ? mergeFingerprints([snapshot.sourceFingerprints, fileFingerprints]) : []),
    [snapshot, fileFingerprints],
  );

  // Persist through the dedicated cabinet-staging seam (formal scope kind).
  // Only the explicit-touch set enters decisions — the resolved collection
  // itself is never serialized, so one action can no longer materialize the
  // whole Cabinet as apparent "user decisions".
  const persist = useCallback((
    next: CabinetItem[],
    files: CabinetFileSelectionV1[],
    pinned: boolean,
    decided: ReadonlySet<string>,
  ) => {
    void (async () => {
      try {
        await window.wb.saveCabinetStaging(buildCabinetStaging(projectId, next, files, pinned, '', decided));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [projectId]);

  const trackDecision = useCallback((next: CabinetItem[], id: string): Set<string> => {
    const item = next.find((candidate) => candidate.id === id);
    if (!item) return new Set(decidedRef.current);
    const decided = refreshExplicitDecision({
      baseDefaults: baseDefaultsRef.current,
      decided: decidedRef.current,
      item: { id: item.id, state: item.state, pinned: item.pinned },
    });
    decidedRef.current = decided;
    setUserDecidedIds(decided);
    return decided;
  }, []);

  const decideState = useCallback((id: string, state: CabinetItem['state']) => {
    setItems((current) => {
      const next = applyCabinetState(current, id, state);
      persist(next, fileSelections, pinnedSelected, trackDecision(next, id));
      return next;
    });
  }, [fileSelections, persist, pinnedSelected, trackDecision]);

  const togglePin = useCallback((id: string) => {
    setItems((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (!item) return current;
      const next = applyCabinetPin(current, id, !item.pinned);
      persist(next, fileSelections, pinnedSelected, trackDecision(next, id));
      return next;
    });
  }, [fileSelections, persist, pinnedSelected, trackDecision]);

  const allFingerprinted = useMemo(
    () => new Set(currentFingerprints.map((fingerprint) => fingerprint.sourceRef)),
    [currentFingerprints],
  );

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
    if (!selected) return;
    if (!selected.sourceRef) {
      setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'UNVERIFIED', detail: 'no source locator to recheck' } }));
      return;
    }
    // Pinned sources bypass the working-tree recheck path: they are verified
    // against the pinned commit itself, never against the working tree.
    if (cabinetFileOrigin(selected) === 'pinned') {
      void (async () => {
        const pinned = await window.wb.readPinnedProjectFile(projectId);
        const baseline = currentFingerprints.find((fingerprint) => fingerprint.sourceRef === selected.sourceRef);
        if (!pinned.item || !pinned.fingerprint || !baseline) {
          setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'INVALID', detail: pinned.error ?? 'pinned source no longer resolvable' } }));
          return;
        }
        setRechecks((current) => ({
          ...current,
          [selected.id]: {
            currentness: pinned.fingerprint!.sha256 === baseline.sha256 ? 'CURRENT' : 'INVALID',
            detail: `pinned commit read · ${pinned.fingerprint!.sha256.slice(0, 12)}…`,
          },
        }));
      })();
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
          [selected.id]: { currentness: cabinetItemCurrentness(selected, currentFingerprints, result.fingerprints) },
        }));
      } catch (e) {
        setRechecks((current) => ({ ...current, [selected.id]: { currentness: 'INVALID', detail: String(e) } }));
      }
    })();
  }, [currentFingerprints, projectId, selected]);

  const checkMemoryAtom = useCallback(() => {
    if (!selected || !selected.id.startsWith('memory:')) return;
    const memoryId = selected.id.slice('memory:'.length);
    const atomRef = `overlay:memory/${memoryId}.md`;
    void (async () => {
      try {
        const result = await window.wb.recheckSources(projectId, [atomRef]);
        const fingerprint = result.fingerprints[0];
        setMemoryAtoms((current) => ({
          ...current,
          [selected.id]: fingerprint
            ? { resolved: true, sha256: fingerprint.sha256 }
            : { resolved: false },
        }));
      } catch {
        setMemoryAtoms((current) => ({ ...current, [selected.id]: { resolved: false } }));
      }
    })();
  }, [projectId, selected]);

  const runPickerSearch = useCallback(() => {
    if (!pickerQuery.trim()) return;
    setPickerBusy(true);
    setPickerError('');
    void (async () => {
      try {
        const result = await window.wb.searchProjectFiles(projectId, pickerQuery);
        setPickerMatches(result.matches);
        if (result.errors.length > 0) setPickerError(result.errors[0]);
      } catch (e) {
        setPickerError(e instanceof Error ? e.message : String(e));
      } finally {
        setPickerBusy(false);
      }
    })();
  }, [pickerQuery, projectId]);

  const addProjectFile = useCallback((relativePath: string, asReference: boolean) => {
    void (async () => {
      setPickerError('');
      try {
        const result = await window.wb.refreshProjectFiles(projectId, [{ relativePath, asReference }]);
        const entry = result.entries[0];
        if (!entry) {
          setPickerError(result.errors[0] ?? 'the file could not be added');
          return;
        }
        const nextFiles = fileSelections.some((file) => file.relativePath === relativePath && file.asReference === asReference)
          ? fileSelections
          : [...fileSelections, {
            projectId,
            relativePath,
            asReference,
            lastKnownSha256: entry.fingerprint.sha256,
          }];
        const mergedFingerprints = [...currentFingerprints, entry.fingerprint];
        // Newly added files start Available: never auto-included. Creation
        // state is their inherited default, so merely adding one mints no
        // decision — only a later explicit include/exclude does.
        const added = { ...asCabinetItem(entry.item, mergedFingerprints), state: 'available' as const, pinned: false };
        baseDefaultsRef.current.set(added.id, { state: added.state, pinned: added.pinned });
        const merged = [
          ...items.filter((item) => item.id !== entry.item.id),
          added,
        ];
        setFileFingerprints((current) => [...current, entry.fingerprint]);
        setFileSelections(nextFiles);
        setItems(merged);
        setExpandedGroups((current) => new Set(current).add('file'));
        persist(merged, nextFiles, pinnedSelected, decidedRef.current);
        setPickerOpen(false);
        setPickerQuery('');
        setPickerMatches([]);
      } catch (e) {
        setPickerError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [currentFingerprints, fileSelections, items, persist, pinnedSelected, projectId]);

  const addPinnedCanonical = useCallback(() => {
    void (async () => {
      setPickerError('');
      try {
        const pinned = await window.wb.readPinnedProjectFile(projectId);
        if (!pinned.item || !pinned.fingerprint) {
          setPickerError(pinned.error ?? 'no verified canonical source to pin');
          return;
        }
        const mergedFingerprints = [...currentFingerprints, pinned.fingerprint];
        const added = { ...asCabinetItem(pinned.item, mergedFingerprints), state: 'available' as const, pinned: false };
        baseDefaultsRef.current.set(added.id, { state: added.state, pinned: added.pinned });
        const merged = [
          ...items.filter((item) => item.id !== pinned.item!.id),
          added,
        ];
        setFileFingerprints((current) => [...current, pinned.fingerprint!]);
        setPinnedSelected(true);
        setItems(merged);
        setExpandedGroups((current) => new Set(current).add('file'));
        persist(merged, fileSelections, true, decidedRef.current);
        setPickerOpen(false);
      } catch (e) {
        setPickerError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [currentFingerprints, fileSelections, items, persist, projectId]);

  const pinnedAvailable = useMemo(() => {
    const adapter = snapshot?.projects.find((project) => project.projectId === projectId);
    return adapter?.canonicalSource?.verification === 'VERIFIED'
      && Boolean(adapter?.canonicalSource?.path)
      && Boolean(adapter?.canonicalSource?.commit)
      && !items.some((item) => item.source.startsWith('pinned-file:'));
  }, [items, projectId, snapshot]);

  const compileTarget = conversationKey
    ? snapshot?.conversations.find((conversation) => conversation.key === conversationKey)
    : undefined;

  const compilePacketAction = useCallback(() => {
    if (!snapshot || compiling) return;
    if (!compileTarget) {
      setPacketError('Pick which chat does this work first.');
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
        fingerprints: currentFingerprints,
      });
      const validity = checkPacketValidity(compiled, currentFingerprints);
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
            includedIds: compiled.included.map((item) => item.id),
          });
          onPrepared({ conversationKey: compileTarget.key, packetId: frozen.packetId });
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
  }, [compileTarget, compiling, currentFingerprints, items, onPrepared, projectId, selection, snapshot]);

  const stateButton = (item: CabinetItem, value: CabinetItem['state'], label: string, short: string) => (
    <button
      type="button"
      className={`cabinet-state${item.state === value ? ' is-active' : ` is-${value}`}`}
      aria-pressed={item.state === value}
      aria-label={`${label}: ${item.title}`}
      title={label}
      onClick={() => decideState(item.id, value)}
    >
      {short}
    </button>
  );

  const originBadge = (item: CabinetItem) => {
    const origin = cabinetFileOrigin(item);
    if (origin === 'working-tree') return <span className="cabinet-origin is-worktree">worktree</span>;
    if (origin === 'pinned') return <span className="cabinet-origin is-pinned">pinned</span>;
    return null;
  };

  return (
    <section className="context-cabinet" role="region" aria-label="Context Cabinet">
      <header className="cabinet-header">
        <div className="cabinet-title">
          <div className="preparation-steps" aria-label="Preparation progress">
            <span className="is-current"><b>1</b> Context</span>
            <span><b>2</b> Preflight</span>
            <span><b>3</b> Execute</span>
          </div>
          <h2>Choose what this work can use</h2>
          <span className="cabinet-scope">{projectId}</span>
          {selection && (selection.kind === 'work' || selection.kind === 'task') && (
            <span className="cabinet-for">staging for · {selection.label}</span>
          )}
        </div>
        <div className="cabinet-actions">
          <button
            type="button"
            className="cabinet-add"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            title="Explicitly add a project file as an Available staging candidate"
          >
            + Project File
          </button>
          <button type="button" className="cabinet-close" aria-label="Close Context Cabinet" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="cabinet-summary" aria-label="Staging summary">
        <span className="sum-included">Will use {summary.included}</span>
        <span className="sum-size">~{summary.roughTokens} tok</span>
        <span className="sum-pinned">Pinned {summary.pinned}</span>
        <span className="sum-available">Available {summary.available}</span>
      </div>
      {(error || stagingProblem) && <p className="cabinet-error">{error || stagingProblem}</p>}
      {pickerOpen && (
        <div className="cabinet-picker" role="search" aria-label="Add project file">
          <input
            value={pickerQuery}
            onChange={(event) => setPickerQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') runPickerSearch(); }}
            placeholder="repo-relative path or filename search…"
            aria-label="Project file path or search"
          />
          <button type="button" onClick={runPickerSearch} disabled={pickerBusy}>
            {pickerBusy ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="cabinet-add-pinned"
            disabled={!pinnedAvailable}
            onClick={addPinnedCanonical}
            title={pinnedAvailable ? 'Add the pinned canonical source at its verified commit' : 'No verified canonical source declared'}
          >
            Add pinned canonical
          </button>
          {pickerError && <p className="cabinet-error">{pickerError}</p>}
          {pickerMatches.length > 0 && (
            <ul className="cabinet-picker-list">
              {pickerMatches.map((match) => (
                <li key={match}>
                  <span className="picker-path">{match}</span>
                  <button type="button" onClick={() => addProjectFile(match, false)} aria-label={`Add ${match} as context`}>Add as Context</button>
                  <button type="button" onClick={() => addProjectFile(match, true)} aria-label={`Add ${match} as reference`}>Add as Reference</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className={`cabinet-body${selected ? ' has-detail' : ''}`}>
        <div className="cabinet-groups">
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            const expanded = expandedGroups.has(group);
            const included = groupItems.filter((item) => item.state === 'included').length;
            const available = groupItems.filter((item) => item.state === 'available').length;
            const excluded = groupItems.length - included - available;
            const listId = `cabinet-group-${group}`;
            return (
              <section className="cabinet-group" key={group}>
                <h3>
                  <button
                    type="button"
                    className="cabinet-group-toggle"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() => setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group)) next.delete(group); else next.add(group);
                      return next;
                    })}
                  >
                    <span className="cabinet-group-title">{GROUP_LABELS[group]} <span className="group-count">{groupItems.length}</span></span>
                    <span className="cabinet-group-summary">
                      <b>{included} will use</b>
                      <span>{available} available</span>
                      {excluded > 0 && <span>{excluded} excluded</span>}
                    </span>
                    <span className="cabinet-group-marker" aria-hidden="true">{expanded ? '−' : '+'}</span>
                  </button>
                </h3>
                <ul id={listId} hidden={!expanded}>
                  {groupItems.map((item) => (
                    <li key={item.id} className={`cabinet-row is-${item.state}${item.pinned ? ' is-pinned' : ''}`}>
                      <div className="cabinet-states" role="group" aria-label={`Staging state for ${item.title}`}>
                        {stateButton(item, 'available', 'Available', 'Avail')}
                        {stateButton(item, 'included', 'Included', 'Incl')}
                        {stateButton(item, 'excluded', 'Excluded', 'Excl')}
                      </div>
                      <button type="button" className="cabinet-item-title" onClick={() => openDetail(item)} title={item.title}>
                        {item.title}
                      </button>
                      {originBadge(item)}
                      {item.binding === 'unbound' && <span className="cabinet-unbound">unbound</span>}
                      <button
                        type="button"
                        className={`cabinet-pin${item.pinned ? ' is-on' : ''}`}
                        disabled={item.state !== 'included'}
                        aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                        title={item.state === 'included' ? 'Pin to the top of the snapshot' : 'Only selected items can be pinned'}
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
        {selected && (
        <aside className="cabinet-detail" aria-label="Context detail">
              <button type="button" className="cabinet-detail-close" aria-label="Close context detail" onClick={() => setSelectedId(null)}>×</button>
              <h3>{selected.title}</h3>
              <dl>
                <dt>Identity</dt><dd>{selected.id}</dd>
                <dt>Source</dt><dd>{selected.source}</dd>
                <dt>Source ref</dt><dd>{selected.sourceRef ?? '—'}</dd>
                <dt>Kind</dt><dd>{selected.isReference ? 'Reference' : 'Context'}</dd>
                <dt>Provenance</dt><dd>{selected.provenance ?? 'EXTERNAL'}</dd>
                <dt>Binding</dt><dd>{selected.binding}</dd>
                {cabinetFileOrigin(selected) !== 'none' && (
                  <><dt>File source</dt><dd>{cabinetFileOrigin(selected) === 'pinned' ? 'PINNED commit' : 'WORKING TREE'}</dd></>
                )}
                <dt>State</dt><dd>{selected.state}{selected.pinned ? ' · pinned' : ''}</dd>
                <dt>Fingerprint</dt><dd>{allFingerprinted.has(selected.sourceRef ?? '') ? 'in current baseline' : 'not in baseline'}</dd>
                <dt>Currentness</dt>
                <dd>
                  {rechecks[selected.id]
                    ? <span className={`currentness is-${rechecks[selected.id].currentness.toLowerCase()}`}>{rechecks[selected.id].currentness}</span>
                    : <button type="button" className="cabinet-recheck" onClick={recheckSelected}>Recheck source</button>}
                  {rechecks[selected.id]?.detail && <span className="recheck-detail"> {rechecks[selected.id].detail}</span>}
                </dd>
                {selected.group === 'memory' && (
                  <>
                    <dt>Atom</dt>
                    <dd>
                      overlay:memory/{selected.id.slice('memory:'.length)}.md
                      <button type="button" className="cabinet-recheck" onClick={checkMemoryAtom}>Check atom</button>
                      {memoryAtoms[selected.id] && (
                        <span className="recheck-detail">
                          {memoryAtoms[selected.id].resolved
                            ? ` resolved · ${memoryAtoms[selected.id].sha256?.slice(0, 12)}…`
                            : ' atom file missing'}
                        </span>
                      )}
                    </dd>
                  </>
                )}
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
        </aside>
        )}
      </div>
      <footer className="preparation-footer">
        <div className="preparation-meaning">
          <strong>{summary.included} will be used</strong>
          <span>Available is not used. Only “Will use” goes into the next snapshot.</span>
        </div>
        <label htmlFor="prepare-conversation">
          <span>Send to</span>
          <select
            id="prepare-conversation"
            className="dispatch-select"
            value={conversationKey}
            onChange={(event) => setConversationKey(event.target.value)}
          >
            <option value="">Choose a chat…</option>
            {(snapshot?.conversations ?? []).filter((conversation) => conversation.project === projectId).map((conversation) => (
              <option key={conversation.key} value={conversation.key}>{conversation.role} · {conversation.platform}</option>
            ))}
          </select>
          {snapshot !== null
            && (snapshot.conversations ?? []).filter((conversation) => conversation.project === projectId).length === 0 && (
            <span className="cabinet-hint">No conversations bound to {projectId} — staging is kept, but freezing needs a conversation target.</span>
          )}
        </label>
        <button
          type="button"
          className="cabinet-compile"
          disabled={!snapshot || compiling || !compileTarget}
          onClick={compilePacketAction}
          title={compileTarget ? 'Snapshot the selected Context, then review before sending' : 'Choose which chat does this work first'}
        >
          {compiling ? 'Snapshotting…' : 'Snapshot and continue'}
        </button>
      </footer>
      {(packet || packetError) && (
        <footer className="cabinet-packet" role="status" aria-label="Compiled snapshot">
          {packetError && <p className="cabinet-error">{packetError}</p>}
          {packet && (
            <dl>
              <dt>packetId</dt><dd>{packet.packetId}</dd>
              <dt>Validity</dt><dd className={`currentness is-${packet.validity.toLowerCase()}`}>{packet.validity}</dd>
              <dt>Included</dt><dd>{packet.included} context · {packet.references} references</dd>
              <dt>Fingerprints</dt><dd>{packet.fingerprints} resolved{packet.unresolved.length > 0 ? ` · ${packet.unresolved.length} unresolved` : ''}</dd>
              <dt>Size</dt><dd>~{packet.roughTokens} tokens (chars/4, deterministic)</dd>
              <dt>Version</dt><dd>v{packet.version} · {packet.hash.slice(0, 12)}…</dd>
              <dt>Included ids</dt>
              <dd>{packet.includedIds.length > 0 ? packet.includedIds.join(' · ') : '(none)'}</dd>
            </dl>
          )}
          <p className="cabinet-hint">Saved for the record — nothing is sent yet. Usage appears after a real run uses it.</p>
        </footer>
      )}
    </section>
  );
}
