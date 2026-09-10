/**
 * Work Graph compiler (PHASE 3A): facts -> candidate -> validate -> verified revision.
 *
 * Pure functions. No I/O, no layout, no UI.
 *
 * Data flow:
 *   WorkGraphSourceFacts (Governance, Overlay, History, Memory, Packets,
 *     Handoffs, Paseo/native adapter facts, Context staging, Attention,
 *     Artifacts)
 *     -> buildWorkGraphCandidate(): WorkGraphCandidate (nodes/edges/evidence)
 *     -> validateWorkGraphCandidate(): WorkGraphCandidateValidation
 *     -> buildWorkGraphRevision(): WorkGraphRevision (hashes, ids)
 *
 * Hard rules enforced here:
 * - Work identity only from explicit Governance facts (workId field).
 *   Never heuristic-merged. Missing facts -> no Work node, never invented.
 * - uses-context edges ONLY for state==='included' items WITH an explicit
 *   consumedBy consumer. Available items never produce flow edges.
 * - produces edges ONLY when the artifact fact names an executionId that
 *   exists as an execution node.
 * - handoff edges ONLY for ACCEPTED handoffs with exact usedResultRef and
 *   both endpoint executions present.
 * - blocked-by edges ONLY when the attention fact names an existing
 *   sourceId (execution/conversation).
 * - execution-of edges ONLY when the adapter fact names an existing
 *   conversationKey/workId.
 * - Paseo agents are Execution nodes, never Work nodes. Sessions are
 *   never root identities (history sessions are evidence only).
 * - UNKNOWN verification/currentness is preserved, never promoted.
 * - Semantic hash covers nodes+edges+evidence only; layoutHash is ''.
 * - Deterministic: inputs sorted by stable id; same facts -> same hashes.
 */

import { createHash } from 'node:crypto';
import type {
  DialogueStatus,
  ObservationVerification,
  Platform,
  RuntimeState,
  TaskState,
} from '../types';
import type {
  WorkGraphConversationId,
  WorkGraphEdge,
  WorkGraphExecutionId,
  WorkGraphNode,
  WorkGraphNodeId,
  WorkGraphProjectId,
  WorkGraphWorkId,
} from './types';
import type {
  WorkGraphAdapterExecutionFact,
  WorkGraphCandidate,
  WorkGraphCompileOptions,
  WorkGraphEvidenceRef,
  WorkGraphReceipt,
  WorkGraphRevision,
  WorkGraphSemanticFacts,
  WorkGraphSourceFacts,
  WorkGraphSourceFingerprint,
} from './revision';
import { validateWorkGraphCandidate } from './schema';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function asVerification(value: string | undefined): ObservationVerification {
  return value === 'VERIFIED' || value === 'OBSERVED' || value === 'INFERRED' || value === 'UNKNOWN'
    ? value
    : 'UNKNOWN';
}

function asDialogue(value: string | undefined): DialogueStatus {
  return value === 'ACTIVE' || value === 'PAUSED' || value === 'FROZEN' || value === 'STANDBY' || value === 'UNKNOWN'
    ? value
    : 'UNKNOWN';
}

function asTask(value: string | undefined): TaskState {
  return value === 'active' || value === 'waiting' || value === 'blocked' || value === 'standby' || value === 'unknown'
    ? value
    : 'unknown';
}

function asRuntime(value: string | undefined): RuntimeState {
  return value === 'working' || value === 'idle' || value === 'stopped' || value === 'error' || value === 'unknown'
    ? value
    : 'unknown';
}

function asAttention(value: string | undefined): 'none' | 'needs-user' | 'approval' | 'blocked' | 'unknown' {
  return value === 'none' || value === 'needs-user' || value === 'approval' || value === 'blocked' ? value : 'unknown';
}

function asPlatform(value: string | undefined): Platform {
  return value === 'claude' || value === 'codex' || value === 'deepseek' ? value : 'other';
}

function asReceipt(
  value: string | undefined,
): 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED' | undefined {
  return value === 'ACCEPTED' || value === 'REJECTED' || value === 'FAILED' || value === 'CANCELLED' ? value : undefined;
}

function nowOf(options: WorkGraphCompileOptions): string {
  return options.now ?? new Date().toISOString();
}

function projectNodeId(projectId: WorkGraphProjectId): WorkGraphNodeId {
  return `project:${projectId}`;
}

function workNodeId(projectId: WorkGraphProjectId, workId: WorkGraphWorkId): WorkGraphNodeId {
  return `work:${projectId}:${workId}`;
}

function taskNodeId(projectId: WorkGraphProjectId, taskId: string): WorkGraphNodeId {
  return `task:${projectId}:${taskId}`;
}

function evidenceNodeId(projectId: WorkGraphProjectId, evidenceId: string): WorkGraphNodeId {
  return `evidence:${projectId}:${evidenceId}`;
}

function conversationNodeId(projectId: WorkGraphProjectId, key: string): WorkGraphNodeId {
  return `conversation:${projectId}:${key}`;
}

function executionNodeId(projectId: WorkGraphProjectId, executionId: WorkGraphExecutionId): WorkGraphNodeId {
  return `execution:${projectId}:${executionId}`;
}

function contextNodeId(projectId: WorkGraphProjectId, contextId: string): WorkGraphNodeId {
  return `context:${projectId}:${contextId}`;
}

function memoryNodeId(projectId: WorkGraphProjectId, memoryId: string): WorkGraphNodeId {
  return `memory:${projectId}:${memoryId}`;
}

function artifactNodeId(projectId: WorkGraphProjectId, artifactId: string): WorkGraphNodeId {
  return `artifact:${projectId}:${artifactId}`;
}

function gateNodeId(projectId: WorkGraphProjectId, gateId: string): WorkGraphNodeId {
  return `gate:${projectId}:${gateId}`;
}

function handoffNodeId(projectId: WorkGraphProjectId, handoffId: string): WorkGraphNodeId {
  return `handoff:${projectId}:${handoffId}`;
}

/**
 * Build a candidate from source facts. Pure; never throws on unknown
 * shapes — unparseable facts become problems[], not invented nodes.
 */
export function buildWorkGraphCandidate(options: WorkGraphCompileOptions): WorkGraphCandidate {
  const { projectId, sourceDigest, facts } = options;
  const now = nowOf(options);
  const nodes: WorkGraphNode[] = [];
  const edges: WorkGraphEdge[] = [];
  const evidenceRefs: WorkGraphEvidenceRef[] = [];
  const sourceFingerprints: WorkGraphSourceFingerprint[] = [];
  const problems: { source: string; message: string }[] = [];

  const evidence = (
    id: string,
    source: WorkGraphEvidenceRef['source'],
    sourceRef: string,
    observedAt: string,
    verification: WorkGraphEvidenceRef['verification'],
  ): string => {
    const ref: WorkGraphEvidenceRef = {
      id,
      source,
      sourceRef,
      observedAt,
      verification,
      currentness: verification === 'VERIFIED' ? 'CURRENT' : 'UNKNOWN',
    };
    evidenceRefs.push(ref);
    return ref.id;
  };

  // ---- Project node (one per scope; requires at least one governance fact or overlay project) ----
  const gov = facts.governanceBindings.find((g) => g.projectId === projectId);
  const overlayProject = facts.overlaySnapshot?.projects.find((p) => p.projectId === projectId);
  const projectLabel = overlayProject?.label ?? projectId;
  const projectVerification = gov ? gov.binding.verification : 'UNKNOWN';
  nodes.push({
    kind: 'project',
    id: projectNodeId(projectId),
    projectId,
    label: projectLabel,
    source: gov ? 'governance-binding' : 'overlay-project',
    sourceRef: gov ? `governance-binding:${gov.binding.canonicalPath}` : `overlay-project:${projectId}`,
    observedAt: gov ? gov.binding.observedAt : now,
    verification: asVerification(projectVerification),
    currentness: gov ? 'CURRENT' : 'UNKNOWN',
    workCount: 0,
    conversationCount: 0,
  });

  // ---- Work nodes: ONLY from explicit governance workId ----
  const workIds = new Map<WorkGraphWorkId, {
    label: string;
    verification: ObservationVerification;
    currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
    observedAt: string;
    source: string;
    sourceRef: string;
    conversationIds: string[];
  }>();
  for (const g of facts.governanceBindings) {
    if (g.projectId !== projectId || !g.workId) continue;
    if (!workIds.has(g.workId)) {
      workIds.set(g.workId, {
        label: g.workLabel ?? g.workId,
        verification: asVerification(g.workSource?.verification ?? g.binding.verification),
        currentness: g.workSource?.currentness
          ?? (g.binding.verification === 'VERIFIED' ? 'CURRENT' : 'UNKNOWN'),
        observedAt: g.workSource?.observedAt ?? g.binding.observedAt,
        source: g.workSource?.source ?? 'governance-work',
        sourceRef: g.workSource?.sourceRef ?? `governance-work:${g.workId}`,
        conversationIds: [...(g.workSource?.conversationIds ?? [])],
      });
    }
  }
  const sortedWorkIds = [...workIds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const workNodeById = new Map<WorkGraphWorkId, WorkGraphNodeId>();
  for (const [workId, meta] of sortedWorkIds) {
    workNodeById.set(workId, workNodeId(projectId, workId));
    nodes.push({
      kind: 'work',
      id: workNodeId(projectId, workId),
      projectId,
      label: meta.label,
      workId,
      source: meta.source,
      sourceRef: meta.sourceRef,
      observedAt: meta.observedAt,
      verification: meta.verification,
      currentness: meta.currentness,
      conversationIds: [...meta.conversationIds],
      executionIds: [],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${workNodeId(projectId, workId)}`,
      projectId,
      source: projectNodeId(projectId),
      target: workNodeId(projectId, workId),
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'workIds' },
      evidenceRefs: [],
      observedAt: now,
      verification: meta.verification,
    });
  }

  // conversationKey -> workId from adapter facts carrying BOTH fields (same-fact evidence, not heuristic).
  const conversationWork = new Map<string, WorkGraphWorkId>();
  for (const exec of facts.adapterExecutions) {
    if (exec.projectId !== projectId || !exec.conversationKey || !exec.workId) continue;
    if (workIds.has(exec.workId) && !conversationWork.has(exec.conversationKey)) {
      conversationWork.set(exec.conversationKey, exec.workId);
    }
  }

  // ---- Conversation nodes ----
  const overlayConversations = (facts.overlaySnapshot?.conversations ?? [])
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => (a.conversationKey < b.conversationKey ? -1 : 1));
  const conversationNodeByKey = new Map<string, WorkGraphNodeId>();
  for (const c of overlayConversations) {
    const nodeId = conversationNodeId(projectId, c.conversationKey);
    conversationNodeByKey.set(c.conversationKey, nodeId);
    const evId = evidence(`ev-conversation:${projectId}:${c.conversationKey}`, 'overlay', `overlay-conversation:${c.conversationKey}`, now, asVerification(c.verification));
    nodes.push({
      kind: 'conversation',
      id: nodeId,
      projectId,
      label: c.conversationKey,
      source: 'overlay',
      sourceRef: `overlay-conversation:${c.conversationKey}`,
      observedAt: now,
      verification: asVerification(c.verification),
      conversationId: c.canonicalConversationId ?? c.conversationKey,
      workId: conversationWork.get(c.conversationKey) ?? null,
      conversationKey: c.conversationKey,
      ...(c.canonicalConversationId ? { canonicalConversationId: c.canonicalConversationId } : {}),
      platform: asPlatform(c.platform),
      lifecycleState: asDialogue(c.lifecycleState),
      taskState: asTask(c.taskState),
      runtimeState: asRuntime(c.runtimeState),
      attentionState: asAttention(c.attentionState),
      evidenceRefs: [evId],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'conversations' },
      evidenceRefs: [evId],
      observedAt: now,
      verification: asVerification(c.verification),
    });
  }

  // ---- Task nodes: ONLY from explicit canonical task facts ----
  const taskFacts = [...(facts.tasks ?? [])]
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => (a.taskId < b.taskId ? -1 : 1));
  const taskNodeById = new Map<string, WorkGraphNodeId>();
  for (const t of taskFacts) {
    const nodeId = taskNodeId(projectId, t.taskId);
    taskNodeById.set(t.taskId, nodeId);
    nodes.push({
      kind: 'task',
      id: nodeId,
      projectId,
      label: t.label,
      source: t.source,
      sourceRef: t.sourceRef,
      observedAt: t.observedAt,
      verification: asVerification(t.verification),
      currentness: t.currentness ?? (t.verification === 'VERIFIED' ? 'CURRENT' : 'UNKNOWN'),
      taskId: t.taskId,
      taskState: t.taskState ?? 'unknown',
      attentionState: t.attentionState ?? 'unknown',
      ...(t.workId ? { workId: t.workId } : {}),
      ...(t.conversationKeys ? { conversationKeys: [...t.conversationKeys] } : {}),
      ...(t.gateIds ? { gateIds: [...t.gateIds] } : {}),
      ...(t.artifactRefs ? { artifactRefs: [...t.artifactRefs] } : {}),
      evidenceRefs: [...t.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'tasks' },
      evidenceRefs: [...t.evidenceRefs],
      observedAt: now,
      verification: asVerification(t.verification),
    });
    // Work -> Task membership ONLY on explicit workId + existing Work.
    if (t.workId) {
      const workNode = workNodeById.get(t.workId);
      if (workNode) {
        edges.push({
          kind: 'membership',
          id: `edge:membership:${workNode}:${nodeId}`,
          projectId,
          source: workNode,
          target: nodeId,
          structuralSource: { entityId: nodeId, fieldPath: 'workId' },
          evidenceRefs: [...t.evidenceRefs],
          observedAt: now,
          verification: asVerification(t.verification),
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Task "${t.taskId}" names unknown work "${t.workId}"; work membership omitted`,
        });
      }
    }
  }

  // ---- Execution nodes (Paseo agents and native runs are executions, never works) ----
  const executions = [...facts.adapterExecutions]
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => (a.executionId < b.executionId ? -1 : 1));
  const executionNodeByRef = new Map<string, WorkGraphNodeId>();
  for (const e of executions) {
    const nodeId = executionNodeId(projectId, e.executionId);
    executionNodeByRef.set(e.executionId, nodeId);
    const convKey = e.conversationKey;
    const convNode = convKey ? conversationNodeByKey.get(convKey) : undefined;
    const evId = evidence(`ev-execution:${projectId}:${e.executionId}`, 'adapter', e.sourceRef, now, 'OBSERVED');
    nodes.push({
      kind: 'execution',
      id: nodeId,
      projectId,
      label: `${e.backend}/${e.provider}:${e.runtimeRef}`,
      source: `adapter:${e.backend}`,
      sourceRef: e.sourceRef,
      observedAt: now,
      verification: 'OBSERVED',
      executionId: e.executionId,
      conversationId: convKey ?? null,
      workId: e.workId && workIds.has(e.workId) ? e.workId : null,
      backend: e.backend,
      provider: e.provider,
      runtimeRef: e.runtimeRef,
      runtimeState: asRuntime(e.runtimeState),
      live: e.live === true,
      ...(e.intentId ? { intentId: e.intentId } : {}),
      ...(asReceipt(e.receiptStatus) ? { receiptStatus: asReceipt(e.receiptStatus) } : {}),
      evidenceRefs: [evId, ...e.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'executions' },
      evidenceRefs: [evId],
      observedAt: now,
      verification: 'OBSERVED',
    });
    if (convNode) {
      edges.push({
        kind: 'execution-of',
        id: `edge:execution-of:${convNode}:${nodeId}`,
        projectId,
        source: convNode,
        target: nodeId,
        structuralSource: { entityId: nodeId, fieldPath: 'conversationId' },
        evidenceRefs: [evId],
        observedAt: now,
        verification: 'OBSERVED',
        ...(e.intentId ? { intentId: e.intentId } : {}),
      });
    }
  }

  // ---- Context nodes ----
  const contextItems = [...facts.contextItems]
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => (a.contextId < b.contextId ? -1 : 1));
  const contextNodeById = new Map<string, WorkGraphNodeId>();
  for (const c of contextItems) {
    const nodeId = contextNodeId(projectId, c.contextId);
    contextNodeById.set(c.contextId, nodeId);
    nodes.push({
      kind: 'context',
      id: nodeId,
      projectId,
      label: c.title,
      source: c.source,
      sourceRef: c.sourceRef ?? `context:${c.contextId}`,
      observedAt: now,
      verification: 'OBSERVED',
      contextId: c.contextId,
      state: c.state,
      pinned: c.pinned === true,
      isReference: c.isReference === true,
      ...(c.sourceRefs ? { sourceRefs: [...c.sourceRefs] } : {}),
      ...(c.provenance ? { provenance: c.provenance } : {}),
      evidenceRefs: [...c.evidenceRefs],
    });
    // Available items: membership only, NEVER flow edges.
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'contextItems' },
      evidenceRefs: [...c.evidenceRefs],
      observedAt: now,
      verification: 'OBSERVED',
    });
    // uses-context: ONLY included items WITH explicit consumedBy.
    if (c.state === 'included' && c.consumedBy) {
      const consumerId = c.consumedBy.executionId
        ? executionNodeByRef.get(c.consumedBy.executionId)
        : c.consumedBy.conversationId
          ? conversationNodeByKey.get(c.consumedBy.conversationId)
          : undefined;
      if (consumerId) {
        edges.push({
          kind: 'uses-context',
          id: `edge:uses-context:${consumerId}:${nodeId}`,
          projectId,
          source: consumerId,
          target: nodeId,
          structuralSource: { entityId: nodeId, fieldPath: 'consumedBy' },
          evidenceRefs: [...c.evidenceRefs],
          observedAt: now,
          verification: 'OBSERVED',
          inclusionAction: c.consumedBy.action,
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Context "${c.contextId}" names unknown consumer; uses-context edge omitted`,
        });
      }
    }
  }

  // ---- Memory source nodes ----
  const memories = [...facts.memoryEntries]
    .filter((m) => m.sourceRef.includes(projectId) || true)
    .sort((a, b) => (a.memoryId < b.memoryId ? -1 : 1));
  for (const m of memories) {
    const nodeId = memoryNodeId(projectId, m.memoryId);
    const sourceType = m.source.startsWith('history:') ? 'history' : m.source.startsWith('project-file:') ? 'project-file' : 'overlay';
    nodes.push({
      kind: 'memory-source',
      id: nodeId,
      projectId,
      label: m.title,
      source: m.source,
      sourceRef: m.sourceRef,
      observedAt: m.observedAt,
      verification: asVerification(m.verification),
      memorySourceId: m.memoryId,
      sourceType,
      availability: 'UNKNOWN',
      evidenceRefs: [],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'memoryEntries' },
      evidenceRefs: [],
      observedAt: now,
      verification: asVerification(m.verification),
    });
  }

  // ---- Artifact nodes + produces edges (exact executionId only) ----
  const artifacts = [...facts.artifacts]
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => (a.artifactId < b.artifactId ? -1 : 1));
  for (const a of artifacts) {
    const nodeId = artifactNodeId(projectId, a.artifactId);
    nodes.push({
      kind: 'artifact',
      id: nodeId,
      projectId,
      label: a.title,
      source: a.source ?? 'adapter',
      sourceRef: a.sourceRef ?? `artifact:${a.artifactId}`,
      observedAt: a.observedAt ?? now,
      verification: asVerification(a.verification ?? 'OBSERVED'),
      currentness: a.currentness ?? ((a.verification ?? 'OBSERVED') === 'VERIFIED' ? 'CURRENT' : 'UNKNOWN'),
      artifactId: a.artifactId,
      artifactKind: a.kind,
      ...(a.executionId ? { executionId: a.executionId } : {}),
      ...(a.taskId ? { taskId: a.taskId } : {}),
      ...(a.eventRef ? { eventRef: a.eventRef } : {}),
      title: a.title,
      ...(a.content !== undefined ? { content: a.content } : {}),
      evidenceRefs: [...a.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'artifacts' },
      evidenceRefs: [...a.evidenceRefs],
      observedAt: now,
      verification: asVerification(a.verification ?? 'OBSERVED'),
    });
    if (a.executionId) {
      const execNode = executionNodeByRef.get(a.executionId);
      if (execNode) {
        edges.push({
          kind: 'produces',
          id: `edge:produces:${execNode}:${nodeId}`,
          projectId,
          source: execNode,
          target: nodeId,
          structuralSource: { entityId: nodeId, fieldPath: 'executionId' },
          evidenceRefs: [...a.evidenceRefs],
          observedAt: now,
          verification: asVerification(a.verification ?? 'OBSERVED'),
          ...(a.eventRef ? { eventRef: a.eventRef } : {}),
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Artifact "${a.artifactId}" names unknown execution "${a.executionId}"; produces edge omitted`,
        });
      }
    }
  }

  // ---- Evidence nodes + evidences edges (exact identity + exact target only) ----
  // An event without an evidence identity never becomes a node: only
  // explicit evidence facts (with source + sourceRef) are projected.
  const evidenceFacts = [...(facts.evidenceItems ?? [])]
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1));
  const evidenceNodeByRef = new Map<string, WorkGraphNodeId>();
  const pendingEvidences: Array<{
    nodeId: WorkGraphNodeId;
    backsNodeId: string;
    evidenceId: string;
    evidenceRefs: string[];
    verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
  }> = [];
  for (const e of evidenceFacts) {
    const nodeId = evidenceNodeId(projectId, e.evidenceId);
    evidenceNodeByRef.set(e.sourceRef, nodeId);
    nodes.push({
      kind: 'evidence',
      id: nodeId,
      projectId,
      label: e.label,
      source: e.source,
      sourceRef: e.sourceRef,
      observedAt: e.observedAt,
      verification: asVerification(e.verification),
      evidenceId: e.evidenceId,
      evidenceType: e.evidenceType,
      ...(e.eventRef ? { eventRef: e.eventRef } : {}),
      ...(e.artifactRef ? { artifactRef: e.artifactRef } : {}),
      ...(e.executionId ? { executionId: e.executionId } : {}),
      ...(e.gateId ? { gateId: e.gateId } : {}),
      evidenceRefs: [...e.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'evidenceItems' },
      evidenceRefs: [...e.evidenceRefs],
      observedAt: now,
      verification: asVerification(e.verification),
    });
    // Defer evidences edges until ALL nodes exist (order-independent).
    if (e.backsNodeId) {
      pendingEvidences.push({
        nodeId,
        backsNodeId: e.backsNodeId,
        evidenceId: e.evidenceId,
        evidenceRefs: [...e.evidenceRefs],
        verification: asVerification(e.verification),
      });
    }
  }

  // ---- Gate nodes + blocked-by edges (exact sourceId only) ----
  const gates = [...facts.attentionItems]
    .filter((g) => g.projectId === projectId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const gateNodeById = new Map<string, WorkGraphNodeId>();
  for (const g of gates) {
    const nodeId = gateNodeId(projectId, g.id);
    gateNodeById.set(g.id, nodeId);
    nodes.push({
      kind: 'gate',
      id: nodeId,
      projectId,
      label: g.title,
      source: 'attention',
      sourceRef: g.sourceRef,
      observedAt: g.observedAt,
      verification: asVerification(g.verification),
      gateId: g.id,
      gateKind: g.kind,
      level: g.level,
      title: g.title,
      summary: g.summary,
      ...(g.sourceId ? { sourceId: g.sourceId } : {}),
      evidenceRefs: [...g.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'attentionItems' },
      evidenceRefs: [...g.evidenceRefs],
      observedAt: now,
      verification: asVerification(g.verification),
    });
    if (g.sourceId) {
      const blockedNode =
        executionNodeByRef.get(g.sourceId) ??
        conversationNodeByKey.get(g.sourceId) ??
        taskNodeById.get(g.sourceId) ??
        workNodeById.get(g.sourceId);
      if (blockedNode) {
        edges.push({
          kind: 'blocked-by',
          id: `edge:blocked-by:${blockedNode}:${nodeId}`,
          projectId,
          source: blockedNode,
          target: nodeId,
          structuralSource: { entityId: nodeId, fieldPath: 'sourceId' },
          evidenceRefs: [...g.evidenceRefs],
          observedAt: now,
          verification: asVerification(g.verification),
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Gate "${g.id}" names unknown source "${g.sourceId}"; blocked-by edge omitted`,
        });
      }
    }
  }

  // ---- Task -> Gate blocked-by from explicit task gateIds ----
  for (const t of taskFacts) {
    if (!t.gateIds) continue;
    const taskNode = taskNodeById.get(t.taskId);
    if (!taskNode) continue;
    for (const gateId of t.gateIds) {
      const gateNode = gateNodeById.get(gateId);
      if (gateNode) {
        edges.push({
          kind: 'blocked-by',
          id: `edge:blocked-by:${taskNode}:${gateNode}`,
          projectId,
          source: taskNode,
          target: gateNode,
          structuralSource: { entityId: taskNode, fieldPath: 'gateIds' },
          evidenceRefs: [...t.evidenceRefs],
          observedAt: now,
          verification: asVerification(t.verification),
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Task "${t.taskId}" names unknown gate "${gateId}"; blocked-by edge omitted`,
        });
      }
    }
  }

  // ---- Handoff nodes + edges (ACCEPTED + exact refs + both endpoints) ----
  const handoffs = [...facts.handoffs].sort((a, b) => (a.intentId < b.intentId ? -1 : 1));
  for (const h of handoffs) {
    const nodeId = handoffNodeId(projectId, h.intentId);
    nodes.push({
      kind: 'handoff',
      id: nodeId,
      projectId,
      label: `handoff:${h.intentId}`,
      source: 'handoff',
      sourceRef: `handoff:${h.intentId}`,
      observedAt: h.at,
      verification: 'OBSERVED',
      handoffId: h.intentId,
      sourceExecutionId: h.sourceExecutionRef,
      targetExecutionId: h.targetExecutionRef,
      usedResultRef: h.usedResultRef,
      evidenceRefs: [...h.evidenceRefs],
    });
    edges.push({
      kind: 'membership',
      id: `edge:membership:${projectNodeId(projectId)}:${nodeId}`,
      projectId,
      source: projectNodeId(projectId),
      target: nodeId,
      structuralSource: { entityId: projectNodeId(projectId), fieldPath: 'handoffs' },
      evidenceRefs: [...h.evidenceRefs],
      observedAt: now,
      verification: 'OBSERVED',
    });
    if (h.status === 'ACCEPTED' && h.usedResultRef) {
      const from = executionNodeByRef.get(h.sourceExecutionRef);
      const to = executionNodeByRef.get(h.targetExecutionRef);
      if (from && to) {
        edges.push({
          kind: 'handoff',
          id: `edge:handoff:${from}:${to}:${h.intentId}`,
          projectId,
          source: from,
          target: to,
          structuralSource: { entityId: nodeId, fieldPath: 'usedResultRef' },
          evidenceRefs: [...h.evidenceRefs],
          observedAt: now,
          verification: 'OBSERVED',
          usedResultRef: h.usedResultRef,
          relationId: h.intentId,
        });
      } else {
        problems.push({
          source: 'workgraph-compiler',
          message: `Handoff "${h.intentId}" references unknown execution; handoff edge omitted`,
        });
      }
    }
  }

  // ---- Deferred evidences edges: emit after every node exists ----
  // evidences edge ONLY when backsNodeId names an existing node.
  const allNodeIds = new Set(nodes.map((n) => n.id));
  for (const pending of pendingEvidences) {
    if (allNodeIds.has(pending.backsNodeId)) {
      edges.push({
        kind: 'evidences',
        id: `edge:evidences:${pending.nodeId}:${pending.backsNodeId}`,
        projectId,
        source: pending.nodeId,
        target: pending.backsNodeId,
        structuralSource: { entityId: pending.nodeId, fieldPath: 'backsNodeId' },
        evidenceRefs: [...pending.evidenceRefs],
        observedAt: now,
        verification: pending.verification,
      });
    } else {
      problems.push({
        source: 'workgraph-compiler',
        message: `Evidence "${pending.evidenceId}" backs unknown node "${pending.backsNodeId}"; evidences edge omitted`,
      });
    }
  }

  // ---- Update derived counts on project node ----
  const projectNode = nodes[0];
  if (projectNode && projectNode.kind === 'project') {
    projectNode.workCount = sortedWorkIds.length;
    projectNode.conversationCount = overlayConversations.length;
  }

  // ---- Source fingerprints + overlay problems ----
  for (const fp of facts.overlaySnapshot?.sourceFingerprints ?? []) {
    sourceFingerprints.push({ sourceRef: fp.sourceRef, sha256: fp.sha256 });
  }
  for (const p of facts.packets) {
    if (p.projectId !== projectId) continue;
    for (const fp of p.sourceFingerprints) sourceFingerprints.push({ sourceRef: fp.sourceRef, sha256: fp.sha256 });
  }
  for (const p of facts.overlaySnapshot?.problems ?? []) problems.push({ source: p.source, message: p.message });

  // ---- History sessions are evidence only (never nodes) ----
  for (const s of facts.historySessions) {
    evidence(`ev-history:${s.sessionId}`, 'history', `history:${s.sessionId}`, s.startedAt ?? now, 'OBSERVED');
  }

  nodes.sort(byId);
  edges.sort(byId);
  evidenceRefs.sort(byId);
  sourceFingerprints.sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1));

  return {
    schemaVersion: 1,
    projectionKind: 'workgraph',
    scope: { projectId },
    sourceBinding: { sourceDigest },
    semanticFacts: { schemaVersion: 1, nodes, edges, evidenceRefs, sourceFingerprints, problems },
  };
}

/** Semantic hash: semantic fields only. Observation time and layout never affect identity. */
export function computeWorkGraphSemanticHash(candidate: WorkGraphCandidate): string {
  const facts = candidate.semanticFacts;
  const withoutObservationTime = <T extends { observedAt: string }>(value: T): Omit<T, 'observedAt'> => {
    const { observedAt: _observedAt, ...semantic } = value;
    return semantic;
  };
  return sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      nodes: [...facts.nodes].sort(byId).map(withoutObservationTime),
      edges: [...facts.edges].sort(byId).map(withoutObservationTime),
      evidenceRefs: [...facts.evidenceRefs].sort(byId).map(withoutObservationTime),
    }),
  );
}

export function computeWorkGraphRevisionHash(input: {
  scope: { projectId: string };
  sourceDigest: string;
  semanticHash: string;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, ...input, layoutHash: '' }));
}

/**
 * Full pipeline: build candidate -> validate -> verified revision.
 * Bad candidates never replace last-good: on validation failure the
 * previous revision is retained and the receipt records NEEDS_FIX.
 */
export async function compileWorkGraph(
  options: WorkGraphCompileOptions,
): Promise<{ revision: WorkGraphRevision | null; receipt: WorkGraphReceipt; previousRetained: boolean }> {
  const candidate = buildWorkGraphCandidate(options);
  const validation = validateWorkGraphCandidate(candidate);
  const checkedAt = nowOf(options);
  const candidateHash = sha256Hex(canonicalJson(candidate));

  if (!validation.ok) {
    const receipt: WorkGraphReceipt = {
      schemaVersion: 1,
      outcome: 'NEEDS_FIX',
      candidateHash,
      sourceDigest: options.sourceDigest,
      recheckedSourceDigest: options.sourceDigest,
      revisionId: null,
      retainedRevisionId: options.previousRevision?.revisionId ?? null,
      checkedAt,
      diagnostics: validation.diagnostics,
    };
    return { revision: null, receipt, previousRetained: !!options.previousRevision };
  }

  const semanticHash = computeWorkGraphSemanticHash(validation.candidate);
  const revisionHash = computeWorkGraphRevisionHash({
    scope: validation.candidate.scope,
    sourceDigest: options.sourceDigest,
    semanticHash,
  });
  const revision: WorkGraphRevision = {
    schemaVersion: 1,
    revisionId: `workgraph-${revisionHash.slice(0, 16)}`,
    revisionHash,
    semanticHash,
    layoutHash: '',
    sourceDigest: options.sourceDigest,
    verifiedAt: checkedAt,
    ...(options.previousRevision ? { previousRevisionId: options.previousRevision.revisionId } : {}),
    candidate: validation.candidate,
  };
  const receipt: WorkGraphReceipt = {
    schemaVersion: 1,
    outcome: 'VERIFIED',
    candidateHash,
    sourceDigest: options.sourceDigest,
    recheckedSourceDigest: options.sourceDigest,
    revisionId: revision.revisionId,
    retainedRevisionId: options.previousRevision?.revisionId ?? null,
    checkedAt,
    diagnostics: [],
  };
  return { revision, receipt, previousRetained: false };
}

export type { WorkGraphAdapterExecutionFact };
