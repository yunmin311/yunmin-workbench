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
}

/** Resolve every declared canonical dependency without guessing ambiguous paths. */
export function packetDependencies(
  governanceRefs: string[],
  staging: ContextItem[],
  fingerprints: SourceFingerprint[],
): PacketDependencyResolution {
  const byRef = new Map(fingerprints.map((f) => [f.sourceRef, f.sha256]));
  const declarations: { label: string; path: string }[] = [];
  // governance refs like "overlay:MEMORY.md" / "project-constitution:CLAUDE.md"
  for (const ref of governanceRefs) {
    const path = ref.split(':').slice(1).join(':');
    declarations.push({ label: ref, path });
  }
  for (const item of staging) {
    if (item.state !== 'included' || !item.sourceRef) continue;
    declarations.push({ label: item.sourceRef, path: item.sourceRef });
  }

  const resolved = new Map<string, string>();
  const unresolved = new Set<string>();
  for (const declaration of declarations) {
    const exact = byRef.has(declaration.path) ? [declaration.path] : [];
    const suffix = exact.length > 0
      ? exact
      : [...byRef.keys()].filter((key) => key.endsWith(`/${declaration.path}`));
    if (suffix.length === 1) {
      resolved.set(suffix[0], byRef.get(suffix[0])!);
    } else {
      unresolved.add(declaration.label);
    }
  }
  return {
    resolved: [...resolved].sort(([a], [b]) => a.localeCompare(b)).map(
      ([sourceRef, sha256]) => ({ sourceRef, sha256 }),
    ),
    unresolved: [...unresolved].sort(),
  };
}

export function compilePacket(input: CompileInput): TaskPacket {
  const included = input.staging.filter((c) => c.state === 'included' && !c.isReference);
  const references = input.staging.filter(
    (c) => c.state === 'included' && c.isReference,
  );
  const governanceRefs = [...input.governanceRefs].sort();
  const bodyChars =
    input.taskSummary.length +
    governanceRefs.join('\n').length +
    included.reduce((n, c) => n + c.body.length, 0) +
    references.reduce((n, c) => n + c.body.length, 0);
  const dependencies = packetDependencies(
    governanceRefs,
    input.staging,
    input.fingerprints ?? [],
  );
  return {
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
    // fixed overhead for packet scaffolding, deterministic
    roughTokens: roughTokenEstimate('§'.repeat(64) + 'x'.repeat(bodyChars)),
  };
}

/**
 * Frozen Packet Validity (Integrity §4): deterministic local comparison.
 * CURRENT = all dependency fingerprints unchanged.
 * STALE   = some dependency changed (hash mismatch).
 * INVALID = a dependency no longer exists / cannot be resolved.
 * Never calls a model; never auto-rebuilds the packet.
 */
export function checkPacketValidity(
  packet: TaskPacket,
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

export function freezePacket(packet: TaskPacket, existing: FrozenPacket[], now?: string): FrozenPacket {
  const prior = existing.filter(
    (p) => p.projectId === packet.projectId && p.conversationKey === packet.conversationKey,
  );
  const version = prior.length === 0 ? 1 : Math.max(...prior.map((p) => p.version)) + 1;
  const hash = bytesToHex(sha256(new TextEncoder().encode(canonicalPacketJson(packet))));
  return { ...packet, frozenAt: now ?? new Date().toISOString(), hash, version };
}
