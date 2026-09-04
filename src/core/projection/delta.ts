/**
 * ADAPT design principles from Archify
 * `archify/delta/architecture-delta.mjs` at commit
 * 06dd052602dd9a369e4d034e24faef0917b5a60c (MIT).
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

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function sortedIds<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort(byId);
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

function strictEquals(a: unknown, b: unknown): boolean {
  return a === b;
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

function checkRevisionsForDuplicates(
  revision: VerifiedProjectionRevisionV0,
  diagnostics: ProjectionDiagnosticV0[],
): void {
  const seen = new Set<string>();
  for (const conversation of revision.candidate.semanticFacts.conversations) {
    if (seen.has(conversation.id)) diagnostics.push(makeDuplicateDiagnostic(conversation.id));
    seen.add(conversation.id);
  }
  for (const execution of revision.candidate.semanticFacts.runtimeExecutions) {
    if (seen.has(execution.id)) diagnostics.push(makeDuplicateDiagnostic(execution.id));
    seen.add(execution.id);
  }
  for (const relation of revision.candidate.semanticFacts.collaborationRelations) {
    if (seen.has(relation.id)) diagnostics.push(makeDuplicateDiagnostic(relation.id));
    seen.add(relation.id);
  }
  for (const artifact of revision.candidate.semanticFacts.artifactsOrEvidence) {
    if (seen.has(artifact.id)) diagnostics.push(makeDuplicateDiagnostic(artifact.id));
    seen.add(artifact.id);
  }
  for (const evidence of revision.candidate.semanticFacts.evidenceRefs) {
    if (seen.has(evidence.id)) diagnostics.push(makeDuplicateDiagnostic(evidence.id));
    seen.add(evidence.id);
  }
}

function makeDuplicateDiagnostic(id: string): ProjectionDiagnosticV0 {
  return {
    code: 'delta/duplicate-id',
    severity: 'error',
    message: `Projection semantic ID appears more than once across collections: ${id}`,
    subject: { id },
    evidence: { duplicatedId: id },
    supportedFixes: ['reject the candidate upstream; verified revisions are required to have stable unique IDs'],
  };
}

function indexConversations(revision: VerifiedProjectionRevisionV0): Map<string, ConversationProjectionV0> {
  return toIndex(sortedIds(revision.candidate.semanticFacts.conversations));
}

function indexExecutions(revision: VerifiedProjectionRevisionV0): Map<string, RuntimeExecutionProjectionV0> {
  return toIndex(sortedIds(revision.candidate.semanticFacts.runtimeExecutions));
}

function indexRelations(revision: VerifiedProjectionRevisionV0): Map<string, CollaborationRelationProjectionV0> {
  return toIndex(sortedIds(revision.candidate.semanticFacts.collaborationRelations));
}

function indexArtifacts(revision: VerifiedProjectionRevisionV0): Map<string, ArtifactOrEvidenceProjectionV0> {
  return toIndex(sortedIds(revision.candidate.semanticFacts.artifactsOrEvidence));
}

function indexEvidence(revision: VerifiedProjectionRevisionV0): Map<string, EvidenceRefV0> {
  return toIndex(sortedIds(revision.candidate.semanticFacts.evidenceRefs));
}

function conversationChanges(
  baseIndex: Map<string, ConversationProjectionV0>,
  headIndex: Map<string, ConversationProjectionV0>,
): { changes: ProjectionDeltaConversationChangeV0[]; counts: ProjectionDeltaSummaryConversationCountsV0 } {
  const counts: ProjectionDeltaSummaryConversationCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaConversationChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      changes.push({
        id,
        status: 'added',
        classifications: ['identity-metadata'],
        changedFields: [],
      });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      changes.push({
        id,
        status: 'removed',
        classifications: ['identity-metadata'],
        changedFields: [],
      });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'lifecycle' | 'task' | 'runtime' | 'attention' | 'identity-metadata' | 'evidence'>[] = [];
    if (!strictEquals(base.lifecycleState, head.lifecycleState)) {
      changedFields.push({ path: 'lifecycleState', kind: 'lifecycle', before: base.lifecycleState, after: head.lifecycleState });
    }
    if (!strictEquals(base.taskState, head.taskState)) {
      changedFields.push({ path: 'taskState', kind: 'task', before: base.taskState, after: head.taskState });
    }
    if (!strictEquals(base.runtimeState, head.runtimeState)) {
      changedFields.push({ path: 'runtimeState', kind: 'runtime', before: base.runtimeState, after: head.runtimeState });
    }
    if (!strictEquals(base.attentionState, head.attentionState)) {
      changedFields.push({ path: 'attentionState', kind: 'attention', before: base.attentionState, after: head.attentionState });
    }
    if (!strictEquals(base.role, head.role)
      || !strictEquals(base.level ?? null, head.level ?? null)
      || !strictEquals(base.platform, head.platform)
      || !strictEquals(base.conversationKey, head.conversationKey)
      || !strictEquals(base.canonicalConversationId ?? null, head.canonicalConversationId ?? null)) {
      changedFields.push({
        path: 'identity-metadata',
        kind: 'identity-metadata',
        before: {
          role: base.role,
          level: base.level ?? null,
          platform: base.platform,
          conversationKey: base.conversationKey,
          canonicalConversationId: base.canonicalConversationId ?? null,
        },
        after: {
          role: head.role,
          level: head.level ?? null,
          platform: head.platform,
          conversationKey: head.conversationKey,
          canonicalConversationId: head.canonicalConversationId ?? null,
        },
      });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({
        path: 'evidenceRefs',
        kind: 'evidence',
        before: sortedStrings(base.evidenceRefs),
        after: sortedStrings(head.evidenceRefs),
      });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const seen = new Set<string>();
      const classifications: Array<'lifecycle' | 'task' | 'runtime' | 'attention' | 'identity-metadata' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seen.has(field.kind)) continue;
        seen.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts };
}

function executionChanges(
  baseIndex: Map<string, RuntimeExecutionProjectionV0>,
  headIndex: Map<string, RuntimeExecutionProjectionV0>,
): { changes: ProjectionDeltaRuntimeExecutionChangeV0[]; counts: ProjectionDeltaSummaryRuntimeExecutionCountsV0 } {
  const counts: ProjectionDeltaSummaryRuntimeExecutionCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaRuntimeExecutionChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      changes.push({ id, status: 'added', classifications: ['runtimeState'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      changes.push({ id, status: 'removed', classifications: ['runtimeState'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'runtimeState' | 'live' | 'binding' | 'intentState' | 'receipt' | 'conversationRef' | 'evidence'>[] = [];
    if (!strictEquals(base.runtimeState, head.runtimeState)) {
      changedFields.push({ path: 'runtimeState', kind: 'runtimeState', before: base.runtimeState, after: head.runtimeState });
    }
    if (!strictEquals(base.live, head.live)) {
      changedFields.push({ path: 'live', kind: 'live', before: base.live, after: head.live });
    }
    if (!strictEquals(base.binding, head.binding)) {
      changedFields.push({ path: 'binding', kind: 'binding', before: base.binding, after: head.binding });
    }
    if (!strictEquals(base.intentState, head.intentState)) {
      changedFields.push({ path: 'intentState', kind: 'intentState', before: base.intentState, after: head.intentState });
    }
    if (!strictEquals(base.receipt, head.receipt)) {
      changedFields.push({ path: 'receipt', kind: 'receipt', before: base.receipt, after: head.receipt });
    }
    if (!strictEquals(base.conversationRef, head.conversationRef)) {
      changedFields.push({ path: 'conversationRef', kind: 'conversationRef', before: base.conversationRef, after: head.conversationRef });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const seen = new Set<string>();
      const classifications: Array<'runtimeState' | 'live' | 'binding' | 'intentState' | 'receipt' | 'conversationRef' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seen.has(field.kind)) continue;
        seen.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts };
}

function relationChanges(
  baseIndex: Map<string, CollaborationRelationProjectionV0>,
  headIndex: Map<string, CollaborationRelationProjectionV0>,
): { changes: ProjectionDeltaCollaborationRelationChangeV0[]; counts: ProjectionDeltaSummaryRelationCountsV0 } {
  const counts: ProjectionDeltaSummaryRelationCountsV0 = { added: 0, removed: 0, changed: 0 };
  const changes: ProjectionDeltaCollaborationRelationChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      changes.push({ id, status: 'added', classifications: ['topology'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      changes.push({ id, status: 'removed', classifications: ['topology'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'topology' | 'semantic' | 'evidence'>[] = [];
    if (base.kind !== head.kind) {
      changedFields.push({ path: 'kind', kind: 'semantic', before: base.kind, after: head.kind });
    }
    if (base.kind === 'parallel' && head.kind === 'parallel') {
      if (!arraysOfSameElements(base.executionRefs, head.executionRefs)) {
        changedFields.push({
          path: 'executionRefs',
          kind: 'topology',
          before: sortedStrings(base.executionRefs),
          after: sortedStrings(head.executionRefs),
        });
      }
    } else if (base.kind === 'handoff' && head.kind === 'handoff') {
      if (!strictEquals(base.sourceExecutionRef, head.sourceExecutionRef)) {
        changedFields.push({ path: 'sourceExecutionRef', kind: 'topology', before: base.sourceExecutionRef, after: head.sourceExecutionRef });
      }
      if (!strictEquals(base.targetExecutionRef, head.targetExecutionRef)) {
        changedFields.push({ path: 'targetExecutionRef', kind: 'topology', before: base.targetExecutionRef, after: head.targetExecutionRef });
      }
      if (!strictEquals(base.usedResultRef, head.usedResultRef)) {
        changedFields.push({ path: 'usedResultRef', kind: 'semantic', before: base.usedResultRef, after: head.usedResultRef });
      }
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const seen = new Set<string>();
      const classifications: Array<'topology' | 'semantic' | 'evidence'> = [];
      for (const field of changedFields) {
        if (seen.has(field.kind)) continue;
        seen.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts };
}

function artifactChanges(
  baseIndex: Map<string, ArtifactOrEvidenceProjectionV0>,
  headIndex: Map<string, ArtifactOrEvidenceProjectionV0>,
): { changes: ProjectionDeltaArtifactOrEvidenceChangeV0[]; counts: ProjectionDeltaSummaryArtifactCountsV0 } {
  const counts: ProjectionDeltaSummaryArtifactCountsV0 = { added: 0, removed: 0, changed: 0, evidenceChanged: 0 };
  const changes: ProjectionDeltaArtifactOrEvidenceChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.added += 1;
      changes.push({ id, status: 'added', classifications: ['content'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.removed += 1;
      changes.push({ id, status: 'removed', classifications: ['content'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'content' | 'evidence'>[] = [];
    if (!strictEquals(base.title, head.title)
      || !strictEquals(base.content ?? null, head.content ?? null)
      || !strictEquals(base.kind, head.kind)
      || !strictEquals(base.executionRef ?? null, head.executionRef ?? null)
      || !strictEquals(base.eventRef ?? null, head.eventRef ?? null)) {
      changedFields.push({ path: 'content', kind: 'content', before: serializeContentForArtifact(base), after: serializeContentForArtifact(head) });
    }
    if (!arraysOfSameElements(base.evidenceRefs, head.evidenceRefs)) {
      changedFields.push({ path: 'evidenceRefs', kind: 'evidence', before: sortedStrings(base.evidenceRefs), after: sortedStrings(head.evidenceRefs) });
    }
    if (changedFields.length === 0) continue;
    const onlyEvidence = changedFields.every((field) => field.kind === 'evidence');
    counts.changed += onlyEvidence ? 0 : 1;
    counts.evidenceChanged += onlyEvidence ? 1 : 0;
    const seen = new Set<string>();
    const classifications: ('content' | 'evidence')[] = [];
    for (const field of changedFields) {
      if (seen.has(field.kind)) continue;
      seen.add(field.kind);
      classifications.push(field.kind);
    }
    changes.push({
      id,
      status: onlyEvidence ? 'evidence-changed' : 'changed',
      classifications,
      changedFields,
    });
  }
  return { changes, counts };
}

function serializeContentForArtifact(artifact: ArtifactOrEvidenceProjectionV0): Record<string, unknown> {
  return {
    kind: artifact.kind,
    title: artifact.title,
    content: artifact.content ?? null,
    executionRef: artifact.executionRef ?? null,
    eventRef: artifact.eventRef ?? null,
  };
}

function evidenceChanges(
  baseIndex: Map<string, EvidenceRefV0>,
  headIndex: Map<string, EvidenceRefV0>,
): { changes: ProjectionDeltaEvidenceRefChangeV0[]; counts: ProjectionDeltaSummaryEvidenceCountsV0 } {
  const counts: ProjectionDeltaSummaryEvidenceCountsV0 = { changed: 0 };
  const changes: ProjectionDeltaEvidenceRefChangeV0[] = [];
  const ids = sortedStrings([...baseIndex.keys(), ...headIndex.keys()]);
  for (const id of ids) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base && head) {
      counts.changed += 1;
      changes.push({ id, status: 'added', classifications: ['source'], changedFields: [] });
      continue;
    }
    if (base && !head) {
      counts.changed += 1;
      changes.push({ id, status: 'removed', classifications: ['source'], changedFields: [] });
      continue;
    }
    if (!base || !head) continue;
    const changedFields: ProjectionDeltaFieldChangeV0<'verification' | 'currentness' | 'revision' | 'source'>[] = [];
    if (!strictEquals(base.verification, head.verification)) {
      changedFields.push({ path: 'verification', kind: 'verification', before: base.verification, after: head.verification });
    }
    if (!strictEquals(base.currentness, head.currentness)) {
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
    if (!strictEquals(base.source, head.source) || !strictEquals(base.sourceRef, head.sourceRef)) {
      changedFields.push({
        path: 'source',
        kind: 'source',
        before: { source: base.source, sourceRef: base.sourceRef },
        after: { source: head.source, sourceRef: head.sourceRef },
      });
    }
    if (changedFields.length > 0) {
      counts.changed += 1;
      const seen = new Set<string>();
      const classifications: Array<'verification' | 'currentness' | 'revision' | 'source'> = [];
      for (const field of changedFields) {
        if (seen.has(field.kind)) continue;
        seen.add(field.kind);
        classifications.push(field.kind);
      }
      changes.push({ id, status: 'changed', classifications, changedFields });
    }
  }
  return { changes, counts };
}

function layoutChanges(
  base: VerifiedProjectionRevisionV0,
  head: VerifiedProjectionRevisionV0,
): { changes: ProjectionDeltaLayoutChangeV0[]; counts: ProjectionDeltaSummaryLayoutCountsV0 } {
  const counts: ProjectionDeltaSummaryLayoutCountsV0 = { moved: 0, viewportChanged: 0 };
  const changes: ProjectionDeltaLayoutChangeV0[] = [];
  const basePositions = base.candidate.layoutState.nodePositions;
  const headPositions = head.candidate.layoutState.nodePositions;
  const ids = sortedStrings([...Object.keys(basePositions), ...Object.keys(headPositions)]);
  for (const id of ids) {
    const basePos = basePositions[id];
    const headPos = headPositions[id];
    if (!basePos && !headPos) continue;
    if (!basePos || !headPos) {
      changes.push({ id, status: 'changed', classifications: ['nodePosition'], changedFields: [] });
      continue;
    }
    if (basePos.x === headPos.x && basePos.y === headPos.y) continue;
    changes.push({
      id,
      status: 'moved',
      classifications: ['nodePosition'],
      changedFields: [{
        path: 'nodePosition',
        kind: 'nodePosition',
        before: basePos,
        after: headPos,
      }],
    });
    counts.moved += 1;
  }
  const baseViewport = base.candidate.layoutState.viewport ?? null;
  const headViewport = head.candidate.layoutState.viewport ?? null;
  if (!strictEquals(baseViewport, headViewport)) {
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

export function compareProjectionRevisions(
  base: VerifiedProjectionRevisionV0,
  head: VerifiedProjectionRevisionV0,
  options?: { now?: () => string },
): ProjectionDeltaResultV0 {
  const checkedAt = options?.now?.() ?? new Date().toISOString();

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
  if (base.candidate.scope.projectId !== head.candidate.scope.projectId) {
    return failure(
      'delta/project-mismatch',
      `Projection scope projectId differs: base='${base.candidate.scope.projectId}', head='${head.candidate.scope.projectId}'.`,
      { base: base.candidate.scope.projectId, head: head.candidate.scope.projectId },
      {},
      ['compare only revisions of the same Project scope; cross-project Delta is rejected'],
    );
  }

  const diagnostics: ProjectionDiagnosticV0[] = [];
  checkRevisionsForDuplicates(base, diagnostics);
  checkRevisionsForDuplicates(head, diagnostics);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    return failure(
      'delta/duplicate-id',
      first.message,
      first.subject,
      first.evidence,
      first.supportedFixes,
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
  const collaborationRelations = relationChanges(baseRelations, headRelations);
  const artifactsOrEvidence = artifactChanges(baseArtifacts, headArtifacts);
  const evidenceRefs = evidenceChanges(baseEvidence, headEvidence);
  const layout = layoutChanges(base, head);

  const semanticChanged = conversations.counts.changed > 0
    || runtimeExecutions.counts.changed > 0
    || collaborationRelations.counts.changed > 0
    || artifactsOrEvidence.counts.changed > 0
    || artifactsOrEvidence.counts.added > 0
    || artifactsOrEvidence.counts.removed > 0
    || evidenceRefs.counts.changed > 0;
  const provenanceChanged = conversations.counts.changed > 0 || evidenceRefs.counts.changed > 0;
  const layoutChanged = layout.counts.moved > 0 || layout.counts.viewportChanged > 0;

  const summary: ProjectionDeltaSummaryV0 = {
    conversations: conversations.counts,
    runtimeExecutions: runtimeExecutions.counts,
    relations: collaborationRelations.counts,
    artifacts: artifactsOrEvidence.counts,
    evidence: evidenceRefs.counts,
    layout: layout.counts,
    semanticChanged,
    layoutChanged,
    provenanceChanged,
  };

  const changes: ProjectionDeltaChangesV0 = {
    conversations: conversations.changes,
    runtimeExecutions: runtimeExecutions.changes,
    collaborationRelations: collaborationRelations.changes,
    artifactsOrEvidence: artifactsOrEvidence.changes,
    evidenceRefs: evidenceRefs.changes,
    layout: layout.changes,
  };

  const limitations = [
    'Workbench Projection Delta v0 is a deterministic field-level comparison of two verified revisions; it never infers runtime impact, downstream impact, causality, risk, or mergeability.',
    'A collection that shares no stable IDs between sides is reported as added / removed only; rename-by-label and move-by-geometry heuristics are deliberately rejected.',
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
      runtimeExecutions: 'executionId',
      collaborationRelations: 'id',
      artifactsOrEvidence: 'id',
      evidenceRefs: 'id',
      layoutNodes: 'id',
    },
    summary,
    changes,
    limitations,
    computedAt: checkedAt,
  };
  return delta;
}