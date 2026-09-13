/**
 * History context source.
 *
 * Exposes the same primitives the legacy `history:list / search /
 * detail` and `sources:recheck` IPC handlers call. Capability
 * declaration here only describes WHAT the source can do; routing
 * through the existing `HistoryService` is the adapter's job.
 *
 * Capability declaration:
 * - list: YES — HistoryService.list returns the catalog.
 * - search: YES — HistoryService.search answers text queries.
 * - read: YES — HistoryService.detail returns a typed session.
 * - fingerprint: YES — HistoryService.fingerprint produces sha256
 *   fingerprints used by sources:recheck and packet validity.
 * - recheck: YES — history source-refs are routed by sources:recheck.
 */
import type {
  ContextSource,
  ContextSourceAvailability,
  ContextSourceCapabilities,
  ContextSourceCurrentness,
  ContextSourceKind,
} from '../../../core/context-sources/types';

export interface HistorySourceOptions {
  hasDiscoveredRoots: () => Promise<boolean>;
}

export function createHistorySource(
  options: HistorySourceOptions,
): ContextSource {
  const kind: ContextSourceKind = 'history';
  return {
    id: 'history',
    kind,
    label: 'History',
    provenance: 'WORKBENCH_BUILTIN',
    capabilities: {
      list: { answer: 'YES', evidence: 'HistoryService.list returns the catalog of discovered sessions' },
      search: { answer: 'YES', evidence: 'HistoryService.search answers text queries against the index' },
      read: { answer: 'YES', evidence: 'HistoryService.detail returns a typed session with bounded excerpt' },
      fingerprint: { answer: 'YES', evidence: 'HistoryService.fingerprint returns sha256 fingerprint for a known sourceRef' },
      recheck: { answer: 'YES', evidence: 'history:* sourceRefs are routed by sources:recheck' },
    },
    async availability(): Promise<ContextSourceAvailability> {
      const discovered = await options.hasDiscoveredRoots();
      if (!discovered) {
        return {
          state: 'UNAVAILABLE',
          reason: 'no history roots discovered; defaultHistoryRoots() found no candidates',
        };
      }
      return { state: 'AVAILABLE', reason: 'at least one history root is discovered' };
    },
    async currentness(): Promise<ContextSourceCurrentness> {
      return {
        state: 'UNKNOWN',
        reason: 'history does not start a watcher; freshness is computed by sources:recheck',
      };
    },
  };
}