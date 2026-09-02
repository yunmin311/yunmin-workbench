import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type {
  ContextItem,
  FrozenPacket,
  PacketValidity,
  SourceFingerprint,
  TaskPacket,
} from '../types';

/**
 * Task Packet compiler (PDF §5): deterministic assembly of
 * Governance refs + Task + selected Context + References. No model call.
 * Pure and environment-agnostic: runs in renderer (preview) and tests.
 */

export function roughTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderContextItem(item: ContextItem): string {
  const provenance = item.provenance === 'USER PROVIDED' ? ' [USER PROVIDED]' : '';
  const source = item.sourceRefs?.length ? item.sourceRefs.join(', ') : item.sourceRef ?? item.source;
  return [`## ${item.title}${provenance}`, `Source: ${source}`, item.body].join('\n');
}

/** Exact deterministic text handed to a Harness. No timestamps, ids, or model calls. */
export function renderAgentInput(packet: TaskPacket): string {
  const governance = packet.governanceRefs.length > 0
    ? [...packet.governanceRefs].sort().map((ref) => `- ${ref}`).join('\n')
    : '- none';
  const context = packet.included.length > 0
    ? packet.included.map(renderContextItem).join('\n\n')
    : '(none)';
  const references = packet.references.length > 0
    ? packet.references.map(renderContextItem).join('\n\n')
    : '(none)';
  return [
    '# Governance',
    governance,
    '',
    '# Task Summary',
    packet.taskSummary || '(not provided)',
    '',
    '# Context',
    context,
    '',
    '# References',
    references,
  ].join('\n');
}

export interface CompileInput {
  projectId: string;
  conversationKey: string;
  conversationId?: string;
  taskSummary: string;
  governanceRefs: string[];
  staging: ContextItem[];
  /** sha256 per canonical file, from the current snapshot — basis for validity checks. */
  fingerprints?: SourceFingerprint[];
  now?: string;
  packetId?: string;
}

export interface PacketDependencyResolution {
  resolved: SourceFingerprint[];
  unresolved: string[];
  governanceRefs: string[];
}

/** Resolve every declared canonical dependency without guessing ambiguous paths. */
export function packetDependencies(
  governanceRefs: string[],
  staging: ContextItem[],
  fingerprints: SourceFingerprint[],
): PacketDependencyResolution {
  const byRef = new Map(fingerprints.map((f) => [f.sourceRef, f.sha256]));
  // Content dependencies come from the Context staging list only.
  // Governance refs are provenance (where the Governance facts were read
  // from) and are recorded verbatim in the packet header without being
  // re-verified as a content dependency.
  const declarations: string[] = [];
  for (const item of staging) {
    if (item.state !== 'included') continue;
    declarations.push(...(item.sourceRefs?.length ? item.sourceRefs : item.sourceRef ? [item.sourceRef] : []));
  }

  const resolved = new Map<string, string>();
  const unresolved = new Set<string>();
  for (const declaration of declarations) {
    if (byRef.has(declaration)) {
      resolved.set(declaration, byRef.get(declaration)!);
    } else {
      unresolved.add(declaration);
    }
  }
  return {
    resolved: [...resolved].sort(([a], [b]) => a.localeCompare(b)).map(
      ([sourceRef, sha256]) => ({ sourceRef, sha256 }),
    ),
    unresolved: [...unresolved].sort(),
    // Governance refs are recorded as-is; they do not participate in the
    // current-fingerprint comparison and they never block dispatch.
    governanceRefs: [...governanceRefs].sort(),
  };
}

export function compilePacket(input: CompileInput): TaskPacket {
  const included = input.staging.filter((c) => c.state === 'included' && !c.isReference);
  const references = input.staging.filter(
    (c) => c.state === 'included' && c.isReference,
  );
  const governanceRefs = [...input.governanceRefs].sort();
  const dependencies = packetDependencies(
    governanceRefs,
    input.staging,
    input.fingerprints ?? [],
  );
  const packet: TaskPacket = {
    schemaVersion: 1,
    packetId: input.packetId ?? globalThis.crypto.randomUUID(),
    createdAt: input.now ?? new Date().toISOString(),
    projectId: input.projectId,
    conversationKey: input.conversationKey,
    conversationId: input.conversationId,
    taskSummary: input.taskSummary,
    governanceRefs,
    included,
    references,
    sourceFingerprints: dependencies.resolved,
    unresolvedDependencies: dependencies.unresolved,
    roughTokens: 0,
  };
  packet.roughTokens = roughTokenEstimate(renderAgentInput(packet));
  return packet;
}

/**
 * Frozen Packet Validity (Integrity §4): deterministic local comparison.
 * CURRENT = all dependency fingerprints unchanged.
 * STALE   = some dependency changed (hash mismatch).
 * INVALID = a dependency no longer exists / cannot be resolved.
 * Never calls a model; never auto-rebuilds the packet.
 */
export function checkPacketValidity(
  packet: Pick<TaskPacket, 'sourceFingerprints' | 'unresolvedDependencies'>,
  current: SourceFingerprint[],
): PacketValidity {
  // Legacy packets did not record unresolved declarations. They cannot prove
  // CURRENT, so fail closed rather than silently treating missing data as zero.
  if (!Array.isArray(packet.unresolvedDependencies) || packet.unresolvedDependencies.length > 0) {
    return 'INVALID';
  }
  const byRef = new Map(current.map((f) => [f.sourceRef, f.sha256]));
  let stale = false;
  for (const dep of packet.sourceFingerprints) {
    const now = byRef.get(dep.sourceRef);
    if (now === undefined) return 'INVALID';
    if (now !== dep.sha256) stale = true;
  }
  return stale ? 'STALE' : 'CURRENT';
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    ) as T;
  }
  return value;
}

/** Canonical JSON: stable key order so the hash is reproducible. */
export function canonicalPacketJson(packet: TaskPacket): string {
  return JSON.stringify(sortKeys(packet));
}

export function freezePacket(
  packet: TaskPacket,
  existing: Pick<FrozenPacket, 'projectId' | 'conversationKey' | 'version'>[],
  now?: string,
): FrozenPacket {
  const prior = existing.filter(
    (p) => p.projectId === packet.projectId && p.conversationKey === packet.conversationKey,
  );
  const version = prior.length === 0 ? 1 : Math.max(...prior.map((p) => p.version)) + 1;
  const hash = bytesToHex(sha256(new TextEncoder().encode(canonicalPacketJson(packet))));
  return { ...packet, frozenAt: now ?? new Date().toISOString(), hash, version };
}
