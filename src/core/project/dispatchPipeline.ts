import type {
  ContextItem,
  ExecutionEnvironment,
  HarnessCapabilities,
  HarnessDispatchRequest,
  HandoffReceipt,
  SourceFingerprint,
  TaskPacket,
} from '../types';
import { compilePacket, renderAgentInput } from './packet';

export interface BuildDispatchPlanInput {
  projectId: string;
  conversationKey: string;
  conversationId?: string;
  taskSummary: string;
  governanceRefs: string[];
  staging: ContextItem[];
  fingerprints: SourceFingerprint[];
  agents: HarnessCapabilities['harness'][];
  capabilities: Partial<Record<HarnessCapabilities['harness'], HarnessCapabilities>>;
  environment: ExecutionEnvironment;
  parentSourceRef?: string;
  now?: string;
}

export interface DispatchPlan {
  mode: 'single' | 'parallel' | 'handoff';
  groupId: string;
  packet: TaskPacket;
  packetText: string;
  requests: HarnessDispatchRequest[];
}

export type DispatchOutcome =
  | { harness: HarnessCapabilities['harness']; intentId: string; status: 'accepted'; receipt: HandoffReceipt }
  | { harness: HarnessCapabilities['harness']; intentId: string; status: 'failed'; error: string };

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

export function buildDispatchPlan(
  input: BuildDispatchPlanInput,
  allocateId: () => string = defaultId,
): DispatchPlan {
  const agents = [...new Set(input.agents)];
  if (agents.length === 0) throw new Error('Choose at least one Agent before dispatch.');
  if (agents.length !== input.agents.length) throw new Error('Each Agent may appear only once in a dispatch.');
  for (const harness of agents) {
    if (!input.capabilities[harness]?.canDispatch) {
      throw new Error(`Harness ${harness} dispatch unavailable.`);
    }
  }
  if (input.environment.kind === 'demo' && !input.environment.sessionId.trim()) {
    throw new Error('Demo dispatch requires an explicit session identity.');
  }

  const groupId = allocateId();
  const packet = compilePacket({
    projectId: input.projectId,
    conversationKey: input.conversationKey,
    conversationId: input.conversationId,
    taskSummary: input.taskSummary,
    governanceRefs: input.governanceRefs,
    staging: input.staging,
    fingerprints: input.fingerprints,
    packetId: allocateId(),
    now: input.now,
  });
  if (packet.unresolvedDependencies.length > 0) {
    throw new Error(`Dispatch packet INVALID: missing ${packet.unresolvedDependencies.join(', ')}`);
  }
  const packetText = renderAgentInput(packet);
  const requests = agents.map((harness): HarnessDispatchRequest => ({
    intentId: allocateId(),
    projectId: input.projectId,
    conversationKey: input.conversationKey,
    packetText,
    harness,
    environment: input.environment,
    groupId,
    parentSourceRef: input.parentSourceRef,
  }));
  return {
    mode: input.parentSourceRef ? 'handoff' : agents.length > 1 ? 'parallel' : 'single',
    groupId,
    packet,
    packetText,
    requests,
  };
}

export async function settleDispatchPlan(
  plan: DispatchPlan,
  dispatch: (request: HarnessDispatchRequest) => Promise<HandoffReceipt>,
): Promise<DispatchOutcome[]> {
  return Promise.all(plan.requests.map(async (request): Promise<DispatchOutcome> => {
    try {
      const receipt = await dispatch(request);
      if (receipt.status !== 'ACCEPTED') {
        return { harness: request.harness, intentId: request.intentId, status: 'failed', error: receipt.message ?? receipt.protocolEvidence };
      }
      return { harness: request.harness, intentId: request.intentId, status: 'accepted', receipt };
    } catch (error) {
      return { harness: request.harness, intentId: request.intentId, status: 'failed', error: String(error) };
    }
  }));
}
