import type { RuntimeExecutionView } from '../../core/project/runtimeInspector';
import type { LiveExecutionInfo } from './store';

export interface RuntimeInspectorScope {
  list: RuntimeExecutionView[];
  selected: RuntimeExecutionView | null;
  targetUnavailable: boolean;
}

export function resolveRuntimeInspectorScope(input: {
  executions: RuntimeExecutionView[];
  targetExecutionId: string | null;
  selectedExecutionId: string | null;
  projectId: string | null;
  conversationKey: string | null;
}): RuntimeInspectorScope {
  const target = input.targetExecutionId
    ? input.executions.find((item) => item.executionId === input.targetExecutionId) ?? null
    : null;
  const inScope = input.executions.filter((item) =>
    (!input.projectId || item.projectId === input.projectId)
      && (!input.conversationKey || item.conversationKey === input.conversationKey));
  const list = target && !inScope.some((item) => item.executionId === target.executionId)
    ? [target, ...inScope]
    : inScope;
  const manuallySelected = input.selectedExecutionId
    ? list.find((item) => item.executionId === input.selectedExecutionId) ?? null
    : null;
  const targetUnavailable = Boolean(input.targetExecutionId && !target);
  const selected = manuallySelected
    ?? (input.targetExecutionId ? target : list[0] ?? null);
  return { list, selected, targetUnavailable };
}

export function latestRuntimeExecutionForConversation(
  executions: RuntimeExecutionView[],
  conversationKey: string,
): RuntimeExecutionView | null {
  return executions
    .filter((item) => item.conversationKey === conversationKey)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;
}

export function runtimeCancelAvailability(
  execution: RuntimeExecutionView,
  liveExecutions: LiveExecutionInfo[],
): { enabled: boolean; reason: 'not-live' | 'unsupported' | null } {
  const live = liveExecutions.find((item) => item.executionId === execution.executionId);
  if (!execution.live || !live) return { enabled: false, reason: 'not-live' };
  if (!live.canCancel) return { enabled: false, reason: 'unsupported' };
  return { enabled: true, reason: null };
}
