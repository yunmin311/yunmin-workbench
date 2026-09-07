/**
 * Executor seam — typed capability contract for any runtime that can
 * receive a Workbench packet and return a receipt / observation stream.
 *
 * Scope:
 * - Describes WHAT an executor claims it can do, with evidence, so the
 *   Workbench can route dispatches without inventing executor truths.
 * - Transport-neutral: the contract never names a wire protocol, an
 *   SDK, or a CLI invocation shape.
 *
 * Hard rules:
 * - Capability answers are YES / NO / UNKNOWN. UNKNOWN is never
 *   collapsed into a positive boolean.
 * - The contract holds NO durable state. Adapters may own their own
 *   process / socket / SDK instance; the registry only enumerates
 *   declared executors.
 * - The contract never declares a preferred provider, a fallback
 *   provider, or a default executor.
 *
 * Compatibility note (Paseo):
 * - Paseo audit pending. Paseo is recorded as an EXECUTION SUBSTRATE
 *   CANDIDATE, not a product UI donor. This contract is intentionally
 *   shaped so that:
 *     (a) existing native adapters (Codex / Claude / DeepSeek) remain
 *         eligible;
 *     (b) a future `@getpaseo/client` adapter, a future Paseo
 *         protocol / daemon adapter, or a future source-reuse
 *         provider layer can declare itself without contract changes;
 *     (c) Workbench's own Governance / Packet / Canvas / Context
 *         Cabinet remain the canonical projection surface — Paseo
 *         will not be retrofitted as a Workbench model.
 *
 * NO concrete transport is implemented in this phase. The registry is
 * the seam; concrete adapters land after the Paseo audit closes.
 */

export type CapabilityAnswer = 'YES' | 'NO' | 'UNKNOWN';

export interface CapabilityEvidence {
  answer: CapabilityAnswer;
  /** Short reason. Never an internal stack trace. */
  evidence: string;
}

export interface ExecutorCapabilities {
  /**
   * Can the executor report whether it is reachable on this host
   * without performing a dispatch. (Process spawn, license check,
   * version probe — the contract never describes HOW.)
   */
  discover: CapabilityEvidence;
  /**
   * Can the executor enumerate its full capability truth (the same
   * shape Workbench already projects for codex / claude / deepseek).
   */
  capabilities: CapabilityEvidence;
  /**
   * Can the executor accept a deterministic packet and return a
   * receipt with a runtimeRef. The contract does NOT describe how the
   * packet text is delivered (stdin / socket / HTTP / IPC).
   */
  dispatch: CapabilityEvidence;
  /**
   * Can the executor stream observations after dispatch
   * (turn/started, item/completed, tool-started, etc.). Transport
   * shape (callback / observable / promise) is the adapter's job.
   */
  observe: CapabilityEvidence;
  /**
   * Can the executor cancel an in-flight dispatch by some stable
   * reference (intentId / runtimeRef / executionId).
   */
  cancel: CapabilityEvidence;
  /**
   * Can the executor resume an external session. Only declared when
   * the upstream provider documents a reliable resume path; UNKNOWN
   * is the honest default.
   */
  resume: CapabilityEvidence;
}

export type ExecutorAvailability =
  | { state: 'AVAILABLE'; reason: string }
  | { state: 'UNAVAILABLE'; reason: string }
  | { state: 'UNKNOWN'; reason: string };

/**
 * Distinct executor kinds Workbench knows about. Adding a new kind is
 * a registry-level decision and requires its own audit window.
 */
export type ExecutorKind =
  | 'codex'
  | 'claude'
  | 'deepseek'
  | 'acp'
  | 'paseo';

export interface Executor {
  /** Stable identifier. Equal kind → equal id requirement. */
  id: string;
  kind: ExecutorKind;
  /** Human label. Never used as identity. */
  label: string;
  capabilities: ExecutorCapabilities;
  /**
   * "Is this executor reachable on this host right now". Adapter-
   * derived. The registry never recomputes this from capabilities.
   */
  availability(): Promise<ExecutorAvailability>;
}

export interface ExecutorRegistryEntry {
  executor: Executor;
  registeredAt: string;
}