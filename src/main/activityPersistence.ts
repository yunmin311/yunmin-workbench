import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ActivityEvent } from '../core/types';

const ActivityEventSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  conversationKey: z.string().min(1),
  kind: z.enum([
    'handoff-dispatched', 'handoff-accepted', 'handoff-failed', 'session-started',
    'turn-started', 'agent-response', 'tool-started', 'tool-completed',
    'file-change', 'turn-completed', 'turn-error',
  ]),
  summary: z.string(),
  runtimeRef: z.string().optional(),
  turnRef: z.string().optional(),
  binding: z.object({
    harness: z.string(), machine: z.string(), cwd: z.string().optional(),
    worktree: z.string().optional(), branch: z.string().optional(), head: z.string().optional(),
    externalSessionRef: z.string().optional(),
  }).optional(),
  runtimeState: z.enum(['working', 'idle', 'stopped', 'error', 'unknown']).optional(),
  observed: z.object({
    source: z.enum(['canonical-file', 'protocol', 'hook', 'process', 'heuristic']),
    sourceRef: z.string(), observedAt: z.string(),
    verification: z.enum(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']),
  }),
});

const ActivityLineSchema = z.object({ schemaVersion: z.literal(1), event: ActivityEventSchema });

function historyPath(stateDir: string): string {
  return join(stateDir, 'activity', 'history.jsonl');
}

export async function appendActivity(stateDir: string, event: ActivityEvent): Promise<void> {
  const path = historyPath(stateDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ schemaVersion: 1, event })}\n`, 'utf8');
}

export async function readActivity(stateDir: string): Promise<{ events: ActivityEvent[]; problem?: string }> {
  try {
    const text = await readFile(historyPath(stateDir), 'utf8');
    const events = text.split(/\r?\n/).filter(Boolean).map((line) => ActivityLineSchema.parse(JSON.parse(line)).event);
    return { events: events as ActivityEvent[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: [] };
    return { events: [], problem: `Activity history rejected: ${String(error)}` };
  }
}

export async function clearActivity(stateDir: string): Promise<void> {
  await rm(historyPath(stateDir), { force: true });
}
