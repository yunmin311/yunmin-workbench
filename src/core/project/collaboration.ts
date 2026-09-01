// Workbench-owned Collaboration Run — a UI/Interaction object that organizes ONE
// explicit multi-agent collaboration. It is NOT a Runtime/Task SOT: it does not
// orchestrate, schedule, or decide the next agent, and it never rewrites
// Runtime/History/Memory. It only records an explicit, user-chosen graph of
// agent executions and links their results so the renderer can project it.
//
// Relation semantics are strict: a Handoff relation is created ONLY when the
// user explicitly confirms "send A's result as context/reference to B". It is
// never inferred by time/neighbourhood proximity. Ties are always explicit
// source -> target edges carrying the exact result/context used.

export type CollaborationMode = 'parallel' | 'handoff';

export interface CollaborationAgent {
  /** Stable id within the run. */
  agentId: string;
  /** E.g. planner / researcher / reviewer — a role the user assigns, not a fact. */
  role: string;
  harness: string;
  /** The exact execution/runtime identity this agent leg projected. */
  executionId?: string;
  /** Target/task text the user gave this agent. */
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-input';
}

/**
 * An explicit source -> target relation. Created only when the user confirms a
 * result transfer; `usedResultRef` names the exact result/context handed over so
 * lineage is never guessed by proximity in time.
 */
export interface CollaborationRelation {
  id: string;
  kind: 'result-to-context';
  source: string; // source agentId
  target: string; // target agentId
  /** The exact result/context ref handed over (provenance, not a guess). */
  usedResultRef: string;
  at: string;
}

export interface CollaborationRun {
  id: string;
  projectId: string;
  conversationKey: string;
  mode: CollaborationMode;
  agents: CollaborationAgent[];
  relations: CollaborationRelation[];
  createdAt: string;
}

export function createCollaborationRun(input: {
  id: string;
  projectId: string;
  conversationKey: string;
  mode: CollaborationMode;
  agents: { agentId: string; harness: string; role: string; goal: string }[];
}): CollaborationRun {
  return {
    id: input.id,
    projectId: input.projectId,
    conversationKey: input.conversationKey,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    agents: input.agents.map((agent) => ({ ...agent, status: 'pending' })),
    relations: [],
  };
}

/** Add a completion/failure state to one agent leg. Never touches run mode. */
export function setAgentStatus(run: CollaborationRun, agentId: string, status: CollaborationAgent['status'], executionId?: string): CollaborationRun {
  return {
    ...run,
    agents: run.agents.map((agent) =>
      agent.agentId === agentId ? { ...agent, status, executionId: executionId ?? agent.executionId } : agent,
    ),
  };
}

/**
 * Record an explicit source -> target result handoff. Rejects ambiguous ties:
 * both agents must exist, must differ, and no relation between the pair exists.
 * A relation is NEVER auto-inferred — the caller (UI) supplies it on explicit
 * user confirmation.
 */
export function addHandoffRelation(run: CollaborationRun, relation: {
  id: string; source: string; target: string; usedResultRef: string;
}): CollaborationRun {
  const { source, target, usedResultRef } = relation;
  if (source === target) {
    throw new Error(`Collaboration handoff ${relation.id}: source and target must differ.`);
  }
  const ids = new Set(run.agents.map((agent) => agent.agentId));
  if (!ids.has(source) || !ids.has(target)) {
    throw new Error(`Collaboration handoff ${relation.id}: source/target must be run agents.`);
  }
  if (run.relations.some((r) => r.source === source && r.target === target)) {
    throw new Error(`Collaboration handoff ${relation.id}: duplicate source->target relation.`);
  }
  return {
    ...run,
    relations: [...run.relations, { ...relation, kind: 'result-to-context', at: new Date().toISOString() }],
  };
}

/**
 * Deterministic projection: is there exactly one way the run can be read as a
 * DAG (no self-loop, no duplicate edge)? Used for the Canvas/Trajectory view to
 * guarantee visual coordinates never decide lineage — only the recorded edges do.
 */
export function collaborationHasCycle(run: CollaborationRun): boolean {
  const adj = new Map<string, string[]>();
  for (const agent of run.agents) adj.set(agent.agentId, []);
  for (const rel of run.relations) adj.get(rel.source)?.push(rel.target);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adj.get(node) ?? []) if (dfs(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return run.agents.some((agent) => dfs(agent.agentId));
}
