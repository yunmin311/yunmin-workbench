/**
 * Context Source seam — typed capability contract for any source that can
 * supply content to the Workbench Context / Memory Cabinet.
 *
 * Scope:
 * - Describes WHAT a source claims it can do (capabilities), WHO declared
 *   the claim (provenance), and HOW FRESH / HOW VERIFIED the claim is.
 * - The contract is transport-neutral and execution-neutral; concrete
 *   adapters live under `src/main/adapters/context/*`.
 *
 * Hard rules:
 * - Capability answers are YES / NO / UNKNOWN. UNKNOWN is never collapsed
 *   into a positive boolean.
 * - Every capability answer carries an `evidence` string so a renderer
 *   can show "why we believe this" rather than guessing.
 * - The contract holds NO durable state. Adapters may cache locally;
 *   the registry holds only the list of registered sources and the
 *   frozen snapshot of their capabilities.
 * - Sources never write back into Governance / Overlay / Memory index.
 *   They are readers, not SOTs.
 *
 * Compatibility note (PHASE 1 read model):
 * - The capability shape here is intentionally a SUPERSET of what
 *   `src/main/services/workbenchReadModel.ts` exposes. The read-model
 *   is a renderer-facing aggregation seam; the context-source contract
 *   is the per-source capability declaration. They compose but never
 *   alias: the read model can call a context source, never vice versa.
 *
 * Compatibility note (Paseo):
 * - Paseo audit pending. The contract is intentionally transport-agnostic
 *   so Paseo can later implement an adapter without forcing contract
 *   changes here.
 */

export type CapabilityAnswer = 'YES' | 'NO' | 'UNKNOWN';

export interface CapabilityEvidence {
  /** Concrete answer. UNKNOWN must be honest. */
  answer: CapabilityAnswer;
  /** Short, never-the-internal-stack-trace reason. */
  evidence: string;
}

/**
 * What a context source claims it can do. Each member is a capability
 * entry, not a boolean — the answer always carries evidence.
 */
export interface ContextSourceCapabilities {
  /** Can the source enumerate its catalog / index. */
  list: CapabilityEvidence;
  /** Can the source answer a text query. */
  search: CapabilityEvidence;
  /** Can the source return a single body / record by stable id. */
  read: CapabilityEvidence;
  /** Can the source compute a stable fingerprint for a given locator. */
  fingerprint: CapabilityEvidence;
  /**
   * Can the source answer "did anything change since this fingerprint".
   * Implementation detail (chokidar / poll / push) is up to the
   * adapter; the contract never starts a watcher of its own.
   */
  recheck: CapabilityEvidence;
}

export type ContextSourceAvailability =
  | { state: 'AVAILABLE'; reason: string }
  | { state: 'UNAVAILABLE'; reason: string }
  | { state: 'UNKNOWN'; reason: string };

export type ContextSourceCurrentness =
  | { state: 'FRESH'; reason: string }
  | { state: 'STALE'; reason: string }
  | { state: 'UNKNOWN'; reason: string };

export type ContextSourceProvenance =
  /** Declared by the local Workbench build (core code). */
  | 'WORKBENCH_BUILTIN'
  /** Declared by the user's local config (settings, profile). */
  | 'USER_CONFIGURED'
  /** Declared by an external system the user opted into. */
  | 'USER_OPT_IN_EXTERNAL'
  /** Capability placeholder pending a real audit (e.g. Coffee today). */
  | 'PLACEHOLDER_PENDING_AUDIT';

/**
 * Source families Workbench already knows about. Adding a new family is
 * a registry-level decision; the kind is the contract's stable identity.
 */
export type ContextSourceKind =
  | 'overlay-memory'
  | 'project-files'
  | 'history'
  | 'coffee';

export interface ContextSource {
  /** Stable identifier; equal kind → equal id requirement. */
  id: string;
  kind: ContextSourceKind;
  /** Human label. Never used as identity. */
  label: string;
  provenance: ContextSourceProvenance;
  capabilities: ContextSourceCapabilities;
  /**
   * Aggregate "is this source reachable right now". Adapter-derived;
   * the registry never recomputes availability from capabilities
   * alone.
   */
  availability(): Promise<ContextSourceAvailability>;
  /** "When did we last learn something new from this source". */
  currentness(): Promise<ContextSourceCurrentness>;
}

export interface ContextSourceRegistryEntry {
  source: ContextSource;
  registeredAt: string;
}