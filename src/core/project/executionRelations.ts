import type { ActivityEvent, ContextItem } from '../types';
import { executionIdForEvent } from './runtimeInspector';

export interface CompareExecution {
  executionId: string;
  harness: NonNullable<ActivityEvent['harness']>;
  result?: ActivityEvent;
  evidence: ActivityEvent[];
  failed: boolean;
}

export interface CompareGroup {
  groupId: string;
  executions: CompareExecution[];
}

export interface ExecutionRelation {
  id: string;
  sourceExecutionId: string;
  targetExecutionId: string;
  sourceRef: string;
}

export function resultSourceRef(event: ActivityEvent): string {
  const executionId = executionIdForEvent(event);
  if (!executionId) throw new Error('Agent result has no native runtime identity.');
  return `harness-result:${executionId}:${event.id}`;
}

export function contextFromAgentResult(event: ActivityEvent, _now = new Date().toISOString()): ContextItem {
  if (event.kind !== 'agent-response') throw new Error('Only an Agent response can become handoff Context.');
  if (!event.content?.trim()) throw new Error('Agent result has no real content.');
  const sourceRef = resultSourceRef(event);
  return {
    id: sourceRef,
    title: `${event.harness ?? 'Agent'} result`,
    source: sourceRef,
    sourceRef,
    body: event.content,
    state: 'included',
    pinned: false,
    isReference: true,
    provenance: 'EXTERNAL',
  };
}

export function projectCompareGroups(activity: ActivityEvent[]): CompareGroup[] {
  const groups = new Map<string, Map<string, CompareExecution>>();
  for (const event of activity) {
    if (!event.groupId || !event.harness) continue;
    const executionId = executionIdForEvent(event);
    if (!executionId) continue;
    let executions = groups.get(event.groupId);
    if (!executions) {
      executions = new Map();
      groups.set(event.groupId, executions);
    }
    let execution = executions.get(executionId);
    if (!execution) {
      execution = { executionId, harness: event.harness, evidence: [], failed: false };
      executions.set(executionId, execution);
    }
    if (event.kind === 'agent-response' && event.content?.trim()) execution.result = event;
    if ((event.kind === 'tool-completed' || event.kind === 'file-change') && event.evidenceRef) execution.evidence.push(event);
    if (event.kind === 'turn-error' || event.kind === 'harness-error' || event.kind === 'handoff-failed') execution.failed = true;
  }
  return [...groups].map(([groupId, executions]) => ({
    groupId,
    executions: [...executions.values()].sort((a, b) => a.executionId.localeCompare(b.executionId)),
  }));
}

export function projectTrajectory(activity: ActivityEvent[]): { relations: ExecutionRelation[] } {
  const sources = new Map<string, string>();
  for (const event of activity) {
    if (event.kind !== 'agent-response' || !event.content) continue;
    const executionId = executionIdForEvent(event);
    if (executionId) sources.set(resultSourceRef(event), executionId);
  }
  const relations = new Map<string, ExecutionRelation>();
  for (const event of activity) {
    if (!event.parentSourceRef) continue;
    const sourceExecutionId = sources.get(event.parentSourceRef);
    const targetExecutionId = executionIdForEvent(event);
    if (!sourceExecutionId || !targetExecutionId || sourceExecutionId === targetExecutionId) continue;
    const relation: ExecutionRelation = {
      id: `handoff:${event.parentSourceRef}->${targetExecutionId}`,
      sourceExecutionId,
      targetExecutionId,
      sourceRef: event.parentSourceRef,
    };
    relations.set(relation.id, relation);
  }
  return { relations: [...relations.values()] };
}
