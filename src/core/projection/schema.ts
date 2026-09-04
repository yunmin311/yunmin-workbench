import { z, type ZodIssue } from 'zod';
import type {
  CollaborationRelationProjectionV0,
  ProjectionCandidateV0,
  ProjectionCandidateValidationV0,
  ProjectionDiagnosticV0,
} from './types';
import { normalizeProjectionDiagnostic } from './diagnostics';

const idSchema = z.string().min(1).max(1_024);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const observedAtSchema = z.string().datetime({ offset: true });

const runtimeBindingSchema = z.object({
  harness: z.string().min(1),
  machine: z.string().min(1),
  cwd: z.string().optional(),
  worktree: z.string().optional(),
  branch: z.string().optional(),
  head: z.string().optional(),
  externalSessionRef: z.string().optional(),
}).strict();

const evidenceRevisionSchema = z.object({
  kind: z.enum(['sha256', 'git-commit', 'activity-event', 'history-session']),
  value: z.string().min(1),
}).strict();

const evidenceRefSchema = z.object({
  id: idSchema,
  source: z.enum(['canonical-file', 'protocol', 'hook', 'process', 'heuristic']),
  sourceRef: z.string().min(1),
  observedAt: observedAtSchema,
  verification: z.enum(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']),
  currentness: z.enum(['CURRENT', 'STALE', 'INVALID', 'UNKNOWN']),
  revision: evidenceRevisionSchema.optional(),
}).strict();

const conversationSchema = z.object({
  id: idSchema,
  conversationKey: z.string().min(1),
  canonicalConversationId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  role: z.string().min(1),
  level: z.string().min(1).optional(),
  platform: z.enum(['claude', 'codex', 'deepseek', 'other']),
  lifecycleState: z.enum(['ACTIVE', 'PAUSED', 'FROZEN', 'STANDBY', 'UNKNOWN']),
  taskState: z.enum(['active', 'waiting', 'blocked', 'standby', 'unknown']),
  runtimeState: z.enum(['working', 'idle', 'stopped', 'error', 'unknown']),
  attentionState: z.enum(['none', 'needs-user', 'approval', 'blocked']),
  verification: z.enum(['VERIFIED', 'UNVERIFIED', 'UNKNOWN']),
  evidenceRefs: z.array(idSchema),
}).strict();

const runtimeReceiptSchema = z.object({
  accepted: z.boolean(),
  status: z.enum(['ACCEPTED', 'NOT ACCEPTED', 'CANCELLED']),
  at: observedAtSchema,
  summary: z.string(),
  protocolSourceRef: z.string().min(1),
  source: z.enum(['canonical-file', 'protocol', 'hook', 'process', 'heuristic']),
}).strict();

const runtimeExecutionSchema = z.object({
  id: idSchema,
  executionId: z.string().min(1),
  nativeRef: z.string().min(1),
  harness: z.string().min(1),
  projectId: z.string().min(1),
  conversationRef: idSchema.nullable(),
  binding: runtimeBindingSchema.nullable(),
  runtimeState: z.enum(['working', 'idle', 'stopped', 'error', 'unknown']),
  live: z.boolean(),
  startedAt: observedAtSchema.nullable(),
  endedAt: observedAtSchema.nullable(),
  intentId: z.string().min(1).nullable(),
  intentState: z.enum(['dispatched', 'accepted', 'failed', 'cancelled', 'unknown']),
  receipt: runtimeReceiptSchema.nullable(),
  evidenceRefs: z.array(idSchema),
}).strict();

const parallelRelationSchema = z.object({
  id: idSchema,
  kind: z.literal('parallel'),
  groupId: z.string().min(1),
  executionRefs: z.array(idSchema).min(2),
  evidenceRefs: z.array(idSchema),
}).strict();

const handoffRelationSchema = z.object({
  id: idSchema,
  kind: z.literal('handoff'),
  sourceExecutionRef: idSchema,
  targetExecutionRef: idSchema,
  usedResultRef: idSchema,
  evidenceRefs: z.array(idSchema),
}).strict();

const artifactSchema = z.object({
  id: idSchema,
  kind: z.enum([
    'agent-result',
    'tool-evidence',
    'file-evidence',
    'runtime-receipt',
    'governance-record',
    'git-fact',
    'history-fact',
    'memory-index',
  ]),
  projectId: z.string().min(1),
  executionRef: idSchema.optional(),
  eventRef: z.string().min(1).optional(),
  title: z.string(),
  content: z.string().optional(),
  evidenceRefs: z.array(idSchema),
}).strict();

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

const viewportSchema = positionSchema.extend({
  zoom: z.number().finite().positive(),
}).strict();

export const projectionCandidateV0Schema = z.object({
  schemaVersion: z.literal(0),
  projectionKind: z.literal('workbench'),
  scope: z.object({ projectId: z.string().min(1) }).strict(),
  sourceBinding: z.object({ sourceDigest: digestSchema }).strict(),
  semanticFacts: z.object({
    conversations: z.array(conversationSchema),
    runtimeExecutions: z.array(runtimeExecutionSchema),
    collaborationRelations: z.array(z.discriminatedUnion('kind', [
      parallelRelationSchema,
      handoffRelationSchema,
    ])),
    artifactsOrEvidence: z.array(artifactSchema),
    evidenceRefs: z.array(evidenceRefSchema),
  }).strict(),
  layoutState: z.object({
    schemaVersion: z.literal(0),
    nodePositions: z.record(idSchema, positionSchema),
    viewport: viewportSchema.optional(),
  }).strict(),
}).strict();

function issueFix(issue: ZodIssue): string[] {
  if (issue.code === 'unrecognized_keys') return ['remove fields that are not part of Projection IR v0'];
  if (issue.code === 'invalid_type') return ['provide the required Projection IR v0 field with the declared type'];
  return ['correct the candidate so it satisfies Projection IR v0'];
}

function issueDiagnostic(issue: ZodIssue): ProjectionDiagnosticV0 {
  return normalizeProjectionDiagnostic({
    code: `schema/${issue.code}`,
    severity: 'error',
    message: issue.message.trim(),
    subject: { path: issue.path },
    evidence: { issue: issue.code },
    supportedFixes: issueFix(issue),
  });
}

export function validateProjectionCandidate(input: unknown): ProjectionCandidateValidationV0 {
  const parsed = projectionCandidateV0Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map(issueDiagnostic) };
  }
  return {
    ok: true,
    candidate: parsed.data as ProjectionCandidateV0,
    diagnostics: [],
  };
}

function semanticDiagnostic(
  code: string,
  message: string,
  subject: Record<string, unknown>,
  evidence: Record<string, unknown>,
  supportedFix: string,
): ProjectionDiagnosticV0 {
  return normalizeProjectionDiagnostic({
    code,
    severity: 'error',
    message,
    subject,
    evidence,
    supportedFixes: [supportedFix],
  });
}

function relationEvidenceRefs(relation: CollaborationRelationProjectionV0): string[] {
  return relation.evidenceRefs;
}

/**
 * Cross-reference validation over an already structurally valid candidate.
 * It reports facts as supplied and never repairs, defaults, or mutates them.
 */
export function validateProjectionSemantics(candidate: ProjectionCandidateV0): ProjectionDiagnosticV0[] {
  const diagnostics: ProjectionDiagnosticV0[] = [];
  const allIds = new Set<string>();
  const collections: Array<readonly { id: string }[]> = [
    candidate.semanticFacts.conversations,
    candidate.semanticFacts.runtimeExecutions,
    candidate.semanticFacts.collaborationRelations,
    candidate.semanticFacts.artifactsOrEvidence,
    candidate.semanticFacts.evidenceRefs,
  ];
  for (const collection of collections) {
    for (const item of collection) {
      if (allIds.has(item.id)) {
        diagnostics.push(semanticDiagnostic(
          'semantic/duplicate-id',
          `Projection semantic ID is duplicated: ${item.id}`,
          { id: item.id },
          { duplicatedId: item.id },
          'give every projected entity a unique stable semantic ID',
        ));
      }
      allIds.add(item.id);
    }
  }

  const evidenceIds = new Set(candidate.semanticFacts.evidenceRefs.map((item) => item.id));
  const conversationIds = new Set(candidate.semanticFacts.conversations.map((item) => item.id));
  const executionIds = new Set(candidate.semanticFacts.runtimeExecutions.map((item) => item.id));
  const artifactById = new Map(candidate.semanticFacts.artifactsOrEvidence.map((item) => [item.id, item]));

  const checkEvidence = (subjectId: string, refs: readonly string[]): void => {
    for (const evidenceRef of refs) {
      if (evidenceIds.has(evidenceRef)) continue;
      diagnostics.push(semanticDiagnostic(
        'semantic/missing-evidence',
        `Projected entity ${subjectId} references missing evidence ${evidenceRef}`,
        { id: subjectId },
        { evidenceRef },
        'include the exact evidence record or remove the unsupported reference',
      ));
    }
  };

  for (const conversation of candidate.semanticFacts.conversations) {
    if (conversation.id !== `conversation:${conversation.conversationKey}`) {
      diagnostics.push(semanticDiagnostic(
        'semantic/unstable-id',
        `Conversation ID does not match its Workbench key: ${conversation.id}`,
        { id: conversation.id },
        { conversationKey: conversation.conversationKey },
        'derive the Conversation semantic ID from the existing Workbench conversation key',
      ));
    }
    if (conversation.projectId !== candidate.scope.projectId) {
      diagnostics.push(semanticDiagnostic(
        'semantic/scope-mismatch',
        `Conversation ${conversation.id} is outside projection scope`,
        { id: conversation.id },
        { projectId: conversation.projectId, scope: candidate.scope.projectId },
        'compile only facts belonging to the projection project scope',
      ));
    }
    checkEvidence(conversation.id, conversation.evidenceRefs);
  }

  for (const execution of candidate.semanticFacts.runtimeExecutions) {
    if (execution.id !== `execution:${execution.executionId}`) {
      diagnostics.push(semanticDiagnostic(
        'semantic/unstable-id',
        `RuntimeExecution ID does not match its execution identity: ${execution.id}`,
        { id: execution.id },
        { executionId: execution.executionId },
        'derive the RuntimeExecution semantic ID from the existing execution ID',
      ));
    }
    if (execution.projectId !== candidate.scope.projectId) {
      diagnostics.push(semanticDiagnostic(
        'semantic/scope-mismatch',
        `RuntimeExecution ${execution.id} is outside projection scope`,
        { id: execution.id },
        { projectId: execution.projectId, scope: candidate.scope.projectId },
        'compile only facts belonging to the projection project scope',
      ));
    }
    if (execution.conversationRef && !conversationIds.has(execution.conversationRef)) {
      diagnostics.push(semanticDiagnostic(
        'semantic/missing-reference',
        `RuntimeExecution ${execution.id} references missing Conversation ${execution.conversationRef}`,
        { id: execution.id },
        { conversationRef: execution.conversationRef },
        'use an exact projected Conversation ref or preserve the association as null',
      ));
    }
    checkEvidence(execution.id, execution.evidenceRefs);
  }

  for (const artifact of candidate.semanticFacts.artifactsOrEvidence) {
    if (artifact.projectId !== candidate.scope.projectId) {
      diagnostics.push(semanticDiagnostic(
        'semantic/scope-mismatch',
        `ArtifactOrEvidence ${artifact.id} is outside projection scope`,
        { id: artifact.id },
        { projectId: artifact.projectId, scope: candidate.scope.projectId },
        'compile only facts belonging to the projection project scope',
      ));
    }
    if (artifact.executionRef && !executionIds.has(artifact.executionRef)) {
      diagnostics.push(semanticDiagnostic(
        'semantic/missing-reference',
        `ArtifactOrEvidence ${artifact.id} references missing RuntimeExecution ${artifact.executionRef}`,
        { id: artifact.id },
        { executionRef: artifact.executionRef },
        'use an exact projected RuntimeExecution ref or omit the unsupported association',
      ));
    }
    checkEvidence(artifact.id, artifact.evidenceRefs);
  }

  for (const relation of candidate.semanticFacts.collaborationRelations) {
    checkEvidence(relation.id, relationEvidenceRefs(relation));
    if (relation.kind === 'parallel') {
      const members = new Set(relation.executionRefs);
      if (members.size < 2 || members.size !== relation.executionRefs.length) {
        diagnostics.push(semanticDiagnostic(
          'semantic/relation-members',
          `Parallel relation ${relation.id} requires at least two distinct executions`,
          { id: relation.id },
          { executionRefs: relation.executionRefs },
          'retain only explicit, distinct execution members from the same groupId',
        ));
      }
      for (const executionRef of members) {
        if (executionIds.has(executionRef)) continue;
        diagnostics.push(semanticDiagnostic(
          'semantic/missing-reference',
          `Parallel relation ${relation.id} references missing RuntimeExecution ${executionRef}`,
          { id: relation.id },
          { executionRef },
          'include only exact RuntimeExecution refs present in this projection',
        ));
      }
    } else {
      for (const executionRef of [relation.sourceExecutionRef, relation.targetExecutionRef]) {
        if (executionIds.has(executionRef)) continue;
        diagnostics.push(semanticDiagnostic(
          'semantic/missing-reference',
          `Handoff relation ${relation.id} references missing RuntimeExecution ${executionRef}`,
          { id: relation.id },
          { executionRef },
          'include only exact RuntimeExecution refs present in this projection',
        ));
      }
      const usedResult = artifactById.get(relation.usedResultRef);
      if (!usedResult) {
        diagnostics.push(semanticDiagnostic(
          'semantic/missing-reference',
          `Handoff relation ${relation.id} references missing result ${relation.usedResultRef}`,
          { id: relation.id },
          { usedResultRef: relation.usedResultRef },
          'reference the exact projected agent result selected for the handoff',
        ));
      } else if (usedResult.kind !== 'agent-result' || usedResult.executionRef !== relation.sourceExecutionRef) {
        diagnostics.push(semanticDiagnostic(
          'semantic/handoff-source',
          `Handoff relation ${relation.id} does not use a result owned by its source execution`,
          { id: relation.id },
          {
            usedResultRef: relation.usedResultRef,
            artifactKind: usedResult.kind,
            artifactExecutionRef: usedResult.executionRef,
            sourceExecutionRef: relation.sourceExecutionRef,
          },
          'use an exact agent-result artifact produced by the source RuntimeExecution',
        ));
      }
    }
  }

  const layoutTargets = new Set([
    `project:${candidate.scope.projectId}`,
    ...candidate.semanticFacts.conversations.map((item) => item.id),
    ...candidate.semanticFacts.runtimeExecutions.map((item) => item.id),
    ...candidate.semanticFacts.artifactsOrEvidence.map((item) => item.id),
  ]);
  for (const targetId of Object.keys(candidate.layoutState.nodePositions)) {
    if (layoutTargets.has(targetId)) continue;
    diagnostics.push(semanticDiagnostic(
      'semantic/layout-target',
      `Layout position targets an entity not present in the projection: ${targetId}`,
      { id: targetId },
      { targetId },
      'keep layout state keyed only by projected entities in this revision',
    ));
  }

  return diagnostics;
}
