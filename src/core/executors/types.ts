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
 * Execution identity is split into two orthogonal dimensions:
 *   ExecutionBackend:  the substrate that actually runs the agent
 *   ProviderIdentity:  the upstream agent product/brand
 *
 * This separation allows:
 *   - Paseo backend with claude/codex/opencode/... providers
 *   - Native backend with claude/codex/deepseek providers
 *   - ACP backend with copilot/cursor/... providers
 *   - External backend with any provider
 *   without hard-coding provider lists into backend kinds.
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
 * Execution backend substrate. Paseo is the primary substrate in
 * PHASE 2B+, but native/acp/external remain valid for fallback and
 * for providers not (yet) available on Paseo.
 */
export type ExecutionBackend =
  | 'paseo'
  | 'native'
  | 'acp'
  | 'external';

/**
 * Upstream agent provider identity. Open string union — not frozen
 * to a closed enum — because new providers appear continuously.
 * The listed brands are the ones currently known to Workbench or Paseo.
 */
export type ProviderIdentity =
  | 'claude'
  | 'codex'
  | 'deepseek'
  | 'opencode'
  | 'copilot'
  | 'pi'
  | 'omp'
  | (string & {});

/**
 * Execution identity combines backend + provider. This is what gets
 * registered in the executor registry and exposed to the UI.
 */
export interface ExecutionIdentity {
  backend: ExecutionBackend;
  provider: ProviderIdentity;
  /** Stable identifier: `${backend}:${provider}`. Must equal id. */
  id: string;
  /** Human label. Never used as identity. */
  label: string;
}

export interface Executor {
  /** Stable identifier. Equal to identity.id. */
  id: string;
  identity: ExecutionIdentity;
  capabilities: ExecutorCapabilities;
  /**
   * "Is this executor reachable on this host right now". Adapter-
   * derived. The registry never recomputes this from capabilities.
   */
  availability(): Promise<ExecutorAvailability>;
  /**
   * Optional runtime identity descriptor. When the executor can
   * authoritatively describe its runtime (e.g. Paseo workspaceId /
   * agentId / native session id), it returns it here. Otherwise
   * returns null — never fabricate a runtimeRef.
   */
  getRuntimeIdentity?(): Promise<RuntimeIdentity | null>;
}

export interface RuntimeIdentity {
  /** Backend-specific runtime handle. Paseo: workspaceId + agentId. Native: external session id. */
  runtimeRef: string;
  /** Human-readable source for debugging (e.g. "paseo:ws://host:6767/ws", "native:codex-app-server"). */
  sourceRef: string;
  /** Verification level of this identity claim. */
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
}

export interface ExecutorRegistryEntry {
  executor: Executor;
  registeredAt: string;
}