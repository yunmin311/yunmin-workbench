import { create } from 'zustand';
import {
  buildWorkbenchDraft,
  restoreWorkbenchDraft,
  type WorkbenchDraftV1,
} from '../../core/project/draft';
import { buildStaging, createManualContext } from '../../core/project/staging';
import { overlayFileSourceRef, projectFileSourceRef } from '../../core/project/sourceIdentity';
import type {
  ContextItem,
  Conversation,
  FrozenPacket,
  GitFacts,
  OverlaySnapshot,
  SourceFingerprint,
} from '../../core/types';

export type View = 'projects' | 'control' | 'canvas' | 'context' | 'packet';

interface WorkbenchState {
  snapshot: OverlaySnapshot | null;
  loading: boolean;
  view: View;
  projectId: string | null;
  conversation: Conversation | null;
  staging: ContextItem[];
  taskSummary: string;
  frozen: FrozenPacket[];
  git: GitFacts | { error: string } | null;
  memoryBodies: Record<string, string>;
  projectFingerprints: SourceFingerprint[];
  recheckedSourceRefs: string[];
  recheckedFingerprints: SourceFingerprint[];
  orphanedDraftDecisionIds: string[];
  sourceChanges: string[];
  contextMessage: string | null;
  load: (refresh?: boolean) => Promise<void>;
  reloadAndRecheck: () => Promise<void>;
  selectProject: (projectId: string) => void;
  selectConversation: (c: Conversation) => void;
  setView: (v: View) => void;
  setStagingState: (id: string, state: ContextItem['state']) => void;
  togglePin: (id: string) => void;
  setTaskSummary: (s: string) => void;
  refreshFrozen: () => Promise<void>;
  loadGit: (projectId: string) => Promise<void>;
  loadMemoryBody: (memoryId: string) => Promise<void>;
  addProjectFile: (asReference: boolean) => Promise<void>;
  refreshProjectFiles: () => Promise<void>;
  recheckSources: () => Promise<void>;
  addManualContext: (title: string, body: string) => void;
  clearDraft: () => Promise<void>;
}

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  draftTimers.set(key, setTimeout(() => {
    draftTimers.delete(key);
    void window.wb.saveDraft(draft).catch((error) => {
      useWorkbench.setState({ contextMessage: `Draft save failed: ${String(error)}` });
    });
  }, 350));
}

function messages(parts: (string | null | undefined)[]): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join('\n') : null;
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  snapshot: null,
  loading: false,
  view: 'projects',
  projectId: null,
  conversation: null,
  staging: [],
  taskSummary: '',
  frozen: [],
  git: null,
  memoryBodies: {},
  projectFingerprints: [],
  recheckedSourceRefs: [],
  recheckedFingerprints: [],
  orphanedDraftDecisionIds: [],
  sourceChanges: [],
  contextMessage: null,

  load: async (refresh) => {
    set({ loading: true });
    const snapshot = await window.wb.loadOverlay({ refresh });
    set((state) => {
      let staging = state.staging;
      let orphanedDraftDecisionIds = state.orphanedDraftDecisionIds;
      if (state.projectId && refresh) {
        const fresh = buildStaging(snapshot, state.projectId);
        const localDraft = draftFromState(state);
        if (localDraft) {
          const restored = restoreWorkbenchDraft(
            fresh,
            localDraft,
            state.staging.filter((item) => item.source === `project-file:${state.projectId}`),
          );
          staging = restored.staging;
          orphanedDraftDecisionIds = restored.orphanedDecisionIds;
        } else {
          staging = fresh;
        }
      }
      return {
        snapshot,
        loading: false,
        memoryBodies: refresh ? {} : state.memoryBodies,
        staging,
        orphanedDraftDecisionIds,
        recheckedSourceRefs: refresh ? [] : state.recheckedSourceRefs,
        recheckedFingerprints: refresh ? [] : state.recheckedFingerprints,
      };
    });
  },

  reloadAndRecheck: async () => {
    await get().load(true);
    await get().recheckSources();
  },

  selectProject: (projectId) => {
    const { snapshot } = get();
    set({
      projectId,
      view: 'control',
      conversation: null,
      staging: snapshot ? buildStaging(snapshot, projectId) : [],
      taskSummary: '',
      frozen: [],
      git: null,
      projectFingerprints: [],
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: null,
    });
    void get().loadGit(projectId);
  },

  selectConversation: (conversation) => {
    const { projectId, snapshot } = get();
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
    });
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
      if (get().projectId !== projectId || get().conversation?.key !== conversation.key) return;
      const restored = restoreWorkbenchDraft(
        buildStaging(snapshot, projectId),
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
        ]),
      });
      await get().refreshFrozen();
      await get().recheckSources();
    })();
  },

  setView: (view) => set({ view }),

  setStagingState: (id, state) => {
    set((current) => ({
      staging: current.staging.map((item) =>
        item.id === id ? { ...item, state, pinned: state === 'included' ? item.pinned : false } : item,
      ),
    }));
    scheduleDraftSave(get());
  },

  togglePin: (id) => {
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
    const { projectId, conversation } = get();
    if (!projectId || !conversation) return;
    const frozen = await window.wb.listFrozen(projectId, conversation.key);
    if (get().projectId === projectId && get().conversation?.key === conversation.key) set({ frozen });
  },

  loadGit: async (projectId) => {
    const result = await window.wb.loadGit(projectId);
    if (get().projectId === projectId) set({ git: result.facts ?? { error: result.error ?? 'unknown' } });
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
    const { projectId, conversation, snapshot } = before;
    if (!projectId || !conversation || !snapshot) return;
    const adapter = snapshot.projects.find((item) => item.projectId === projectId);
    const refs = new Set<string>([
      overlayFileSourceRef('memory/MEMORY.md'),
      ...(adapter?.canonicalSource?.path ? [projectFileSourceRef(projectId, adapter.canonicalSource.path)] : []),
      ...before.staging.filter((item) => item.state === 'included').flatMap((item) => item.sourceRef ? [item.sourceRef] : []),
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
    set((state) => ({
      staging: state.staging.map((current) => {
        const refreshed = fileResult.entries.find((entry) => entry.item.id === current.id)?.item;
        return refreshed ? { ...refreshed, state: current.state, pinned: current.pinned } : current;
      }),
      projectFingerprints: fileResult.entries.map((entry) => entry.fingerprint),
      recheckedSourceRefs: checked.checkedSourceRefs,
      recheckedFingerprints: checked.fingerprints,
      sourceChanges: [...new Set([...state.sourceChanges, ...changed])],
      contextMessage: messages([
        changed.length > 0 ? `Source changed: ${changed.join(', ')}` : null,
        checked.errors.length > 0
          ? `Source unavailable: ${checked.errors.map((item) => item.sourceRef).join(', ')}`
          : null,
        fileResult.errors.length > 0 ? fileResult.errors.join('\n') : null,
        state.orphanedDraftDecisionIds.length > 0
          ? `Orphaned draft decisions: ${state.orphanedDraftDecisionIds.join(', ')}`
          : null,
      ]),
    }));
    scheduleDraftSave(get());
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
    const { projectId, conversation, snapshot } = get();
    if (!projectId || !conversation || !snapshot) return;
    const timerKey = `${projectId}\0${conversation.key}`;
    const pending = draftTimers.get(timerKey);
    if (pending) clearTimeout(pending);
    draftTimers.delete(timerKey);
    await window.wb.clearDraft(projectId, conversation.key);
    set({
      taskSummary: '',
      staging: buildStaging(snapshot, projectId),
      projectFingerprints: [],
      recheckedSourceRefs: [],
      recheckedFingerprints: [],
      orphanedDraftDecisionIds: [],
      sourceChanges: [],
      contextMessage: 'Draft cleared.',
    });
  },
}));
