import type {
  AttentionState,
  DialogueStatus,
  ObservationSource,
  ObservationVerification,
  Platform,
  RuntimeBinding,
  RuntimeState,
  TaskState,
  Verification,
} from '../types';

export const PROJECTION_SCHEMA_VERSION = 0 as const;

export type ProjectionCurrentness = 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
export type ProjectionBuildStatus = 'VERIFIED' | 'NEEDS_FIX' | 'STALE';
export type ProjectionDiagnosticSeverity = 'error' | 'warning';

export type EvidenceRevisionV0 =
  | { kind: 'sha256'; value: string }
  | { kind: 'git-commit'; value: string }
  | { kind: 'activity-event'; value: string }
  | { kind: 'history-session'; value: string };

/**
 * `history-session` is reserved. v0 does not emit EvidenceRefV0 with this
 * revision kind; it remains in the union so a future explicit trusted Project
 * binding can introduce History without an IR break.
 */

export interface EvidenceRefV0 {
  id: string;
  source: ObservationSource;
  sourceRef: string;
  observedAt: string;
  verification: ObservationVerification;
  currentness: ProjectionCurrentness;
  revision?: EvidenceRevisionV0;
}

export interface ConversationProjectionV0 {
  id: string;
  /** Workbench-local render key. It is never promoted to canonical identity. */
  conversationKey: string;
  canonicalConversationId?: string;
  projectId: string;
  role: string;
  level?: string;
  platform: Platform;
  lifecycleState: DialogueStatus;
  taskState: TaskState;
  runtimeState: RuntimeState;
  attentionState: AttentionState;
  verification: Verification;
  evidenceRefs: string[];
}

export interface RuntimeReceiptProjectionV0 {
  accepted: boolean;
  status: 'ACCEPTED' | 'NOT ACCEPTED' | 'CANCELLED';
  at: string;
  summary: string;
  protocolSourceRef: string;
  source: ObservationSource;
}

export interface RuntimeExecutionProjectionV0 {
  id: string;
  executionId: string;
  nativeRef: string;
  harness: string;
  projectId: string;
  conversationRef: string | null;
  binding: RuntimeBinding | null;
  runtimeState: RuntimeState;
  live: boolean;
  startedAt: string | null;
  endedAt: string | null;
  intentId: string | null;
  intentState: 'dispatched' | 'accepted' | 'failed' | 'cancelled' | 'unknown';
  receipt: RuntimeReceiptProjectionV0 | null;
  evidenceRefs: string[];
}

export interface ParallelRelationProjectionV0 {
  id: string;
  kind: 'parallel';
  groupId: string;
  executionRefs: string[];
  evidenceRefs: string[];
}

export interface HandoffRelationProjectionV0 {
  id: string;
  kind: 'handoff';
  sourceExecutionRef: string;
  targetExecutionRef: string;
  usedResultRef: string;
  evidenceRefs: string[];
}

export type CollaborationRelationProjectionV0 =
  | ParallelRelationProjectionV0
  | HandoffRelationProjectionV0;

export type ArtifactOrEvidenceKindV0 =
  | 'agent-result'
  | 'tool-evidence'
  | 'file-evidence'
  | 'runtime-receipt'
  | 'governance-record'
  | 'git-fact'
  | 'history-fact'
  | 'memory-index';

/**
 * `history-fact` is reserved. v0 does not emit ArtifactOrEvidenceProjectionV0
 * with this kind: History has no canonical Project binding, and v0 forbids
 * inferring it from cwd, provider, or time proximity. The kind stays in the
 * union so the IR does not break when a future explicit binding exists.
 */

export interface ArtifactOrEvidenceProjectionV0 {
  id: string;
  kind: ArtifactOrEvidenceKindV0;
  projectId: string;
  executionRef?: string;
  eventRef?: string;
  title: string;
  content?: string;
  evidenceRefs: string[];
}

export interface ProjectionSemanticFactsV0 {
  conversations: ConversationProjectionV0[];
  runtimeExecutions: RuntimeExecutionProjectionV0[];
  collaborationRelations: CollaborationRelationProjectionV0[];
  artifactsOrEvidence: ArtifactOrEvidenceProjectionV0[];
  evidenceRefs: EvidenceRefV0[];
}

export interface LayoutPositionV0 {
  x: number;
  y: number;
}

export interface LayoutViewportV0 extends LayoutPositionV0 {
  zoom: number;
}

export interface LayoutStateV0 {
  schemaVersion: 0;
  nodePositions: Record<string, LayoutPositionV0>;
  viewport?: LayoutViewportV0;
}

export interface ProjectionCandidateV0 {
  schemaVersion: 0;
  projectionKind: 'workbench';
  scope: { projectId: string };
  sourceBinding: { sourceDigest: string };
  semanticFacts: ProjectionSemanticFactsV0;
  layoutState: LayoutStateV0;
}

export interface ProjectionDiagnosticV0 {
  code: string;
  severity: ProjectionDiagnosticSeverity;
  message: string;
  subject: Record<string, unknown>;
  evidence: Record<string, unknown>;
  supportedFixes: string[];
}

export interface ProjectionReceiptV0 {
  schemaVersion: 0;
  outcome: ProjectionBuildStatus;
  candidateHash: string;
  sourceDigest: string;
  recheckedSourceDigest: string;
  revisionId: string | null;
  retainedRevisionId: string | null;
  checkedAt: string;
  diagnostics: ProjectionDiagnosticV0[];
}

export interface VerifiedProjectionRevisionV0 {
  schemaVersion: 0;
  revisionId: string;
  revisionHash: string;
  semanticHash: string;
  layoutHash: string;
  sourceDigest: string;
  verifiedAt: string;
  previousRevisionId?: string;
  candidate: ProjectionCandidateV0;
}

export interface ProjectionBuildStateV0 {
  status: ProjectionBuildStatus;
  current: VerifiedProjectionRevisionV0 | null;
  receipt: ProjectionReceiptV0 | null;
  diagnostics: ProjectionDiagnosticV0[];
}

export type ProjectionCandidateValidationV0 =
  | { ok: true; candidate: ProjectionCandidateV0; diagnostics: [] }
  | { ok: false; diagnostics: ProjectionDiagnosticV0[] };

// ===== Projection Delta v0 =====
//
// Pure comparator output for two `VerifiedProjectionRevisionV0` revisions
// of the same Project scope. Delta is Workbench-owned and never infers
// runtime impact, causality, risk, or mergeability.

export const PROJECTION_DELTA_SCHEMA_VERSION = 0 as const;
export const PROJECTION_DELTA_COMPARATOR_VERSION = 0 as const;

export type ProjectionDeltaProofLevelV0 = 'verified-projection';

export type ProjectionDeltaFailureCodeV0 =
  | 'delta/schema-version-mismatch'
  | 'delta/projection-kind-mismatch'
  | 'delta/project-mismatch'
  | 'delta/invalid-revision'
  | 'delta/duplicate-id';

export interface ProjectionDeltaFailureV0 {
  ok: false;
  code: ProjectionDeltaFailureCodeV0;
  message: string;
  subject: Record<string, unknown>;
  evidence: Record<string, unknown>;
  supportedFixes: string[];
}

export type ConversationFieldKindV0 =
  | 'lifecycle'
  | 'task'
  | 'runtime'
  | 'attention'
  | 'identity-metadata'
  | 'evidence';

export type RuntimeExecutionFieldKindV0 =
  | 'runtimeState'
  | 'live'
  | 'binding'
  | 'intentState'
  | 'receipt'
  | 'conversationRef'
  | 'evidence';

export type CollaborationRelationFieldKindV0 =
  | 'topology'
  | 'semantic'
  | 'evidence';

export type ArtifactOrEvidenceFieldKindV0 =
  | 'content'
  | 'evidence';

export type EvidenceRefFieldKindV0 =
  | 'verification'
  | 'currentness'
  | 'revision'
  | 'source';

export type LayoutFieldKindV0 =
  | 'nodePosition'
  | 'viewport';

export interface ProjectionDeltaFieldChangeV0<K extends string> {
  path: string;
  kind: K;
  before: unknown;
  after: unknown;
}

export interface ProjectionDeltaConversationChangeV0 {
  id: string;
  status: 'added' | 'removed' | 'changed';
  classifications: ConversationFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<ConversationFieldKindV0>[];
}

export interface ProjectionDeltaRuntimeExecutionChangeV0 {
  id: string;
  status: 'added' | 'removed' | 'changed';
  classifications: RuntimeExecutionFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<RuntimeExecutionFieldKindV0>[];
}

export interface ProjectionDeltaCollaborationRelationChangeV0 {
  id: string;
  status: 'added' | 'removed' | 'changed';
  classifications: CollaborationRelationFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<CollaborationRelationFieldKindV0>[];
}

export interface ProjectionDeltaArtifactOrEvidenceChangeV0 {
  id: string;
  status: 'added' | 'removed' | 'changed' | 'evidence-changed';
  classifications: ArtifactOrEvidenceFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<ArtifactOrEvidenceFieldKindV0>[];
}

export interface ProjectionDeltaEvidenceRefChangeV0 {
  id: string;
  status: 'added' | 'removed' | 'changed';
  classifications: EvidenceRefFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<EvidenceRefFieldKindV0>[];
}

export interface ProjectionDeltaLayoutChangeV0 {
  id: string;
  status: 'moved' | 'viewport-changed' | 'changed';
  classifications: LayoutFieldKindV0[];
  changedFields: ProjectionDeltaFieldChangeV0<LayoutFieldKindV0>[];
}

export interface ProjectionDeltaChangesV0 {
  conversations: ProjectionDeltaConversationChangeV0[];
  runtimeExecutions: ProjectionDeltaRuntimeExecutionChangeV0[];
  collaborationRelations: ProjectionDeltaCollaborationRelationChangeV0[];
  artifactsOrEvidence: ProjectionDeltaArtifactOrEvidenceChangeV0[];
  evidenceRefs: ProjectionDeltaEvidenceRefChangeV0[];
  layout: ProjectionDeltaLayoutChangeV0[];
}

export interface ProjectionDeltaSummaryCountsV0 {
  added: number;
  removed: number;
  changed: number;
}

export interface ProjectionDeltaSummaryArtifactCountsV0 extends ProjectionDeltaSummaryCountsV0 {
  evidenceChanged: number;
}

export interface ProjectionDeltaSummaryEvidenceCountsV0 {
  changed: number;
}

export interface ProjectionDeltaSummaryLayoutCountsV0 {
  moved: number;
  viewportChanged: number;
}

export interface ProjectionDeltaSummaryRelationCountsV0 extends ProjectionDeltaSummaryCountsV0 {}

export interface ProjectionDeltaSummaryRuntimeExecutionCountsV0 extends ProjectionDeltaSummaryCountsV0 {}

export interface ProjectionDeltaSummaryConversationCountsV0 extends ProjectionDeltaSummaryCountsV0 {}

export interface ProjectionDeltaSummaryV0 {
  conversations: ProjectionDeltaSummaryConversationCountsV0;
  runtimeExecutions: ProjectionDeltaSummaryRuntimeExecutionCountsV0;
  relations: ProjectionDeltaSummaryRelationCountsV0;
  artifacts: ProjectionDeltaSummaryArtifactCountsV0;
  evidence: ProjectionDeltaSummaryEvidenceCountsV0;
  layout: ProjectionDeltaSummaryLayoutCountsV0;
  semanticChanged: boolean;
  layoutChanged: boolean;
  provenanceChanged: boolean;
}

export interface ProjectionDeltaIdentityDeclarationV0 {
  conversations: 'id';
  runtimeExecutions: 'id';
  collaborationRelations: 'id';
  artifactsOrEvidence: 'id';
  evidenceRefs: 'id';
  layoutNodes: 'id';
}

export interface ProjectionDeltaV0 {
  ok: true;
  schemaVersion: typeof PROJECTION_DELTA_SCHEMA_VERSION;
  comparatorVersion: typeof PROJECTION_DELTA_COMPARATOR_VERSION;
  projectId: string;
  baseRevisionId: string;
  headRevisionId: string;
  baseSemanticHash: string;
  headSemanticHash: string;
  baseLayoutHash: string;
  headLayoutHash: string;
  baseSourceDigest: string;
  headSourceDigest: string;
  proofLevel: ProjectionDeltaProofLevelV0;
  identity: ProjectionDeltaIdentityDeclarationV0;
  summary: ProjectionDeltaSummaryV0;
  changes: ProjectionDeltaChangesV0;
  limitations: string[];
  computedAt: string;
}

export type ProjectionDeltaResultV0 = ProjectionDeltaV0 | ProjectionDeltaFailureV0;
