import type {
  ContextIncludeState,
  ContextItem,
  OverlaySnapshot,
} from '../types';
import { buildStaging } from './staging';

/**
 * Context Cabinet (PHASE 3C.1) — source-first projection of the existing
 * Context staging domain for the vNext renderer.
 *
 * What this module IS:
 * - A deterministic view over `buildStaging` (the existing candidate list
 *   from the real Overlay) grouped by real source family, plus the exact
 *   decision transitions (include / exclude / pin) the Cabinet UI offers.
 * - Scope-aware: a Cabinet is opened for one Project; Work/Task-specific
 *   Context appears ONLY when the source declares the relation exactly
 *   (project-scoped INBOX lines, adapter gates). Global Memory entries
 *   stay `unbound` — never auto-attached to the selected project.
 *
 * What this module is NOT:
 * - Not a new SOT. Decisions persist through the existing
 *   `WorkbenchDraftV1` seam (`buildWorkbenchDraft` / `restoreWorkbenchDraft`).
 * - Not a context recommendation engine. No similarity, no recency, no
 *   model scoring; groups come from the item's declared `source` only.
 * - Not a consumer record. Available != Included, retrieved != used;
 *   only an exact dispatch consumer can produce `uses-context`.
 *
 * Scope key note: the draft seam's scope kind is the migration-era
 * `migration-conversation-key`. The Cabinet stores its decisions under the
 * reserved local key `cabinet:v1:<projectId>`, which can never collide with
 * a real conversation key (`<project>::<platform>::<role>`).
 */

export const CABINET_SCOPE_PREFIX = 'cabinet:v1:';

/** Reserved draft scope key for one project's Cabinet staging. */
export function cabinetScopeKey(projectId: string): string {
  return `${CABINET_SCOPE_PREFIX}${projectId}`;
}

/** Groups come from the item's declared source only — never from content. */
export type CabinetSourceGroup = 'governance' | 'inbox' | 'memory' | 'other';

/**
 * Declared relation to the Cabinet's project scope. `unbound` items remain
 * Available context; binding them to a project would be an inference.
 */
export type CabinetBinding = 'project' | 'unbound';

export interface CabinetItem extends ContextItem {
  group: CabinetSourceGroup;
  binding: CabinetBinding;
  /** True when the current Overlay snapshot already fingerprints sourceRef. */
  fingerprintAvailable: boolean;
}

function groupFor(source: string): CabinetSourceGroup {
  if (source.startsWith('adapter:')) return 'governance';
  if (source.startsWith('inbox:')) return 'inbox';
  if (source.startsWith('memory:') || source.startsWith('memory-projection:')) return 'memory';
  return 'other';
}

function bindingFor(group: CabinetSourceGroup): CabinetBinding {
  // Only sources that declare the project relation may bind. The memory
  // index is global; the Cabinet must not attach it to the open project.
  return group === 'memory' ? 'unbound' : 'project';
}

/** Deterministic Cabinet candidates from the real Overlay snapshot. */
export function buildCabinetItems(snapshot: OverlaySnapshot, projectId: string): CabinetItem[] {
  const fingerprinted = new Set(snapshot.sourceFingerprints.map((f) => f.sourceRef));
  return buildStaging(snapshot, projectId).map((item) => {
    const group = groupFor(item.source);
    return {
      ...item,
      group,
      binding: bindingFor(group),
      fingerprintAvailable: item.sourceRef !== undefined && fingerprinted.has(item.sourceRef),
    };
  });
}

/**
 * Explicit state decision. Pinned is a strengthening of included, so any
 * move away from included drops the pin (mirrors the draft seam's rule).
 */
export function applyCabinetState(items: CabinetItem[], id: string, state: ContextIncludeState): CabinetItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      state,
      pinned: state === 'included' ? item.pinned : false,
    };
  });
}

/** Pin / unpin an included item. Pinning anything else is a domain error. */
export function applyCabinetPin(items: CabinetItem[], id: string, pinned: boolean): CabinetItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    if (item.state !== 'included') {
      throw new Error(`"${item.title}" is not included; pinning requires included context.`);
    }
    return { ...item, pinned };
  });
}

export interface CabinetSummary {
  available: number;
  included: number;
  excluded: number;
  pinned: number;
  /** Deterministic size fact: total characters of included bodies. */
  includedChars: number;
  /** Same deterministic estimate the packet compiler uses: ceil(chars/4). */
  roughTokens: number;
}

export function cabinetSummary(items: CabinetItem[]): CabinetSummary {
  const includedItems = items.filter((item) => item.state === 'included');
  const includedChars = includedItems.reduce((sum, item) => sum + item.body.length, 0);
  return {
    available: items.filter((item) => item.state === 'available').length,
    included: includedItems.length,
    excluded: items.filter((item) => item.state === 'excluded').length,
    pinned: includedItems.filter((item) => item.pinned).length,
    includedChars,
    roughTokens: Math.ceil(includedChars / 4),
  };
}

/** Strip Cabinet display fields back to the canonical staging item shape. */
export function cabinetStaging(items: CabinetItem[]): ContextItem[] {
  return items.map(({ group, binding, fingerprintAvailable, ...item }) => item);
}

/**
 * Deterministic per-item currentness: compares the fingerprint recorded in
 * the Overlay snapshot at Cabinet-open time (baseline) against a fresh
 * recheck. Never guesses:
 * - no sourceRef          -> UNVERIFIED (nothing to compare; never CURRENT)
 * - ref gone / errored    -> INVALID
 * - fingerprint changed   -> STALE
 * - fingerprint unchanged -> CURRENT
 */
export type CabinetItemCurrentness = 'CURRENT' | 'STALE' | 'INVALID' | 'UNVERIFIED';

export function cabinetItemCurrentness(
  item: Pick<CabinetItem, 'sourceRef' | 'sourceRefs'>,
  baseline: { sourceRef: string; sha256: string }[],
  fresh: { sourceRef: string; sha256: string }[],
): CabinetItemCurrentness {
  const refs = item.sourceRefs?.length ? item.sourceRefs : item.sourceRef ? [item.sourceRef] : [];
  if (refs.length === 0) return 'UNVERIFIED';
  const baseByRef = new Map(baseline.map((f) => [f.sourceRef, f.sha256]));
  const freshByRef = new Map(fresh.map((f) => [f.sourceRef, f.sha256]));
  let stale = false;
  for (const ref of refs) {
    const before = baseByRef.get(ref);
    const now = freshByRef.get(ref);
    if (before === undefined || now === undefined) return 'INVALID';
    if (before !== now) stale = true;
  }
  return stale ? 'STALE' : 'CURRENT';
}
