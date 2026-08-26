import { discoverProjects } from './discovery';
import type { OverlaySnapshot } from '../types';

export const WORKSPACE_SESSION_SCHEMA_VERSION = 1 as const;
export type WorkspaceView = 'projects' | 'control' | 'canvas' | 'context' | 'packet';

export interface WorkspaceTargetV1 {
  projectId: string;
  /** Migration-era local scope only; never treated as canonical identity. */
  conversationScope?: {
    kind: 'migration-conversation-key';
    conversationKey: string;
    canonicalConversationId?: string;
  };
  view: WorkspaceView;
  usedAt: string;
}

export interface WorkspaceSessionV1 {
  schemaVersion: typeof WORKSPACE_SESSION_SCHEMA_VERSION;
  last: WorkspaceTargetV1 | null;
  recent: WorkspaceTargetV1[];
}

export function updateWorkspaceSession(
  prior: WorkspaceSessionV1,
  target: WorkspaceTargetV1,
  maxRecent = 8,
): WorkspaceSessionV1 {
  const key = (item: WorkspaceTargetV1) =>
    `${item.projectId}\0${item.conversationScope?.conversationKey ?? ''}`;
  return {
    schemaVersion: WORKSPACE_SESSION_SCHEMA_VERSION,
    last: target,
    recent: [target, ...prior.recent.filter((item) => key(item) !== key(target))].slice(0, maxRecent),
  };
}

export interface WorkspaceResumeResolution {
  target: WorkspaceTargetV1 | null;
  problem?: string;
}

/** Exact-match restoration against fresh projection. No identity guessing. */
export function resolveWorkspaceTarget(
  snapshot: OverlaySnapshot,
  target: WorkspaceTargetV1 | null,
): WorkspaceResumeResolution {
  if (!target) return { target: null };
  if (!discoverProjects(snapshot).some((project) => project.projectId === target.projectId)) {
    return { target: null, problem: `Cannot resume: project no longer exists: ${target.projectId}` };
  }
  if (target.conversationScope) {
    const conversation = snapshot.conversations.find(
      (item) => item.project === target.projectId
        && item.key === target.conversationScope!.conversationKey,
    );
    if (!conversation) {
      return {
        target: null,
        problem: `Cannot resume: conversation no longer exists: ${target.conversationScope.conversationKey}`,
      };
    }
  }
  return { target };
}
