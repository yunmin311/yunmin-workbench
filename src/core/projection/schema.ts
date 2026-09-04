import { z, type ZodIssue } from 'zod';
import type {
  ProjectionCandidateV0,
  ProjectionCandidateValidationV0,
  ProjectionDiagnosticV0,
} from './types';

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
  return {
    code: `schema/${issue.code}`,
    severity: 'error',
    message: issue.message.trim(),
    subject: { path: issue.path },
    evidence: { issue: issue.code },
    supportedFixes: issueFix(issue),
  };
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

