import { create } from 'zustand';
import {
  buildWorkbenchDraft,
  restoreWorkbenchDraft,
  type WorkbenchDraftV1,
} from '../../core/project/draft';
import { buildStaging, createManualContext, createMemoryProjectionContext } from '../../core/project/staging';
import { orderActivity, projectRuntimeSessions } from '../../core/project/activity';
import { applyAttentionLocalState, reduceAttention } from '../../core/attention/reducer';
import { checkPacketValidity } from '../../core/project/packet';
import { computeFrozenPacketHash, computeStringHash } from '../../core/project/canonical';
import { overlayFileSourceRef, projectFileSourceRef } from '../../core/project/sourceIdentity';
import { governanceRefsForPacket, projectGovernanceView, type GovernanceSnapshot } from '../../core/project/governanceBinding';
import {
  resolveWorkspaceTarget,
  updateWorkspaceSession,
  type WorkspaceSessionV1,
  type WorkspaceTargetV1,
} from '../../core/project/workspaceSession';
import type {
  ContextItem,
  ActivityEvent,
  Conversation,
  FrozenPacket,
  FrozenPacketSummary,
  GitFacts,
  OverlaySnapshot,
  SourceFingerprint,
  RuntimeSession,
  AttentionItem,
  AttentionLocalState,
  HarnessCapabilities,
  TaskPacket,
} from '../../core/types';
import type { MemorySearchHit } from '../../core/memory/types';
import { probeLiveExecutions } from './runtimeInspectorModel';
import {
  DEMO_SNAPSHOT,
  DEMO_PROJECTS,
  DEMO_CONVERSATIONS,
  DEMO_CONTEXT,
  DEMO_FROZEN,
  DEMO_ACTIVITY,
  DEMO_RUNTIME_SESSIONS,
  DEMO_ATTENTION,
  DEMO_HARNESS_CAPABILITIES,
  DEMO_MEMORY_HITS,
  getDemoFrozenDetail,
  getDemoMemorySearchResult,
  getDemoMemoryDetail,
  getDemoHistorySearchResult,
  DEMO_HISTORY_CATALOG,
  DEMO_HISTORY_DETAILS,
} from './demo/demoData';
import type {
  HistoryCatalogResult,
  HistorySearchResult,
  HistorySessionDetail,
} from '../../core/history/types';
import type {
  MemorySearchResult,
  MemoryEvidenceExpansion,
} from '../../core/memory/types';
import { buildDispatchPlan, settleDispatchPlan, type DispatchOutcome } from '../../core/project/dispatchPipeline';
import { useMemo } from 'react';
import { contextFromAgentResult } from '../../core/project/executionRelations';
import {
  compileProjectionCandidate,
  computeProjectionSourceDigest,
  type ProjectionFactInputV0,
} from '../../core/projection/compiler';
import { compareProjectionRevisions } from '../../core/projection/delta';
import {
  buildVerifiedProjection,
  emptyProjectionBuildState,
} from '../../core/projection/revision';
import type {
  ProjectionBuildStateV0,
  VerifiedProjectionRevisionV0,
} from '../../core/projection/types';

export type View = 'projects' | 'control' | 'canvas' | 'compare' | 'context' | 'packet';
export type DraftSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

/** Exact Runtime Inspector target: one observed `harness::nativeExternalRef` execution id. */
export interface RuntimeInspectorTarget {
  executionId: string;
}

export interface LiveExecutionInfo {
  executionId: string;
  harness: string;
  externalSessionRef: string;
  startedAt: string;
  canCancel: boolean;
}

interface WorkbenchState {
  snapshot: OverlaySnapshot | null;
  loading: boolean;
  view: View;
  projectId: string | null;
  conversation: Conversation | null;
  demoMode: boolean;
  demoSessionId: string | null;
  staging: ContextItem[];
  taskSummary: string;
  frozen: FrozenPacketSummary[];
  frozenProblems: { file: string; message: string }[];
  frozenDetails: Record<string, FrozenPacket>;
  git: GitFacts | { error: string } | null;
  memoryBodies: Record<string, string>;
  projectFingerprints: SourceFingerprint[];
  recheckedSourceRefs: string[];
  recheckedFingerprints: SourceFingerprint[];
  orphanedDraftDecisionIds: string[];
  sourceChanges: string[];
  contextMessage: string | null;
  workspaceSession: WorkspaceSessionV1;
  resumeProblem: string | null;
  activity: ActivityEvent[];
  activityBeforeByte?: number;
  activityHasEarlier: boolean;
  runtimeSessions: RuntimeSession[];
  activityProblem: string | null;
  liveExecutions: LiveExecutionInfo[];
  runtimeTarget: RuntimeInspectorTarget | null;
  harnessCapabilities: Record<string, HarnessCapabilities>;
  attentionItems: AttentionItem[];
  attentionLocal: AttentionLocalState;
  attentionProblem: string | null;
/** Current verification outcome plus the last-known-good Projection revision. */
  projection: ProjectionBuildStateV0;
  /**
   * Bounded in-memory previous verified revision seam. Holds only the most
   * recent verified revision for the current Project; cleared on Project
   * switch / demo enter / exit / reset. Invalid or stale candidates never
   * become previous. App restart drops it. Never persisted.
   */
  projectionPrevious: VerifiedProjectionRevisionV0 | null;
  draftSaveState: DraftSaveState;
  packetValidity: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
  handoffStatus: string;
  handoffSourceRef: string | null;
  lastDispatchGroupId: string | null;
  lastDispatchOutcomes: DispatchOutcome[];
  syncIslandAttention: () => void;
  refreshProjection: () => void;
  initialize: () => Promise<void>;
  resumeWorkspace: (target?: WorkspaceTargetV1) => void;
  enterDemo: () => void;
  exitDemo: () => Promise<void>;
  resetDemo: () => void;
  load: (refresh?: boolean) => Promise<void>;
  reloadAndRecheck: () => Promise<void>;
  selectProject: (projectId: string) => void;
  selectConversation: (c: Conversation) => void;
  selectProjectedConversation: (conversationRef: string) => void;
  setView: (v: View) => void;
  setStagingState: (id: string, state: ContextItem['state']) => void;
  togglePin: (id: string) => Promise<void>;
  setTaskSummary: (s: string) => void;
  refreshFrozen: () => Promise<void>;
  loadFrozenDetail: (summary: FrozenPacketSummary) => Promise<FrozenPacket | null>;
  // Demo-aware data accessors (store boundary chooses fixture vs IPC)
  listHistory: () => Promise<HistoryCatalogResult>;
  searchHistory: (query: { text: string; limit?: number }) => Promise<HistorySearchResult>;
  readHistoryDetail: (sessionId: string) => Promise<HistorySessionDetail | null>;
  searchMemory: (query: { text: string; limit?: number }) => Promise<MemorySearchResult>;
  expandMemory: (id: string) => Promise<MemoryEvidenceExpansion | null>;
  loadGit: (projectId: string) => Promise<void>;
  loadMemoryBody: (memoryId: string) => Promise<void>;
  addProjectFile: (asReference: boolean) => Promise<void>;
  refreshProjectFiles: () => Promise<void>;
  recheckSources: () => Promise<void>;
  addManualContext: (title: string, body: string) => void;
  addMemoryContext: (hit: MemorySearchHit, pinned?: boolean) => Promise<void>;
  clearDraft: () => Promise<void>;
  loadActivity: () => Promise<void>;
  loadEarlierActivity: () => Promise<void>;
  ingestActivity: (event: ActivityEvent) => void;
  clearActivity: () => Promise<void>;
  refreshLiveExecutions: () => Promise<void>;
  openRuntimeInspector: (target: RuntimeInspectorTarget) => void;
  loadHarnessCapabilities: () => Promise<void>;
  sendTask: (summary: string, harness: 'codex' | 'claude' | 'deepseek' | ('codex' | 'claude' | 'deepseek')[]) => Promise<DispatchOutcome[]>;
  addResultToContext: (event: ActivityEvent) => void;
  clearHandoffSource: () => void;
  loadAttentionLocal: () => Promise<void>;
  dismissAttention: (item: AttentionItem) => Promise<void>;
  setPacketValidity: (validity: WorkbenchState['packetValidity']) => void;
  setHandoffStatus: (status: string) => void;
  freezePacket: (packet: TaskPacket) => Promise<FrozenPacketSummary | undefined>;
}

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
let workspaceTimer: ReturnType<typeof setTimeout> | null = null;

const EMPTY_WORKSPACE_SESSION: WorkspaceSessionV1 = {
  schemaVersion: 1,
  last: null,
  recent: [],
};

const EMPTY_ATTENTION_LOCAL: AttentionLocalState = { schemaVersion: 1, dismissed: {} };

// Demo-in-memory state (never persisted, discarded on reset/exit)
interface DemoFrozenPacket {
  summary: FrozenPacketSummary;
  detail: FrozenPacket;
}

function createDemoFrozenState(): { frozen: FrozenPacketSummary[]; frozenDetails: Record<string, FrozenPacket> } {
  const frozen = DEMO_FROZEN.map((f) => ({ ...f }));
  const frozenDetails: Record<string, FrozenPacket> = {};
  for (const f of frozen) {
    frozenDetails[f.hash] = getDemoFrozenDetail(f);
  }
  return { frozen, frozenDetails };
}

let demoFrozenState = createDemoFrozenState();
let demoWorkspaceSession = EMPTY_WORKSPACE_SESSION;
let demoDraftState: WorkbenchDraftV1 | null = null;

// Demo Memory use tracking (in-memory only, discarded on reset/exit)
interface DemoMemoryUseRecord {
  memoryId: string;
  count: number;
  lastUsedAt: string;
  pinned: boolean;
}
const demoMemoryUse = new Map<string, DemoMemoryUseRecord>();

type AttentionProjectionSource = Pick<
  WorkbenchState,
  'activity' | 'runtimeSessions' | 'attentionLocal' | 'frozen' | 'snapshot'
    | 'recheckedSourceRefs' | 'recheckedFingerprints' | 'projectFingerprints'
>;

function projectAttention(state: AttentionProjectionSource): AttentionItem[] {
  const current = new Map(state.snapshot?.sourceFingerprints.map((item) => [item.sourceRef, item.sha256]) ?? []);
  for (const sourceRef of state.recheckedSourceRefs) current.delete(sourceRef);
  for (const item of state.recheckedFingerprints) current.set(item.sourceRef, item.sha256);
  for (const item of state.projectFingerprints) current.set(item.sourceRef, item.sha256);
  const packetFacts = state.frozen.map((packet) => {
    const validity = checkPacketValidity(packet, [...current].map(([sourceRef, sha256]) => ({ sourceRef, sha256 })));
    const dependencyVersion = packet.sourceFingerprints
      .map((item) => `${item.sourceRef}=${current.get(item.sourceRef) ?? 'MISSING'}`)
      .sort()
      .join('\n');
    const versionHash = computeStringHash(dependencyVersion);
    return {
      key: `${packet.hash}:${validity}:${versionHash}`,
      projectId: packet.projectId,
      conversationKey: packet.conversationKey,
      validity,
      packetRef: `v${packet.version}:${packet.hash}`,
      observed: {
        source: 'process' as const,
        sourceRef: `workbench-frozen-packet:${packet.projectId}:${packet.conversationKey}:${packet.version}:${packet.hash}`,
        observedAt: new Date().toISOString(),
        verification: 'VERIFIED' as const,
      },
    };
  });
  return applyAttentionLocalState(reduceAttention({
    activity: state.activity,
    runtimeSessions: state.runtimeSessions,
    packetFacts,
  }), state.attentionLocal);
}

type RendererProjectionSource = Pick<
  WorkbenchState,
  'snapshot' | 'projectId' | 'activity' | 'liveExecutions' | 'git' | 'projection'
>;

function projectionInput(state: RendererProjectionSource): ProjectionFactInputV0 | null {
  if (!state.snapshot || !state.projectId) return null;
  const gitFacts = state.git && 'projectId' in state.git ? state.git : null;
  const priorLayout = state.projection.current?.candidate.scope.projectId === state.projectId
    ? state.projection.current.candidate.layoutState
    : undefined;
  return {
    projectId: state.projectId,
    snapshot: state.snapshot,
    activity: state.activity,
    liveExecutionIds: state.liveExecutions.map((item) => item.executionId),
    gitFacts,
    ...(priorLayout ? { layoutState: priorLayout } : {}),
  };
}

function scheduleWorkspaceSave(state: WorkbenchState): void {
  if (!state.projectId) return;
  const target: WorkspaceTargetV1 = {
    projectId: state.projectId,
    conversationScope: state.conversation
      ? {
          kind: 'migration-conversation-key',
          conversationKey: state.conversation.key,
          canonicalConversationId: state.conversation.conversationId,
        }
      : undefined,
    // Compare is a renderer projection, not a persisted Workspace contract.
    view: state.view === 'compare' ? 'control' : state.view,
    usedAt: new Date().toISOString(),
  };
  const session = updateWorkspaceSession(state.workspaceSession, target);
  useWorkbench.setState({ workspaceSession: session });
  if (state.demoMode) {
    demoWorkspaceSession = session;
    return;
  }
  if (workspaceTimer) clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => {
    workspaceTimer = null;
    void window.wb.saveWorkspaceSession(session).catch((error) => {
      useWorkbench.setState({ resumeProblem: `Workspace continuity save failed: ${String(error)}` });
    });
  }, 180);
}

function draftFromState(state: WorkbenchState): WorkbenchDraftV1 | null {
  if (!state.projectId || !state.conversation) return null;
  return buildWorkbenchDraft(
    state.projectId,
    state.conversation.key,
    state.conversation.conversationId,
    state.taskSummary,
    state.staging,
    state.projectFingerprints,
  );
}

function scheduleDraftSave(state: WorkbenchState): void {
  const draft = draftFromState(state);
  if (!draft) return;
  const key = `${draft.scope.projectId}\0${draft.scope.conversationKey}`;
  const prior = draftTimers.get(key);
  if (prior) clearTimeout(prior);
  useWorkbench.setState({ draftSaveState: 'dirty' });
  if (state.demoMode) {
    demoDraftState = draft;
    useWorkbench.setState({ draftSaveState: 'saved' });
    return;
  }
  draftTimers.set(key, setTimeout(() => {
    draftTimers.delete(key);
    useWorkbench.setState({ draftSaveState: 'saving' });
    void window.wb.saveDraft(draft).then(() => {
      useWorkbench.setState({ draftSaveState: 'saved' });
    }).catch((error) => {
      useWorkbench.setState({
        draftSaveState: 'error',
        contextMessage: `Draft save failed: ${String(error)}`,
      });
    });
  }, 350));
}

function messages(parts: (string | null | undefined)[]): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join('\n') : null;
}

async function refreshMemoryContextItem(item: Pick<ContextItem, 'id' | 'state' | 'pinned'>): Promise<ContextItem | null> {
  if (!item.id.startsWith('memory-projection:')) return null;
  const memoryId = item.id.slice('memory-projection:'.length);
  const expanded = await window.wb.expandMemory(memoryId);
  if (!expanded || expanded.evidence.verdict !== 'SUFFICIENT') return null;
  const currentness = 'currentness' in expanded.record ? expanded.record.currentness : expanded.record.status;
  const summary = 'statement' in expanded.record ? expanded.record.statement : expanded.record.summary;
  const fresh = createMemoryProjectionContext({
    id: memoryId,
    recordType: 'statement' in expanded.record ? 'fact' : 'event',
    summary,
    sourceRefs: expanded.record.sourceRefs,
    sourceSessionIds: 'sourceSessionIds' in expanded.record ? expanded.record.sourceSessionIds : [],
    currentness,
    verification: expanded.record.verification,
    score: 0,
    useCount: 0,
  });
  return { ...fresh, state: item.state, pinned: item.state === 'included' ? item.pinned : false };
}

async function verifyMemoryContextItems(projectId: string, items: ContextItem[]): Promise<{
  items: ContextItem[];
  checkedSourceRefs: string[];
  fingerprints: SourceFingerprint[];
  errors: string[];
}> {
  const refs = [...new Set(items.flatMap((item) => item.sourceRefs?.length ? item.sourceRefs : item.sourceRef ? [item.sourceRef] : []))];
  if (refs.length === 0) return { items, checkedSourceRefs: [], fingerprints: [], errors: [] };
  const checked = await window.wb.recheckSources(projectId, refs);
  const verified = new Set(checked.fingerprints.map((item) => item.sourceRef));
  return {
    items: items.filter((item) => (item.sourceRefs?.length ? item.sourceRefs : item.sourceRef ? [item.sourceRef] : []).every((ref) => verified.has(ref))),
    checkedSourceRefs: checked.checkedSourceRefs,
    fingerprints: checked.fingerprints,
    errors: checked.errors.map((item) => `${item.sourceRef}: ${item.message}`),
  };
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  snapshot: null,
  loading: false,
  view: 'projects',
  projectId: null,
  conversation: null,
  demoMode: false,
  demoSessionId: null,
  staging: [],
  taskSummary: '',
  frozen: [],
  frozenProblems: [],
  frozenDetails: {},
  git: null,
  memoryBodies: {},
  projectFingerprints: [],
  recheckedSourceRefs: [],
  recheckedFingerprints: [],
  orphanedDraftDecisionIds: [],
  sourceChanges: [],
  contextMessage: null,
  workspaceSession: EMPTY_WORKSPACE_SESSION,
  resumeProblem: null,
  activity: [],
  activityBeforeByte: undefined,
  activityHasEarlier: false,
  runtimeSessions: [],
  activityProblem: null,
  liveExecutions: [],
  runtimeTarget: null,
  harnessCapabilities: {},
  attentionItems: [],
attentionLocal: EMPTY_ATTENTION_LOCAL,
  attentionProblem: null,
  projection: emptyProjectionBuildState(),
  projectionPrevious: null,
  draftSaveState: 'clean',
  packetValidity: 'UNKNOWN',
  handoffStatus: 'IDLE',
  handoffSourceRef: null,
  lastDispatchGroupId: null,
  lastDispatchOutcomes: [],
  syncIslandAttention: () => {
    const items = get().attentionItems;
    if (window.wb?.syncIslandAttention) {
      void window.wb.syncIslandAttention(items);
    }
  },
refreshProjection: () => {
    const before = get();
    const input = projectionInput(before);
    if (!input) {
      set({ projection: emptyProjectionBuildState(), projectionPrevious: null });
      return;
    }
    const projection = buildVerifiedProjection(input, before.projection.current, {
      recheckSourceDigest: () => {
        const latest = projectionInput(get());
        return latest
          ? computeProjectionSourceDigest(latest, compileProjectionCandidate(latest))
          : '0'.repeat(64);
      },
    });
    // Maintain the bounded previous/current seam: a fresh verified revision
    // for the same Project that has a different revisionHash from the prior
    // verified revision becomes the new "previous". INVALID/STALE never
    // promote previous; cross-project prior revisions are evicted.
    let projectionPrevious: VerifiedProjectionRevisionV0 | null = before.projectionPrevious;
    if (projectionPrevious
      && projectionPrevious.candidate.scope.projectId !== input.projectId) {
      projectionPrevious = null;
    }
    const priorVerified = before.projection.current;
    if (projection.status === 'VERIFIED'
      && projection.current
      && projection.current.candidate.scope.projectId === input.projectId
      && priorVerified
      && priorVerified.candidate.scope.projectId === input.projectId
      && priorVerified.revisionHash !== projection.current.revisionHash) {
      projectionPrevious = priorVerified;
    }
    set({ projection, projectionPrevious });
  },

  initialize: async () => {
    await get().load(true);
    await get().loadActivity();
    await get().refreshLiveExecutions();
    await get().loadAttentionLocal();
    const loaded = await window.wb.loadWorkspaceSession();
    set({
      workspaceSession: loaded.session ?? EMPTY_WORKSPACE_SESSION,
      resumeProblem: loaded.problem ?? null,
    });
    if (loaded.session?.last) get().resumeWorkspace(loaded.session.last);
  },

  enterDemo: () => {
    const firstProject = DEMO_PROJECTS[0];
    const firstConversation = DEMO_CONVERSATIONS[0];
    set({
      demoMode: true,
      demoSessionId: globalThis.crypto.randomUUID(),
      loading: false,
      snapshot: DEMO_SNAPSHOT,
      view: 'control',
      projectId: firstProject.projectId,
      conversation: firstConversation,
      staging: DEMO_CONTEXT,
      taskSummary: '',
      frozen: DEMO_FROZEN,
      frozenProblems: [],
      frozenDetails: {},
      git: null,
      memoryBodies: {},
      projectFingerprints: DEMO_SNAPSHOT.sourceFingerprints,
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: null,
      draftSaveState: 'clean',
      packetValidity: 'CURRENT',
      handoffStatus: 'IDLE',
      activity: DEMO_ACTIVITY,
      activityBeforeByte: undefined,
      activityHasEarlier: false,
      runtimeSessions: DEMO_RUNTIME_SESSIONS as RuntimeSession[],
      activityProblem: null,
liveExecutions: [],
      attentionItems: DEMO_ATTENTION,
      handoffSourceRef: null,
      lastDispatchGroupId: null,
      lastDispatchOutcomes: [],
      harnessCapabilities: DEMO_HARNESS_CAPABILITIES,
      projectionPrevious: null,
    });
    get().refreshProjection();
    get().syncIslandAttention();
  },

  exitDemo: async () => {
    // Leave demo mode and reload the real workspace. Demo state is recreated on
    // the next enterDemo(); nothing was persisted, so real truth is untouched.
    // Reset all demo in-memory state
    demoFrozenState = createDemoFrozenState();
    demoMemoryUse.clear();
    demoDraftState = null;
    demoWorkspaceSession = EMPTY_WORKSPACE_SESSION;
set({
      demoMode: false,
      demoSessionId: null,
      snapshot: null,
      projectId: null,
      conversation: null,
      view: 'projects',
      staging: [],
      activity: [],
      runtimeSessions: [],
      attentionItems: [],
      handoffSourceRef: null,
      lastDispatchGroupId: null,
      lastDispatchOutcomes: [],
      projection: emptyProjectionBuildState(),
      projectionPrevious: null,
    });
    await get().initialize();
  },

  resetDemo: () => {
    if (!get().demoMode) return;
    const firstProject = DEMO_PROJECTS[0];
    // Reset all demo in-memory state
    demoFrozenState = createDemoFrozenState();
    demoMemoryUse.clear();
    demoDraftState = null;
    demoWorkspaceSession = EMPTY_WORKSPACE_SESSION;
    set({
      snapshot: DEMO_SNAPSHOT,
      demoSessionId: globalThis.crypto.randomUUID(),
      projectId: firstProject.projectId,
      conversation: DEMO_CONVERSATIONS[0],
      staging: DEMO_CONTEXT,
      taskSummary: '',
      frozen: DEMO_FROZEN,
      activity: DEMO_ACTIVITY,
      runtimeSessions: DEMO_RUNTIME_SESSIONS as RuntimeSession[],
      attentionItems: DEMO_ATTENTION,
      packetValidity: 'CURRENT',
      draftSaveState: 'clean',
contextMessage: null,
      handoffStatus: 'IDLE',
      handoffSourceRef: null,
      lastDispatchGroupId: null,
      lastDispatchOutcomes: [],
      harnessCapabilities: DEMO_HARNESS_CAPABILITIES,
      projectionPrevious: null,
    });
    get().refreshProjection();
    get().syncIslandAttention();
  },

  resumeWorkspace: (requested) => {
    const { snapshot, workspaceSession } = get();
    if (!snapshot) return;
    const resolved = resolveWorkspaceTarget(snapshot, requested ?? workspaceSession.last);
    if (!resolved.target) {
      set({
        projectId: null,
        conversation: null,
        view: 'projects',
        staging: [],
        resumeProblem: resolved.problem ?? 'No recent workspace to resume.',
      });
      return;
    }
    const target = resolved.target;
    get().selectProject(target.projectId);
    if (target.conversationScope) {
      const conversation = snapshot.conversations.find(
        (item) => item.project === target.projectId
          && item.key === target.conversationScope!.conversationKey,
      );
      if (!conversation) {
        set({ projectId: null, conversation: null, view: 'projects', staging: [], resumeProblem: 'Conversation disappeared during resume.' });
        return;
      }
      get().selectConversation(conversation);
    }
    set({ view: target.view, resumeProblem: null });
    scheduleWorkspaceSave(get());
  },

load: async (refresh) => {
    const { demoMode } = get();
    if (demoMode) {
      // Demo mode: already has DEMO_SNAPSHOT, no real overlay load needed
      set({ loading: false });
      get().syncIslandAttention();
      return;
    }
    set({ loading: true });
    const snapshot = await window.wb.loadOverlay({ refresh });
    const priorState = get();
    const refreshedMemoryCandidates = refresh
      ? (await Promise.all(priorState.staging.filter((item) => item.id.startsWith('memory-projection:')).map(refreshMemoryContextItem)))
        .filter((item): item is ContextItem => item !== null)
      : [];
    const refreshedMemory = refresh && priorState.projectId
      ? await verifyMemoryContextItems(priorState.projectId, refreshedMemoryCandidates)
      : { items: refreshedMemoryCandidates, checkedSourceRefs: [], fingerprints: [], errors: [] };
    const refreshedMemoryIds = new Set(refreshedMemory.items.map((item) => item.id));
    const removedMemoryIds = refresh
      ? priorState.staging.filter((item) => item.id.startsWith('memory-projection:') && !refreshedMemoryIds.has(item.id)).map((item) => item.id)
      : [];
    set((state) => {
      const sameScope = state.projectId === priorState.projectId
        && state.conversation?.key === priorState.conversation?.key;
      const applyScopedRefresh = Boolean(refresh && sameScope);
      let staging = state.staging;
      let orphanedDraftDecisionIds = state.orphanedDraftDecisionIds;
      if (state.projectId && applyScopedRefresh) {
        const fresh = [...buildStaging(snapshot, state.projectId), ...refreshedMemory.items];
        const localDraft = draftFromState(state);
        if (localDraft) {
          const restored = restoreWorkbenchDraft(
            fresh,
            localDraft,
            state.staging.filter((item) => item.source === `project-file:${state.projectId}`),
          );
          staging = restored.staging;
          orphanedDraftDecisionIds = [...new Set([...restored.orphanedDecisionIds, ...removedMemoryIds])];
        } else {
          staging = fresh;
        }
      }
      const recheckedSourceRefs = applyScopedRefresh ? refreshedMemory.checkedSourceRefs : state.recheckedSourceRefs;
      const recheckedFingerprints = applyScopedRefresh ? refreshedMemory.fingerprints : state.recheckedFingerprints;
      const next = { ...state, snapshot, staging, orphanedDraftDecisionIds, recheckedSourceRefs, recheckedFingerprints };
      return {
        snapshot,
        loading: false,
        memoryBodies: applyScopedRefresh ? {} : state.memoryBodies,
        staging,
        orphanedDraftDecisionIds,
        recheckedSourceRefs,
        recheckedFingerprints,
        contextMessage: applyScopedRefresh
          ? messages([
              state.contextMessage,
              removedMemoryIds.length > 0 ? `Orphaned draft decisions: ${removedMemoryIds.join(', ')}` : null,
              refreshedMemory.errors.length > 0 ? `Memory source unavailable: ${refreshedMemory.errors.join(', ')}` : null,
            ])
          : state.contextMessage,
        attentionItems: projectAttention(next),
      };
    });
    get().refreshProjection();
    get().syncIslandAttention();
  },

  reloadAndRecheck: async () => {
    await get().load(true);
    await get().recheckSources();
  },

selectProject: (projectId) => {
    const { snapshot, demoMode } = get();
    set({
      projectId,
      view: 'control',
      conversation: null,
      staging: snapshot ? buildStaging(snapshot, projectId) : [],
      taskSummary: '',
      frozen: demoMode ? demoFrozenState.frozen : [],
      frozenProblems: [],
      frozenDetails: demoMode ? demoFrozenState.frozenDetails : {},
      git: null,
      projectFingerprints: [],
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: null,
      draftSaveState: 'clean',
      packetValidity: 'UNKNOWN',
      handoffStatus: 'IDLE',
      projectionPrevious: null,
    });
    get().refreshProjection();
    set((state) => ({ attentionItems: projectAttention(state) }));
    get().syncIslandAttention();
    if (!demoMode) {
      void get().loadGit(projectId);
      scheduleWorkspaceSave(get());
    }
  },

  selectConversation: (conversation) => {
    const { projectId, snapshot, demoMode } = get();
    if (!projectId || !snapshot) return;
    set({
      conversation,
      staging: buildStaging(snapshot, projectId),
      taskSummary: '',
      projectFingerprints: [],
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: null,
      draftSaveState: 'clean',
      packetValidity: 'UNKNOWN',
      handoffStatus: 'IDLE',
    });
    set((state) => ({ attentionItems: projectAttention(state) }));
    get().syncIslandAttention();
    if (!demoMode) {
      void (async () => {
        const loaded = await window.wb.loadDraft(projectId, conversation.key);
        if (get().projectId !== projectId || get().conversation?.key !== conversation.key) return;
        if (!loaded.draft) {
          set({ contextMessage: loaded.problem ?? null });
          await get().refreshFrozen();
          return;
        }
        const fileResult = await window.wb.refreshProjectFiles(
          projectId,
          loaded.draft.projectFiles.map((file) => ({
            relativePath: file.relativePath,
            asReference: file.asReference,
          })),
        );
        const restoredMemoryCandidates = (await Promise.all(
          loaded.draft.projectedDecisions
            .filter((decision) => decision.itemId.startsWith('memory-projection:'))
            .map((decision) => refreshMemoryContextItem({ id: decision.itemId, state: decision.state, pinned: decision.pinned })),
        )).filter((item): item is ContextItem => item !== null);
        const restoredMemory = await verifyMemoryContextItems(projectId, restoredMemoryCandidates);
        if (get().projectId !== projectId || get().conversation?.key !== conversation.key) return;
        const restored = restoreWorkbenchDraft(
          [...buildStaging(snapshot, projectId), ...restoredMemory.items],
          loaded.draft,
          fileResult.entries.map((entry) => entry.item),
        );
        const currentByRef = new Map(fileResult.entries.map((entry) => [entry.fingerprint.sourceRef, entry.fingerprint.sha256]));
        const sourceChanges = loaded.draft.projectFiles.flatMap((file) => {
          const ref = projectFileSourceRef(projectId, file.relativePath);
          const current = currentByRef.get(ref);
          return file.lastKnownSha256 && current && file.lastKnownSha256 !== current ? [file.relativePath] : [];
        });
        set({
          taskSummary: loaded.draft.taskSummary,
          staging: restored.staging,
          projectFingerprints: fileResult.entries.map((entry) => entry.fingerprint),
          recheckedSourceRefs: restoredMemory.checkedSourceRefs,
          recheckedFingerprints: restoredMemory.fingerprints,
          orphanedDraftDecisionIds: restored.orphanedDecisionIds,
          sourceChanges,
          contextMessage: messages([
            restored.orphanedDecisionIds.length > 0
              ? `Orphaned draft decisions: ${restored.orphanedDecisionIds.join(', ')}`
              : null,
            restored.unavailableProjectFiles.length > 0
              ? `Unavailable project files: ${restored.unavailableProjectFiles.join(', ')}`
              : null,
            sourceChanges.length > 0 ? `Source changed since draft save: ${sourceChanges.join(', ')}` : null,
            fileResult.errors.length > 0 ? fileResult.errors.join('\n') : null,
            restoredMemory.errors.length > 0 ? `Memory source unavailable: ${restoredMemory.errors.join(', ')}` : null,
          ]),
          draftSaveState: 'saved',
        });
        await get().refreshFrozen();
        await get().recheckSources();
      })();
    } else {
      // Demo mode: use in-memory demo draft state if available
      if (demoDraftState && demoDraftState.scope.conversationKey === conversation.key) {
        set({
          taskSummary: demoDraftState.taskSummary,
          draftSaveState: 'saved',
        });
      }
    }
    scheduleWorkspaceSave(get());
  },

  setView: (view) => {
    set({ view });
    scheduleWorkspaceSave(get());
  },

  setStagingState: (id, state) => {
    set((current) => ({
      staging: current.staging.map((item) =>
        item.id === id ? { ...item, state, pinned: state === 'included' ? item.pinned : false } : item,
      ),
    }));
    scheduleDraftSave(get());
  },

  togglePin: async (id) => {
    const { demoMode } = get();
    const before = get();
    const item = before.staging.find((candidate) => candidate.id === id);
    if (item?.id.startsWith('memory-projection:') && item.state === 'included' && !item.pinned) {
      if (demoMode) {
        // Demo mode: pin in-memory only, no real IPC
        const memoryId = item.id.slice('memory-projection:'.length);
        set((state) => {
          const stillPinnable = state.staging.some((candidate) => candidate.id === id && candidate.state === 'included' && !candidate.pinned);
          if (!stillPinnable) return state;
          return {
            staging: state.staging.map((candidate) => candidate.id === id ? { ...candidate, pinned: true } : candidate),
          };
        });
        // Demo mode: track memory use in-memory only
        const existing = demoMemoryUse.get(memoryId);
        demoMemoryUse.set(memoryId, {
          memoryId,
          count: (existing?.count ?? 0) + 1,
          lastUsedAt: new Date().toISOString(),
          pinned: true,
        });
        scheduleDraftSave(get());
        return;
      }
      try {
        const scope = { projectId: before.projectId, conversationKey: before.conversation?.key };
        const memoryId = item.id.slice('memory-projection:'.length);
        const expanded = await window.wb.expandMemory(memoryId);
        if (!expanded || expanded.evidence.verdict !== 'SUFFICIENT' || !scope.projectId || !scope.conversationKey) {
          throw new Error('Memory evidence is no longer sufficient; Pin was not changed.');
        }
        const checked = await window.wb.recheckSources(scope.projectId, expanded.record.sourceRefs);
        if (checked.errors.length > 0 || checked.fingerprints.length !== expanded.record.sourceRefs.length) {
          throw new Error('Memory source fingerprint could not be verified; Pin was not changed.');
        }
        let committed = false;
        set((state) => {
          const stillInScope = state.projectId === scope.projectId && state.conversation?.key === scope.conversationKey;
          const stillPinnable = state.staging.some((candidate) => candidate.id === id && candidate.state === 'included' && !candidate.pinned);
          if (!stillInScope || !stillPinnable) return state;
          committed = true;
          return {
            staging: state.staging.map((candidate) => candidate.id === id ? { ...candidate, pinned: true } : candidate),
            recheckedSourceRefs: [...new Set([...state.recheckedSourceRefs, ...checked.checkedSourceRefs])],
            recheckedFingerprints: [
              ...state.recheckedFingerprints.filter((prior) => !checked.checkedSourceRefs.includes(prior.sourceRef)),
              ...checked.fingerprints,
            ],
          };
        });
        if (!committed) return;
        try {
          await window.wb.recordMemoryUse(memoryId);
        } catch (error) {
          set((state) => state.projectId === scope.projectId && state.conversation?.key === scope.conversationKey
            ? { staging: state.staging.map((candidate) => candidate.id === id ? { ...candidate, pinned: false } : candidate), contextMessage: String(error) }
            : state);
          return;
        }
        scheduleDraftSave(get());
        return;
      } catch (error) {
        set({ contextMessage: String(error) });
        return;
      }
    }
    set((current) => ({
      staging: current.staging.map((item) =>
        item.id === id && item.state === 'included' ? { ...item, pinned: !item.pinned } : item,
      ),
    }));
    scheduleDraftSave(get());
  },

  setTaskSummary: (taskSummary) => {
    set({ taskSummary });
    scheduleDraftSave(get());
  },

  refreshFrozen: async () => {
    const { projectId, conversation, demoMode } = get();
    if (!projectId || !conversation) return;
    if (demoMode) {
      // Demo mode: use in-memory frozen state
      set((state) => ({
        frozen: demoFrozenState.frozen,
        frozenProblems: [],
        frozenDetails: demoFrozenState.frozenDetails,
        attentionItems: projectAttention({ ...state, frozen: demoFrozenState.frozen }),
      }));
      get().syncIslandAttention();
      return;
    }
    const result = await window.wb.listFrozen(projectId, conversation.key);
    if (get().projectId === projectId && get().conversation?.key === conversation.key) {
      set((state) => ({
        frozen: result.packets,
        frozenProblems: result.problems,
        frozenDetails: {},
        attentionItems: projectAttention({ ...state, frozen: result.packets }),
      }));
      get().syncIslandAttention();
    }
  },

  selectProjectedConversation: (conversationRef) => {
    const { projection, snapshot, projectId } = get();
    if (!projection.current || !snapshot || !projectId) return;
    if (projection.current.candidate.scope.projectId !== projectId) return;
    const projected = projection.current.candidate.semanticFacts.conversations
      .find((item) => item.id === conversationRef);
    if (!projected) return;
    const conversation = snapshot.conversations.find((item) =>
      item.project === projectId && item.key === projected.conversationKey);
    if (conversation) get().selectConversation(conversation);
  },

  freezePacket: async (packet) => {
    const { demoMode } = get();
    if (demoMode) {
      // Demo mode: add to in-memory frozen state
      // Version per (projectId, conversationKey) pair: max version for this exact pair + 1
      const convFrozen = demoFrozenState.frozen.filter(
        (f) => f.projectId === packet.projectId && f.conversationKey === packet.conversationKey,
      );
      const nextVersion = convFrozen.length > 0 ? Math.max(...convFrozen.map((f) => f.version)) + 1 : 1;
      const newFrozen: FrozenPacketSummary = {
        schemaVersion: 1,
        packetId: packet.packetId,
        projectId: packet.projectId,
        conversationKey: packet.conversationKey,
        conversationId: packet.conversationId,
        version: nextVersion,
        hash: computeFrozenPacketHash(packet),
        frozenAt: new Date().toISOString(),
        roughTokens: packet.roughTokens,
        taskSummary: packet.taskSummary,
        sourceFingerprints: packet.sourceFingerprints,
        unresolvedDependencies: packet.unresolvedDependencies,
      };
      const newDetail: FrozenPacket = {
        ...packet,
        frozenAt: newFrozen.frozenAt,
        version: newFrozen.version,
        hash: newFrozen.hash,
      };
      demoFrozenState = {
        frozen: [...demoFrozenState.frozen, newFrozen],
        frozenDetails: { ...demoFrozenState.frozenDetails, [newFrozen.hash]: newDetail },
      };
      set((state) => ({
        frozen: demoFrozenState.frozen,
        frozenDetails: demoFrozenState.frozenDetails,
        attentionItems: projectAttention({ ...state, frozen: demoFrozenState.frozen }),
      }));
      get().syncIslandAttention();
      return newFrozen; // Return the created summary for UI
    }
    const { frozen: f, path } = await window.wb.freezePacket(packet);
    await get().refreshFrozen();
  },

  loadFrozenDetail: async (summary) => {
    const { projectId, conversation, frozenDetails } = get();
    if (!projectId || !conversation) return null;
    const cached = frozenDetails[summary.hash];
    if (cached) return cached;
    if (get().demoMode) {
      const detail = getDemoFrozenDetail(summary);
      if (detail && get().projectId === projectId && get().conversation?.key === conversation.key) {
        set((state) => ({ frozenDetails: { ...state.frozenDetails, [summary.hash]: detail } }));
      }
      return detail;
    }
    const detail = await window.wb.readFrozenDetail(projectId, conversation.key, {
      version: summary.version,
    });
    if (detail && get().projectId === projectId && get().conversation?.key === conversation.key) {
      set((state) => ({ frozenDetails: { ...state.frozenDetails, [summary.hash]: detail } }));
    }
    return detail;
  },

  listHistory: async () => {
    if (get().demoMode) return DEMO_HISTORY_CATALOG;
    return window.wb.listHistory();
  },

  searchHistory: async (query) => {
    if (get().demoMode) return getDemoHistorySearchResult(query.text);
    return window.wb.searchHistory(query);
  },

  readHistoryDetail: async (sessionId) => {
    if (get().demoMode) return DEMO_HISTORY_DETAILS[sessionId] ?? null;
    return window.wb.readHistoryDetail(sessionId);
  },

  searchMemory: async (query) => {
    if (get().demoMode) return getDemoMemorySearchResult(query.text);
    return window.wb.searchMemory(query);
  },

  expandMemory: async (id) => {
    if (get().demoMode) return getDemoMemoryDetail(id);
    return window.wb.expandMemory(id);
  },

  loadGit: async (projectId) => {
    if (get().demoMode) {
      set({ git: { error: 'DEMO · NO REAL GIT' } });
      get().refreshProjection();
      return;
    }
    const result = await window.wb.loadGit(projectId);
    if (get().projectId === projectId) {
      set({ git: result.facts ?? { error: result.error ?? 'unknown' } });
      get().refreshProjection();
    }
  },

  loadMemoryBody: async (memoryId) => {
    if (get().memoryBodies[memoryId] !== undefined) return;
    const body = await window.wb.readMemory(memoryId);
    set((state) => ({ memoryBodies: { ...state.memoryBodies, [memoryId]: body ?? '(not found)' } }));
  },

  addProjectFile: async (asReference) => {
    const { projectId } = get();
    if (!projectId) return;
    const result = await window.wb.chooseProjectFile(projectId, asReference);
    if (result.canceled) return;
    if (!result.item || !result.fingerprint) {
      set({ contextMessage: result.error ?? 'Unable to add project file.' });
      return;
    }
    const item = result.item;
    const fingerprint = result.fingerprint;
    set((state) => ({
      staging: [...state.staging.filter((current) => current.id !== item.id), item],
      projectFingerprints: [
        ...state.projectFingerprints.filter((current) => current.sourceRef !== fingerprint.sourceRef),
        fingerprint,
      ],
      contextMessage: `${asReference ? 'Reference' : 'Context'} added: ${item.relativePath}`,
    }));
    scheduleDraftSave(get());
  },

  refreshProjectFiles: async () => {
    const { projectId, staging } = get();
    if (!projectId) return;
    const files = staging
      .filter((item) => item.source === `project-file:${projectId}` && item.relativePath)
      .map((item) => ({ relativePath: item.relativePath!, asReference: item.isReference }));
    if (files.length === 0) {
      set({ projectFingerprints: [] });
      return;
    }
    const result = await window.wb.refreshProjectFiles(projectId, files);
    set((state) => ({
      staging: state.staging.map((current) => {
        const refreshed = result.entries.find((entry) => entry.item.id === current.id)?.item;
        return refreshed ? { ...refreshed, state: current.state, pinned: current.pinned } : current;
      }),
      projectFingerprints: result.entries.map((entry) => entry.fingerprint),
      contextMessage: result.errors.length > 0 ? result.errors.join('\n') : state.contextMessage,
    }));
  },

  recheckSources: async () => {
    const before = get();
    if (before.demoMode) return;
    const { projectId, conversation, snapshot } = before;
    if (!projectId || !conversation || !snapshot) return;
    const adapter = snapshot.projects.find((item) => item.projectId === projectId);
    const refs = new Set<string>([
      overlayFileSourceRef('memory/MEMORY.md'),
      ...(adapter?.canonicalSource?.path ? [projectFileSourceRef(projectId, adapter.canonicalSource.path)] : []),
      ...before.staging.filter((item) => item.state === 'included').flatMap((item) =>
        (item.sourceRefs?.length ? item.sourceRefs : item.sourceRef ? [item.sourceRef] : [])
          .filter((sourceRef) => !sourceRef.startsWith('harness-result:'))),
      ...before.staging.filter((item) => item.source === `project-file:${projectId}`).flatMap((item) => item.sourceRef ? [item.sourceRef] : []),
      ...before.frozen.flatMap((packet) => [
        ...packet.sourceFingerprints.map((item) => item.sourceRef),
        ...(packet.unresolvedDependencies ?? []),
      ]),
    ]);
    const prior = new Map([
      ...snapshot.sourceFingerprints,
      ...before.recheckedFingerprints,
      ...before.projectFingerprints,
    ].map((item) => [item.sourceRef, item.sha256]));
    const explicitFiles = before.staging
      .filter((item) => item.source === `project-file:${projectId}` && item.relativePath)
      .map((item) => ({ relativePath: item.relativePath!, asReference: item.isReference }));
    const [checked, fileResult] = await Promise.all([
      window.wb.recheckSources(projectId, [...refs]),
      explicitFiles.length > 0
        ? window.wb.refreshProjectFiles(projectId, explicitFiles)
        : Promise.resolve({ entries: [], errors: [] }),
    ]);
    if (get().projectId !== projectId || get().conversation?.key !== conversation.key) return;
    const changed = checked.fingerprints
      .filter((item) => prior.has(item.sourceRef) && prior.get(item.sourceRef) !== item.sha256)
      .map((item) => item.sourceRef);
    const historyProjectionChanged = changed.some((sourceRef) => sourceRef.startsWith('history:'))
      || checked.errors.some((item) => item.sourceRef.startsWith('history:'));
    const refreshedMemory = historyProjectionChanged
      ? await verifyMemoryContextItems(projectId, (await Promise.all(
        before.staging
          .filter((item) => item.id.startsWith('memory-projection:'))
          .map(refreshMemoryContextItem),
      )).filter((item): item is ContextItem => item !== null))
      : null;
    if (get().projectId !== projectId || get().conversation?.key !== conversation.key) return;
    set((state) => {
      let staging = state.staging.map((current) => {
        const refreshed = fileResult.entries.find((entry) => entry.item.id === current.id)?.item;
        return refreshed ? { ...refreshed, state: current.state, pinned: current.pinned } : current;
      });
      if (refreshedMemory) {
        staging = [
          ...staging.filter((item) => !item.id.startsWith('memory-projection:')),
          ...refreshedMemory.items,
        ];
      }
      const projectFingerprints = fileResult.entries.map((entry) => entry.fingerprint);
      const localResultRefs = state.recheckedSourceRefs.filter((sourceRef) => sourceRef.startsWith('harness-result:'));
      const localResultFingerprints = state.recheckedFingerprints.filter((item) => item.sourceRef.startsWith('harness-result:'));
      const recheckedSourceRefs = [...localResultRefs, ...checked.checkedSourceRefs];
      const recheckedFingerprints = refreshedMemory
        ? [
          ...localResultFingerprints,
          ...checked.fingerprints.filter((item) => !item.sourceRef.startsWith('history:')),
          ...refreshedMemory.fingerprints,
        ]
        : [...localResultFingerprints, ...checked.fingerprints];
      const next = { ...state, staging, projectFingerprints, recheckedSourceRefs, recheckedFingerprints };
      return {
      staging,
      projectFingerprints,
      recheckedSourceRefs,
      recheckedFingerprints,
      sourceChanges: [...new Set([...state.sourceChanges, ...changed])],
      contextMessage: messages([
        changed.length > 0 ? `Source changed: ${changed.join(', ')}` : null,
        checked.errors.length > 0
          ? `Source unavailable: ${checked.errors.map((item) => item.sourceRef).join(', ')}`
          : null,
        fileResult.errors.length > 0 ? fileResult.errors.join('\n') : null,
        refreshedMemory && refreshedMemory.items.length < before.staging.filter((item) => item.id.startsWith('memory-projection:')).length
          ? 'Memory Context removed because its source changed or is no longer sufficient.'
          : null,
        refreshedMemory && refreshedMemory.errors.length > 0
          ? `Memory source unavailable: ${refreshedMemory.errors.join(', ')}`
          : null,
        state.orphanedDraftDecisionIds.length > 0
          ? `Orphaned draft decisions: ${state.orphanedDraftDecisionIds.join(', ')}`
          : null,
      ]),
      attentionItems: projectAttention(next),
    };
    });
    scheduleDraftSave(get());
    get().syncIslandAttention();
    const overlayProjectionChanged = changed.some((sourceRef) => sourceRef.startsWith('overlay:'))
      || checked.errors.some((item) => item.sourceRef.startsWith('overlay:'));
    if (overlayProjectionChanged) await get().load(true);
  },

  addManualContext: (title, body) => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      set({ contextMessage: 'Manual Context needs both a title and content.' });
      return;
    }
    const item = createManualContext(globalThis.crypto.randomUUID(), trimmedTitle, trimmedBody);
    set((state) => ({
      staging: [...state.staging, item],
      contextMessage: `Manual Context added: ${trimmedTitle}`,
    }));
    scheduleDraftSave(get());
  },

  clearDraft: async () => {
    const { projectId, conversation, snapshot, demoMode } = get();
    if (!projectId || !conversation || !snapshot) return;
    const timerKey = `${projectId}\0${conversation.key}`;
    const pending = draftTimers.get(timerKey);
    if (pending) clearTimeout(pending);
    draftTimers.delete(timerKey);
    if (!demoMode) {
      await window.wb.clearDraft(projectId, conversation.key);
    } else {
      demoDraftState = null;
    }
    set({
      taskSummary: '',
      staging: buildStaging(snapshot, projectId),
      projectFingerprints: [],
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: 'Draft cleared.',
      draftSaveState: 'clean',
      packetValidity: 'UNKNOWN',
      handoffStatus: 'IDLE',
    });
  },

  loadActivity: async () => {
    const loaded = await window.wb.loadActivity({ limit: 1_000 });
    const activity = orderActivity(loaded.events);
    set((state) => {
      const runtimeSessions = projectRuntimeSessions(activity);
      const next = { ...state, activity, runtimeSessions };
      return {
        activity, runtimeSessions, activityProblem: loaded.problem ?? null,
        activityBeforeByte: loaded.nextBeforeByte, activityHasEarlier: loaded.hasEarlier,
        attentionItems: projectAttention(next),
      };
    });
    get().refreshProjection();
    get().syncIslandAttention();
  },

  loadEarlierActivity: async () => {
    const beforeByte = get().activityBeforeByte;
    if (beforeByte === undefined || !get().activityHasEarlier) return;
    const loaded = await window.wb.loadActivity({ beforeByte, limit: 1_000 });
    set((state) => {
      const byId = new Map<string, ActivityEvent>();
      for (const event of [...loaded.events, ...state.activity]) byId.set(event.id, event);
      const activity = orderActivity([...byId.values()]);
      const runtimeSessions = projectRuntimeSessions(activity);
      const next = { ...state, activity, runtimeSessions };
      return {
        activity, runtimeSessions,
        activityProblem: loaded.problem ?? state.activityProblem,
        activityBeforeByte: loaded.nextBeforeByte, activityHasEarlier: loaded.hasEarlier,
        attentionItems: projectAttention(next),
      };
    });
    get().refreshProjection();
    get().syncIslandAttention();
  },

  ingestActivity: (event) => {
    set((state) => {
      const activity = orderActivity([...state.activity.filter((item) => item.id !== event.id), event]);
      const runtimeSessions = projectRuntimeSessions(activity);
      return { activity, runtimeSessions, attentionItems: projectAttention({ ...state, activity, runtimeSessions }) };
    });
    get().refreshProjection();
    // Session/process boundaries change what the adapter currently holds live;
    // chatty per-item events (tools/files) do not.
    if (['session-started', 'turn-completed', 'turn-error', 'harness-error', 'process-cancelled', 'handoff-dispatched', 'handoff-accepted', 'handoff-failed', 'handoff-cancelled'].includes(event.kind)) {
      void get().refreshLiveExecutions();
    }
    get().syncIslandAttention();
  },

  clearActivity: async () => {
    await window.wb.clearActivity();
    set((state) => ({
      activity: [], runtimeSessions: [], activityProblem: null,
      activityBeforeByte: undefined, activityHasEarlier: false,
      attentionItems: projectAttention({ ...state, activity: [], runtimeSessions: [] }),
    }));
    get().refreshProjection();
    get().syncIslandAttention();
  },

  refreshLiveExecutions: async () => {
    if (!window.wb.loadLiveExecutions) {
      set({ liveExecutions: [] });
      get().refreshProjection();
      return;
    }
    set({ liveExecutions: await probeLiveExecutions(window.wb.loadLiveExecutions) });
    get().refreshProjection();
  },

  openRuntimeInspector: (target) => {
    set({ runtimeTarget: target });
    window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'runtime' }));
  },

  loadHarnessCapabilities: async () => {
    const { demoMode, demoSessionId } = get();
    const environment = demoMode
      ? { kind: 'demo' as const, sessionId: demoSessionId ?? '' }
      : { kind: 'real' as const };
    if (demoMode && !demoSessionId) throw new Error('Demo session identity is unavailable. Reset Demo and try again.');
    const all = window.wb.loadAllHarnessCapabilities
      ? await window.wb.loadAllHarnessCapabilities(environment)
      : { codex: await window.wb.loadHarnessCapabilities() };
    set({ harnessCapabilities: all });
  },

  sendTask: async (summary, harness) => {
    const before = get();
    const { projectId, conversation, demoMode, demoSessionId, harnessCapabilities, snapshot } = before;
    if (!projectId || !conversation || !snapshot) {
      throw new Error('Open a project session before sending a task.');
    }
    const agents = Array.isArray(harness) ? harness : [harness];
    const merged = new Map(snapshot.sourceFingerprints.map((item) => [item.sourceRef, item.sha256]));
    for (const sourceRef of before.recheckedSourceRefs) merged.delete(sourceRef);
    for (const item of before.recheckedFingerprints) merged.set(item.sourceRef, item.sha256);
    for (const item of before.projectFingerprints) merged.set(item.sourceRef, item.sha256);
    const adapter = snapshot.projects.find((item) => item.projectId === projectId);
    const governanceRefs = governanceRefsForPacket(snapshot, projectId, conversation.key, demoMode);
    try {
      const plan = buildDispatchPlan({
        projectId,
        conversationKey: conversation.key,
        conversationId: conversation.conversationId,
        taskSummary: summary,
        governanceRefs,
        staging: before.staging,
        fingerprints: [...merged].map(([sourceRef, sha256]) => ({ sourceRef, sha256 })),
        agents,
        capabilities: harnessCapabilities,
        environment: demoMode
          ? { kind: 'demo', sessionId: demoSessionId ?? '' }
          : { kind: 'real' },
        parentSourceRef: before.handoffSourceRef ?? undefined,
      });
      set({
        packetValidity: 'CURRENT', handoffStatus: 'DISPATCHED',
        lastDispatchGroupId: plan.groupId, lastDispatchOutcomes: [],
      });
      const outcomes = await settleDispatchPlan(plan, window.wb.dispatchToHarness);
      const accepted = outcomes.some((outcome) => outcome.status === 'accepted');
      set({
        lastDispatchOutcomes: outcomes,
        handoffStatus: outcomes.every((outcome) => outcome.status === 'accepted') ? 'ACCEPTED' : 'PARTIAL_OR_FAILED',
        handoffSourceRef: accepted ? null : before.handoffSourceRef,
      });
      return outcomes;
    } catch (error) {
      if (/packet INVALID/i.test(String(error))) {
        set({ packetValidity: 'INVALID', handoffStatus: 'INVALID' });
        window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' }));
      }
      throw error;
    }
  },

  addResultToContext: (event) => {
    const item = contextFromAgentResult(event);
    const hash = computeStringHash(item.body);
    set((state) => ({
      staging: [...state.staging.filter((current) => current.id !== item.id), item],
      recheckedSourceRefs: [...new Set([...state.recheckedSourceRefs, item.sourceRef!])],
      recheckedFingerprints: [
        ...state.recheckedFingerprints.filter((fingerprint) => fingerprint.sourceRef !== item.sourceRef),
        { sourceRef: item.sourceRef!, sha256: hash },
      ],
      handoffSourceRef: item.sourceRef!,
      contextMessage: `${event.harness ?? 'Agent'} result added to the next handoff Context.`,
    }));
    scheduleDraftSave(get());
  },

  clearHandoffSource: () => set({ handoffSourceRef: null }),

  addMemoryContext: async (hit, pinned = false) => {
    const { projectId, conversation, demoMode } = get();
    if (!projectId || !conversation) {
      set({ contextMessage: 'Open a project session before adding Memory to Context.' });
      return;
    }
    if (demoMode) {
      // Demo mode: use in-memory fixtures, no real IPC
      const demoHit = DEMO_MEMORY_HITS.find((h) => h.id === hit.id);
      if (!demoHit) {
        set({ contextMessage: 'Demo memory not found.' });
        return;
      }
      const item = createMemoryProjectionContext({
        ...demoHit,
        sourceRefs: demoHit.sourceRefs,
        currentness: demoHit.currentness,
        verification: demoHit.verification,
      }, pinned);
      let committed = false;
      let priorItem: ContextItem | undefined;
      set((state) => {
        if (state.projectId !== projectId || state.conversation?.key !== conversation.key) return state;
        committed = true;
        priorItem = state.staging.find((current) => current.id === item.id);
        return {
          staging: [...state.staging.filter((current) => current.id !== item.id), item],
          recheckedSourceRefs: [...new Set([...state.recheckedSourceRefs, ...demoHit.sourceRefs])],
          recheckedFingerprints: [
            ...state.recheckedFingerprints.filter((prior) => !demoHit.sourceRefs.includes(prior.sourceRef)),
            ...demoHit.sourceRefs.map((ref) => ({ sourceRef: ref, sha256: `demo-sha-${ref}` })),
          ],
          contextMessage: `${pinned ? 'Pinned' : 'Added'} Memory reference: ${hit.summary}`,
        };
      });
      if (!committed) return;
      // Demo mode: track memory use in-memory only
      const existing = demoMemoryUse.get(hit.id);
      demoMemoryUse.set(hit.id, {
        memoryId: hit.id,
        count: (existing?.count ?? 0) + 1,
        lastUsedAt: new Date().toISOString(),
        pinned: pinned || (existing?.pinned ?? false),
      });
      scheduleDraftSave(get());
      return;
    }
    try {
      // Revalidate at the action boundary: a compact search hit may have gone stale
      // while the Memory panel was open, and must not become Context on old state.
      const expanded = await window.wb.expandMemory(hit.id);
      if (!expanded || expanded.evidence.verdict !== 'SUFFICIENT') {
        throw new Error('Memory evidence is no longer sufficient; inspect or refresh its source first.');
      }
      const currentness = 'currentness' in expanded.record ? expanded.record.currentness : expanded.record.status;
      const checked = await window.wb.recheckSources(projectId, expanded.record.sourceRefs);
      if (checked.errors.length > 0 || checked.fingerprints.length !== expanded.record.sourceRefs.length) {
        throw new Error('Memory source fingerprint could not be verified; Context was not changed.');
      }
      const item = createMemoryProjectionContext({
        ...hit,
        sourceRefs: expanded.record.sourceRefs,
        currentness,
        verification: expanded.record.verification,
      }, pinned);
      let committed = false;
      let priorItem: ContextItem | undefined;
      set((state) => {
        if (state.projectId !== projectId || state.conversation?.key !== conversation.key) return state;
        committed = true;
        priorItem = state.staging.find((current) => current.id === item.id);
        return {
          staging: [...state.staging.filter((current) => current.id !== item.id), item],
          recheckedSourceRefs: [...new Set([...state.recheckedSourceRefs, ...checked.checkedSourceRefs])],
          recheckedFingerprints: [
            ...state.recheckedFingerprints.filter((prior) => !checked.checkedSourceRefs.includes(prior.sourceRef)),
            ...checked.fingerprints,
          ],
          contextMessage: `${pinned ? 'Pinned' : 'Added'} Memory reference: ${hit.summary}`,
        };
      });
      if (!committed) return;
      try {
        await window.wb.recordMemoryUse(hit.id);
      } catch (error) {
        set((state) => state.projectId === projectId && state.conversation?.key === conversation.key
          ? {
            staging: [
              ...state.staging.filter((current) => current.id !== item.id),
              ...(priorItem ? [priorItem] : []),
            ],
            contextMessage: String(error),
          }
          : state);
        return;
      }
      scheduleDraftSave(get());
    } catch (error) {
      set({ contextMessage: String(error) });
    }
  },

  loadAttentionLocal: async () => {
    try {
      const attentionLocal = await window.wb.loadAttentionLocal();
      set((state) => ({
        attentionLocal,
        attentionItems: projectAttention({ ...state, attentionLocal }),
        attentionProblem: null,
      }));
    } catch (error) {
      set({ attentionProblem: `Attention local state unavailable: ${String(error)}` });
    }
  },

  dismissAttention: async (item) => {
    try {
      await window.wb.dismissAttention(item.id, item.observedAt);
      set((state) => {
        const priorObservedAt = state.attentionLocal.dismissed[item.id];
        const attentionLocal: AttentionLocalState = {
          schemaVersion: 1,
          dismissed: {
            ...state.attentionLocal.dismissed,
            [item.id]: priorObservedAt && priorObservedAt > item.observedAt
              ? priorObservedAt
              : item.observedAt,
          },
        };
        return {
          attentionLocal,
          attentionItems: projectAttention({ ...state, attentionLocal }),
          attentionProblem: null,
        };
      });
      get().syncIslandAttention();
    } catch (error) {
      set({ attentionProblem: `Attention dismissal was not saved: ${String(error)}` });
    }
  },

  setPacketValidity: (packetValidity) => set({ packetValidity }),
  setHandoffStatus: (handoffStatus) => set({ handoffStatus }),
}));

/**
 * Selector hook: derive the read-only Governance view from the active
 * snapshot + project + conversation. Never mutates state. UNKNOWN is
 * preserved as UNKNOWN and never fabricated.
 */
export function useGovernanceView(): GovernanceSnapshot {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  return useMemo(
    () => projectGovernanceView(snapshot ?? null, projectId, conversation),
    [snapshot, projectId, conversation],
  );
}

export type UseProjectionDeltaResultV0 =
  | { kind: 'none'; reason: 'no-previous-verified-revision' | 'no-current-verified-revision' }
  | { kind: 'failure'; failure: import('../../core/projection/types').ProjectionDeltaFailureV0 }
  | { kind: 'delta'; delta: import('../../core/projection/types').ProjectionDeltaV0 };

/**
 * Selector hook: compute the ProjectionDeltaV0 between the bounded previous
 * and current verified revisions for the active Project. Pure derivation;
 * never mutates state and never falls back to raw Snapshot/Activity.
 */
export function useProjectionDelta(): UseProjectionDeltaResultV0 {
  const projection = useWorkbench((state) => state.projection);
  const previous = useWorkbench((state) => state.projectionPrevious);
  return useMemo<UseProjectionDeltaResultV0>(() => {
    if (!projection.current) {
      return { kind: 'none', reason: 'no-current-verified-revision' };
    }
    if (!previous) {
      return { kind: 'none', reason: 'no-previous-verified-revision' };
    }
    const result = compareProjectionRevisions(previous, projection.current);
    if (!result.ok) {
      return { kind: 'failure', failure: result };
    }
    return { kind: 'delta', delta: result };
  }, [projection.current, previous]);
}
