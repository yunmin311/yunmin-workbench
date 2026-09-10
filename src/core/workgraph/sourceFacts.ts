import { compileProjectionCandidate } from '../projection/compiler';
import { executionIdForEvent } from '../project/runtimeInspector';
import { buildStaging } from '../project/staging';
import type { ActivityEvent, GitFacts, OverlaySnapshot } from '../types';
import type {
  WorkGraphAttentionFact,
  WorkGraphArtifactFact,
  WorkGraphGovernanceFact,
  WorkGraphSourceFingerprint,
  WorkGraphSourceFacts,
  WorkGraphTaskFact,
} from './revision';

export interface CanonicalProjectWorkGraphFacts {
  governanceBindings: WorkGraphGovernanceFact[];
  tasks: WorkGraphTaskFact[];
  artifacts: WorkGraphArtifactFact[];
  sourceFingerprints: WorkGraphSourceFingerprint[];
  problems: { source: string; message: string }[];
}

export interface CanonicalWorkGraphFactInput {
  projectId: string;
  snapshot: OverlaySnapshot;
  activity: ActivityEvent[];
  liveExecutionIds?: readonly string[];
  gitFacts?: GitFacts | null;
  governanceBindings?: WorkGraphGovernanceFact[];
  attentionItems?: WorkGraphAttentionFact[];
  canonicalFacts?: CanonicalProjectWorkGraphFacts;
}

function executionIdFromRef(ref: string | undefined): string | undefined {
  return ref?.startsWith('execution:') ? ref.slice('execution:'.length) : undefined;
}

/**
 * Adapts already-canonical repository facts to the frozen WorkGraph input.
 * It owns no state and deliberately has no Work/Task/Memory ownership rules:
 * those nodes stay absent until an exact project-scoped source supplies them.
 */
export function buildCanonicalWorkGraphFacts(input: CanonicalWorkGraphFactInput): WorkGraphSourceFacts {
  const projectActivity = input.activity.filter((event) => event.projectId === input.projectId);
  const projection = compileProjectionCandidate({
    projectId: input.projectId,
    snapshot: input.snapshot,
    activity: projectActivity,
    liveExecutionIds: input.liveExecutionIds,
    gitFacts: input.gitFacts,
  });
  const semantic = projection.semanticFacts;
  const evidenceById = new Map(semantic.evidenceRefs.map((item) => [item.id, item]));

  const adapterExecutions = semantic.runtimeExecutions.map((execution) => {
    const observed = execution.evidenceRefs.map((id) => evidenceById.get(id)).find(Boolean);
    const receiptStatus = execution.intentState === 'accepted' ? 'ACCEPTED' as const
      : execution.intentState === 'failed' ? 'FAILED' as const
        : execution.intentState === 'cancelled' ? 'CANCELLED' as const
          : undefined;
    return {
      executionId: execution.executionId,
      backend: 'native' as const,
      provider: execution.harness,
      runtimeRef: execution.nativeRef,
      projectId: input.projectId,
      ...(execution.conversationRef
        ? { conversationKey: execution.conversationRef.slice('conversation:'.length) }
        : {}),
      ...(execution.intentId ? { intentId: execution.intentId } : {}),
      runtimeState: execution.runtimeState,
      live: execution.live,
      ...(receiptStatus ? { receiptStatus } : {}),
      evidenceRefs: [...execution.evidenceRefs],
      sourceRef: observed?.sourceRef ?? `runtime:${execution.harness}:${execution.nativeRef}`,
    };
  });

  const artifacts = semantic.artifactsOrEvidence
    .filter((artifact) => artifact.kind === 'agent-result' && artifact.executionRef && artifact.eventRef)
    .map((artifact) => ({
    artifactId: artifact.id,
    projectId: artifact.projectId,
    kind: artifact.kind,
    ...(executionIdFromRef(artifact.executionRef) ? { executionId: executionIdFromRef(artifact.executionRef) } : {}),
    ...(artifact.eventRef ? { eventRef: artifact.eventRef } : {}),
    title: artifact.title,
    ...(artifact.content !== undefined ? { content: artifact.content } : {}),
    evidenceRefs: [...artifact.evidenceRefs],
  }));

  const evidenceItemsById = new Map<string, WorkGraphSourceFacts['evidenceItems'][number]>();
  for (const event of projectActivity) {
    if ((event.kind !== 'tool-completed' && event.kind !== 'file-change') || !event.evidenceRef) continue;
    const executionId = executionIdForEvent(event) ?? undefined;
    if (evidenceItemsById.has(event.evidenceRef)) continue;
    evidenceItemsById.set(event.evidenceRef, {
      evidenceId: event.evidenceRef,
      projectId: input.projectId,
      label: event.summary,
      evidenceType: event.kind === 'tool-completed' ? 'tool-evidence' : 'file-evidence',
      source: event.observed.source,
      sourceRef: event.evidenceRef,
      observedAt: event.observed.observedAt,
      verification: event.observed.verification,
      eventRef: event.id,
      ...(executionId ? { executionId } : {}),
      ...(executionId ? { backsNodeId: `execution:${input.projectId}:${executionId}` } : {}),
      evidenceRefs: [event.observed.sourceRef],
    });
  }
  const evidenceItems = [...evidenceItemsById.values()];

  const handoffs = semantic.collaborationRelations.flatMap((relation) => {
    if (relation.kind !== 'handoff') return [];
    const targetExecutionRef = executionIdFromRef(relation.targetExecutionRef);
    const sourceExecutionRef = executionIdFromRef(relation.sourceExecutionRef);
    if (!targetExecutionRef || !sourceExecutionRef) return [];
    const accepted = projectActivity.find((event) =>
      event.kind === 'handoff-accepted'
      && event.parentSourceRef === relation.usedResultRef
      && executionIdForEvent(event) === targetExecutionRef
      && event.intentId);
    if (!accepted?.intentId) return [];
    return [{
      intentId: accepted.intentId,
      sourceExecutionRef,
      targetExecutionRef,
      usedResultRef: relation.usedResultRef,
      evidenceRefs: [...relation.evidenceRefs],
      at: accepted.observed.observedAt,
      status: 'ACCEPTED' as const,
    }];
  });

  const contextItems = buildStaging(input.snapshot, input.projectId)
    .filter((item) => item.source === `adapter:${input.projectId}` && item.sourceRef)
    .map((item) => ({
      contextId: item.id,
      projectId: input.projectId,
      title: item.title,
      source: item.source,
      body: item.body,
      state: item.state,
      pinned: item.pinned,
      isReference: item.isReference,
      sourceRef: item.sourceRef,
      ...(item.sourceRefs ? { sourceRefs: [...item.sourceRefs] } : {}),
      ...(item.provenance ? { provenance: item.provenance } : {}),
      evidenceRefs: [],
    }));

  return {
    governanceBindings: [
      ...(input.governanceBindings ?? []),
      ...(input.canonicalFacts?.governanceBindings ?? []),
    ],
    historySessions: [],
    memoryEntries: [],
    packets: [],
    handoffs,
    adapterExecutions,
    overlaySnapshot: {
      conversations: input.snapshot.conversations.map((conversation) => ({
        conversationKey: conversation.key,
        canonicalConversationId: conversation.conversationId,
        projectId: conversation.project,
        role: conversation.role,
        platform: conversation.platform,
        lifecycleState: conversation.status,
        taskState: conversation.taskState,
        runtimeState: conversation.runtimeState,
        attentionState: conversation.attention,
        verification: conversation.verification,
        evidenceRefs: [],
      })),
      projects: input.snapshot.projects.map((project) => ({
        projectId: project.projectId,
        label: project.displayName,
        canonicalSource: project.canonicalSource?.path
          ? { path: project.canonicalSource.path, remote: project.canonicalSource.remote }
          : undefined,
      })),
      memoryIndex: input.snapshot.memoryIndex.map((memory) => ({
        memoryId: memory.id,
        title: memory.title,
        source: memory.sourceRef,
      })),
      inbox: input.snapshot.inbox.map((item) => ({ id: item.id, line: item.line, text: item.raw })),
      sourceFingerprints: [
        ...input.snapshot.sourceFingerprints,
        ...(input.canonicalFacts?.sourceFingerprints ?? []),
      ],
      problems: [
        ...input.snapshot.problems,
        ...(input.canonicalFacts?.problems ?? []),
      ],
    },
    contextItems,
    attentionItems: input.attentionItems ?? [],
    artifacts: [...artifacts, ...(input.canonicalFacts?.artifacts ?? [])],
    tasks: input.canonicalFacts?.tasks ?? [],
    evidenceItems,
  };
}
