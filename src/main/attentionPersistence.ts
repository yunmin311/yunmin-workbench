import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AttentionLocalState } from '../core/types';

const LocalSchema = z.object({ schemaVersion: z.literal(1), dismissed: z.record(z.string()) });
const EMPTY: AttentionLocalState = { schemaVersion: 1, dismissed: {} };
const writes = new Map<string, Promise<void>>();

function localPath(stateDir: string): string {
  return join(stateDir, 'attention', 'local-v1.json');
}

export async function readAttentionLocalState(stateDir: string): Promise<AttentionLocalState> {
  try {
    return LocalSchema.parse(JSON.parse(await readFile(localPath(stateDir), 'utf8'))) as AttentionLocalState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw new Error(`Attention local state rejected: ${String(error)}`);
  }
}

async function writeAtomic(stateDir: string, state: AttentionLocalState): Promise<void> {
  const path = localPath(stateDir);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(state), 'utf8');
  await rename(temp, path);
}

export function dismissAttention(stateDir: string, itemId: string, observedAt: string): Promise<void> {
  const prior = writes.get(stateDir) ?? Promise.resolve();
  const next = prior.then(async () => {
    const state = await readAttentionLocalState(stateDir);
    const priorObservedAt = state.dismissed[itemId];
    const dismissed = {
      ...state.dismissed,
      [itemId]: priorObservedAt && priorObservedAt > observedAt ? priorObservedAt : observedAt,
    };
    const entries = Object.entries(dismissed).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 1_000);
    await writeAtomic(stateDir, { schemaVersion: 1, dismissed: Object.fromEntries(entries) });
  });
  const queued = next.finally(() => {
    if (writes.get(stateDir) === queued) writes.delete(stateDir);
  });
  writes.set(stateDir, queued);
  return queued;
}
