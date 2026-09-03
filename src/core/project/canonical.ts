import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Canonical JSON utilities for deterministic hashing.
 * Shared between main process (freezePacket) and renderer (demo mode).
 * Single hash contract across the codebase.
 */

/** Recursively sort object keys and array elements for deterministic JSON. */
export function sortKeys<T>(value: T): T {
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
export function canonicalPacketJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Compute deterministic SHA-256 hash (64 hex chars) of a packet-like object. */
export function computePacketHash(value: unknown): string {
  const { sha256 } = require('@noble/hashes/sha256');
  const { bytesToHex } = require('@noble/hashes/utils');
  return bytesToHex(sha256(new TextEncoder().encode(canonicalPacketJson(value))));
}

/** Compute Frozen packet hash using the formal canonicalization + SHA-256. */
export function computeFrozenPacketHash(packet: unknown): string {
  const { sha256 } = require('@noble/hashes/sha256');
  const { bytesToHex } = require('@noble/hashes/utils');
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(sortKeys(packet)))));
}