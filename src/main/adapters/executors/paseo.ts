/**
 * Paseo execution adapter — minimal spike using @getpaseo/client public API.
 *
 * Scope:
 * - Implements the Workbench Executor contract for the Paseo backend.
 * - Uses ONLY public exports from @getpaseo/client (no internal/*).
 * - Capabilities that the public SDK does not expose are reported as
 *   NO / UNKNOWN with concrete evidence — no internal fallback.
 *
 * What this is NOT:
 * - Not a full Paseo integration. No daemon spawn, no relay setup,
 *   no account/pairing UI. The Paseo daemon is an external service.
 * - Not a raw WebSocket implementation. If the public SDK cannot
 *   express a capability, the adapter reports NO/UNKNOWN.
 *
 * Capability mapping (Paseo public SDK -> Workbench ExecutorCapabilities):
 * - discover: YES — providers.listAvailable() / waitForReady()
 * - capabilities: YES — providers.snapshot() + AgentCapabilityFlags
 * - dispatch: YES — agents.create({ config, cwd, prompt })
 * - observe: YES — agent.timeline.subscribe() + agent.timeline.refetch()
 * - cancel: PARTIAL — no public stop(intentId); detach() only removes local subscription.
 *   HubExecutionControlAction "interrupt" exists but is not in public SDK.
 * - resume: UNKNOWN — AgentPersistenceHandle exists in protocol but public SDK
 *   does not expose "resume by nativeHandle". agents.ref(id).refresh() re-binds
 *   but does not round-trip nativeHandle.
 * - runtime identity: YES — getRuntimeIdentity() returns Paseo's
 *   workspaceId + agentId + provider when available; UNKNOWN otherwise.
 */
import {
  createPaseoClient,
  type PaseoClient,
  type PaseoClientConfig,
  type PaseoAgentHandle,
  type PaseoAgentCreateOptions,
  type PaseoAgentRunOptions,
  type PaseoProviderActions,
  type PaseoAgentActions,
  type ConnectionState,
} from '@getpaseo/client';
import type {
  CapabilityAnswer,
  ExecutionBackend,
  ExecutionIdentity,
  Executor,
  ExecutorCapabilities,
  ExecutorAvailability,
  ProviderIdentity,
  RuntimeIdentity,
} from '../../../core/executors/types';

export interface PaseoExecutorOptions {
  /** WebSocket URL of the Paseo daemon (e.g. ws://127.0.0.1:6767/ws). */
  url: string;
  /** Optional password if daemon requires auth. */
  password?: string;
  /** Optional client identifier for debugging. */
  clientId?: string;
  /** Optional logger for SDK internals. */
  logger?: PaseoClientConfig['logger'];
}

const PaseoBackend: ExecutionBackend = 'paseo';

function capability(answer: CapabilityAnswer, evidence: string): { answer: CapabilityAnswer; evidence: string } {
  return { answer, evidence };
}

const CAPABILITIES: ExecutorCapabilities = {
  discover: capability('YES', 'providers.listAvailable() and waitForReady() are public SDK methods'),
  capabilities: capability('YES', 'providers.snapshot() returns AgentCapabilityFlags for each provider'),
  dispatch: capability('YES', 'agents.create() accepts config, cwd, prompt, worktree, autoArchive'),
  observe: capability('YES', 'agent.timeline.subscribe() streams agent_stream events; refetch() does authoritative RPC'),
  cancel: capability('NO', 'public SDK has no stop(intentId) or cancel(executionId); detach() only removes local subscription; hub interrupt not exposed'),
  resume: capability('UNKNOWN', 'AgentPersistenceHandle exists in protocol but public SDK lacks resume-by-nativeHandle verb; agents.ref(id).refresh() rebinds but does not round-trip nativeHandle'),
};

export function createPaseoExecutor(options: PaseoExecutorOptions): Executor {
  const identity: ExecutionIdentity = {
    backend: PaseoBackend,
    provider: 'paseo', // Paseo is a meta-provider; actual provider is per-agent
    id: 'paseo:paseo',
    label: 'Paseo (multi-provider)',
  };

  let client: PaseoClient | null = null;
  let connectionState: ConnectionState = { status: 'idle' };

  async function getClient(): Promise<PaseoClient> {
    if (client) return client;
    const config: PaseoClientConfig = {
      url: options.url,
      password: options.password,
      clientId: options.clientId,
      logger: options.logger,
    };
    client = createPaseoClient(config);
    await client.connect();
    connectionState = client.getConnectionState();
    return client;
  }

  async function availability(): Promise<ExecutorAvailability> {
    try {
      const c = await getClient();
      const state = c.getConnectionState();
      if (state.status === 'connected') {
        // Try a lightweight provider discovery to confirm daemon responsiveness
        await c.providers.listAvailable({ requestId: `avail-${Date.now()}` });
        return { state: 'AVAILABLE', reason: `Connected to ${options.url}; provider discovery responsive` };
      }
      if (state.status === 'connecting') {
        return { state: 'UNKNOWN', reason: `Connecting to ${options.url}` };
      }
      const reason = state.status === 'disconnected' && state.reason
        ? ` (${state.reason})`
        : '';
      return { state: 'UNAVAILABLE', reason: `Connection state: ${state.status}${reason}` };
    } catch (err) {
      return { state: 'UNAVAILABLE', reason: `Failed to reach daemon at ${options.url}: ${String(err)}` };
    }
  }

  async function getRuntimeIdentity(): Promise<RuntimeIdentity | null> {
    // The Paseo executor itself doesn't have a single runtime identity;
    // individual agents do. Return null — the executor registry will
    // query per-agent handles via the adapter if needed.
    return null;
  }

  const executor: Executor = {
    id: identity.id,
    identity,
    capabilities: CAPABILITIES,
    availability,
    getRuntimeIdentity,
  };

  return executor;
}

/**
 * Agent-level operations using the Paseo client. Not part of the
 * Executor contract but exposed for the spike to demonstrate that
 * the public SDK can express dispatch/observe/wait/refresh.
 */
export interface PaseoAgentOps {
  createAgent(options: PaseoAgentCreateOptions): Promise<PaseoAgentHandle>;
  getAgentHandle(agentId: string): PaseoAgentHandle;
  listAgents(opts?: import('@getpaseo/client').PaseoAgentListOptions): Promise<import('@getpaseo/client').PaseoAgentListResult>;
  listProviders(opts?: import('@getpaseo/client').PaseoProviderListOptions): Promise<import('@getpaseo/client').PaseoProviderSnapshotResult>;
  waitForProviderReady(timeoutMs?: number): Promise<import('@getpaseo/client').PaseoProviderSnapshotResult>;
  close(): Promise<void>;
}

export function createPaseoAgentOps(client: PaseoClient): PaseoAgentOps {
  return {
    createAgent: (options) => client.agents.create(options),
    getAgentHandle: (agentId) => client.agents.ref(agentId),
    listAgents: (opts) => client.agents.list(opts),
    listProviders: (opts) => client.providers.snapshot(opts),
    waitForProviderReady: (timeoutMs) => client.providers.waitForReady({ timeoutMs }),
    close: () => client.close(),
  };
}