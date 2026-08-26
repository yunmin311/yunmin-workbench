// Yunmin Workbench domain model (产品类别: Agent Workbench).
// Workbench OWNS: workspace layout, context staging, packet drafts/frozen packets, mount configs.
// Workbench NEVER owns: governance, project/task/git facts, harness runtime — those are projections.

// ===== 1. Observation Contract (Projection Integrity) =====
// Every important projected state carries provenance. Heuristic/best-effort
// states must never render as equal to canonical/protocol facts. No model confidence scores.

export type ObservationSource = 'canonical-file' | 'protocol' | 'hook' | 'process' | 'heuristic';
export type ObservationVerification = 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';

export interface Observation {
  source: ObservationSource;
  /** file path / protocol endpoint / hook id / process description */
  sourceRef: string;
  observedAt: string; // ISO
  verification: ObservationVerification;
}

/** Coverage/trust of a projected entity in the UI (PDF §7). Distinct from Observation.verification. */
export type TrustLevel = 'VERIFIED' | 'REGISTERED' | 'DISCOVERED' | 'UNKNOWN';

// ===== 3. State Separation =====
// TaskState / RuntimeState / AttentionState are permanently separate in the
// domain model. UI may merge for display; domain never does.

export type TaskState = 'active' | 'waiting' | 'blocked' | 'standby' | 'unknown';
export type RuntimeState = 'working' | 'idle' | 'stopped' | 'error' | 'unknown';
export type AttentionState = 'none' | 'needs-user' | 'approval' | 'blocked';

/** Raw dialogue-registry status: external fact, kept verbatim. */
export type DialogueStatus = 'ACTIVE' | 'PAUSED' | 'FROZEN' | 'STANDBY' | 'UNKNOWN';
export type Verification = 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
export type Platform = 'claude' | 'codex' | 'deepseek' | 'other';

export interface Conversation {
  /**
   * Workbench-LOCAL render key, derived from project+platform+role.
   * NOT an identity: upstream conversation_id is MIGRATING (contract not frozen);
   * we never impersonate it with role or session_id (migration rule §4).
   */
  key: string;
  /** Canonical conversation id from Governance. UNKNOWN until the upstream contract lands. */
  conversationId?: string;
  role: string;
  level?: string;
  project: string;
  platform: Platform;
  sessionId?: string;
  status: DialogueStatus; // external routing status, verbatim
  /** UNKNOWN until a canonical Task source exists; lifecycle status is not Task truth. */
  taskState: TaskState;
  runtimeState: RuntimeState; // 'unknown' until a runtime adapter observes it
  attention: AttentionState;
  verification: Verification;
  gitAuthority?: string;
  note?: string;
  observed: Observation;
}

// ===== 2. Execution Binding (seam) =====
// Binding belongs to one Runtime Session/Execution, never permanently to a
// Conversation. Same Conversation/Task can hold different Harness Sessions
// over time or in parallel. No runtime adapter writes these yet — seam only.

export interface RuntimeBinding {
  harness: string; // claude | codex | deepseek | ...
  machine: string; // device_id
  cwd?: string;
  worktree?: string;
  branch?: string;
  head?: string; // commit sha
  externalSessionRef?: string; // harness-side session reference
}

export interface RuntimeSession {
  id: string;
  /** Canonical conversation id; may be absent while the upstream contract is MIGRATING. */
  conversationId?: string;
  /** Workbench-local key fallback for associating with a projected Conversation. */
  conversationKey?: string;
  binding: RuntimeBinding;
  state: RuntimeState;
  observed: Observation;
  startedAt: string;
  endedAt?: string;
}

// ===== 5. Intent / Receipt (seam only) =====
// Workbench emitting an Intent does NOT mean the external runtime changed.
// Only an Adapter/Runtime receipt may update the projection.

export type IntentState = 'draft' | 'dispatched' | 'accepted' | 'rejected' | 'failed';

export interface IntentReceipt {
  at: string;
  message?: string;
  runtimeRef?: string;
}

export interface UserIntent {
  id: string;
  kind: string; // e.g. 'handoff' | 'resume' | 'approve' — future
  payload: Record<string, unknown>;
  state: IntentState;
  createdAt: string;
  receipt?: IntentReceipt;
}

// ===== Projected entities =====

export interface ProjectAdapter {
  projectId: string;
  displayName: string;
  status: string;
  lastVerifiedAt?: string;
  canonicalSource?: {
    repository?: string;
    remote?: string;
    defaultBranch?: string;
    path?: string;
    commit?: string;
    verification?: string;
  };
  roles: { name: string; responsibility: string }[];
  gates: Record<string, string>;
  trust: TrustLevel;
  observed: Observation;
}

export interface InboxItem {
  id: string;
  /** Global vs project INBOX semantics are MIGRATING upstream; we only assert what we read. */
  scope: 'global' | 'project' | 'unknown';
  /** Present only when the source contract identifies a project-scoped INBOX. */
  projectId?: string;
  raw: string;
  done: boolean;
  date?: string;
  owner?: string;
  /** Needs-Attention projection: INBOX is not the task canonical source (PDF §3). */
  attention: boolean;
  line: number;
  sourceRef: string; // canonical file, for jump-back verification
}

export interface MemoryEntry {
  id: string; // file path relative to memory/, without .md
  title: string;
  hook: string;
  category: string;
  sourceRef: string; // index file; body loads lazily on demand
}

export interface MachineProfile {
  deviceId: string;
  displayName: string;
  retirementStatus?: string;
  availableTools: Record<string, string>;
  /** project_id -> local repo root, from machine profile project_bindings/roots. */
  projectRoots: Record<string, string>;
  observed: Observation;
}

export interface HarnessInfo {
  harness: string;
  model?: string;
  pluginsEnabled: number;
  hooks: { id: string; event: string; enforcement: string }[];
  observed: Observation;
}

/** Read-only git facts for one project repo. Never writes. */
export interface GitFacts {
  projectId: string;
  localRoot: string;
  branch?: string;
  head?: string;
  remotes: Record<string, string>;
  dirty: boolean;
  modified: number;
  ahead?: number;
  behind?: number;
  observed: Observation;
}

export interface SourceFingerprint {
  sourceRef: string; // canonical file path
  sha256: string;
}

export interface OverlaySnapshot {
  overlayRoot: string;
  foundAt: string;
  conversations: Conversation[];
  projects: ProjectAdapter[];
  inbox: InboxItem[];
  memoryIndex: MemoryEntry[];
  machine?: MachineProfile;
  harness: HarnessInfo[];
  /** sha256 of every canonical file read — basis for packet staleness checks. */
  sourceFingerprints: SourceFingerprint[];
  /** Any source that failed to parse is reported, never silently dropped. */
  problems: { source: string; message: string }[];
}

// --- Canvas projection (Workbench node/edge semantics; engine is React Flow) ---

export type WbNodeKind = 'project' | 'conversation' | 'memory' | 'gate';
/** Structure/mount edges are not evidence that execution or context flow occurred. */
export type WbEdgeKind = 'membership' | 'mount' | 'execution' | 'handoff' | 'data-context';

export interface WbNode {
  id: string;
  kind: WbNodeKind;
  label: string;
  status?: DialogueStatus;
  trust: TrustLevel;
  x: number;
  y: number;
}

export interface WbEdge {
  id: string;
  source: string;
  target: string;
  kind: WbEdgeKind;
}

// --- Context staging & Task Packet (Workbench-owned) ---

export type ContextIncludeState = 'available' | 'included' | 'excluded';

export interface ContextItem {
  id: string;
  title: string;
  /** source of the item: memory:<path> | inbox:<line> | adapter:<project> | manual */
  source: string;
  body: string;
  state: ContextIncludeState;
  /** Pinned is a strengthening of included (PDF §5). */
  pinned: boolean;
  isReference: boolean;
  /** Resolvable canonical file for staleness checks, when the item projects one. */
  sourceRef?: string;
  /** Manual input remains visibly user-owned and never impersonates external truth. */
  provenance?: 'EXTERNAL' | 'USER PROVIDED';
  /** Project-root-relative locator for an explicitly selected file. */
  relativePath?: string;
}

export interface HarnessCapabilities {
  harness: 'codex' | 'claude' | 'deepseek';
  canDispatch: boolean;
  canCreateSession: boolean;
  canResumeSession: boolean;
  canObserveRuntime: boolean;
  canReceiveReceipt: boolean;
  protocol: string;
  evidence: string;
}

export interface HandoffReceipt {
  intentId: string;
  harness: 'codex' | 'claude' | 'deepseek';
  status: 'ACCEPTED' | 'REJECTED' | 'FAILED';
  at: string;
  runtimeRef?: string;
  turnRef?: string;
  source: 'protocol';
  protocolEvidence: string;
  message?: string;
}

export type ActivityKind =
  | 'handoff-dispatched'
  | 'handoff-accepted'
  | 'handoff-failed'
  | 'session-started'
  | 'turn-started'
  | 'agent-response'
  | 'tool-started'
  | 'tool-completed'
  | 'file-change'
  | 'turn-completed'
  | 'turn-error';

/** Workbench-owned observation history. It projects protocol facts; it is not external runtime truth. */
export interface ActivityEvent {
  id: string;
  projectId: string;
  conversationKey: string;
  kind: ActivityKind;
  summary: string;
  runtimeRef?: string;
  turnRef?: string;
  binding?: RuntimeBinding;
  runtimeState?: RuntimeState;
  observed: Observation;
}

// ===== 4. Frozen Packet Validity =====

export interface TaskPacket {
  schemaVersion: 1;
  packetId: string;
  createdAt: string;
  projectId: string;
  /** Workbench-local key of the target conversation (identity contract MIGRATING). */
  conversationKey: string;
  /** Canonical conversation id when the upstream contract provides one; else absent. */
  conversationId?: string;
  taskSummary: string;
  governanceRefs: string[];
  included: ContextItem[];
  references: ContextItem[];
  /** fingerprints of every canonical file the packet depends on, at compile time. */
  sourceFingerprints: SourceFingerprint[];
  /** Declared canonical dependencies that could not be resolved at compile time. */
  unresolvedDependencies: string[];
  /** deterministic rough estimate: ceil(chars/4), no model call (PDF §8). */
  roughTokens: number;
}

export type PacketValidity = 'CURRENT' | 'STALE' | 'INVALID';

export interface FrozenPacket extends TaskPacket {
  frozenAt: string;
  /** sha256 of the canonical JSON of TaskPacket fields. */
  hash: string;
  /** frozen packets are immutable; later changes produce a new version. */
  version: number;
}

/**
 * Listing projection of a FrozenPacket: identity + validity metadata only.
 * Full bodies (included/references) load on demand via a detail read, so
 * history growth never drags every body across IPC into the renderer.
 */
export interface FrozenPacketSummary {
  schemaVersion: 1;
  packetId: string;
  projectId: string;
  conversationKey: string;
  conversationId?: string;
  version: number;
  hash: string;
  frozenAt: string;
  roughTokens: number;
  taskSummary: string;
  sourceFingerprints: SourceFingerprint[];
  unresolvedDependencies: string[];
}
