import { create } from 'zustand';
import type {
  ContextItem,
  Conversation,
  FrozenPacket,
  GitFacts,
  OverlaySnapshot,
} from '../../core/types';
import { buildStaging } from '../../core/project/staging';

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
          ? buildStaging(snapshot, s.projectId).map((fresh) => {
              const prev = s.staging.find((c) => c.id === fresh.id);
              return prev ? { ...fresh, state: prev.state, pinned: prev.pinned } : fresh;
            })
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
    const frozen = await window.wb.listFrozen(projectId, conversation.id);
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
}));
