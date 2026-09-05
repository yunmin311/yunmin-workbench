/**
 * ADAPT design principles from Archify
 * `archify/.../evidence-console` and related passport surfaces at commit
 * 06dd052602dd9a369e4d034e24faef0917b5a60c (MIT).
 *
 * Reused ideas, none of the diagram-specific code:
 *   - focused proof/details surface keyed by stable entity identity (ADAPT)
 *   - progressive disclosure: identity / current / evidence / changes (ADAPT)
 *   - viewer-layer evidence separated from canonical visual truth (ADAPT)
 *   - structured failure codes that mirror ProjectionDiagnosticV0 (ADAPT)
 *
 * REJECTED:
 *   - Archify diagram component schemas, Node Finder, reachability, repo-root
 *     line verification, branding, SVG/HTML Passport renderer.
 *   - repository evidence framework; this stage has no repo proof of its own.
 *   - AI explanation, risk/impact/causality inference, conversation aliases,
 *     revision DB, Canvas redesign, Reach/Route.
 *
 * No Archify source code is copied in this stage; THIRD_PARTY_NOTICES.md
 * needs no update.
 */

import type {
  ArtifactOrEvidenceProjectionV0,
  CollaborationRelationProjectionV0,
  ConversationProjectionV0,
  EvidenceRefV0,
  ProjectionDeltaV0,
  RuntimeExecutionProjectionV0,
  SemanticPassportCurrentV0,
  SemanticPassportDeltaChangeV0,
  SemanticPassportEntityKindV0,
  SemanticPassportEntityRefV0,
  SemanticPassportEvidenceEntryV0,
  SemanticPassportFailureV0,
  SemanticPassportIdentityV0,
  SemanticPassportResultV0,
  SemanticPassportV0,
  VerifiedProjectionRevisionV0,
} from './types';
import { SEMANTIC_PASSPORT_SCHEMA_VERSION } from './types';
import {
  computeProjectionLayoutHash,
  computeProjectionRevisionHash,
  computeProjectionSemanticHash,
} from './revision';

function failure(
  code: SemanticPassportFailureV0['code'],
  message: string,
  subject: Record<string, unknown>,
  evidence: Record<string, unknown>,
  supportedFixes: string[],
): SemanticPassportFailureV0 {
  return { ok: false, code, message, subject, evidence, supportedFixes };
}

function toEvidenceEntry(evidence: EvidenceRefV0): SemanticPassportEvidenceEntryV0 {
  return {
    id: evidence.id,
    source: evidence.source,
    sourceRef: evidence.sourceRef,
    verification: evidence.verification,
    currentness: evidence.currentness,
    ...(evidence.revision ? { revision: evidence.revision } : {}),
  };
}

function lookupEntity(
  revision: VerifiedProjectionRevisionV0,
  ref: SemanticPassportEntityRefV0,
):
  | { kind: 'conversation'; entity: ConversationProjectionV0 }
  | { kind: 'runtimeExecution'; entity: RuntimeExecutionProjectionV0 }
  | { kind: 'collaborationRelation'; entity: CollaborationRelationProjectionV0 }
  | { kind: 'artifactOrEvidence'; entity: ArtifactOrEvidenceProjectionV0 }
  | { kind: 'evidence'; entity: EvidenceRefV0 }
  | null {
  const facts = revision.candidate.semanticFacts;
  switch (ref.kind) {
    case 'conversation': {
      const entity = facts.conversations.find((item) => item.id === ref.id);
      return entity ? { kind: 'conversation', entity } : null;
    }
    case 'runtimeExecution': {
      const entity = facts.runtimeExecutions.find((item) => item.id === ref.id);
      return entity ? { kind: 'runtimeExecution', entity } : null;
    }
    case 'collaborationRelation': {
      const entity = facts.collaborationRelations.find((item) => item.id === ref.id);
      return entity ? { kind: 'collaborationRelation', entity } : null;
    }
    case 'artifactOrEvidence': {
      const entity = facts.artifactsOrEvidence.find((item) => item.id === ref.id);
      return entity ? { kind: 'artifactOrEvidence', entity } : null;
    }
    case 'evidence': {
      const entity = facts.evidenceRefs.find((item) => item.id === ref.id);
      return entity ? { kind: 'evidence', entity } : null;
    }
  }
}

function buildIdentity(
  found: NonNullable<ReturnType<typeof lookupEntity>>,
): SemanticPassportIdentityV0 {
  switch (found.kind) {
    case 'conversation':
      return {
        kind: 'conversation',
        id: found.entity.id,
        conversationKey: found.entity.conversationKey,
        ...(found.entity.canonicalConversationId
          ? { canonicalConversationId: found.entity.canonicalConversationId }
          : {}),
        role: found.entity.role,
        platform: found.entity.platform,
      };
    case 'runtimeExecution':
      return {
        kind: 'runtimeExecution',
        id: found.entity.id,
        executionId: found.entity.executionId,
        nativeRef: found.entity.nativeRef,
        harness: found.entity.harness,
        conversationRef: found.entity.conversationRef,
      };
    case 'collaborationRelation':
      return {
        kind: 'collaborationRelation',
        id: found.entity.id,
        relationKind: found.entity.kind,
      };
    case 'artifactOrEvidence':
      return {
        kind: 'artifactOrEvidence',
        id: found.entity.id,
        artifactKind: found.entity.kind,
        ...(found.entity.executionRef ? { executionRef: found.entity.executionRef } : {}),
        ...(found.entity.eventRef ? { eventRef: found.entity.eventRef } : {}),
      };
    case 'evidence':
      return {
        kind: 'evidence',
        id: found.entity.id,
        source: found.entity.source,
        sourceRef: found.entity.sourceRef,
      };
  }
}

function buildCurrent(
  found: NonNullable<ReturnType<typeof lookupEntity>>,
): SemanticPassportCurrentV0 {
  switch (found.kind) {
    case 'conversation':
      return {
        kind: 'conversation',
        lifecycleState: found.entity.lifecycleState,
        taskState: found.entity.taskState,
        runtimeState: found.entity.runtimeState,
        attentionState: found.entity.attentionState,
        verification: found.entity.verification,
      };
    case 'runtimeExecution':
      return {
        kind: 'runtimeExecution',
        runtimeState: found.entity.runtimeState,
        live: found.entity.live,
        intentState: found.entity.intentState,
        receipt: found.entity.receipt,
        binding: found.entity.binding,
      };
    case 'collaborationRelation': {
      if (found.entity.kind === 'parallel') {
        return {
          kind: 'collaborationRelation',
          relationKind: 'parallel',
          executionRefs: [...found.entity.executionRefs].sort(),
        };
      }
      return {
        kind: 'collaborationRelation',
        relationKind: 'handoff',
        sourceExecutionRef: found.entity.sourceExecutionRef,
        targetExecutionRef: found.entity.targetExecutionRef,
        usedResultRef: found.entity.usedResultRef,
      };
    }
    case 'artifactOrEvidence':
      return {
        kind: 'artifactOrEvidence',
        title: found.entity.title,
        ...(found.entity.content !== undefined ? { content: found.entity.content } : {}),
        ...(found.entity.executionRef ? { executionRef: found.entity.executionRef } : {}),
        ...(found.entity.eventRef ? { eventRef: found.entity.eventRef } : {}),
      };
    case 'evidence':
      return {
        kind: 'evidence',
        verification: found.entity.verification,
        currentness: found.entity.currentness,
        source: found.entity.source,
        sourceRef: found.entity.sourceRef,
        ...(found.entity.revision ? { revision: found.entity.revision } : {}),
      };
  }
}

function entityEvidenceRefs(
  found: NonNullable<ReturnType<typeof lookupEntity>>,
): string[] {
  switch (found.kind) {
    case 'conversation':
      return [...found.entity.evidenceRefs];
    case 'runtimeExecution':
      return [...found.entity.evidenceRefs];
    case 'collaborationRelation':
      return [...found.entity.evidenceRefs];
    case 'artifactOrEvidence':
      return [...found.entity.evidenceRefs];
    case 'evidence':
      // Evidence is the evidence; it references its own source only, not
      // a higher-level evidenceRefs array. Surface the evidence's own
      // sourceRef in a single-entry list for caller convenience.
      return [found.entity.id];
  }
}

function extractDelta(
  delta: ProjectionDeltaV0,
  ref: SemanticPassportEntityRefV0,
): SemanticPassportDeltaChangeV0 {
  type Raw = {
    status: 'added' | 'removed' | 'changed' | 'evidence-changed';
    classifications: readonly string[];
    changedFields: ReadonlyArray<{ path: string; kind: string; before: unknown; after: unknown }>;
  } | null;
  const find = (rows: ReadonlyArray<Raw>): Raw => rows.find((row) => (row as { id?: string }).id === ref.id) ?? null;
  let change: Raw = null;
  switch (ref.kind) {
    case 'conversation':
      change = find(delta.changes.conversations as unknown as ReadonlyArray<Raw>);
      break;
    case 'runtimeExecution':
      change = find(delta.changes.runtimeExecutions as unknown as ReadonlyArray<Raw>);
      break;
    case 'collaborationRelation':
      change = find(delta.changes.collaborationRelations as unknown as ReadonlyArray<Raw>);
      break;
    case 'artifactOrEvidence':
      change = find(delta.changes.artifactsOrEvidence as unknown as ReadonlyArray<Raw>);
      break;
    case 'evidence':
      change = find(delta.changes.evidenceRefs as unknown as ReadonlyArray<Raw>);
      break;
  }
  if (!change) return null;
  return {
    status: change.status,
    classifications: [...change.classifications].sort(),
    changedFields: change.changedFields.map((field) => ({
      path: field.path,
      kind: field.kind,
      before: field.before,
      after: field.after,
    })),
  };
}

const PASSPORT_LIMITATIONS = [
  'Workbench Semantic Passport v0 is a read-only proof surface; it never edits the source revision, never infers impact, causality, or risk, and never falls back to raw Snapshot / Activity / Governance files.',
  'entity identity, current state, and evidence are taken verbatim from the active VerifiedProjectionRevisionV0. UNKNOWN is preserved as UNKNOWN and never fabricated.',
  'When a ProjectionDeltaV0 is supplied, the per-entity slice is the exact field-level row from the Delta; classifications and changed fields are copied, never summarized.',
];

export function buildSemanticPassport(
  revision: VerifiedProjectionRevisionV0,
  ref: SemanticPassportEntityRefV0,
  delta?: ProjectionDeltaV0,
): SemanticPassportResultV0 {
  if (revision.schemaVersion !== 0) {
    return failure(
      'passport/invalid-revision',
      'Semantic Passport v0 requires a VerifiedProjectionRevisionV0 (schemaVersion 0).',
      { revisionSchemaVersion: revision.schemaVersion },
      { expected: 0 },
      ['open a Passport only on a verified projection revision produced by Workbench Verified Projection Foundation'],
    );
  }
  // Envelope integrity: the candidate hashes Foundation would have computed
  // must equal the hashes on the envelope. We re-run the same pure helpers
  // Delta uses, so the comparator and Passport stay consistent and the
  // check needs no system clock.
  const recomputedSemantic = computeProjectionSemanticHash(revision.candidate);
  const recomputedLayout = computeProjectionLayoutHash(revision.candidate);
  const recomputedRevision = computeProjectionRevisionHash({
    scope: revision.candidate.scope,
    sourceDigest: revision.candidate.sourceBinding.sourceDigest,
    semanticHash: recomputedSemantic,
    layoutHash: recomputedLayout,
  });
  const recomputedRevisionId = `projection:${recomputedRevision}`;
  if (recomputedSemantic !== revision.semanticHash
    || recomputedLayout !== revision.layoutHash
    || recomputedRevision !== revision.revisionHash
    || recomputedRevisionId !== revision.revisionId
    || revision.candidate.sourceBinding.sourceDigest !== revision.sourceDigest) {
    return failure(
      'passport/invalid-revision',
      'Semantic Passport v0 refuses a revision whose envelope does not match its candidate after recomputation.',
      { revisionId: revision.revisionId },
      {
        revisionSemanticHash: revision.semanticHash,
        recomputedSemanticHash: recomputedSemantic,
        revisionLayoutHash: revision.layoutHash,
        recomputedLayoutHash: recomputedLayout,
        revisionRevisionHash: revision.revisionHash,
        recomputedRevisionHash: recomputedRevision,
        revisionRevisionId: revision.revisionId,
        recomputedRevisionId,
        revisionSourceDigest: revision.sourceDigest,
        candidateSourceDigest: revision.candidate.sourceBinding.sourceDigest,
      },
      ['discard the revision and rebuild from Foundation; only verified revisions produced by Workbench are passable'],
    );
  }
  if (delta) {
    if (delta.projectId !== revision.candidate.scope.projectId) {
      return failure(
        'passport/delta-mismatch',
        `Projection Delta projectId does not match the Passport revision projectId: delta='${delta.projectId}', revision='${revision.candidate.scope.projectId}'.`,
        { deltaProjectId: delta.projectId, revisionProjectId: revision.candidate.scope.projectId },
        {},
        ['pass a Delta whose projectId equals the active verified revision scope'],
      );
    }
    if (delta.headRevisionId !== revision.revisionId) {
      return failure(
        'passport/delta-mismatch',
        `Projection Delta headRevisionId does not match the Passport revision: delta='${delta.headRevisionId}', revision='${revision.revisionId}'.`,
        { deltaHeadRevisionId: delta.headRevisionId, revisionId: revision.revisionId },
        {},
        ['pass a Delta whose headRevisionId equals the active verified revision'],
      );
    }
  }

  const found = lookupEntity(revision, ref);
  if (!found) {
    return failure(
      'passport/entity-not-found',
      `Semantic Passport could not find entity '${ref.id}' of kind '${ref.kind}' in revision '${revision.revisionId}'.`,
      { kind: ref.kind, id: ref.id, revisionId: revision.revisionId },
      {},
      ['pick a stable id that already exists in the active verified projection'],
    );
  }

  const evidenceById = new Map(
    revision.candidate.semanticFacts.evidenceRefs.map((item) => [item.id, item] as const),
  );
  const evidenceEntries: SemanticPassportEvidenceEntryV0[] = [];
  for (const refId of entityEvidenceRefs(found)) {
    const evidence = evidenceById.get(refId);
    if (!evidence) {
      return failure(
        'passport/evidence-missing',
        `Entity '${ref.id}' references evidence '${refId}' that is not present in revision '${revision.revisionId}'.`,
        { entityId: ref.id, evidenceId: refId, revisionId: revision.revisionId },
        {},
        ['reject the upstream candidate; verified revisions must have every entity.evidenceRef resolvable'],
      );
    }
    evidenceEntries.push(toEvidenceEntry(evidence));
  }
  evidenceEntries.sort((left, right) => left.id.localeCompare(right.id));

  const passport: SemanticPassportV0 = {
    ok: true,
    schemaVersion: SEMANTIC_PASSPORT_SCHEMA_VERSION,
    projectId: revision.candidate.scope.projectId,
    revisionId: revision.revisionId,
    entityRef: ref,
    entityType: ref.kind,
    identity: buildIdentity(found),
    current: buildCurrent(found),
    evidence: evidenceEntries,
    delta: delta ? extractDelta(delta, ref) : null,
    deltaRevisionId: delta ? delta.headRevisionId : null,
    limitations: [...PASSPORT_LIMITATIONS],
  };
  return passport;
}