/**
 * ADAPT design principles from Archify
 * `archify/delta/architecture-delta.mjs` at commit
 * 06dd052602dd9a369e4d034e24faf0917b5a60c (MIT).
 *
 * Reused ideas, none of the diagram-specific code:
 *   - stable-id keyed entity matching (ADAPT)
 *   - canonical-by-stable-id array ordering (ADAPT)
 *   - structured failure return instead of throwing (ADAPT — the Foundation's
 *     `ProjectionDiagnosticV0` style is used instead of `ArchitectureDeltaError`)
 *   - proofLevel + limitations as first-class receipt shape (ADAPT — values
 *     adapted: only `verified-projection` is meaningful here)
 *   - separate semantic / layout / provenance booleans (ADAPT)
 *
 * REJECTED:
 *   - same-system-unproven hard fail when no shared id; spec requires that a
 *     matched Project scope is sufficient evidence of same system.
 *   - SVG annotation, rendering, side-by-side artifact.
 *   - "authored" / "revision-pinned" proof levels; v0 has no canonical repo
 *     SHA in Projection IR, only `sourceDigest`.
 *   - rename-by-label / move-by-geometry heuristics; spec forbids inferring
 *     identity from layout or non-stable signals.
 *   - any causal/risk/impact text.
 */

import type {
  ArtifactOrEvidenceProjectionV0,
  CollaborationRelationProjectionV0,
  ConversationProjectionV0,
  EvidenceRefV0,
  ProjectionDeltaArtifactOrEvidenceChangeV0,
  ProjectionDeltaChangesV0,
  ProjectionDeltaCollaborationRelationChangeV0,
  ProjectionDeltaConversationChangeV0,
  ProjectionDeltaEvidenceRefChangeV0,
  ProjectionDeltaFailureV0,
  ProjectionDeltaFieldChangeV0,
  ProjectionDeltaLayoutChangeV0,
  ProjectionDeltaResultV0,
  ProjectionDeltaRuntimeExecutionChangeV0,
  ProjectionDeltaSummaryArtifactCountsV0,
  ProjectionDeltaSummaryConversationCountsV0,
  ProjectionDeltaSummaryEvidenceCountsV0,
  ProjectionDeltaSummaryLayoutCountsV0,
  ProjectionDeltaSummaryRelationCountsV0,
  ProjectionDeltaSummaryRuntimeExecutionCountsV0,
  ProjectionDeltaSummaryV0,
  ProjectionDeltaV0,
  ProjectionDiagnosticV0,
  RuntimeExecutionProjectionV0,
  VerifiedProjectionRevisionV0,
} from './types';
import {
  PROJECTION_DELTA_COMPARATOR_VERSION,
  PROJECTION_DELTA_SCHEMA_VERSION,
} from './types';
import {
  computeProjectionLayoutHash,
  computeProjectionRevisionHash,
  computeProjectionSemanticHash,
  verifyProjectionCandidate,
} from './revision';

// ===== helpers =====

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function toIndex<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item] as const));
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function arraysOfSameElements(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedStrings(left);
  const b = sortedStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Deterministic structural equality. Object property insertion order does
 * not matter; arrays are element-compared by canonical-sort order when they
 * carry string IDs. No model logic; no JSON.stringify of untrusted shapes.
 */
function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!structuralEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (!structuralEqual((a as Record<string, unknown>)[aKeys[i]], (b as Record<string, unknown>)[bKeys[i]])) {
      return false;
    }
  }
  return true;
}

function failure(
  code: ProjectionDeltaFailureV0['code'],
  message: string,
  subject: Record<string, unknown>,
  evidence: Record<string, unknown>,
  supportedFixes: string[],
): ProjectionDeltaFailureV0 {
  return {
    ok: false,
    code,
    message,
    subject,
    evidence,
    supportedFixes,
  };
}

// ===== comparability gate =====

/**
 * Trust only verified projections. Re-uses Foundation's
 * `verifyProjectionCandidate` so the comparator never invents a second
 * hash/validator. Diagnostics are forwarded with a per-side prefix so the
 * main comparator can map Foundation codes onto the right Delta failure
 * code (duplicate-id stays `delta/duplicate-id`; everything else collapses
 * to `delta/invalid-revision`).
 */
function trustVerifiedRevision(
  side: 'base' | 'head',
  revision: VerifiedProjectionRevisionV0,
  diagnostics: ProjectionDiagnosticV0[],
): void {
  // Foundation's structural validator already rejects unknown fields and
  // schema mismatches. Strict schema means TS casts cannot smuggle extra
  // fields past `verifyProjectionCandidate`.
  const verified = verifyProjectionCandidate(revision.candidate, null, {
    recheckSourceDigest: () => revision.candidate.sourceBinding.sourceDigest,
  });
  if (!verified.current) {
    for (const diagnostic of verified.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        message: `${side} revision failed Workbench Verified Projection validation: ${diagnostic.message}`,
        subject: { side, ...diagnostic.subject },
        evidence: { side, ...diagnostic.evidence },
      });
    }
    return;
  }
  // Envelope integrity: hashes, revision id, sourceDigest must all match the
  // candidate Foundation actually computed.
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
    diagnostics.push({
      code: 'delta/invalid-revision',
      severity: 'error',
      message: `${side} revision envelope does not match its candidate after recomputation.`,
      subject: { side, revisionId: revision.revisionId },
      evidence: {
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
      supportedFixes: [
        'discard the revision and rebuild from Foundation; only verified revisions produced by Workbench are comparable',
      ],
    });
  }
}

function indexConversations(revision: VerifiedProjectionRevisionV0): Map<string, ConversationProjectionV0> {
  return toIndex(revision.candidate.semanticFacts.conversations);
}

function indexExecutions(revision: VerifiedProjectionRevisionV0): Map<string, RuntimeExecutionProjectionV0> {
  return toIndex(revision.candidate.semanticFacts.runtimeExecutions);
}

function indexRelations(revision: VerifiedProjectionRevisionV0): Map<string, CollaborationRelationProjectionV0> {
  return toIndex(revision.candidate.semanticFacts.collaborationRelations);
}

function indexArtifacts(revision: VerifiedProjectionRevisionV0): Map<string, ArtifactOrEvidenceProjectionV0> {
  return toIndex(revision.candidate.semanticFacts.artifactsOrEvidence);
}

function indexEvidence(revision: VerifiedProjectionRevisionV0): Map<string, EvidenceRefV0> {
  return toIndex(revision.candidate.semanticFacts.evidenceRefs);
}

// ===== per-collection comparators =====

interface ConversationChangeOutcomeV0 {
  changes: ProjectionDeltaConversationChangeV0[];
  counts: ProjectionDeltaSummaryConversationCountsV0;
  addedOrRemoved: boolean;
  contentChanged: boolean;
  evidenceOnlyChanged: boolean;
}

function conversationChanges(
  baseIndex: Map<string, ConversationProjectionV0>,
  headIndex: Map<string, ConversationProjectionV0>,
): ConversationChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryConversationCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaConversationChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  let addedOrRemoved = false;
  let contentChanged = false;
  let evidenceOnlyChanged = false;
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'added', classifications: ['identity-metadata'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'removed', classifications: ['identity-metadata'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'lifecycle' | 'task' | 'runtime' | 'attention' | 'identity-metadata' | 'evidence'>[] = [];
    if (base.lifecycleState !== head.lifecycleState) {
      changedFields.push({ path: 'lifecycleState', kind: 'lifecycle', before: base.lifecycleState, after: head.lifecycleState });
    }
    if (base.taskState !== head.taskState) {
      changedFields.push({ path: 'taskState', kind: 'task', before: base.taskState, after: head.taskState });
    }
    if (base.runtimeState !== head.runtimeState) {
      changedFields.push({ path: 'runtimeState', kind: 'runtime', before: base.runtimeState, after: head.runtimeState });
    }
    if (base.attentionState !== head.attentionState) {
      changedFields.push({ path: 'attentionState', kind: 'attention', before: base.attentionState, after: head.attentionState });
    }
    const identityBefore = {
      role: base.role,
      level: base.level ?? null,
      platform: base.platform,
      conversationKey: base.conversationKey,
      canonicalConversationId: base.canonicalConversationId ?? null,
    };
    const identityAfter = {
      role: head.role,
      level: head.level ?? null,
      platform: head.platform,
      conversationKey: head.conversationKey,
      canonicalConversationId: head.canonicalConversationId ?? null,
    };
    if (!structuralEqual(identityBefore, identityAfter)) {
      changedFields.push({ path: 'identity-metadata', kind: 'identity-metadata', before: identityBefore, after: identityAfter });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const onlyEvidence = changedFields.every((field) => field.kind === 'evidence');
      if (onlyEvidence) {
        evidenceOnlyChanged = true;
      } else {
        contentChanged = true;
      }
      const seenKinds = new Set<string>();
      const classifications: Array<'lifecycle' | 'task' | 'runtime' | 'attention' | 'identity-metadata' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seenKinds.has(field.kind)) continue;
        seenKinds.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts, addedOrRemoved, contentChanged, evidenceOnlyChanged };
}

interface ExecutionChangeOutcomeV0 {
  changes: ProjectionDeltaRuntimeExecutionChangeV0[];
  counts: ProjectionDeltaSummaryRuntimeExecutionCountsV0;
  addedOrRemoved: boolean;
  contentChanged: boolean;
  evidenceOnlyChanged: boolean;
}

function executionChanges(
  baseIndex: Map<string, RuntimeExecutionProjectionV0>,
  headIndex: Map<string, RuntimeExecutionProjectionV0>,
): ExecutionChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryRuntimeExecutionCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaRuntimeExecutionChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  let addedOrRemoved = false;
  let contentChanged = false;
  let evidenceOnlyChanged = false;
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'added', classifications: ['runtimeState'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'removed', classifications: ['runtimeState'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'runtimeState' | 'live' | 'binding' | 'intentState' | 'receipt' | 'conversationRef' | 'evidence'>[] = [];
    if (base.runtimeState !== head.runtimeState) {
      changedFields.push({ path: 'runtimeState', kind: 'runtimeState', before: base.runtimeState, after: head.runtimeState });
    }
    if (base.live !== head.live) {
      changedFields.push({ path: 'live', kind: 'live', before: base.live, after: head.live });
    }
    if (!structuralEqual(base.binding, head.binding)) {
      changedFields.push({ path: 'binding', kind: 'binding', before: base.binding, after: head.binding });
    }
    if (base.intentState !== head.intentState) {
      changedFields.push({ path: 'intentState', kind: 'intentState', before: base.intentState, after: head.intentState });
    }
    if (!structuralEqual(base.receipt, head.receipt)) {
      changedFields.push({ path: 'receipt', kind: 'receipt', before: base.receipt, after: head.receipt });
    }
    if ((base.conversationRef ?? null) !== (head.conversationRef ?? null)) {
      changedFields.push({ path: 'conversationRef', kind: 'conversationRef', before: base.conversationRef, after: head.conversationRef });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const onlyEvidence = changedFields.every((field) => field.kind === 'evidence');
      if (onlyEvidence) {
        evidenceOnlyChanged = true;
      } else {
        contentChanged = true;
      }
      const seenKinds = new Set<string>();
      const classifications: Array<'runtimeState' | 'live' | 'binding' | 'intentState' | 'receipt' | 'conversationRef' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seenKinds.has(field.kind)) continue;
        seenKinds.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts, addedOrRemoved, contentChanged, evidenceOnlyChanged };
}

interface RelationChangeOutcomeV0 {
  changes: ProjectionDeltaCollaborationRelationChangeV0[];
  counts: ProjectionDeltaSummaryRelationCountsV0;
  addedOrRemoved: boolean;
  semanticOrTopologyChanged: boolean;
  evidenceOnlyChanged: boolean;
}

function relationChanges(
  baseIndex: Map<string, CollaborationRelationProjectionV0>,
  headIndex: Map<string, CollaborationRelationProjectionV0>,
): RelationChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryRelationCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaCollaborationRelationChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  let addedOrRemoved = false;
  let semanticOrTopologyChanged = false;
  let evidenceOnlyChanged = false;
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      addedOrRemoved = true;
      semanticOrTopologyChanged = true;
      changes.push({ id, status: 'added', classifications: ['topology'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      addedOrRemoved = true;
      semanticOrTopologyChanged = true;
      changes.push({ id, status: 'removed', classifications: ['topology'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'topology' | 'semantic' | 'evidence'>[] = [];
    const markTopologyOrSemantic = () => {
      semanticOrTopologyChanged = true;
    };
    if (base.kind !== head.kind) {
      markTopologyOrSemantic();
      changedFields.push({ path: 'kind', kind: 'semantic', before: base.kind, after: head.kind });
    }
    if (base.kind === 'parallel' && head.kind === 'parallel') {
      if (!arraysOfSameElements(base.executionRefs, head.executionRefs)) {
        markTopologyOrSemantic();
        changedFields.push({
          path: 'executionRefs',
          kind: 'topology',
          before: sortedStrings(base.executionRefs),
          after: sortedStrings(head.executionRefs),
        });
      }
    } else if (base.kind === 'handoff' && head.kind === 'handoff') {
      if (base.sourceExecutionRef !== head.sourceExecutionRef) {
        markTopologyOrSemantic();
        changedFields.push({ path: 'sourceExecutionRef', kind: 'topology', before: base.sourceExecutionRef, after: head.sourceExecutionRef });
      }
      if (base.targetExecutionRef !== head.targetExecutionRef) {
        markTopologyOrSemantic();
        changedFields.push({ path: 'targetExecutionRef', kind: 'topology', before: base.targetExecutionRef, after: head.targetExecutionRef });
      }
      if (base.usedResultRef !== head.usedResultRef) {
        markTopologyOrSemantic();
        changedFields.push({ path: 'usedResultRef', kind: 'semantic', before: base.usedResultRef, after: head.usedResultRef });
      }
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const onlyEvidence = changedFields.every((field) => field.kind === 'evidence');
      if (onlyEvidence) {
        evidenceOnlyChanged = true;
      }
      const seenKinds = new Set<string>();
      const classifications: Array<'topology' | 'semantic' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seenKinds.has(field.kind)) continue;
        seenKinds.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts, addedOrRemoved, semanticOrTopologyChanged, evidenceOnlyChanged };
}

interface ArtifactChangeOutcomeV0 {
  changes: ProjectionDeltaArtifactOrEvidenceChangeV0[];
  counts: ProjectionDeltaSummaryArtifactCountsV0;
  addedOrRemoved: boolean;
  contentChanged: boolean;
  evidenceOnlyChanged: boolean;
}

function artifactChanges(
  baseIndex: Map<string, ArtifactOrEvidenceProjectionV0>,
  headIndex: Map<string, ArtifactOrEvidenceProjectionV0>,
): ArtifactChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryArtifactCountsV0 = { added: 0, removed: 0, changed: 0, evidenceChanged: 0 };
  const changes: ProjectionDeltaArtifactOrEvidenceChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  let addedOrRemoved = false;
  let contentChanged = false;
  let evidenceOnlyChanged = false;
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'added', classifications: ['content'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      addedOrRemoved = true;
      contentChanged = true;
      changes.push({ id, status: 'removed', classifications: ['content'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'content' | 'evidence'>[] = [];
    const contentBefore = {
      kind: base.kind,
      title: base.title,
      content: base.content ?? null,
      executionRef: base.executionRef ?? null,
      eventRef: base.eventRef ?? null,
    };
    const contentAfter = {
      kind: head.kind,
      title: head.title,
      content: head.content ?? null,
      executionRef: head.executionRef ?? null,
      eventRef: head.eventRef ?? null,
    };
    if (!structuralEqual(contentBefore, contentAfter)) {
      contentChanged = true;
      changedFields.push({ path: 'content', kind: 'content', before: contentBefore, after: contentAfter });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length === 0) continue;
    const onlyEvidence = changedFields.every((field) => field.kind === 'evidence');
    counts.changed += onlyEvidence ? 0 : 1;
    counts.evidenceChanged += onlyEvidence ? 1 : 0;
    if (onlyEvidence) {
      evidenceOnlyChanged = true;
    }
    const seenKinds = new Set<string>();
    const classifications: Array<'content' | 'evidence'> = [];
    for (const field of changedFields) {
      if (seenKinds.has(field.kind)) continue;
      seenKinds.add(field.kind);
      classifications.push(field.kind);
    }
    changes.push({
      id,
      status: onlyEvidence ? 'evidence-changed' : 'changed',
      classifications,
      changedFields,
    });
  }
  return { changes, counts, addedOrRemoved, contentChanged, evidenceOnlyChanged };
}

interface EvidenceChangeOutcomeV0 {
  changes: ProjectionDeltaEvidenceRefChangeV0[];
  counts: ProjectionDeltaSummaryEvidenceCountsV0;
  provenanceChanged: boolean;
}

function evidenceChanges(
  baseIndex: Map<string, EvidenceRefV0>,
  headIndex: Map<string, EvidenceRefV0>,
): EvidenceChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryEvidenceCountsV0 = { changed: 0 };
  const changes: ProjectionDeltaEvidenceRefChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  let provenanceChanged = false;
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.changed += 1;
      provenanceChanged = true;
      changes.push({ id, status: 'added', classifications: ['source'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.changed += 1;
      provenanceChanged = true;
      changes.push({ id, status: 'removed', classifications: ['source'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'verification' | 'currentness' | 'revision' | 'source'>[] = [];
    if (base.verification !== head.verification) {
      changedFields.push({ path: 'verification', kind: 'verification', before: base.verification, after: head.verification });
    }
    if (base.currentness !== head.currentness) {
      changedFields.push({ path: 'currentness', kind: 'currentness', before: base.currentness, after: head.currentness });
    }
    if ((base.revision?.kind ?? null) !== (head.revision?.kind ?? null)
      || (base.revision?.value ?? null) !== (head.revision?.value ?? null)) {
      changedFields.push({
        path: 'revision',
        kind: 'revision',
        before: base.revision ?? null,
        after: head.revision ?? null,
      });
    }
    if (base.source !== head.source || base.sourceRef !== head.sourceRef) {
      changedFields.push({
        path: 'source',
        kind: 'source',
        before: { source: base.source, sourceRef: base.sourceRef },
        after: { source: head.source, sourceRef: head.sourceRef },
      });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      provenanceChanged = true;
      const seenKinds = new Set<string>();
      const classifications: Array<'verification' | 'currentness' | 'revision' | 'source'> = [];
      for (const field of changedFields) {
        if (seenKinds.has(field.kind)) continue;
        seenKinds.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts, provenanceChanged };
}

interface LayoutChangeOutcomeV0 {
  changes: ProjectionDeltaLayoutChangeV0[];
  counts: ProjectionDeltaSummaryLayoutCountsV0;
}

function layoutChanges(
  base: VerifiedProjectionRevisionV0,
  head: VerifiedProjectionRevisionV0,
): LayoutChangeOutcomeV0 {
  const counts: ProjectionDeltaSummaryLayoutCountsV0 = { moved: 0, viewportChanged: 0 };
  const changes: ProjectionDeltaLayoutChangeV0[] = [];
  const basePositions = base.candidate.layoutState.nodePositions;
  const headPositions = head.candidate.layoutState.nodePositions;
  const ids = sortedStrings([...Object.keys(basePositions), ...Object.keys(headPositions)]);
  for (const id of ids) {
    const basePos = basePositions[id];
    const headPos = headPositions[id];
    if (basePos === headPos) continue;
    if (!basePos || !headPos || basePos.x !== headPos.x || basePos.y !== headPos.y) {
      changes.push({
        id,
        status: 'moved',
        classifications: ['nodePosition'],
        changedFields: [{
          path: 'nodePosition',
          kind: 'nodePosition',
          before: basePos ?? null,
          after: headPos ?? null,
        }],
      });
      counts.moved += 1;
    }
  }
  const baseViewport = base.candidate.layoutState.viewport ?? null;
  const headViewport = head.candidate.layoutState.viewport ?? null;
  if (!structuralEqual(baseViewport, headViewport)) {
    changes.push({
      id: 'viewport',
      status: 'viewport-changed',
      classifications: ['viewport'],
      changedFields: [{
        path: 'viewport',
        kind: 'viewport',
        before: baseViewport,
        after: headViewport,
      }],
    });
    counts.viewportChanged += 1;
  }
  return { changes, counts };
}

// ===== main comparator =====

export function compareProjectionRevisions(
  base: VerifiedProjectionRevisionV0,
  head: VerifiedProjectionRevisionV0,
): ProjectionDeltaResultV0 {

  if (base.schemaVersion !== PROJECTION_DELTA_SCHEMA_VERSION
    || head.schemaVersion !== PROJECTION_DELTA_SCHEMA_VERSION) {
    return failure(
      'delta/schema-version-mismatch',
      'Projection Delta v0 only accepts VerifiedProjectionRevisionV0 (schemaVersion 0).',
      { baseSchemaVersion: base.schemaVersion, headSchemaVersion: head.schemaVersion },
      { expected: 0 },
      ['use two VerifiedProjectionRevisionV0 revisions produced by Workbench Verified Projection Foundation'],
    );
  }
  if (base.candidate.projectionKind !== head.candidate.projectionKind) {
    return failure(
      'delta/projection-kind-mismatch',
      `Projection kinds do not match: base='${base.candidate.projectionKind}', head='${head.candidate.projectionKind}'.`,
      { base: base.candidate.projectionKind, head: head.candidate.projectionKind },
      {},
      ['compare only revisions produced by the same Workbench projectionKind'],
    );
  }

  // Re-trust both sides against Foundation itself. Foundation's duplicate-id
  // diagnostic keeps its own Delta code so the comparator exposes it as a
  // real failure path instead of silently collapsing into invalid-revision.
  const diagnostics: ProjectionDiagnosticV0[] = [];
  trustVerifiedRevision('base', base, diagnostics);
  trustVerifiedRevision('head', head, diagnostics);
  if (diagnostics.length > 0) {
    const duplicate = diagnostics.find((d) => d.code === 'semantic/duplicate-id');
    const first = duplicate ?? diagnostics[0];
    const code: ProjectionDeltaFailureV0['code'] = duplicate
      ? 'delta/duplicate-id'
      : 'delta/invalid-revision';
    return failure(
      code,
      first.message,
      first.subject,
      first.evidence,
      first.supportedFixes,
    );
  }

  if (base.candidate.scope.projectId !== head.candidate.scope.projectId) {
    return failure(
      'delta/project-mismatch',
      `Projection scope projectId differs: base='${base.candidate.scope.projectId}', head='${head.candidate.scope.projectId}'.`,
      { base: base.candidate.scope.projectId, head: head.candidate.scope.projectId },
      {},
      ['compare only revisions of the same Project scope; cross-project Delta is rejected'],
    );
  }

  const baseConversations = indexConversations(base);
  const headConversations = indexConversations(head);
  const baseExecutions = indexExecutions(base);
  const headExecutions = indexExecutions(head);
  const baseRelations = indexRelations(base);
  const headRelations = indexRelations(head);
  const baseArtifacts = indexArtifacts(base);
  const headArtifacts = indexArtifacts(head);
  const baseEvidence = indexEvidence(base);
  const headEvidence = indexEvidence(head);

  const conversations = conversationChanges(baseConversations, headConversations);
  const runtimeExecutions = executionChanges(baseExecutions, headExecutions);
  const relations = relationChanges(baseRelations, headRelations);
  const artifacts = artifactChanges(baseArtifacts, headArtifacts);
  const evidence = evidenceChanges(baseEvidence, headEvidence);
  const layout = layoutChanges(base, head);

// semanticChanged: any added/removed or content / topology / state change.
// Evidence-only changes never set semanticChanged.
  const semanticChanged =
    conversations.addedOrRemoved
    || conversations.contentChanged
    || runtimeExecutions.addedOrRemoved
    || runtimeExecutions.contentChanged
    || relations.addedOrRemoved
    || relations.semanticOrTopologyChanged
    || artifacts.addedOrRemoved
    || artifacts.contentChanged;

  // provenanceChanged: EvidenceRef any change, OR a per-entity `evidence`
  // classification fired (including the evidence-only case). Plain lifecycle
  // / task / runtime / attention do not qualify.
  const conversationEvidenceTouched = conversations.changes.some((c) => c.classifications.includes('evidence'));
  const executionEvidenceTouched = runtimeExecutions.changes.some((c) => c.classifications.includes('evidence'));
  const relationEvidenceTouched = relations.changes.some((c) => c.classifications.includes('evidence'));
  const artifactEvidenceTouched = artifacts.changes.some((c) => c.classifications.includes('evidence'));
  const provenanceChanged =
    evidence.provenanceChanged
    || conversationEvidenceTouched
    || executionEvidenceTouched
    || relationEvidenceTouched
    || artifactEvidenceTouched;

  const layoutChanged = layout.counts.moved > 0 || layout.counts.viewportChanged > 0;

  const summary: ProjectionDeltaSummaryV0 = {
    conversations: conversations.counts,
    runtimeExecutions: runtimeExecutions.counts,
    relations: relations.counts,
    artifacts: artifacts.counts,
    evidence: evidence.counts,
    layout: layout.counts,
    semanticChanged,
    layoutChanged,
    provenanceChanged,
  };

  const changes: ProjectionDeltaChangesV0 = {
    conversations: conversations.changes,
    runtimeExecutions: runtimeExecutions.changes,
    collaborationRelations: relations.changes,
    artifactsOrEvidence: artifacts.changes,
    evidenceRefs: evidence.changes,
    layout: layout.changes,
  };

  const limitations = [
    'Workbench Projection Delta v0 is a deterministic field-level comparison of two verified revisions; it never infers runtime impact, downstream impact, causality, risk, or mergeability.',
    'A collection that shares no stable IDs between sides is reported as added / removed only; rename-by-label and move-by-geometry heuristics are deliberately rejected.',
    'Object-valued fields are compared structurally: two separately-built yet semantically identical bindings, receipts, and viewports do not produce a phantom Delta.',
    'summary booleans are derived strictly from per-entity classifications: evidence-only changes set provenanceChanged but not semanticChanged; layout-only changes set layoutChanged but not semanticChanged.',
  ];

  const delta: ProjectionDeltaV0 = {
    ok: true,
    schemaVersion: PROJECTION_DELTA_SCHEMA_VERSION,
    comparatorVersion: PROJECTION_DELTA_COMPARATOR_VERSION,
    projectId: base.candidate.scope.projectId,
    baseRevisionId: base.revisionId,
    headRevisionId: head.revisionId,
    baseSemanticHash: base.semanticHash,
    headSemanticHash: head.semanticHash,
    baseLayoutHash: base.layoutHash,
    headLayoutHash: head.layoutHash,
    baseSourceDigest: base.sourceDigest,
    headSourceDigest: head.sourceDigest,
    proofLevel: 'verified-projection',
    identity: {
      conversations: 'id',
      runtimeExecutions: 'id',
      collaborationRelations: 'id',
      artifactsOrEvidence: 'id',
      evidenceRefs: 'id',
      layoutNodes: 'id',
    },
    summary,
    changes,
    limitations,
  };
  return delta;
}