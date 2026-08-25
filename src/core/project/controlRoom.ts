import type {
  Conversation,
  InboxItem,
  MachineProfile,
  OverlaySnapshot,
  ProjectAdapter,
  TrustLevel,
} from '../types';

export interface ControlRoomModel {
  projectId: string;
  displayName: string;
  trust: TrustLevel;
  /** Current Focus: task-state buckets (domain-separated from runtime/attention). */
  active: Conversation[];
  waiting: Conversation[];
  blocked: Conversation[];
  gates: Record<string, string>;
  /** Needs Attention: projection of overlay INBOX, never a second task store. */
  needsAttention: InboxItem[];
  roles: { name: string; responsibility: string }[];
  canonicalSource?: ProjectAdapter['canonicalSource'];
  machine?: MachineProfile;
  /** local repo root for this project on the current machine, if bound. */
  localRoot?: string;
}

function bucket(c: Conversation): 'active' | 'waiting' | 'blocked' {
  if (c.taskState === 'active' || c.taskState === 'standby') return 'active';
  if (c.taskState === 'waiting') return 'waiting';
  return 'blocked';
}

export function buildControlRoom(snapshot: OverlaySnapshot, projectId: string): ControlRoomModel | null {
  const adapter = snapshot.projects.find((p) => p.projectId === projectId);
  const convos = snapshot.conversations.filter((c) => c.project === projectId);
  if (!adapter && convos.length === 0) return null;
  const model: ControlRoomModel = {
    projectId,
    displayName: adapter?.displayName ?? projectId,
    trust: adapter?.trust ?? 'DISCOVERED',
    active: [],
    waiting: [],
    blocked: [],
    gates: adapter?.gates ?? {},
    needsAttention: snapshot.inbox.filter((i) => i.attention),
    roles: adapter?.roles ?? [],
    canonicalSource: adapter?.canonicalSource,
    machine: snapshot.machine,
    localRoot: snapshot.machine?.projectRoots[projectId],
  };
  for (const c of convos) model[bucket(c)].push(c);
  return model;
}

/** Projects viewable in the Projects screen: adapters + any project a conversation claims. */
export function listProjects(snapshot: OverlaySnapshot): { projectId: string; displayName: string; trust: TrustLevel; conversationCount: number }[] {
  const ids = new Set<string>([
    ...snapshot.projects.map((p) => p.projectId),
    ...snapshot.conversations.map((c) => c.project),
  ]);
  return [...ids].sort().map((id) => {
    const adapter = snapshot.projects.find((p) => p.projectId === id);
    return {
      projectId: id,
      displayName: adapter?.displayName ?? id,
      trust: adapter?.trust ?? 'DISCOVERED',
      conversationCount: snapshot.conversations.filter((c) => c.project === id).length,
    };
  });
}
