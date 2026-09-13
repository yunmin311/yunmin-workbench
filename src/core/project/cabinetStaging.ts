import type { ContextIncludeState } from '../types';
import type { CabinetItem } from './cabinet';
import { cabinetScopeKey } from './cabinet';

/**
 * Formal Cabinet staging identity (PHASE 3C.2).
 *
 * PHASE 3C.1 borrowed the migration-era draft seam under the reserved local
 * key `cabinet:v1:<projectId>`. That was a temporary seam. This module gives
 * the Cabinet its own typed staging state with a scope kind that can never
 * be confused with a conversation draft:
 *
 *   scope.kind = 'project-context-cabinet'
 *
 * The staging state is Workbench-owned (Workbench OWNS context staging) and
 * persists only explicit user decisions plus explicit project-file
 * selections. It never stores external bodies — truth is re-resolved fresh
 * on every open, so stale/invalid rules keep working unchanged.
 *
 * Work/Task scoping: the scope carries optional workId/taskId fields for a
 * future need, but the UI MUST NOT mint per-Work/Task persistence
 * partitions today. The storage key is the projectId alone.
 *
 * Migration: legacy 3C.1 drafts stored under `cabinet:v1:<projectId>` are
 * converted once by the main-process persistence layer
 * (src/main/cabinetStagingPersistence.ts); this module owns the pure
 * conversion so tests can lock it.
 */

export const CABINET_STAGING_SCHEMA_VERSION = 1 as const;

/** Reserved legacy local key whose draft files are migrated to this scope. */
export const LEGACY_CABINET_SCOPE_PREFIX = 'cabinet:v1:';

export interface CabinetStagingScopeV1 {
  kind: 'project-context-cabinet';
  projectId: string;
  /** Reserved seam only: never minted from a canvas selection alone. */
  workId?: string;
  /** Reserved seam only: never minted from a canvas selection alone. */
  taskId?: string;
}

export interface CabinetStagingDecisionV1 {
  /** Exact Cabinet context id (identity is the real ContextItem id). */
  contextId: string;
  state: ContextIncludeState;
  /** Pinned is a strengthening of included; persisted only when included. */
  pinned: boolean;
  order: number;
}

/** Explicit user-selected project file, resolved fresh from disk on open. */
export interface CabinetFileSelectionV1 {
  projectId: string;
  /** Repo-root-relative, safe path (validated again on every resolve). */
  relativePath: string;
  asReference: boolean;
  /** sha256 observed when the file was added; change disclosure only. */
  lastKnownSha256?: string;
}

export interface CabinetStagingV1 {
  schemaVersion: typeof CABINET_STAGING_SCHEMA_VERSION;
  scope: CabinetStagingScopeV1;
  taskSummary: string;
  decisions: CabinetStagingDecisionV1[];
  /** Working-tree files the user explicitly picked (never auto-scanned). */
  projectFiles: CabinetFileSelectionV1[];
  /** True when the user explicitly added the pinned canonical source. */
  pinnedCanonicalFile: boolean;
}

export function cabinetStagingScope(projectId: string): CabinetStagingScopeV1 {
  return { kind: 'project-context-cabinet', projectId };
}

/**
 * Persistence semantic: SPARSE OVERRIDES, never a resolved snapshot.
 *
 * `decisions` records only explicit user overrides on top of the
 * inherited/source defaults that `buildCabinetItems` resolves fresh on every
 * open. Untouched contexts leave no record, so a later source-default change
 * flows through to every context the user never explicitly decided.
 * Reverting an item to its inherited default deletes the override instead of
 * persisting a decision that happens to equal the default.
 *
 * Callers pass the exact explicit-touch set (`explicitIds`). Omitting it
 * keeps the legacy whole-collection serialization for migration-era callers
 * only — new UI writes must always pass the explicit set.
 */
export function buildCabinetStaging(
  projectId: string,
  items: CabinetItem[],
  projectFiles: CabinetFileSelectionV1[],
  pinnedCanonicalFile: boolean,
  taskSummary = '',
  explicitIds?: ReadonlySet<string>,
): CabinetStagingV1 {
  const overridden = explicitIds ? items.filter((item) => explicitIds.has(item.id)) : items;
  return {
    schemaVersion: CABINET_STAGING_SCHEMA_VERSION,
    scope: cabinetStagingScope(projectId),
    taskSummary,
    decisions: overridden.map((item, order) => ({
      contextId: item.id,
      state: item.state,
      pinned: item.state === 'included' ? item.pinned : false,
      order,
    })),
    projectFiles,
    pinnedCanonicalFile,
  };
}

/** The inherited/source default an item resolved to when the Cabinet opened. */
export interface CabinetSourceDefault {
  state: ContextIncludeState;
  pinned: boolean;
}

/**
 * Pure maintenance for the explicit-touch set behind sparse persistence.
 * Adds the item id when its current (state, pinned) differs from the
 * inherited default captured at open; removes it when the user reverts to
 * that default. Unknown ids (e.g. files added mid-session before their
 * default is registered) fall back to the creation default
 * available/unpinned. Never guesses beyond the supplied defaults.
 */
export function refreshExplicitDecision(args: {
  baseDefaults: ReadonlyMap<string, CabinetSourceDefault>;
  decided: ReadonlySet<string>;
  item: { id: string; state: ContextIncludeState; pinned: boolean };
}): Set<string> {
  const fallback: CabinetSourceDefault = { state: 'available', pinned: false };
  const def = args.baseDefaults.get(args.item.id) ?? fallback;
  const next = new Set(args.decided);
  if (args.item.state === def.state && args.item.pinned === def.pinned) {
    next.delete(args.item.id);
  } else {
    next.add(args.item.id);
  }
  return next;
}

export interface LegacyCabinetDraftLike {
  scope: { kind: string; projectId: string; conversationKey: string };
  taskSummary: string;
  manualContexts: unknown[];
  projectFiles: Array<{
    projectId: string;
    relativePath: string;
    asReference: boolean;
    lastKnownSha256?: string;
    state: ContextIncludeState;
    pinned: boolean;
    order: number;
  }>;
  projectedDecisions: Array<{ itemId: string; state: ContextIncludeState; pinned: boolean; order: number }>;
}

/**
 * Pure one-time conversion of a legacy 3C.1 cabinet draft. Returns null for
 * anything that is not exactly the legacy cabinet scope for this project —
 * conversation drafts are never touched.
 */
export function migrateLegacyCabinetDraft(
  projectId: string,
  draft: LegacyCabinetDraftLike | null,
): CabinetStagingV1 | null {
  if (!draft) return null;
  if (draft.scope.kind !== 'migration-conversation-key') return null;
  if (draft.scope.projectId !== projectId) return null;
  if (draft.scope.conversationKey !== `${LEGACY_CABINET_SCOPE_PREFIX}${projectId}`) return null;
  if (draft.manualContexts.length > 0) return null;
  return {
    schemaVersion: CABINET_STAGING_SCHEMA_VERSION,
    scope: cabinetStagingScope(projectId),
    taskSummary: '',
    decisions: draft.projectedDecisions.map((decision) => ({
      contextId: decision.itemId,
      state: decision.state,
      pinned: decision.state === 'included' ? decision.pinned : false,
      order: decision.order,
    })),
    projectFiles: draft.projectFiles
      .filter((file) => file.projectId === projectId)
      .map((file) => ({
        projectId: file.projectId,
        relativePath: file.relativePath,
        asReference: file.asReference,
        ...(file.lastKnownSha256 !== undefined ? { lastKnownSha256: file.lastKnownSha256 } : {}),
      })),
    pinnedCanonicalFile: false,
  };
}

/** Legacy storage key whose draft file is migrated then removed. */
export function legacyCabinetScopeKey(projectId: string): string {
  return cabinetScopeKey(projectId);
}
