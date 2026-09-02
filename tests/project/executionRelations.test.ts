import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../src/core/types';
import { contextFromAgentResult, projectCompareGroups, projectTrajectory } from '../../src/core/project/executionRelations';

const event = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  id: 'event-1', projectId: 'project-1', conversationKey: 'conversation-1', kind: 'agent-response',
  summary: 'Assistant result', harness: 'codex', runtimeRef: 'thread-1', intentId: 'intent-1',
  groupId: 'group-1', content: 'A real assistant answer',
  observed: { source: 'protocol', sourceRef: 'codex:item:message-1', observedAt: '2026-09-01T00:00:00.000Z', verification: 'VERIFIED' },
  ...overrides,
});

describe('real execution relations', () => {
  it('turns an actual assistant result into explicit Context with an immutable sourceRef', () => {
    const item = contextFromAgentResult(event({}), '2026-09-01T00:00:01.000Z');
    expect(item).toMatchObject({
      source: 'harness-result:codex::execution:intent-1:event-1',
      sourceRef: 'harness-result:codex::execution:intent-1:event-1',
      body: 'A real assistant answer', state: 'included', isReference: true, provenance: 'EXTERNAL',
    });
  });

  it('refuses summary-only placeholders and events without native runtime identity', () => {
    expect(() => contextFromAgentResult(event({ content: undefined }))).toThrow(/content/i);
    expect(() => contextFromAgentResult(event({ runtimeRef: undefined }))).toThrow(/runtime/i);
  });

  it('projects Compare from actual result, tool, and file evidence without judging', () => {
    const activity: ActivityEvent[] = [
      event({}),
      event({ id: 'tool-1', kind: 'tool-completed', content: 'Read package.json', evidenceRef: 'tool:read-1' }),
      event({ id: 'file-1', kind: 'file-change', content: 'src/App.tsx', evidenceRef: 'file:src/App.tsx' }),
      event({ id: 'result-2', harness: 'claude', runtimeRef: 'session-2', intentId: 'intent-2', content: 'A second real answer' }),
    ];
    const groups = projectCompareGroups(activity);
    expect(groups).toHaveLength(1);
    expect(groups[0].executions.map((execution) => execution.executionId)).toEqual([
      'claude::execution:intent-2', 'codex::execution:intent-1',
    ]);
    expect(groups[0].executions[1]).toMatchObject({
      result: expect.objectContaining({ content: 'A real assistant answer' }),
      evidence: [expect.objectContaining({ evidenceRef: 'tool:read-1' }), expect.objectContaining({ evidenceRef: 'file:src/App.tsx' })],
    });
    expect(groups[0]).not.toHaveProperty('winner');
  });

  it('derives handoff lineage from the selected result sourceRef, never coordinates', () => {
    const source = contextFromAgentResult(event({}), '2026-09-01T00:00:01.000Z');
    const followup = event({
      id: 'result-2', harness: 'claude', runtimeRef: 'session-2', intentId: 'intent-2', groupId: 'group-2',
      parentSourceRef: source.sourceRef, content: 'Follow-up answer',
    });
    const trajectory = projectTrajectory([event({}), followup]);
    expect(trajectory.relations).toEqual([{
      id: `handoff:${source.sourceRef}->claude::execution:intent-2`,
      sourceExecutionId: 'codex::execution:intent-1',
      targetExecutionId: 'claude::execution:intent-2', sourceRef: source.sourceRef,
    }]);
    expect(JSON.stringify(trajectory.relations)).not.toMatch(/\"x\"|\"y\"|position/i);
  });
});
