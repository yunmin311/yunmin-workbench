import type { HarnessCapabilities } from './types';

export interface RuntimePresenceExecution {
  executionId: string;
  harness: HarnessCapabilities['harness'];
  externalSessionRef: string;
  startedAt: string;
  canCancel: boolean;
}

export interface RuntimePresenceSnapshot {
  kind: 'snapshot';
  epoch: string;
  revision: number;
  executions: RuntimePresenceExecution[];
}

export type RuntimePresenceMutation =
  | { type: 'upsert'; execution: RuntimePresenceExecution }
  | { type: 'remove'; executionId: string }
  | { type: 'clear' };

export interface RuntimePresenceMutationEnvelope {
  kind: 'mutation';
  epoch: string;
  previousRevision: number;
  revision: number;
  mutation: RuntimePresenceMutation;
}

export type RuntimePresenceEnvelope = RuntimePresenceSnapshot | RuntimePresenceMutationEnvelope;

export interface RuntimePresenceApplyResult {
  snapshot: RuntimePresenceSnapshot;
  accepted: boolean;
  needsSnapshot: boolean;
}

const sortExecutions = (executions: RuntimePresenceExecution[]): RuntimePresenceExecution[] =>
  [...executions].sort((left, right) => left.executionId.localeCompare(right.executionId));

/**
 * Applies only a consecutive authority stream. Readers never invent lifecycle
 * transitions: a gap asks the authority for a fresh snapshot, and stale
 * envelopes cannot revive a completed execution.
 */
export function applyRuntimePresenceEnvelope(
  current: RuntimePresenceSnapshot,
  envelope: RuntimePresenceEnvelope,
): RuntimePresenceApplyResult {
  if (envelope.kind === 'snapshot') {
    if (envelope.epoch === current.epoch && envelope.revision < current.revision) {
      return { snapshot: current, accepted: false, needsSnapshot: false };
    }
    return {
      snapshot: { ...envelope, executions: sortExecutions(envelope.executions) },
      accepted: envelope.epoch !== current.epoch || envelope.revision !== current.revision,
      needsSnapshot: false,
    };
  }

  if (envelope.epoch !== current.epoch) {
    return { snapshot: current, accepted: false, needsSnapshot: true };
  }
  if (envelope.revision <= current.revision) {
    return { snapshot: current, accepted: false, needsSnapshot: false };
  }
  if (
    envelope.previousRevision !== current.revision ||
    envelope.revision !== current.revision + 1
  ) {
    return { snapshot: current, accepted: false, needsSnapshot: true };
  }

  const mutation = envelope.mutation;
  let executions = current.executions;
  if (mutation.type === 'upsert') {
    executions = sortExecutions([
      ...current.executions.filter((item) => item.executionId !== mutation.execution.executionId),
      mutation.execution,
    ]);
  } else if (mutation.type === 'remove') {
    executions = current.executions.filter((item) => item.executionId !== mutation.executionId);
  } else {
    executions = [];
  }
  return {
    snapshot: { kind: 'snapshot', epoch: envelope.epoch, revision: envelope.revision, executions },
    accepted: true,
    needsSnapshot: false,
  };
}
