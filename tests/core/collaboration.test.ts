import { describe, expect, it } from 'vitest';
import {
  createCollaborationRun,
  addHandoffRelation,
  setAgentStatus,
  collaborationHasCycle,
} from '../../src/core/project/collaboration';

describe('Collaboration Run (Workbench-owned interaction object)', () => {
  const base = {
    id: 'run-1',
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::Creative OS 主对话',
    mode: 'handoff' as const,
    agents: [
      { agentId: 'planner', harness: 'codex', role: 'planner', goal: 'plan the task' },
      { agentId: 'reviewer', harness: 'claude', role: 'reviewer', goal: 'review the plan' },
    ],
  };

  it('creates a run with pending agents and no relations', () => {
    const run = createCollaborationRun(base);
    expect(run.agents).toHaveLength(2);
    expect(run.agents.every((agent) => agent.status === 'pending')).toBe(true);
    expect(run.relations).toEqual([]);
    expect(run.mode).toBe('handoff');
  });

  it('explicit handoff records an exact source->target relation with the used result ref', () => {
    let run = createCollaborationRun(base);
    run = setAgentStatus(run, 'planner', 'completed', 'exec-planner-1');
    run = addHandoffRelation(run, {
      id: 'rel-1', source: 'planner', target: 'reviewer', usedResultRef: 'exec-planner-1:result',
    });
    expect(run.relations).toHaveLength(1);
    expect(run.relations[0]).toMatchObject({
      id: 'rel-1', kind: 'result-to-context', source: 'planner', target: 'reviewer',
      usedResultRef: 'exec-planner-1:result',
    });
    // The handoff does NOT rewrite runtime/agent status of the target (no auto-orchestration).
    expect(run.agents.find((a) => a.agentId === 'reviewer')?.status).toBe('pending');
  });

  it('refuses ambiguous relations: self-loop, unknown agent, or duplicate edge', () => {
    const run = createCollaborationRun(base);
    expect(() => addHandoffRelation(run, { id: 'x', source: 'planner', target: 'planner', usedResultRef: 'r' })).toThrow();
    expect(() => addHandoffRelation(run, { id: 'x', source: 'planner', target: 'ghost', usedResultRef: 'r' })).toThrow();
    const withRel = addHandoffRelation(run, { id: 'rel-2', source: 'planner', target: 'reviewer', usedResultRef: 'r' });
    expect(() => addHandoffRelation(withRel, { id: 'rel-3', source: 'planner', target: 'reviewer', usedResultRef: 'r2' })).toThrow();
  });

  it('detects cycles so the projection never misreads edge order as lineage', () => {
    let run = createCollaborationRun(base);
    expect(collaborationHasCycle(run)).toBe(false);
    run = addHandoffRelation(run, { id: 'a', source: 'planner', target: 'reviewer', usedResultRef: 'r1' });
    expect(collaborationHasCycle(run)).toBe(false);
    // Add the back edge to form a cycle.
    run = addHandoffRelation(run, { id: 'b', source: 'reviewer', target: 'planner', usedResultRef: 'r2' });
    expect(collaborationHasCycle(run)).toBe(true);
  });
});
