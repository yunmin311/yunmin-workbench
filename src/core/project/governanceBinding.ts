// Governance Product Binding — read-only projection.
//
// This module does NOT add a new schema, does NOT mutate the OverlaySnapshot,
// and does NOT introduce a second SOT. It only derives a compact view from
// the facts Workbench already loaded: ProjectAdapter.roles / project_gates /
// canonical_source, DialogueRegistry.dialogues, and the active conversation.
//
// UNKNOWN is preserved as UNKNOWN. Missing fields stay missing. Heuristic
// rules are restricted to the dialog-registry level; we never fabricate gate
// values, approver names, or "ALLOW/BLOCK" verdicts.

import type { Conversation, OverlaySnapshot, ProjectAdapter } from '../types';
import { overlayFileSourceRef, projectFileSourceRef } from './sourceIdentity';

export interface GovernanceRoleHint {
  source: 'adapter' | 'dialog' | 'unknown';
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
  role: string | null;
  source: 'adapter+dialog' | 'dialog' | 'none';
}

export interface GovernanceSnapshot {
  projectId: string | null;
  projectDisplayName: string | null;
  projectTrust: string | null;
  canonicalSourceRef: string | null;
  canonicalSourceCommit: string | null;
  adapter: ProjectAdapter | null;
  roles: GovernanceRoleHint[];
  gates: GovernanceGateView;
  dialogue: GovernanceDialogueView;
  agentHints: GovernanceAgentHint[];
  hasGate: boolean;
  problems: string[];
}

const ACTIVE_LIFECYCLE = new Set(['ACTIVE', 'PAUSED', 'FROZEN', 'STANDBY']);

function pickDialogue(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  conversation: Conversation | null,
): GovernanceDialogueView {
  if (!snapshot || !projectId || !conversation) {
    return {
      roleFromRegistry: null,
      lifecycle: 'UNKNOWN',
      verification: 'UNKNOWN',
      sessionId: null,
      platform: null,
      gitAuthority: null,
    };
  }
  const match = snapshot.conversations.find((candidate) =>
    candidate.key === conversation.key && candidate.project === projectId);
  if (!match) {
    return {
      roleFromRegistry: null,
      lifecycle: 'UNKNOWN',
      verification: 'UNKNOWN',
      sessionId: null,
      platform: null,
      gitAuthority: null,
    };
  }
  return {
    roleFromRegistry: match.role,
    lifecycle: ACTIVE_LIFECYCLE.has(match.status) ? match.status : 'UNKNOWN',
    verification: match.verification,
    sessionId: match.sessionId ?? null,
    platform: match.platform,
    gitAuthority: match.gitAuthority ?? null,
  };
}

function projectGateConflicts(snapshot: OverlaySnapshot | null, projectId: string | null): { key: string; values: string[] }[] {
  if (!snapshot || !projectId) return [];
  const sameProject = snapshot.projects.filter((project) => project.projectId === projectId);
  if (sameProject.length < 2) return [];
  const conflicts: { key: string; values: string[] }[] = [];
  const allKeys = new Set<string>();
  for (const project of sameProject) {
    for (const key of Object.keys(project.gates)) allKeys.add(key);
  }
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

function findRoleHarnessHint(
  adapter: ProjectAdapter | null,
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  harness: 'codex' | 'claude' | 'deepseek',
): { role: string | null; source: 'adapter+dialog' | 'dialog' | 'none' } {
  if (!adapter) return { role: null, source: 'none' };
  // Adapter roles may name the harness family explicitly (e.g. "Codex
  // builder" / "Claude reviewer"). When no adapter role names the harness,
  // we fall back to the dialog registry: if the active project has at least
  // one dialogue on that platform, the harness is at least plausible.
  const platformAlias: Record<string, string[]> = {
    codex: ['codex', 'gpt', 'luna'],
    claude: ['claude', 'sonnet', 'opus', 'haiku'],
    deepseek: ['deepseek', 'r1', 'v3'],
  };
  const aliases = platformAlias[harness] ?? [harness];
  for (const role of adapter.roles) {
    const lower = `${role.name} ${role.responsibility}`.toLowerCase();
    if (aliases.some((alias) => lower.includes(alias))) {
      return { role: role.name, source: 'adapter+dialog' };
    }
  }
  if (snapshot && projectId) {
    const matched = snapshot.conversations.some((candidate) =>
      candidate.project === projectId && candidate.platform === harness);
    if (matched) return { role: `${harness} 对话`, source: 'dialog' };
  }
  return { role: null, source: 'none' };
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
  if (ownerConflicts.length > 0) {
    problems.push(`project_gates have hard conflicts: ${ownerConflicts.map((conflict) => conflict.key).join(', ')}`);
  }
  if (dialogue.verification === 'UNVERIFIED') problems.push('Active dialogue is UNVERIFIED in the registry.');
  if (dialogue.lifecycle === 'UNKNOWN' && projectId) problems.push('Active dialogue lifecycle is UNKNOWN.');
  if (snapshot && projectId && adapter?.trust === 'UNKNOWN') problems.push('Project adapter trust is UNKNOWN.');

  const roles: GovernanceRoleHint[] = (adapter?.roles ?? []).map((role) => {
    const alive = snapshot?.conversations.some((candidate) =>
      candidate.project === projectId && candidate.role === role.name) ?? false;
    const lifecycle = alive
      ? (snapshot?.conversations.find((candidate) => candidate.project === projectId && candidate.role === role.name)?.status ?? 'UNKNOWN')
      : 'UNKNOWN';
    return {
      source: 'adapter',
      role: role.name,
      responsibility: role.responsibility,
      alive,
      lifecycle: ACTIVE_LIFECYCLE.has(lifecycle) ? lifecycle : 'UNKNOWN',
    };
  });

  const agentHints: GovernanceAgentHint[] = (['codex', 'claude', 'deepseek'] as const).map((harness) => {
    const hint = findRoleHarnessHint(adapter, snapshot, projectId, harness);
    return { harness, role: hint.role, source: hint.source };
  });

  return {
    projectId: adapter?.projectId ?? projectId,
    projectDisplayName: adapter?.displayName ?? null,
    projectTrust: adapter?.trust ?? null,
    canonicalSourceRef: adapter?.canonicalSource?.path ? projectFileSourceRef(adapter.projectId, adapter.canonicalSource.path) : null,
    canonicalSourceCommit: adapter?.canonicalSource?.commit ?? null,
    adapter,
    roles,
    gates: {
      declared,
      defaultFlow: declared.default_flow ?? null,
      undeclared: !hasGate,
      ownerConflicts,
    },
    dialogue,
    agentHints,
    hasGate,
    problems,
  };
}

/**
 * Source refs that the compiled Packet must carry so the Governance context
 * survives every dispatch (Single / Parallel / Handoff). Mirrors the existing
 * rule already used in store.sendTask and PacketPanel. Demo overrides with
 * the demo-namespaced ref so the dispatch chain still carries a verifiable
 * governance anchor without leaking the real Overlay.
 */
export function governanceRefsForPacket(
  snapshot: OverlaySnapshot | null,
  projectId: string | null,
  isDemo: boolean,
): string[] {
  if (!projectId) return [];
  if (isDemo) {
    return snapshot?.projects.find((project) => project.projectId === projectId)
      ? [`demo:adapter:${projectId}`]
      : [];
  }
  const refs: string[] = [];
  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  if (project?.canonicalSource?.path) refs.push(projectFileSourceRef(projectId, project.canonicalSource.path));
  refs.push(overlayFileSourceRef('memory/MEMORY.md'));
  return refs;
}
