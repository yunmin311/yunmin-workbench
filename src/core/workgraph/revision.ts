/**
 * Work Graph Revision & Candidate types — verified projection model.
 *
 * Mirrors the existing Projection v0 types (VerifiedProjectionRevisionV0,
 * ProjectionCandidateV0, ProjectionReceiptV0, etc.) but for the
 * Work Graph semantic layer.
 *
 * Key differences from Canvas projection:
 * - No LayoutStateV0 (x/y/zoom/viewport). Layout is renderer concern.
 * - Semantic hash is separate from layout hash (layout doesn't exist here).
 * - Source is Workbench-owned facts (Governance, Overlay, History, Memory,
 *   Packets, Handoffs, Paseo/native adapters), NOT Canvas position.
 * - Candidate validation uses the same trust semantics: UNKNOWN stays
 *   UNKNOWN, STALE/INVALID don't replace last-good.
 *
 * This module reuses existing projection infrastructure:
 * - src/core/projection/diagnostics.ts (diagnostics, severity)
 * - src/core/projection/revision.ts (semantic hash, revision id)
 * - src/core/projection/delta.ts (delta comparator, if needed)
 * - src/core/projection/schema.ts (schema versioning)
 */

import type { ProjectionDiagnosticV0 } from '../projection/types';
import type { WorkGraphEdge, WorkGraphNode, WorkGraphProjectId } from './types';

/**
 * Semantic facts for one project scope in the Work Graph.
 * Unlike ProjectionSemanticFactsV0, this contains Work Graph nodes/edges
 * and evidence refs, not Canvas projection entities.
 */
export interface WorkGraphSemanticFacts {
  schemaVersion: 1;
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  evidenceRefs: WorkGraphEvidenceRef[];
  sourceFingerprints: WorkGraphSourceFingerprint[];
  problems: { source: string; message: string }[];
}

/**
 * Evidence reference for Work Graph.
 * Mirrors EvidenceRefV0 but for Work Graph evidence refs.
 */
export interface WorkGraphEvidenceRef {
  id: string;
  source: 'governance' | 'overlay' | 'history' | 'memory' | 'packet' | 'handoff' | 'adapter' | 'user-provided';
  sourceRef: string;
  observedAt: string;
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  revision?: { kind: 'sha256' | 'git-commit' | 'activity-event'; value: string };
}

/**
 * Source fingerprint for Work Graph facts.
 * Mirrors SourceFingerprint from core/types.ts.
 */
export interface WorkGraphSourceFingerprint {
  sourceRef: string;
  sha256: string;
}

/**
 * Work Graph Candidate — pre-validation semantic facts.
 * Equivalent to ProjectionCandidateV0.
 */
export interface WorkGraphCandidate {
  schemaVersion: 1;
  projectionKind: 'workgraph';
  scope: { projectId: WorkGraphProjectId };
  sourceBinding: { sourceDigest: string };
  semanticFacts: WorkGraphSemanticFacts;
  // No layoutState — Work Graph has no layout.
}

/**
 * Diagnostics for candidate validation.
 * Reuses ProjectionDiagnosticV0 structure.
 */
export type WorkGraphDiagnostic = ProjectionDiagnosticV0;

/**
 * Validation result for a WorkGraphCandidate.
 * Mirrors ProjectionCandidateValidationV0.
 */
export type WorkGraphCandidateValidation =
  | { ok: true; candidate: WorkGraphCandidate; diagnostics: [] }
  | { ok: false; diagnostics: WorkGraphDiagnostic[] };

/**
 * Work Graph Receipt — result of a compilation attempt.
 * Mirrors ProjectionReceiptV0.
 */
export interface WorkGraphReceipt {
  schemaVersion: 1;
  outcome: 'VERIFIED' | 'NEEDS_FIX' | 'STALE';
  candidateHash: string;
  sourceDigest: string;
  recheckedSourceDigest: string;
  revisionId: string | null;
  retainedRevisionId: string | null;
  checkedAt: string;
  diagnostics: WorkGraphDiagnostic[];
}

/**
 * Verified Work Graph Revision — the canonical, immutable state.
 * Equivalent to VerifiedProjectionRevisionV0.
 */
export interface WorkGraphRevision {
  schemaVersion: 1;
  revisionId: string;
  revisionHash: string;
  /** Semantic hash — excludes any layout (there is none). */
  semanticHash: string;
  /** Layout hash — always empty string for Work Graph. */
  layoutHash: '';
  sourceDigest: string;
  verifiedAt: string;
  previousRevisionId?: string;
  candidate: WorkGraphCandidate;
}

/**
 * Work Graph Build State — current state of the projection for a project.
 * Mirrors ProjectionBuildStateV0.
 */
export interface WorkGraphBuildState {
  status: 'VERIFIED' | 'NEEDS_FIX' | 'STALE';
  current: WorkGraphRevision | null;
  receipt: WorkGraphReceipt | null;
  diagnostics: WorkGraphDiagnostic[];
}

/**
 * Compile options for the Work Graph compiler.
 */
export interface WorkGraphCompileOptions {
  /** The project scope. */
  projectId: WorkGraphProjectId;
  /** Current source digest (sha256 of all source facts). */
  sourceDigest: string;
  /** Previous verified revision, if any. */
  previousRevision?: WorkGraphRevision;
  /** Source facts input (from WorkbenchReadModel, adapters, etc.). */
  facts: WorkGraphSourceFacts;
  /** If true, allow reusing previous revision when sourceDigest unchanged. */
  allowReuse?: boolean;
  /** Deterministic clock for tests. Defaults to current time. */
  now?: string;
}

/**
 * Source facts input for the compiler.
 * Aggregated from Governance binding, Overlay, History, Memory, Packets,
 * Handoffs, Paseo/native adapters, etc.
 */
export interface WorkGraphSourceFacts {
  /** Governance Project bindings. */
  governanceBindings: WorkGraphGovernanceFact[];
  /** Overlay snapshot (conversations, projects, memoryIndex, etc.). */
  overlaySnapshot?: {
    conversations: WorkGraphOverlayConversation[];
    projects: WorkGraphOverlayProject[];
    memoryIndex: WorkGraphOverlayMemoryEntry[];
    inbox: WorkGraphOverlayInboxItem[];
    sourceFingerprints: WorkGraphSourceFingerprint[];
    problems: { source: string; message: string }[];
  };
  /** History sessions. */
  historySessions: WorkGraphHistorySession[];
  /** Memory entries. */
  memoryEntries: WorkGraphMemoryEntry[];
  /** Frozen Packets. */
  packets: WorkGraphPacketFact[];
  /** Handoff receipts. */
  handoffs: WorkGraphHandoffFact[];
  /** Paseo/native adapter execution facts. */
  adapterExecutions: WorkGraphAdapterExecutionFact[];
  /** Context staging facts (available/included/excluded). */
  contextItems: WorkGraphContextItemFact[];
  /** Attention/Gate facts. */
  attentionItems: WorkGraphAttentionFact[];
  /** Artifact/evidence facts. */
  artifacts: WorkGraphArtifactFact[];
  /** Explicit task facts (canonical task source only). */
  tasks: WorkGraphTaskFact[];
  /** Explicit evidence facts (exact evidence identity only). */
  evidenceItems: WorkGraphEvidenceFact[];
}

/**
 * Minimal fact types — just enough to construct nodes/edges.
 * These are NOT domain objects; they are raw fact inputs.
 */

export interface WorkGraphGovernanceFact {
  projectId: string;
  workId?: string;
  workLabel?: string;
  /** Exact source metadata for an explicit Work fact. Absent on root-only bindings. */
  workSource?: {
    source: string;
    sourceRef: string;
    observedAt: string;
    verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
    currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
    conversationIds: string[];
  };
  binding: {
    projectId: string;
    root: string;
    canonicalPath: string;
    observedAt: string;
    verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  };
}

export interface WorkGraphOverlayConversation {
  conversationKey: string;
  canonicalConversationId?: string;
  projectId: string;
  role: string;
  platform: string;
  lifecycleState: string;
  taskState: string;
  runtimeState: string;
  attentionState: string;
  verification: string;
  evidenceRefs: string[];
}

export interface WorkGraphOverlayProject {
  projectId: string;
  label: string;
  canonicalSource?: { path: string; remote?: string };
}

export interface WorkGraphOverlayMemoryEntry {
  memoryId: string;
  title: string;
  source: string;
}

export interface WorkGraphOverlayInboxItem {
  id: string;
  line: number;
  text: string;
}

export interface WorkGraphHistorySession {
  sessionId: string;
  harness: string;
  cwd: string;
  nativeId: string;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  sourceFiles: string[];
}

export interface WorkGraphMemoryEntry {
  memoryId: string;
  title: string;
  source: string;
  sourceRef: string;
  observedAt: string;
  verification: string;
}

export interface WorkGraphPacketFact {
  packetId: string;
  projectId: string;
  conversationKey: string;
  conversationId?: string;
  version: number;
  hash: string;
  frozenAt: string;
  roughTokens: number;
  taskSummary: string;
  sourceFingerprints: WorkGraphSourceFingerprint[];
  unresolvedDependencies: string[];
}

export interface WorkGraphHandoffFact {
  intentId: string;
  sourceExecutionRef: string;
  targetExecutionRef: string;
  usedResultRef: string;
  evidenceRefs: string[];
  at: string;
  status: 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
}

export interface WorkGraphAdapterExecutionFact {
  executionId: string;
  backend: 'paseo' | 'native' | 'acp' | 'external';
  provider: string;
  runtimeRef: string;
  projectId: string;
  conversationKey?: string;
  workId?: string;
  taskId?: string;
  packetId?: string;
  intentId?: string;
  runtimeState: string;
  live: boolean;
  receiptStatus?: 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
  evidenceRefs: string[];
  sourceRef: string;
}

export interface WorkGraphContextItemFact {
  contextId: string;
  projectId: string;
  title: string;
  source: string;
  body: string;
  state: 'available' | 'included' | 'excluded';
  pinned: boolean;
  isReference: boolean;
  sourceRef?: string;
  sourceRefs?: string[];
  provenance?: 'EXTERNAL' | 'USER PROVIDED';
  evidenceRefs: string[];
  /**
   * Explicit consumer of this context item, when the source fact records
   * one (e.g. a packet's included[] entry attached to a dispatch, or a
   * timeline event that sent the item). uses-context edges are ONLY
   * created from this field — never from cwd/time/provider heuristics.
   */
  consumedBy?: {
    executionId?: string;
    conversationId?: string;
    action: 'included' | 'attached' | 'sent';
  };
}

export interface WorkGraphAttentionFact {
  id: string;
  kind: 'approval-required' | 'needs-user-input' | 'receipt-failed' | 'runtime-error'
      | 'packet-stale' | 'packet-invalid' | 'gate-attention' | 'execution-review';
  level: 'alert' | 'action' | 'review';
  title: string;
  summary: string;
  projectId: string;
  sourceId?: string;
  sourceRef: string;
  evidenceRefs: string[];
  observedAt: string;
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  provenance?: string;
}

export interface WorkGraphArtifactFact {
  artifactId: string;
  projectId: string;
  kind: 'agent-result' | 'tool-evidence' | 'file-evidence' | 'runtime-receipt'
      | 'governance-record' | 'git-fact' | 'history-fact' | 'memory-index';
  executionId?: string;
  eventRef?: string;
  title: string;
  content?: string;
  source?: string;
  sourceRef?: string;
  observedAt?: string;
  verification?: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  currentness?: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  /** Exact Task relation carried by canonical facts; no edge is inferred from it. */
  taskId?: string;
  evidenceRefs: string[];
}

/**
 * Explicit task fact. Only facts from a canonical/explicit task source
 * may appear here. The compiler creates one Task node per fact and
 * never invents tasks from execution liveness or conversation activity.
 */
export interface WorkGraphTaskFact {
  taskId: string;
  projectId: string;
  label: string;
  source: string;
  sourceRef: string;
  observedAt: string;
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  currentness?: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  taskState?: 'active' | 'waiting' | 'blocked' | 'standby' | 'unknown';
  attentionState?: 'none' | 'needs-user' | 'approval' | 'blocked' | 'unknown';
  /** Explicit Work binding declared by the task source. */
  workId?: string;
  /** Explicit conversation bindings declared by the task source. */
  conversationKeys?: string[];
  /** Explicit gate bindings declared by the task source. */
  gateIds?: string[];
  /** Exact artifact refs declared by the task source. */
  artifactRefs?: string[];
  evidenceRefs: string[];
}

/**
 * Explicit evidence fact. Only facts with an exact, referenceable
 * evidence identity may appear here. A bare "an event happened" with
 * no evidence identity must NOT be recorded as an evidence fact.
 */
export interface WorkGraphEvidenceFact {
  evidenceId: string;
  projectId: string;
  label: string;
  evidenceType: string;
  source: string;
  sourceRef: string;
  observedAt: string;
  verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  eventRef?: string;
  artifactRef?: string;
  executionId?: string;
  gateId?: string;
  /**
   * Exact target this evidence backs. When the target exists as a
   * node, the compiler emits an `evidences` edge. Format:
   * node id (e.g. 'gate:p1:g1') — never a guess.
   */
  backsNodeId?: string;
  evidenceRefs: string[];
}

/**
 * Compiler function type signature.
 * The actual implementation lives in a separate file to keep this
 * module focused on types.
 */
export type WorkGraphCompiler = (options: WorkGraphCompileOptions) => Promise<WorkGraphCandidateValidation>;

/**
 * Validator function type signature.
 */
export type WorkGraphValidator = (candidate: WorkGraphCandidate) => Promise<WorkGraphDiagnostic[]>;
