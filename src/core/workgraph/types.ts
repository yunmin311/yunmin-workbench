/**
 * Work Graph — semantic foundation types (PHASE 3A).
 *
 * Canonical node/edge semantics for the Workbench Work Graph.
 * Single source of truth for what may appear in a verified Work Graph.
 *
 * Design principles:
 * - Node/edge kinds are fixed discriminated unions. New kinds require
 *   a schema version bump and an audit window.
 * - Structural edges (membership) do NOT prove execution flow or
 *   context flow. They only describe containment.
 * - Context-flow edges (uses-context) require EXPLICIT evidence that
 *   a ContextItem was Included/attached/sent — never cwd / time /
 *   provider / title / visual-position heuristics.
 * - Execution-flow edges (execution-of / handoff / produces / evidences)
 *   require exact runtime identity and sourceRef provenance.
 * - Handoff edges require exact used-result identity.
 * - UNKNOWN is preserved; nothing is auto-promoted to VERIFIED.
 * - Session is NOT a root graph identity. Execution is the transient
 *   runtime instance; Conversation is the durable logical carrier.
 * - Work spans multiple Conversations and Executions across backends.
 *   Work identity is never auto-merged by heuristic; it requires
 *   explicit Governance/Project binding. Without sufficient facts the
 *   compiler returns UNKNOWN/UNRESOLVED, never an invented Work.
 * - TaskState / RuntimeState / AttentionState are never merged.
 *
 * This module contains NO layout (x/y/zoom/viewport/color/panel state).
 * Layout belongs to the Canvas renderer (later phase).
 *
 * FROZEN DECISION (PHASE 3A.1): Workflow is NOT an independent
 * first-class node. There is no `workflow` member in
 * WorkGraphNodeKind, and none may be added without an explicit
 * canonical workflow source plus a new audit decision.
 *
 *   Workflow semantics = DEFERRED PROJECTION OVER WORK / TASK /
 *   GATE / HANDOFF until an explicit canonical workflow source exists.
 *
 * Rationale: no independent SOT proves Workflow has a stable identity
 * distinct from Work. Work is the sustained semantic container;
 * Workflow is at most a structural/flow attribute of a Work or a
 * later projection view. Future UI grouping must never mint
 * canonical Workflow identity.
 */

import type {
  DialogueStatus,
  ObservationVerification,
  Platform,
  RuntimeState,
  TaskState,
} from '../types';

// ===== Identity aliases (opaque strings; equality is identity) =====

export type WorkGraphNodeId = string;
export type WorkGraphEdgeId = string;
export type WorkGraphProjectId = string;
export type WorkGraphWorkId = string;
export type WorkGraphConversationId = string;
export type WorkGraphExecutionId = string;
export type WorkGraphContextId = string;
export type WorkGraphMemorySourceId = string;
export type WorkGraphTaskId = string;
export type WorkGraphArtifactId = string;
export type WorkGraphEvidenceEntityId = string;
export type WorkGraphGateId = string;
export type WorkGraphHandoffId = string;

// ===== Common node base =====

export interface WorkGraphNodeBase {
  id: WorkGraphNodeId;
  kind: WorkGraphNodeKind;
  label: string;
  projectId: WorkGraphProjectId;
  /** Fact origin, e.g. 'governance-binding' | 'overlay' | 'adapter' | 'user-provided'. */
  source: string;
  sourceRef: string;
  observedAt: string;
  verification: ObservationVerification;
}

// ===== Node kinds =====

export type WorkGraphNodeKind =
  | 'project'
  | 'work'
  | 'task'
  | 'conversation'
  | 'execution'
  | 'context'
  | 'memory-source'
  | 'artifact'
  | 'evidence'
  | 'gate'
  | 'handoff';

/** Root project node. One per Governance Project binding. */
export interface WorkGraphProjectNode extends WorkGraphNodeBase {
  kind: 'project';
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  workCount: number;
  conversationCount: number;
}

/**
 * Work node — a sustained unit of user work.
 * Spans multiple Conversations and Executions across backends.
 * Never auto-created by heuristic.
 */
export interface WorkGraphWorkNode extends WorkGraphNodeBase {
  kind: 'work';
  workId: WorkGraphWorkId;
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  conversationIds: WorkGraphConversationId[];
  executionIds: WorkGraphExecutionId[];
}

/**
 * Task node — first-class task unit with an explicit canonical source.
 *
 * Task != Work. Work is the sustained semantic container; Task is a
 * discrete unit that exists in a Governance/Project source. Tasks are
 * never inferred from execution liveness, conversation activity, or
 * any other heuristic: no canonical/explicit task source means no
 * Task node.
 *
 * TaskState is orthogonal to RuntimeState: a task's state never moves
 * because an execution started, stopped, or failed.
 */
export interface WorkGraphTaskNode extends WorkGraphNodeBase {
  kind: 'task';
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  taskId: WorkGraphTaskId;
  taskState: TaskState;
  attentionState: 'none' | 'needs-user' | 'approval' | 'blocked' | 'unknown';
  /** Explicit Work binding, when the task source declares one. */
  workId?: WorkGraphWorkId;
  /** Explicit conversation bindings declared by the task source. */
  conversationKeys?: WorkGraphConversationId[];
  /** Explicit gate bindings declared by the task source. */
  gateIds?: WorkGraphGateId[];
  /** Exact artifact refs declared by the task source. */
  artifactRefs?: string[];
  evidenceRefs: string[];
}

/**
 * Evidence node — first-class, locatable, referenceable evidence entity.
 *
 * An Evidence node is NOT "an event happened". It requires an exact
 * evidence identity (source + sourceRef) that can be cited and traced:
 * protocol observation, runtime receipt, git fact, test/build result,
 * artifact verification, gate evidence, fingerprint-backed evidence.
 *
 * The `evidences` edge cites an Evidence node as backing for a Gate,
 * Artifact, or Execution — only with an exact evidenceRef/sourceRef.
 */
export interface WorkGraphEvidenceNode extends WorkGraphNodeBase {
  kind: 'evidence';
  evidenceId: WorkGraphEvidenceEntityId;
  evidenceType: string;
  eventRef?: string;
  artifactRef?: string;
  executionId?: WorkGraphExecutionId;
  gateId?: WorkGraphGateId;
  evidenceRefs: string[];
}

/**
 * Conversation node — durable logical carrier.
 * May span multiple Executions across backends. NOT a runtime session.
 */
export interface WorkGraphConversationNode extends WorkGraphNodeBase {
  kind: 'conversation';
  conversationId: WorkGraphConversationId;
  /** Null = not bound to any Work (allowed, never auto-bound). */
  workId: WorkGraphWorkId | null;
  conversationKey: string;
  canonicalConversationId?: string;
  platform: Platform;
  lifecycleState: DialogueStatus;
  taskState: TaskState;
  runtimeState: RuntimeState;
  attentionState: 'none' | 'needs-user' | 'approval' | 'blocked' | 'unknown';
  evidenceRefs: string[];
}

/**
 * Execution node — transient runtime instance.
 * One per real dispatch/agent run. Backend/provider/runtimeRef
 * come from the executor's authoritative identity only.
 */
export interface WorkGraphExecutionNode extends WorkGraphNodeBase {
  kind: 'execution';
  executionId: WorkGraphExecutionId;
  conversationId: WorkGraphConversationId | null;
  workId: WorkGraphWorkId | null;
  backend: 'paseo' | 'native' | 'acp' | 'external';
  provider: string;
  /** Authoritative runtime handle (Paseo agentId / native session id). */
  runtimeRef: string;
  runtimeState: RuntimeState;
  live: boolean;
  intentId?: string;
  receiptStatus?: 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
  evidenceRefs: string[];
}

/** Context item node — Available / Included / Excluded / Pinned. */
export interface WorkGraphContextNode extends WorkGraphNodeBase {
  kind: 'context';
  contextId: WorkGraphContextId;
  state: 'available' | 'included' | 'excluded';
  pinned: boolean;
  isReference: boolean;
  sourceRefs?: string[];
  provenance?: 'EXTERNAL' | 'USER PROVIDED';
  evidenceRefs: string[];
}

/** Memory source node — external source of ContextItems, not an item itself. */
export interface WorkGraphMemorySourceNode extends WorkGraphNodeBase {
  kind: 'memory-source';
  memorySourceId: WorkGraphMemorySourceId;
  sourceType: 'overlay' | 'history' | 'project-file';
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  evidenceRefs: string[];
}

/** Artifact / evidence node — result, tool output, file, receipt. */
export interface WorkGraphArtifactNode extends WorkGraphNodeBase {
  kind: 'artifact';
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  artifactId: WorkGraphArtifactId;
  artifactKind:
    | 'agent-result'
    | 'tool-evidence'
    | 'file-evidence'
    | 'runtime-receipt'
    | 'governance-record'
    | 'git-fact'
    | 'history-fact'
    | 'memory-index';
  executionId?: WorkGraphExecutionId;
  taskId?: WorkGraphTaskId;
  eventRef?: string;
  title: string;
  content?: string;
  evidenceRefs: string[];
}

/** Gate / attention node — requires user action. */
export interface WorkGraphGateNode extends WorkGraphNodeBase {
  kind: 'gate';
  gateId: WorkGraphGateId;
  gateKind:
    | 'approval-required'
    | 'needs-user-input'
    | 'receipt-failed'
    | 'runtime-error'
    | 'packet-stale'
    | 'packet-invalid'
    | 'gate-attention'
    | 'execution-review';
  level: 'alert' | 'action' | 'review';
  title: string;
  summary: string;
  sourceId?: string;
  evidenceRefs: string[];
}

/** Handoff node — explicit handoff between two executions. */
export interface WorkGraphHandoffNode extends WorkGraphNodeBase {
  kind: 'handoff';
  handoffId: WorkGraphHandoffId;
  sourceExecutionId: WorkGraphExecutionId;
  targetExecutionId: WorkGraphExecutionId;
  /** Exact result identity that was handed off. */
  usedResultRef: string;
  evidenceRefs: string[];
}

export type WorkGraphNode =
  | WorkGraphProjectNode
  | WorkGraphWorkNode
  | WorkGraphTaskNode
  | WorkGraphConversationNode
  | WorkGraphExecutionNode
  | WorkGraphContextNode
  | WorkGraphMemorySourceNode
  | WorkGraphArtifactNode
  | WorkGraphEvidenceNode
  | WorkGraphGateNode
  | WorkGraphHandoffNode;

export function getNodeProjectId(node: WorkGraphNode): WorkGraphProjectId {
  return node.projectId;
}

export function getNodeId(node: WorkGraphNode): WorkGraphNodeId {
  return node.id;
}

export function getNodeKind(node: WorkGraphNode): WorkGraphNodeKind {
  return node.kind;
}

// ===== Edge semantics =====
//
// STRUCTURAL (containment, no flow implication):
// - membership: Project/Work/Conversation contains a child node.
// - depends-on: explicit declared dependency (from a canonical field).
//
// FLOW (requires explicit evidence, never heuristics):
// - uses-context: Execution/Conversation explicitly Included/attached/sent a ContextItem.
// - produces: Execution produced an Artifact (exact runtime identity + sourceRef).
// - evidences: Gate/Artifact/Evidence backed by an Execution/Event.
// - blocked-by: Execution/Conversation blocked by a Gate.
// - handoff: explicit handoff between two Executions with exact usedResultRef.
// - execution-of: Conversation/Work launched an Execution.
// - derived-from: Artifact/Memory derived from another Artifact/Memory.
//
// Prohibited heuristics: cwd proximity, time proximity, provider
// similarity, title similarity, visual position, key-prefix match.

export type WorkGraphEdgeKind =
  | 'membership'
  | 'depends-on'
  | 'uses-context'
  | 'produces'
  | 'evidences'
  | 'blocked-by'
  | 'handoff'
  | 'execution-of'
  | 'derived-from';

/** Exact structural provenance: the node + field asserting the relation. */
export interface WorkGraphEdgeStructuralSource {
  entityId: WorkGraphNodeId;
  fieldPath: string;
}

export interface WorkGraphEdgeBase {
  id: WorkGraphEdgeId;
  kind: WorkGraphEdgeKind;
  projectId: WorkGraphProjectId;
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  structuralSource: WorkGraphEdgeStructuralSource;
  evidenceRefs: string[];
  observedAt: string;
  verification: ObservationVerification;
}

/** Structural containment. No flow implication. */
export interface WorkGraphMembershipEdge extends WorkGraphEdgeBase {
  kind: 'membership';
}

/** Explicit declared dependency from a canonical field. */
export interface WorkGraphDependsOnEdge extends WorkGraphEdgeBase {
  kind: 'depends-on';
}

/** Explicit context inclusion. Requires inclusion evidence. */
export interface WorkGraphUsesContextEdge extends WorkGraphEdgeBase {
  kind: 'uses-context';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  inclusionAction: 'included' | 'attached' | 'sent';
}

/** Execution produced an artifact. Requires exact runtime identity. */
export interface WorkGraphProducesEdge extends WorkGraphEdgeBase {
  kind: 'produces';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  eventRef?: string;
}

/** Artifact/Gate backed by an execution/event. */
export interface WorkGraphEvidencesEdge extends WorkGraphEdgeBase {
  kind: 'evidences';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  eventRef?: string;
}

/** Execution/Conversation blocked by a gate. */
export interface WorkGraphBlockedByEdge extends WorkGraphEdgeBase {
  kind: 'blocked-by';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
}

/** Explicit handoff with exact used-result identity. */
export interface WorkGraphHandoffEdge extends WorkGraphEdgeBase {
  kind: 'handoff';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  usedResultRef: string;
  relationId?: string;
}

/** Conversation/Work launched an execution. */
export interface WorkGraphExecutionOfEdge extends WorkGraphEdgeBase {
  kind: 'execution-of';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  intentId?: string;
}

/** Artifact/Memory derivation. */
export interface WorkGraphDerivedFromEdge extends WorkGraphEdgeBase {
  kind: 'derived-from';
  source: WorkGraphNodeId;
  target: WorkGraphNodeId;
  derivationAction: string;
}

export type WorkGraphEdge =
  | WorkGraphMembershipEdge
  | WorkGraphDependsOnEdge
  | WorkGraphUsesContextEdge
  | WorkGraphProducesEdge
  | WorkGraphEvidencesEdge
  | WorkGraphBlockedByEdge
  | WorkGraphHandoffEdge
  | WorkGraphExecutionOfEdge
  | WorkGraphDerivedFromEdge;

/** True for edges that assert real flow (not pure containment). */
export function isFlowEdge(kind: WorkGraphEdgeKind): boolean {
  return (
    kind === 'uses-context' ||
    kind === 'produces' ||
    kind === 'evidences' ||
    kind === 'blocked-by' ||
    kind === 'handoff' ||
    kind === 'execution-of' ||
    kind === 'derived-from' ||
    kind === 'depends-on'
  );
}

/** True for purely structural (containment-only) edges. */
export function isStructuralEdge(kind: WorkGraphEdgeKind): boolean {
  return kind === 'membership';
}

const SOURCE_KIND_MAP: Record<WorkGraphEdgeKind, Array<WorkGraphNode['kind']>> = {
  membership: ['project', 'work', 'conversation'],
  'depends-on': ['work', 'task', 'conversation', 'execution'],
  'uses-context': ['execution', 'conversation'],
  produces: ['execution'],
  evidences: ['evidence', 'artifact', 'gate'],
  'blocked-by': ['work', 'task', 'execution', 'conversation'],
  handoff: ['execution'],
  'execution-of': ['conversation', 'work'],
  'derived-from': ['artifact', 'memory-source'],
};

const TARGET_KIND_MAP: Record<WorkGraphEdgeKind, Array<WorkGraphNode['kind']>> = {
  membership: ['work', 'task', 'conversation', 'execution', 'context', 'memory-source', 'gate', 'artifact', 'evidence', 'handoff'],
  'depends-on': ['work', 'task', 'conversation', 'execution', 'gate'],
  'uses-context': ['context'],
  produces: ['artifact'],
  evidences: ['gate', 'artifact', 'execution', 'context'],
  'blocked-by': ['gate'],
  handoff: ['execution'],
  'execution-of': ['execution'],
  'derived-from': ['artifact', 'memory-source'],
};

export function expectedSourceKind(kind: WorkGraphEdgeKind): Array<WorkGraphNode['kind']> {
  return SOURCE_KIND_MAP[kind] ?? [];
}

export function expectedTargetKind(kind: WorkGraphEdgeKind): Array<WorkGraphNode['kind']> {
  return TARGET_KIND_MAP[kind] ?? [];
}
