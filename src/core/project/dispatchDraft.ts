import type {
  ExecutionEnvironment,
  HarnessCapabilities,
  PacketValidity,
} from '../types';

/**
 * Explicit Dispatch Surface — Dispatch Draft (PHASE 3D.1).
 *
 * A Dispatch Draft is a ONE-SHOT dispatch PREPARATION held in the renderer
 * while the user assembles: which Task, with which Frozen Packet, to which
 * Conversation and executor. It is deliberately EPHEMERAL (no persistence
 * seam, no file): the durable identities it references already live in
 * their own sources of truth —
 *   Task / Work  -> canonical project facts
 *   packetId     -> the FrozenPacket store
 *   conversation -> the Overlay conversation inventory
 * so the draft cannot become a second SOT for any of them.
 *
 * Hard rules locked by tests:
 * - Canonical lineage (workId/taskId) enters ONLY as an exact identity
 *   handed over by the caller; this module contains no inference.
 * - The executor identity keeps the two frozen orthogonal dimensions
 *   (ExecutionBackend x Provider); they are never merged into one id.
 * - Preflight FAILS CLOSED: every check is computed, never assumed.
 */

export const DISPATCH_DRAFT_VERSION = 1 as const;

export interface DispatchDraftV1 {
  schemaVersion: typeof DISPATCH_DRAFT_VERSION;
  projectId: string;
  /** Exact canonical lineage from an explicit Work/Task selection. Absent for QUICK dispatch. */
  workId?: string;
  taskId?: string;
  /** Explicit runtime target for THIS dispatch. Never written back to any Task. */
  conversationKey?: string;
  /** Exact FrozenPacket identity. Only frozen packets may enter. */
  packetId?: string;
  /** Orthogonal executor dimensions. Null until the user picks one. */
  backend: 'native' | 'paseo' | 'acp' | 'external' | null;
  provider: HarnessCapabilities['harness'] | null;
  instruction: string;
  environment: ExecutionEnvironment;
}

export interface DispatchLineage {
  workId?: string;
  taskId?: string;
}

/** Start a preparation. Lineage arrives only from an explicit selection. */
export function createDispatchDraft(projectId: string, lineage: DispatchLineage = {}): DispatchDraftV1 {
  return {
    schemaVersion: DISPATCH_DRAFT_VERSION,
    projectId,
    ...(lineage.workId !== undefined ? { workId: lineage.workId } : {}),
    ...(lineage.taskId !== undefined ? { taskId: lineage.taskId } : {}),
    backend: null,
    provider: null,
    instruction: '',
    environment: { kind: 'real' },
  };
}

/** QUICK dispatch is allowed but must be explicitly labeled as non-canonical. */
export function isCanonicalTaskDispatch(draft: DispatchDraftV1): boolean {
  return draft.taskId !== undefined && draft.workId !== undefined;
}

export function setDispatchConversation(draft: DispatchDraftV1, conversationKey: string | null): DispatchDraftV1 {
  return {
    ...draft,
    ...(conversationKey !== null ? { conversationKey } : { conversationKey: undefined }),
  };
}

/** Only a FrozenPacket identity may enter; the caller must have read it from the frozen store. */
export function setDispatchPacket(draft: DispatchDraftV1, packetId: string | null): DispatchDraftV1 {
  return {
    ...draft,
    ...(packetId !== null ? { packetId } : { packetId: undefined }),
  };
}

/** Backend and provider are set together or not at all — never merged, never auto-picked. */
export function setDispatchExecutor(
  draft: DispatchDraftV1,
  backend: NonNullable<DispatchDraftV1['backend']> | null,
  provider: DispatchDraftV1['provider'],
): DispatchDraftV1 {
  if (backend === null || provider === null) {
    return { ...draft, backend: null, provider: null };
  }
  return { ...draft, backend, provider };
}

export function setDispatchInstruction(draft: DispatchDraftV1, instruction: string): DispatchDraftV1 {
  return { ...draft, instruction };
}

export interface PreflightCheck {
  id: 'executor' | 'packet' | 'conversation' | 'lineage' | 'environment';
  label: string;
  status: 'PASS' | 'BLOCK';
  detail: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

/**
 * Deterministic preflight. `packetValidity` must be computed by the caller
 * via the existing checkPacketValidity against fresh fingerprints — this
 * module never re-derives validity.
 *
 * Packet policy (existing contract, no override invented):
 *   CURRENT -> may dispatch; STALE -> blocked (recompile in the Cabinet
 *   produces a NEW packetId); INVALID -> blocked.
 */
export function preflightDispatch(
  draft: DispatchDraftV1,
  input: {
    capabilities: Partial<Record<HarnessCapabilities['harness'], HarnessCapabilities>>;
    packetValidity?: PacketValidity;
    packetId?: string;
    projectRootBound: boolean;
  },
): PreflightResult {
  const checks: PreflightCheck[] = [];

  if (draft.provider === null || draft.backend === null) {
    checks.push({ id: 'executor', label: 'Executor', status: 'BLOCK', detail: 'no executor selected' });
  } else {
    const capabilities = input.capabilities[draft.provider];
    if (!capabilities) {
      checks.push({ id: 'executor', label: 'Executor', status: 'BLOCK', detail: `provider ${draft.provider} has no capability truth` });
    } else if (!capabilities.canDispatch || capabilities.support.dispatch !== 'YES') {
      checks.push({
        id: 'executor',
        label: 'Executor',
        status: 'BLOCK',
        detail: `${draft.backend}:${draft.provider} dispatch unavailable — ${capabilities.evidence}`,
      });
    } else {
      checks.push({ id: 'executor', label: 'Executor', status: 'PASS', detail: `${draft.backend}:${draft.provider} — ${capabilities.evidence}` });
    }
  }

  if (draft.packetId === undefined) {
    checks.push({ id: 'packet', label: 'Frozen Packet', status: 'BLOCK', detail: 'no frozen packet selected' });
  } else if (input.packetId !== undefined && input.packetId !== draft.packetId) {
    checks.push({ id: 'packet', label: 'Frozen Packet', status: 'BLOCK', detail: 'selected packet no longer matches the frozen identity' });
  } else if (input.packetValidity === 'CURRENT') {
    checks.push({ id: 'packet', label: 'Frozen Packet', status: 'PASS', detail: `${draft.packetId} · CURRENT` });
  } else if (input.packetValidity === 'STALE') {
    checks.push({ id: 'packet', label: 'Frozen Packet', status: 'BLOCK', detail: `${draft.packetId} · STALE — return to the Cabinet and compile a new packet (new packetId)` });
  } else {
    checks.push({ id: 'packet', label: 'Frozen Packet', status: 'BLOCK', detail: `${draft.packetId} · INVALID — dispatch prohibited` });
  }

  if (draft.conversationKey === undefined) {
    checks.push({ id: 'conversation', label: 'Conversation', status: 'BLOCK', detail: 'no explicit conversation target — pick one for this dispatch' });
  } else {
    checks.push({ id: 'conversation', label: 'Conversation', status: 'PASS', detail: `${draft.conversationKey} (this dispatch only)` });
  }

  if (isCanonicalTaskDispatch(draft)) {
    checks.push({ id: 'lineage', label: 'Lineage', status: 'PASS', detail: `canonical Task ${draft.taskId} · Work ${draft.workId}` });
  } else if (draft.workId !== undefined || draft.taskId !== undefined) {
    checks.push({ id: 'lineage', label: 'Lineage', status: 'BLOCK', detail: 'partial canonical lineage — select the Task (or enter as QUICK without lineage)' });
  } else {
    checks.push({ id: 'lineage', label: 'Lineage', status: 'PASS', detail: 'QUICK dispatch — not a canonical Task; no Work/Task identity is minted' });
  }

  checks.push({
    id: 'environment',
    label: 'Environment',
    status: draft.environment.kind === 'real' && input.projectRootBound ? 'PASS' : 'BLOCK',
    detail: draft.environment.kind !== 'real'
      ? `environment ${draft.environment.kind} requires an explicit session identity`
      : input.projectRootBound ? 'real environment · project root bound' : 'no local project root binding',
  });

  return { ok: checks.every((check) => check.status === 'PASS'), checks };
}
