/**
 * Overlay-memory context source.
 *
 * Reads the memory body for a given memory id from the user's Overlay
 * (the Governance-owned memory tree). Never writes back. Never guesses.
 *
 * Capability declaration:
 * - list: NO — Overlay memory is intentionally not a flat catalog;
 *   `loadOverlay` already projects `memoryIndex` for renderer access.
 * - search: NO — Overlay memory has no native text search today. The
 *   renderer's Memory Cabinet queries go through `core/memory`,
 *   not through this adapter.
 * - read: YES — `readMemoryBody` is the canonical reader.
 * - fingerprint: NO — Overlay memory body fingerprint is computed
 *   elsewhere (overlay snapshot); declaring YES here would duplicate
 *   that contract.
 * - recheck: NO — freshness is owned by `loadOverlay`'s watcher;
 *   this adapter stays out of the loop.
 */
import type {
  ContextSource,
  ContextSourceAvailability,
  ContextSourceCapabilities,
  ContextSourceCurrentness,
  ContextSourceKind,
} from '../../../core/context-sources/types';
import { readMemoryBody } from '../overlaySource';

export interface OverlayMemorySourceOptions {
  /** Workbench-owned local binding for the Overlay root. */
  readOverlayRootBinding: () => Promise<string | null>;
}

const NO: ContextSourceCapabilities['list'] = {
  answer: 'NO',
  evidence: 'Overlay memory has no flat catalog surface',
};

export function createOverlayMemorySource(
  options: OverlayMemorySourceOptions,
): ContextSource {
  const kind: ContextSourceKind = 'overlay-memory';
  return {
    id: 'overlay-memory',
    kind,
    label: 'Overlay Memory',
    provenance: 'WORKBENCH_BUILTIN',
    capabilities: {
      list: NO,
      search: { answer: 'NO', evidence: 'Overlay memory has no native text search; Memory Cabinet projects the index elsewhere' },
      read: { answer: 'YES', evidence: 'readMemoryBody returns the canonical body for a known memory id' },
      fingerprint: { answer: 'NO', evidence: 'Overlay memory fingerprint is owned by loadOverlay; declaring YES here would duplicate that contract' },
      recheck: { answer: 'NO', evidence: 'freshness is owned by the Overlay watcher; this adapter stays out of the loop' },
    },
    async availability(): Promise<ContextSourceAvailability> {
      const root = await options.readOverlayRootBinding();
      if (!root) {
        return {
          state: 'UNAVAILABLE',
          reason: 'no Overlay root is bound; choose one via overlay:choose or set GOV_OVERLAY',
        };
      }
      return {
        state: 'AVAILABLE',
        reason: `Overlay root bound at ${root}`,
      };
    },
    async currentness(): Promise<ContextSourceCurrentness> {
      // Without subscribing we cannot prove freshness. UNKNOWN is the
      // honest answer; the read-model recheck path is the place that
      // upgrades this.
      return {
        state: 'UNKNOWN',
        reason: 'overlay-memory never observes the watcher; freshness is owned upstream',
      };
    },
  };
}

/**
 * Convenience reader that this adapter advertises. Routed through the
 * adapter so the registry sees a single capability contract per source.
 */
export async function readOverlayMemory(
  root: string,
  memoryId: string,
): Promise<string | null> {
  return readMemoryBody(root, memoryId);
}