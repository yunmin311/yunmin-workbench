import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ActivityEvent } from '../core/types';

const ActivityEventSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  conversationKey: z.string().min(1),
  kind: z.enum([
    'handoff-dispatched', 'handoff-accepted', 'handoff-failed', 'handoff-cancelled', 'session-started',
    'turn-started', 'agent-response', 'tool-started', 'tool-completed',
    'file-change', 'turn-completed', 'turn-error',
    'approval-required', 'needs-user-input', 'harness-error', 'process-cancelled',
  ]),
  summary: z.string(),
  harness: z.enum(['codex', 'claude', 'deepseek']).optional(),
  adapter: z.string().optional(),
  capability: z.enum([
    'dispatch', 'observe', 'receipt', 'approval', 'needsInput',
    'toolEvents', 'fileEvents', 'externalSessionRef', 'resume',
  ]).optional(),
  runtimeRef: z.string().min(1).max(1024).regex(/^[^\u0000\r\n]+$/).optional(),
  turnRef: z.string().min(1).max(1024).regex(/^[^\u0000\r\n]+$/).optional(),
  binding: z.object({
    harness: z.enum(['codex', 'claude', 'deepseek']), machine: z.string(), cwd: z.string().optional(),
    worktree: z.string().optional(), branch: z.string().optional(), head: z.string().optional(),
    externalSessionRef: z.string().min(1).max(1024).regex(/^[^\u0000\r\n]+$/).optional(),
  }).optional(),
  runtimeState: z.enum(['working', 'idle', 'stopped', 'error', 'unknown']).optional(),
  attentionKey: z.string().optional(),
  attentionKind: z.enum(['approval-required', 'needs-user-input', 'execution-review']).optional(),
  attentionStatus: z.enum(['active', 'resolved']).optional(),
  observed: z.object({
    source: z.enum(['canonical-file', 'protocol', 'hook', 'process', 'heuristic']),
    sourceRef: z.string(), observedAt: z.string(),
    verification: z.enum(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']),
  }),
}).superRefine((event, ctx) => {
  if (event.harness && event.binding?.harness && event.harness !== event.binding.harness) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['binding', 'harness'], message: 'binding harness contradicts event harness' });
  }
  if (event.runtimeRef && event.binding?.externalSessionRef && event.runtimeRef !== event.binding.externalSessionRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['binding', 'externalSessionRef'], message: 'binding external ref contradicts runtime ref' });
  }
});

const ActivityLineSchema = z.object({ schemaVersion: z.literal(1), event: ActivityEventSchema });

function historyPath(stateDir: string): string {
  return join(stateDir, 'activity', 'history.jsonl');
}

const mutations = new Map<string, Promise<void>>();

function mutateHistory(path: string, mutation: () => Promise<void>): Promise<void> {
  const prior = mutations.get(path) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(mutation);
  const queued = next.finally(() => {
    if (mutations.get(path) === queued) mutations.delete(path);
  });
  mutations.set(path, queued);
  return queued;
}

export async function appendActivity(stateDir: string, event: ActivityEvent): Promise<void> {
  const path = historyPath(stateDir);
  return mutateHistory(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    // A leading blank line is an explicit recovery boundary. If a crash left a
    // partial JSON tail, the next valid record can never be glued to it; blank
    // lines are ignored by readActivity and cost one byte per append.
    await appendFile(path, `\n${JSON.stringify({ schemaVersion: 1, event })}\n`, 'utf8');
  });
}

export async function readActivity(stateDir: string): Promise<{ events: ActivityEvent[]; problem?: string; rejectedLines?: number }> {
  let text: string;
  try {
    text = await readFile(historyPath(stateDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: [] };
    return { events: [], problem: `Activity history rejected: ${String(error)}` };
  }
  // Bad-line isolation: one malformed/corrupt line is skipped and reported;
  // valid events around it still project. A partial trailing write is the
  // common case (append interrupted) and must not erase live history.
  const eventsById = new Map<string, ActivityEvent>();
  let rejectedLines = 0;
  let firstProblem: string | undefined;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = ActivityLineSchema.parse(JSON.parse(line)).event;
      // Event ids are idempotency keys. A repeated append deterministically
      // replaces the older projection while the append-only evidence remains.
      eventsById.delete(event.id);
      eventsById.set(event.id, event);
    } catch (error) {
      rejectedLines += 1;
      firstProblem ??= `line ${index + 1}: ${String(error)}`;
    }
  }
  const problem = rejectedLines > 0
    ? `Activity history isolated ${rejectedLines} malformed line(s); first: ${firstProblem}`
    : undefined;
  return { events: [...eventsById.values()] as ActivityEvent[], problem, rejectedLines };
}

export async function clearActivity(stateDir: string): Promise<void> {
  const path = historyPath(stateDir);
  return mutateHistory(path, () => rm(path, { force: true }));
}
