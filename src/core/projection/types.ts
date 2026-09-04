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
