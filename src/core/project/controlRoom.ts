import type {
  Conversation,
  DialogueStatus,
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
  /** Explicitly Conversation lifecycle; never a substitute for canonical Task state. */
  conversationLifecycle: Record<DialogueStatus, Conversation[]>;
  gates: Record<string, string>;
  /** Needs Attention: projection of overlay INBOX, never a second task store. */
  needsAttention: InboxItem[];
  roles: { name: string; responsibility: string }[];
  canonicalSource?: ProjectAdapter['canonicalSource'];
  machine?: MachineProfile;
  /** local repo root for this project on the current machine, if bound. */
  localRoot?: string;
}

export function buildControlRoom(snapshot: OverlaySnapshot, projectId: string): ControlRoomModel | null {
  const adapter = snapshot.projects.find((p) => p.projectId === projectId);
  const convos = snapshot.conversations.filter((c) => c.project === projectId);
  if (!adapter && convos.length === 0) return null;
  const model: ControlRoomModel = {
    projectId,
    displayName: adapter?.displayName ?? projectId,
    trust: adapter?.trust ?? 'DISCOVERED',
    conversationLifecycle: {
      ACTIVE: [],
      PAUSED: [],
      FROZEN: [],
      STANDBY: [],
      UNKNOWN: [],
    },
    gates: adapter?.gates ?? {},
    needsAttention: snapshot.inbox.filter(
      (i) => i.attention && i.scope === 'project' && i.projectId === projectId,
    ),
    roles: adapter?.roles ?? [],
    canonicalSource: adapter?.canonicalSource,
    machine: snapshot.machine,
    localRoot: snapshot.machine?.projectRoots[projectId],
  };
  for (const c of convos) model.conversationLifecycle[c.status].push(c);
  return model;
}
