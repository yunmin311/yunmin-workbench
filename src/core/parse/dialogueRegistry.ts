import { load } from 'js-yaml';
import type {
  AttentionState,
  Conversation,
  DialogueStatus,
  Observation,
  Platform,
  TaskState,
  Verification,
} from '../types';

const STATUSES: DialogueStatus[] = ['ACTIVE', 'PAUSED', 'FROZEN', 'STANDBY'];
const VERIFICATIONS: Verification[] = ['VERIFIED', 'UNVERIFIED'];
const PLATFORMS: Platform[] = ['claude', 'codex', 'deepseek'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** Registry routing status -> TaskState. Runtime/attention stay separate (Integrity §3). */
export function toTaskState(status: DialogueStatus): TaskState {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'STANDBY':
      return 'standby';
    case 'PAUSED':
      return 'waiting';
    case 'FROZEN':
      return 'blocked';
    default:
      return 'unknown';
  }
}

const FALLBACK_OBSERVED: Observation = {
  source: 'canonical-file',
  sourceRef: 'unknown',
  observedAt: 'unknown',
  verification: 'UNKNOWN',
};

/** Schema versions this parser understands. Upstream contract MIGRATING:
 *  unknown versions must fail loudly into problems[], never silently misparse. */
const KNOWN_SCHEMA_VERSIONS = new Set([1]);

/** Parse a dialogue-registry YAML (legacy schema_version 1) into Workbench Conversations. */
export function parseDialogueRegistry(yamlText: string, observed: Observation = FALLBACK_OBSERVED): Conversation[] {
  const doc = load(yamlText) as Record<string, unknown> | null;
  if (!doc || !Array.isArray(doc.dialogues)) return [];
  const version = typeof doc.schema_version === 'number' ? doc.schema_version : 1;
  if (!KNOWN_SCHEMA_VERSIONS.has(version)) {
    throw new Error(`unsupported dialogue-registry schema_version: ${String(doc.schema_version)}`);
  }
  return doc.dialogues
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => {
      const role = String(d.role ?? 'UNKNOWN');
      const project = String(d.project ?? 'UNKNOWN');
      const platform = pick(d.platform, PLATFORMS, 'other' as Platform);
      const sessionId =
        typeof d.session_id === 'string' && d.session_id !== 'UNVERIFIED' ? d.session_id : undefined;
      const status = pick(d.status, STATUSES, 'UNKNOWN');
      const verification: Verification = sessionId
        ? pick(d.verification, VERIFICATIONS, 'UNKNOWN')
        : 'UNVERIFIED';
      // registry self-declared VERIFIED -> VERIFIED observation; else OBSERVED-from-file
      const obs: Observation = {
        ...observed,
        verification: verification === 'VERIFIED' ? 'VERIFIED' : observed.verification,
      };
      const attention: AttentionState = 'none'; // attention comes from INBOX projection, not registry
      return {
        key: `${project}::${platform}::${role}`,
        // conversationId intentionally absent: upstream identity contract is MIGRATING
        role,
        level: typeof d.level === 'string' ? d.level : undefined,
        project,
        platform,
        sessionId,
        status,
        taskState: toTaskState(status),
        runtimeState: 'unknown',
        attention,
        verification,
        gitAuthority: typeof d.git_authority === 'string' ? d.git_authority : undefined,
        note: typeof d.note === 'string' ? d.note : undefined,
        observed: obs,
      };
    });
}
