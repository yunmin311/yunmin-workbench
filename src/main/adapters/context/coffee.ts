/**
 * Coffee context source — fail-closed placeholder.
 *
 * The Coffee adapter is intentionally NOT implemented in this phase.
 *
 * Why this is a placeholder:
 * - Coffee's stable public API is not yet defined in our context; no
 *   donor exact repo / commit / license is recorded for a "Coffee
 *   context source" — only general Coffee CLI references exist.
 * - Coffee's export schema (CSV / JSON / what fields) is not frozen
 *   here; the Workbench never invents a schema on Coffee's behalf.
 * - Without either a stable API or a documented export format, the
 *   only honest capability answer is UNKNOWN / UNAVAILABLE — never a
 *   guess.
 *
 * What this adapter WILL NOT do:
 * - It will not import or scrape any Coffee private database.
 * - It will not infer a file format from sampling.
 * - It will not surface a synthetic "example" record as if it were
 *   real Coffee data.
 *
 * What the placeholder guarantees:
 * - Every capability is UNKNOWN with a concrete "pending audit" reason.
 * - availability() always returns UNAVAILABLE with the same reason.
 * - The adapter exists in the registry only so that Coffee-related
 *   UI surfaces do not have to invent a parallel seam.
 *
 * Future-state wiring (NOT done here):
 * - When Coffee's stable public API is documented, expose a real
 *   client in this file.
 * - When Coffee's documented export format is known, accept a
 *   user-configured read-only directory and project its records
 *   through this adapter.
 * - Until then, the adapter stays a typed UNKNOWN.
 */
import type {
  ContextSource,
  ContextSourceAvailability,
  ContextSourceCapabilities,
  ContextSourceCurrentness,
  ContextSourceKind,
} from '../../../core/context-sources/types';

const PENDING_REASON = 'Coffee public API / export format is not yet audited; awaiting donor decision before any read path is implemented';

function pendingCapability(name: string): ContextSourceCapabilities['list'] {
  return { answer: 'UNKNOWN', evidence: `${name}: ${PENDING_REASON}` };
}

export function createCoffeeSource(): ContextSource {
  const kind: ContextSourceKind = 'coffee';
  return {
    id: 'coffee',
    kind,
    label: 'Coffee (placeholder)',
    provenance: 'PLACEHOLDER_PENDING_AUDIT',
    capabilities: {
      list: pendingCapability('list'),
      search: pendingCapability('search'),
      read: pendingCapability('read'),
      fingerprint: pendingCapability('fingerprint'),
      recheck: pendingCapability('recheck'),
    },
    async availability(): Promise<ContextSourceAvailability> {
      return { state: 'UNAVAILABLE', reason: PENDING_REASON };
    },
    async currentness(): Promise<ContextSourceCurrentness> {
      return { state: 'UNKNOWN', reason: PENDING_REASON };
    },
  };
}