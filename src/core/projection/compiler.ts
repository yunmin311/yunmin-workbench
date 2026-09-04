import { computePacketHash, canonicalPacketJson } from '../project/canonical';
import { projectCompareGroups, projectTrajectory, resultSourceRef } from '../project/executionRelations';
import { executionIdForEvent, projectRuntimeExecutions } from '../project/runtimeInspector';
import type {
  ActivityEvent,
  GitFacts,
  Observation,
  OverlaySnapshot,
} from '../types';
import type {
  ArtifactOrEvidenceProjectionV0,
  CollaborationRelationProjectionV0,
  EvidenceRefV0,
  EvidenceRevisionV0,
  LayoutStateV0,
  ProjectionCandidateV0,
  ProjectionSemanticFactsV0,
} from './types';

/**
 * Projection IR v0 has no History input.
 *
 * History is derived transcript evidence. History sessions have no canonical
 * project identity, and a session's observed cwd is metadata/filter only —
 * never identity. v0 therefore does not accept HistorySession in its fact
 * input, and the compiler does not emit project-scoped `history-fact`
 * artifacts. History can return to Projection only when an explicit trusted
 * Project binding exists; until then `history-fact` is a reserved enum kind
 * only and `history-session` is a reserved `EvidenceRevisionV0` kind only.
 */
export interface ProjectionFactInputV0 {
  projectId: string;
  snapshot: OverlaySnapshot;
  activity: ActivityEvent[];
  liveExecutionIds?: readonly string[];
  gitFacts?: GitFacts | null;
  layoutState?: LayoutStateV0;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function sorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)));
}

/**
 * sourceDigestFacts: dependency set is "what the candidate actually consumes",
 * not "every fingerprint the OverlaySnapshot read".
 *
 * - Conversations / ProjectAdapter / Activity / GitFacts are already filtered
 *   to `input.projectId`; including them scopes dependencies to Project A.
 * - sourceFingerprints are restricted to the exact sourceRefs the compiled
 *   candidate referenced. Unrelated Project B canonical files therefore
 *   cannot influence Project A's digest.
 * - liveExecutionIds are restricted to RuntimeExecution identities the compiled
 *   candidate projected. Unrelated Project B live/stopped transitions cannot
 *   influence Project A's digest.
 * - The shared/global Memory Vault is a current intentional product mount,
 *   so its fingerprints are included when memoryIndex has entries.
 *
 * No path-name heuristics are used to guess Project ownership.
 */
function sourceDigestFacts(
  input: ProjectionFactInputV0,
  candidate: ProjectionCandidateV0,
): unknown {
  const consumedSourceRefs = [...new Set(candidate.semanticFacts.evidenceRefs.map((item) => item.sourceRef))].sort();
  const consumedFingerprints = sorted(
    input.snapshot.sourceFingerprints.filter((item) => consumedSourceRefs.includes(item.sourceRef)),
    (item) => item.sourceRef,
  );
  const memoryIndex = sorted(
    input.snapshot.memoryIndex.filter((item) => consumedSourceRefs.includes(item.sourceRef)),
    (item) => item.id,
  );
  // liveExecutionIds is the renderer's global set; restrict it to the exact
  // RuntimeExecution identities the compiled candidate projected, so unrelated
  // Project B live/stopped transitions cannot change Project A's sourceDigest.
  const candidateExecutionIds = new Set(candidate.semanticFacts.runtimeExecutions.map((item) => item.executionId));
  const scopedLiveExecutionIds = [...new Set((input.liveExecutionIds ?? [])
    .filter((id) => candidateExecutionIds.has(id)))].sort();
  return {
    projectId: input.projectId,
    conversations: sorted(
      input.snapshot.conversations.filter((item) => item.project === input.projectId),
      (item) => item.key,
    ),
    project: input.snapshot.projects.find((item) => item.projectId === input.projectId) ?? null,
    activity: sorted(
      input.activity.filter((item) => item.projectId === input.projectId),
      (item) => item.id,
    ),
    sourceFingerprints: consumedFingerprints,
    memoryIndex,
    liveExecutionIds: scopedLiveExecutionIds,
    gitFacts: input.gitFacts?.projectId === input.projectId ? input.gitFacts : null,
  };
}

export function computeProjectionSourceDigest(
  input: ProjectionFactInputV0,
  candidate: ProjectionCandidateV0,
): string {
  return computePacketHash(sourceDigestFacts(input, candidate));
}

function normalizedLayout(layout?: LayoutStateV0): LayoutStateV0 {
  if (!layout) return { schemaVersion: 0, nodePositions: {} };
  return {
    schemaVersion: 0,
    nodePositions: Object.fromEntries(
      Object.entries(layout.nodePositions).sort(([left], [right]) => left.localeCompare(right)),
    ),
    ...(layout.viewport ? { viewport: { ...layout.viewport } } : {}),
  };
}

export function compileProjectionCandidate(input: ProjectionFactInputV0): ProjectionCandidateV0 {
  const projectActivity = input.activity.filter((event) => event.projectId === input.projectId);
  const fingerprints = new Map(input.snapshot.sourceFingerprints.map((item) => [item.sourceRef, item.sha256]));
  const evidenceById = new Map<string, EvidenceRefV0>();
  const eventEvidence = new Map<string, string>();

  const addEvidence = (
    observed: Observation,
    revision?: EvidenceRevisionV0,
    currentness?: EvidenceRefV0['currentness'],
  ): string => {
    const fingerprint = fingerprints.get(observed.sourceRef);
    const validFingerprint = fingerprint && /^[a-f0-9]{64}$/i.test(fingerprint)
      ? fingerprint.toLowerCase()
      : undefined;
    const resolvedRevision = revision ?? (validFingerprint
      ? { kind: 'sha256' as const, value: validFingerprint }
      : undefined);
    const resolvedCurrentness = currentness ?? (validFingerprint ? 'CURRENT' : 'UNKNOWN');
    const id = `evidence:${computePacketHash({ observed, revision: resolvedRevision ?? null })}`;
    evidenceById.set(id, {
      id,
      source: observed.source,
      sourceRef: observed.sourceRef,
      observedAt: observed.observedAt,
      verification: observed.verification,
      currentness: resolvedCurrentness,
      ...(resolvedRevision ? { revision: resolvedRevision } : {}),
    });
    return id;
  };

  for (const item of projectActivity) {
    eventEvidence.set(item.id, addEvidence(
      item.observed,
      { kind: 'activity-event', value: item.id },
      'UNKNOWN',
    ));
  }

  const conversations = input.snapshot.conversations
    .filter((conversation) => conversation.project === input.projectId)
    .map((conversation) => ({
      id: `conversation:${conversation.key}`,
      conversationKey: conversation.key,
      ...(conversation.conversationId ? { canonicalConversationId: conversation.conversationId } : {}),
      projectId: input.projectId,
      role: conversation.role,
      ...(conversation.level ? { level: conversation.level } : {}),
      platform: conversation.platform,
      lifecycleState: conversation.status,
      taskState: conversation.taskState,
      runtimeState: conversation.runtimeState,
      attentionState: conversation.attention,
      verification: conversation.verification,
      evidenceRefs: [addEvidence(conversation.observed)],
    }))
    .sort(byId);
  const conversationRefs = new Map(conversations.map((item) => [item.conversationKey, item.id]));

  const runtimeViews = projectRuntimeExecutions(projectActivity, input.liveExecutionIds ?? []);
  const runtimeExecutions = runtimeViews.map((execution) => ({
    id: `execution:${execution.executionId}`,
    executionId: execution.executionId,
    nativeRef: execution.nativeRef,
    harness: execution.harness,
    projectId: input.projectId,
    conversationRef: execution.conversationKey
      ? conversationRefs.get(execution.conversationKey) ?? null
      : null,
    binding: execution.binding,
    runtimeState: execution.state,
    live: execution.live,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    intentId: execution.intentId,
    intentState: execution.intentState,
    receipt: execution.receipt,
    evidenceRefs: [...new Set(execution.events.flatMap((item) => {
      const ref = eventEvidence.get(item.id);
      return ref ? [ref] : [];
    }))].sort(),
  })).sort(byId);

  const artifacts: ArtifactOrEvidenceProjectionV0[] = [];
  for (const item of projectActivity) {
    const executionId = executionIdForEvent(item);
    const executionRef = executionId ? `execution:${executionId}` : undefined;
    const evidenceRef = eventEvidence.get(item.id);
    if (item.kind === 'agent-response' && item.content?.trim() && executionRef && evidenceRef) {
      artifacts.push({
        id: resultSourceRef(item),
        kind: 'agent-result',
        projectId: input.projectId,
        executionRef,
        eventRef: item.id,
        title: item.summary,
        content: item.content,
        evidenceRefs: [evidenceRef],
      });
    } else if ((item.kind === 'tool-completed' || item.kind === 'file-change') && item.evidenceRef && evidenceRef) {
      artifacts.push({
        id: item.evidenceRef,
        kind: item.kind === 'tool-completed' ? 'tool-evidence' : 'file-evidence',
        projectId: input.projectId,
        ...(executionRef ? { executionRef } : {}),
        eventRef: item.id,
        title: item.summary,
        ...(item.content ? { content: item.content } : {}),
        evidenceRefs: [evidenceRef],
      });
    } else if (
      ['handoff-accepted', 'handoff-failed', 'handoff-cancelled'].includes(item.kind)
      && evidenceRef
    ) {
      artifacts.push({
        id: `runtime-receipt:${item.id}`,
        kind: 'runtime-receipt',
        projectId: input.projectId,
        ...(executionRef ? { executionRef } : {}),
        eventRef: item.id,
        title: item.summary,
        evidenceRefs: [evidenceRef],
      });
    }
  }

  const projectAdapter = input.snapshot.projects.find((item) => item.projectId === input.projectId);
  if (projectAdapter) {
    const evidenceRef = addEvidence(projectAdapter.observed);
    artifacts.push({
      id: `governance:project:${input.projectId}`,
      kind: 'governance-record',
      projectId: input.projectId,
      title: projectAdapter.displayName,
      content: canonicalPacketJson({
        status: projectAdapter.status,
        trust: projectAdapter.trust,
        roles: projectAdapter.roles,
        gates: projectAdapter.gates,
      }),
      evidenceRefs: [evidenceRef],
    });
  }

  if (input.snapshot.memoryIndex.length > 0) {
    const memoryEvidence = input.snapshot.memoryIndex.map((item) => addEvidence({
      source: 'canonical-file',
      sourceRef: item.sourceRef,
      observedAt: input.snapshot.foundAt,
      verification: 'OBSERVED',
    }));
    artifacts.push({
      id: `memory:index:${input.projectId}`,
      kind: 'memory-index',
      projectId: input.projectId,
      title: `Memory Vault (${input.snapshot.memoryIndex.length})`,
      evidenceRefs: [...new Set(memoryEvidence)].sort(),
    });
  }

  if (input.gitFacts?.projectId === input.projectId) {
    const revision = input.gitFacts.head && /^[a-f0-9]{40}$/i.test(input.gitFacts.head)
      ? { kind: 'git-commit' as const, value: input.gitFacts.head }
      : undefined;
    const evidenceRef = addEvidence(
      input.gitFacts.observed,
      revision,
      revision ? 'CURRENT' : 'UNKNOWN',
    );
    artifacts.push({
      id: `git:${input.projectId}:${input.gitFacts.head ?? 'unknown'}`,
      kind: 'git-fact',
      projectId: input.projectId,
      title: `${input.gitFacts.branch ?? 'UNKNOWN'} @ ${input.gitFacts.head ?? 'UNKNOWN'}`,
      content: canonicalPacketJson({
        dirty: input.gitFacts.dirty,
        modified: input.gitFacts.modified,
        ahead: input.gitFacts.ahead,
        behind: input.gitFacts.behind,
        remotes: input.gitFacts.remotes,
      }),
      evidenceRefs: [evidenceRef],
    });
  }

  artifacts.sort(byId);
  const artifactById = new Map(artifacts.map((item) => [item.id, item]));
  const relations: CollaborationRelationProjectionV0[] = [];

  for (const group of projectCompareGroups(projectActivity)) {
    const executionRefs = [...new Set(group.executions.map((item) => `execution:${item.executionId}`))].sort();
    if (executionRefs.length < 2) continue;
    const evidenceRefs = projectActivity
      .filter((item) => item.groupId === group.groupId)
      .flatMap((item) => {
        const ref = eventEvidence.get(item.id);
        return ref ? [ref] : [];
      });
    relations.push({
      id: `parallel:${group.groupId}`,
      kind: 'parallel',
      groupId: group.groupId,
      executionRefs,
      evidenceRefs: [...new Set(evidenceRefs)].sort(),
    });
  }

  for (const relation of projectTrajectory(projectActivity).relations) {
    const artifact = artifactById.get(relation.sourceRef);
    if (!artifact || artifact.kind !== 'agent-result') continue;
    const sourceExecutionRef = `execution:${relation.sourceExecutionId}`;
    const targetExecutionRef = `execution:${relation.targetExecutionId}`;
    if (artifact.executionRef !== sourceExecutionRef) continue;
    const targetEvent = projectActivity.find((item) =>
      item.parentSourceRef === relation.sourceRef
      && executionIdForEvent(item) === relation.targetExecutionId);
    const targetEvidence = targetEvent ? eventEvidence.get(targetEvent.id) : undefined;
    relations.push({
      id: relation.id,
      kind: 'handoff',
      sourceExecutionRef,
      targetExecutionRef,
      usedResultRef: relation.sourceRef,
      evidenceRefs: [...new Set([
        ...artifact.evidenceRefs,
        ...(targetEvidence ? [targetEvidence] : []),
      ])].sort(),
    });
  }

  relations.sort(byId);

  const semanticFacts: ProjectionSemanticFactsV0 = {
    conversations,
    runtimeExecutions,
    collaborationRelations: relations,
    artifactsOrEvidence: artifacts,
    evidenceRefs: [...evidenceById.values()].sort(byId),
  };

  const candidate: ProjectionCandidateV0 = {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: input.projectId },
    sourceBinding: { sourceDigest: '0'.repeat(64) },
    semanticFacts,
    layoutState: normalizedLayout(input.layoutState),
  };
  candidate.sourceBinding = { sourceDigest: computeProjectionSourceDigest(input, candidate) };
  return candidate;
}