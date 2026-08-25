import { create } from 'zustand';
import type {
  ContextItem,
  Conversation,
  FrozenPacket,
  GitFacts,
  OverlaySnapshot,
  SourceFingerprint,
} from '../../core/types';
import { buildStaging, createManualContext } from '../../core/project/staging';

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
  contextMessage: string | null;
  load: (refresh?: boolean) => Promise<void>;
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
  addManualContext: (title: string, body: string) => void;
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
  contextMessage: null,

  load: async (refresh) => {
    set({ loading: true });
    const snapshot = await window.wb.loadOverlay({ refresh });
    set((s) => ({
      snapshot,
      loading: false,
      memoryBodies: refresh ? {} : s.memoryBodies,
      // re-derive staging so included items reflect canonical changes
      staging:
        s.projectId && refresh
          ? [
              ...buildStaging(snapshot, s.projectId).map((fresh) => {
                const prev = s.staging.find((c) => c.id === fresh.id);
                return prev ? { ...fresh, state: prev.state, pinned: prev.pinned } : fresh;
              }),
              ...s.staging.filter(
                (item) => item.source.startsWith('project-file:') || item.provenance === 'USER PROVIDED',
              ),
            ]
          : s.staging,
    }));
  },

  selectProject: (projectId) => {
    const { snapshot } = get();
    set({
      projectId,
      view: 'control',
      conversation: null,
      staging: snapshot ? buildStaging(snapshot, projectId) : [],
      frozen: [],
      git: null,
      projectFingerprints: [],
      contextMessage: null,
    });
    void get().loadGit(projectId);
  },

  selectConversation: (conversation) => {
    set({ conversation });
    void get().refreshFrozen();
  },

  setView: (view) => set({ view }),

  setStagingState: (id, state) =>
    set((s) => ({
      staging: s.staging.map((c) =>
        c.id === id ? { ...c, state, pinned: state === 'included' ? c.pinned : false } : c,
      ),
    })),

  togglePin: (id) =>
    set((s) => ({
      staging: s.staging.map((c) =>
        c.id === id && c.state === 'included' ? { ...c, pinned: !c.pinned } : c,
      ),
    })),

  setTaskSummary: (taskSummary) => set({ taskSummary }),

  refreshFrozen: async () => {
    const { projectId, conversation } = get();
    if (!projectId || !conversation) return;
    const frozen = await window.wb.listFrozen(projectId, conversation.key);
    set({ frozen });
  },

  loadGit: async (projectId) => {
    const res = await window.wb.loadGit(projectId);
    set({ git: res.facts ?? { error: res.error ?? 'unknown' } });
  },

  loadMemoryBody: async (memoryId) => {
    if (get().memoryBodies[memoryId] !== undefined) return;
    const body = await window.wb.readMemory(memoryId);
    set((s) => ({ memoryBodies: { ...s.memoryBodies, [memoryId]: body ?? '(not found)' } }));
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
    set((s) => ({
      staging: [...s.staging.filter((current) => current.id !== item.id), item],
      projectFingerprints: [
        ...s.projectFingerprints.filter((current) => current.sourceRef !== fingerprint.sourceRef),
        fingerprint,
      ],
      contextMessage: `${asReference ? 'Reference' : 'Context'} added: ${item.relativePath}`,
    }));
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
    set((s) => ({
      staging: s.staging.map((current) => {
        const refreshed = result.entries.find((entry) => entry.item.id === current.id)?.item;
        return refreshed ? { ...refreshed, state: current.state, pinned: current.pinned } : current;
      }),
      projectFingerprints: result.entries.map((entry) => entry.fingerprint),
      contextMessage: result.errors.length > 0 ? result.errors.join('\n') : s.contextMessage,
    }));
  },

  addManualContext: (title, body) => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      set({ contextMessage: 'Manual Context needs both a title and content.' });
      return;
    }
    const item = createManualContext(globalThis.crypto.randomUUID(), trimmedTitle, trimmedBody);
    set((s) => ({
      staging: [...s.staging, item],
      contextMessage: `Manual Context added: ${trimmedTitle}`,
    }));
  },
}));
