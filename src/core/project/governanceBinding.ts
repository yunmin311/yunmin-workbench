// Governance Product Binding — read-only projection.
//
// No new schema, no mutation, no second SOT. Derives a compact view from
// facts Workbench already loaded: ProjectAdapter.roles / project_gates /
// observed, and Conversation.observed (dialogue registry projection).
// UNKNOWN stays UNKNOWN; missing stays missing.

import type { Conversation, OverlaySnapshot, ProjectAdapter } from '../types';

const ACTIVE_LIFECYCLE = new Set(['ACTIVE', 'PAUSED', 'FROZEN', 'STANDBY']);

export interface GovernanceRoleHint {
  role: string;
  responsibility: string;
  alive: boolean;
  lifecycle: string;
}

export interface GovernanceGateView {
  declared: Record<string, string>;
  defaultFlow: string | null;
  undeclared: boolean;
  ownerConflicts: { key: string; values: string[] }[];
}

export interface GovernanceDialogueView {
  roleFromRegistry: string | null;
  lifecycle: string;
  verification: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
  sessionId: string | null;
  platform: string | null;
  gitAuthority: string | null;
}

export interface GovernanceAgentHint {
  harness: 'codex' | 'claude' | 'deepseek';
  /** Concrete role only when the dialog registry names exactly one role on that platform for this project. */
  role: string | null;
  /** 'single' = exactly one dialogue role on the platform; 'ambiguous' = multiple; 'none' = none. */
  state: 'single' | 'ambiguous' | 'none';
}

export interface GovernanceSnapshot {
  projectId: string | null;
  projectDisplayName: string | null;
  projectTrust: string | null;
  /** Verbatim adapter.observed.sourceRef — the real source of this project fact. */
  adapterObservedRef: string | null;
  /** Verbatim conversation.observed.sourceRef — the real source of the active dialogue fact. */
  dialogueObservedRef: string | null;
  adapter: ProjectAdapter | null;
  roles: GovernanceRoleHint[];
  gates: GovernanceGateView;
  dialogue: GovernanceDialogueView;
  agentHints: GovernanceAgentHint[];
  hasGate: boolean;
  problems: string[];
}

function pickDialogue(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  conversation: Conversation | null,
): { view: GovernanceDialogueView; observedRef: string | null } {
  const empty: GovernanceDialogueView = {
    roleFromRegistry: null, lifecycle: 'UNKNOWN', verification: 'UNKNOWN',
    sessionId: null, platform: null, gitAuthority: null,
  };
  if (!snapshot || !projectId || !conversation) return { view: empty, observedRef: null };
  const match = snapshot.conversations.find((candidate) =>
    candidate.key === conversation.key && candidate.project === projectId);
  if (!match) return { view: empty, observedRef: null };
  return {
    view: {
      roleFromRegistry: match.role,
      lifecycle: ACTIVE_LIFECYCLE.has(match.status) ? match.status : 'UNKNOWN',
      verification: match.verification,
      sessionId: match.sessionId ?? null,
      platform: match.platform,
      gitAuthority: match.gitAuthority ?? null,
    },
    observedRef: match.observed.sourceRef,
  };
}

function projectGateConflicts(snapshot: OverlaySnapshot | null, projectId: string | null): { key: string; values: string[] }[] {
  if (!snapshot || !projectId) return [];
  const sameProject = snapshot.projects.filter((project) => project.projectId === projectId);
  if (sameProject.length < 2) return [];
  const allKeys = new Set<string>();
  for (const project of sameProject) for (const key of Object.keys(project.gates)) allKeys.add(key);
  const conflicts: { key: string; values: string[] }[] = [];
  for (const key of allKeys) {
    const values = new Set<string>();
    for (const project of sameProject) {
      const value = project.gates[key];
      if (typeof value === 'string' && value.trim().length > 0) values.add(value);
    }
    if (values.size > 1) conflicts.push({ key, values: [...values] });
  }
  return conflicts;
}

/**
 * Agent hint is grounded only in the dialog registry. ProjectAdapter.roles
 * never carry a harness binding, so we never infer one from the adapter.
 * When one and only one dialogue in this project has the requested platform,
 * we surface its role verbatim. When multiple match, the hint is suppressed
 * (ambiguous) rather than guessed. None means no dialogue on that platform.
 */
function agentHintFromDialog(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  harness: 'codex' | 'claude' | 'deepseek',
): GovernanceAgentHint {
  if (!snapshot || !projectId) return { harness, role: null, state: 'none' };
  const matches = snapshot.conversations.filter(
    (candidate) => candidate.project === projectId && candidate.platform === harness,
  );
  if (matches.length === 0) return { harness, role: null, state: 'none' };
  if (matches.length > 1) return { harness, role: null, state: 'ambiguous' };
  return { harness, role: matches[0].role, state: 'single' };
}

export function projectGovernanceView(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  conversation: Conversation | null,
): GovernanceSnapshot {
  const adapter = projectId && snapshot
    ? snapshot.projects.find((item) => item.projectId === projectId) ?? null
    : null;
  const dialogue = pickDialogue(snapshot, projectId, conversation);
  const declared = adapter ? { ...adapter.gates } : {};
  const hasGate = Object.keys(declared).length > 0;
  const ownerConflicts = projectGateConflicts(snapshot, projectId);
  const problems: string[] = [];
  if (snapshot && projectId && !adapter) problems.push('Project adapter is missing for the active project.');
  if (snapshot && projectId && adapter && !hasGate) problems.push('project_gates are not declared by the adapter.');
  if (ownerConflicts.length > 0) problems.push(`project_gates have hard conflicts: ${ownerConflicts.map((c) => c.key).join(', ')}`);
  if (dialogue.view.verification === 'UNVERIFIED') problems.push('Active dialogue is UNVERIFIED in the registry.');
  if (dialogue.view.lifecycle === 'UNKNOWN' && projectId) problems.push('Active dialogue lifecycle is UNKNOWN.');
  if (snapshot && projectId && adapter?.trust === 'UNKNOWN') problems.push('Project adapter trust is UNKNOWN.');

  const roles: GovernanceRoleHint[] = (adapter?.roles ?? []).map((role) => {
    const alive = snapshot?.conversations.some((candidate) =>
      candidate.project === projectId && candidate.role === role.name) ?? false;
    const lifecycle = alive
      ? (snapshot?.conversations.find((candidate) => candidate.project === projectId && candidate.role === role.name)?.status ?? 'UNKNOWN')
      : 'UNKNOWN';
    return {
      role: role.name,
      responsibility: role.responsibility,
      alive,
      lifecycle: ACTIVE_LIFECYCLE.has(lifecycle) ? lifecycle : 'UNKNOWN',
    };
  });

  const agentHints: GovernanceAgentHint[] = (['codex', 'claude', 'deepseek'] as const).map(
    (harness) => agentHintFromDialog(snapshot, projectId, harness),
  );

  return {
    projectId: adapter?.projectId ?? projectId,
    projectDisplayName: adapter?.displayName ?? null,
    projectTrust: adapter?.trust ?? null,
    adapterObservedRef: adapter?.observed.sourceRef ?? null,
    dialogueObservedRef: dialogue.observedRef,
    adapter,
    roles,
    gates: { declared, defaultFlow: declared.default_flow ?? null, undeclared: !hasGate, ownerConflicts },
    dialogue: dialogue.view,
    agentHints,
    hasGate,
    problems,
  };
}

/**
 * Governance refs for the compiled packet. These are the project's own
 * canonical observations (ProjectAdapter.observed + the active
 * Conversation.observed), verbatim — they prove where the Governance facts
 * were read from, not the contents the agent will execute on. Demo
 * fixture observations are already namespaced under "demo:" in the
 * snapshot, so the demo path passes them through unchanged; the real path
 * never fabricates a namespaced ref.
 *
 * The active conversation is required. The caller must pass the
 * Conversation (or its key) it is dispatching to; this function never
 * "picks the first" dialogue in the project, because once a project
 * carries more than one conversation the wrong provenance would silently
 * land in the packet header. The namespaced demo pass-through is
 * structural (ref starts with "demo:"), not a flag.
 */
export function governanceRefsForPacket(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  activeConversationKey: string | null,
  isDemo: boolean,
): string[] {
  if (!projectId || !activeConversationKey) return [];
  const adapter = snapshot?.projects.find((p) => p.projectId === projectId);
  if (!adapter) return [];
  const conversation = snapshot?.conversations.find(
    (c) => c.project === projectId && c.key === activeConversationKey,
  );
  if (!conversation) return [];
  const refs: string[] = [adapter.observed.sourceRef, conversation.observed.sourceRef];
  if (isDemo) {
    const demoRefs: string[] = [];
    for (const ref of refs) {
      if (ref.startsWith('demo:')) demoRefs.push(ref);
    }
    return demoRefs.length > 0 ? demoRefs : [];
  }
  return refs;
}
