import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { freezePacket } from '../core/project/packet';
import type { FrozenPacket, FrozenPacketSummary, TaskPacket } from '../core/types';
import { encodeStateKey } from './stateKey';

export const ContextItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  body: z.string(),
  state: z.enum(['available', 'included', 'excluded']),
  pinned: z.boolean(),
  isReference: z.boolean(),
  sourceRef: z.string().optional(),
  provenance: z.enum(['EXTERNAL', 'USER PROVIDED']).optional(),
  relativePath: z.string().optional(),
});

export const TaskPacketSchema = z.object({
  schemaVersion: z.literal(1),
  packetId: z.string(),
  createdAt: z.string(),
  projectId: z.string().min(1).max(1024),
  conversationKey: z.string().min(1).max(1024),
  conversationId: z.string().optional(),
  taskSummary: z.string(),
  governanceRefs: z.array(z.string()),
  included: z.array(ContextItemSchema),
  references: z.array(ContextItemSchema),
  sourceFingerprints: z.array(z.object({ sourceRef: z.string(), sha256: z.string() })),
  unresolvedDependencies: z.array(z.string()),
  roughTokens: z.number().int().nonnegative(),
});

export const FrozenPacketSchema = TaskPacketSchema.extend({
  frozenAt: z.string(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.number().int().positive(),
});

export interface FrozenProblem {
  file: string;
  message: string;
}

export interface FrozenListResult {
  packets: FrozenPacketSummary[];
  problems: FrozenProblem[];
}

function summaryOf(packet: FrozenPacket): FrozenPacketSummary {
  return {
    schemaVersion: 1,
    packetId: packet.packetId,
    projectId: packet.projectId,
    conversationKey: packet.conversationKey,
    conversationId: packet.conversationId,
    version: packet.version,
    hash: packet.hash,
    frozenAt: packet.frozenAt,
    roughTokens: packet.roughTokens,
    taskSummary: packet.taskSummary,
    sourceFingerprints: packet.sourceFingerprints,
    unresolvedDependencies: packet.unresolvedDependencies,
  };
}

export function frozenPacketDir(stateRoot: string, projectId: string, conversationId: string): string {
  return join(stateRoot, 'frozen-packets', encodeStateKey(projectId), encodeStateKey(conversationId));
}

const summaryCache = new Map<string, { mtimeMs: number; size: number; summary: FrozenPacketSummary }>();

function invalidateCachePrefix(dir: string): void {
  for (const key of summaryCache.keys()) {
    if (key.startsWith(dir)) summaryCache.delete(key);
  }
}

async function readValidated(file: string): Promise<{ summary: FrozenPacketSummary } | { problem: string }> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    return { problem: `unreadable: ${String(error)}` };
  }
  try {
    return { summary: summaryOf(FrozenPacketSchema.parse(JSON.parse(raw))) };
  } catch (error) {
    return { problem: `schema rejected: ${String(error)}` };
  }
}

/**
 * Per-conversation write serialization: rapid double-freeze must never
 * allocate the same version twice. Listing inside the lock keeps version
 * allocation consistent with what is actually on disk.
 */
const scopeLocks = new Map<string, Promise<unknown>>();

async function withScopeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = scopeLocks.get(key) ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(fn);
  scopeLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (scopeLocks.get(key) === run) scopeLocks.delete(key);
  }
}

export async function listFrozenPackets(
  stateRoot: string,
  projectId: string,
  conversationId: string,
): Promise<FrozenListResult> {
  const dir = frozenPacketDir(stateRoot, projectId, conversationId);
  const problems: FrozenProblem[] = [];
  let names: string[];
  try {
    await mkdir(dir, { recursive: true });
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    return { packets: [], problems: [{ file: dir, message: `listing failed: ${String(error)}` }] };
  }
  const loaded: { file: string; summary: FrozenPacketSummary }[] = [];

  const readOne = async (name: string): Promise<void> => {
    const file = join(dir, name);
    let cached = summaryCache.get(file);
    try {
      const stats = await stat(file);
      if (!cached || cached.mtimeMs !== stats.mtimeMs || cached.size !== stats.size) {
        const result = await readValidated(file);
        if ('problem' in result) {
          summaryCache.delete(file);
          problems.push({ file: name, message: result.problem });
          return;
        }
        cached = { mtimeMs: stats.mtimeMs, size: stats.size, summary: result.summary };
        summaryCache.set(file, cached);
      }
    } catch (error) {
      summaryCache.delete(file);
      problems.push({ file: name, message: `stat failed: ${String(error)}` });
      return;
    }
    loaded.push({ file, summary: cached.summary });
  };

  // bounded concurrency: hundreds of cold reads must not serialize
  const CONCURRENCY = 8;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, names.length) }, async () => {
    while (cursor < names.length) {
      const index = cursor;
      cursor += 1;
      await readOne(names[index]);
    }
  });
  await Promise.all(workers);

  loaded.sort((a, b) => a.summary.version - b.summary.version);
  return { packets: loaded.map((entry) => entry.summary), problems };
}

export async function readFrozenPacketDetail(
  stateRoot: string,
  projectId: string,
  conversationId: string,
  query: { version: number } | { hash: string },
): Promise<FrozenPacket | null> {
  const dir = frozenPacketDir(stateRoot, projectId, conversationId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return null;
  }
  if ('version' in query) {
    names = names.filter((name) => name.startsWith(`v${query.version}-`));
  }
  for (const name of names) {
    try {
      const parsed = FrozenPacketSchema.parse(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if ('hash' in query && parsed.hash !== query.hash) continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Atomic, non-destructive freeze: same-directory temp + rename, and an
 * existing frozen file is NEVER silently overwritten — a collision throws.
 */
export async function writeFrozenPacket(
  stateRoot: string,
  packet: TaskPacket,
): Promise<{ frozen: FrozenPacket; path: string }> {
  const lockKey = `${stateRoot}\0${packet.projectId}\0${packet.conversationKey}`;
  return withScopeLock(lockKey, async () => {
    const { packets } = await listFrozenPackets(stateRoot, packet.projectId, packet.conversationKey);
    const frozen = freezePacket(packet, packets);
    const dir = frozenPacketDir(stateRoot, packet.projectId, packet.conversationKey);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `v${frozen.version}-${frozen.hash.slice(0, 8)}.json`);
    const existing = await stat(file).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (existing) {
      throw new Error(`refusing to overwrite existing frozen packet: ${file}`);
    }
    const temp = `${file}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(frozen, null, 2), { encoding: 'utf8', flag: 'wx' });
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    invalidateCachePrefix(dir);
    return { frozen, path: file };
  });
}
