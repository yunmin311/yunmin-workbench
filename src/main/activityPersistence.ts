import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
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
  intentId: z.string().min(1).max(1024).optional(),
  groupId: z.string().min(1).max(1024).optional(),
  parentSourceRef: z.string().min(1).max(4096).optional(),
  content: z.string().max(5_000_000).optional(),
  evidenceRef: z.string().min(1).max(4096).optional(),
  simulated: z.boolean().optional(),
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

export interface ActivityPage {
  events: ActivityEvent[];
  problem?: string;
  rejectedLines: number;
  nextBeforeByte?: number;
  hasEarlier: boolean;
  /** True when the file itself could not be opened or read — never a healthy empty page. */
  ioFailed?: boolean;
  /** True when the 8MB page budget stopped the scan before the requested window was covered. */
  scanCapped?: boolean;
}

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

/**
 * Reads a bounded byte window from the end of Activity JSONL. The cursor is a
 * physical byte boundary, so paging never needs to load or split the whole
 * append-only file. Malformed records remain isolated inside each page.
 */
export async function readActivityPage(
  stateDir: string,
  options: { beforeByte?: number; limit?: number } = {},
): Promise<ActivityPage> {
  const limit = z.number().int().min(1).max(1_000).parse(options.limit ?? 1_000);
  const requestedBefore = options.beforeByte === undefined
    ? undefined
    : z.number().int().nonnegative().parse(options.beforeByte);
  const path = historyPath(stateDir);
  let handle;
  try { handle = await open(path, 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], rejectedLines: 0, hasEarlier: false };
    }
    return {
      events: [], rejectedLines: 0, hasEarlier: false, ioFailed: true,
      problem: `Activity history rejected: ${String(error)}`,
    };
  }

  // 1MB reads keep a full 8MB page at eight syscalls. The scratch buffer is already
  // allocated, so a larger chunk costs nothing and removes the per-read I/O latency
  // that dominated the capped-scan path at 64KB.
  const CHUNK_BYTES = 1024 * 1024;
  const MAX_PAGE_BYTES = 8 * 1024 * 1024;
  try {
    const info = await handle.stat();
    // A directory or device at the history path reads as zero bytes on Windows;
    // treating that as an empty history would silently hide a real I/O failure.
    if (!info.isFile()) {
      return {
        events: [], rejectedLines: 0, hasEarlier: false, ioFailed: true,
        problem: 'Activity history rejected: path is not a regular file',
      };
    }
    const size = info.size;
    const end = Math.min(requestedBefore ?? size, size);
    let start = end;
    // The window is filled from the tail backwards into one pre-allocated scratch
    // buffer. Data lives in scratch[dataStart, MAX_PAGE_BYTES) and mirrors file
    // bytes [start, end), so growing the window backwards never copies or shifts
    // anything — a full 8MB page costs one allocation, not one per 64KB chunk.
    const scratch = Buffer.alloc(MAX_PAGE_BYTES);
    let dataStart = MAX_PAGE_BYTES;
    // scratch index of the oldest complete record seen so far; -1 until the first
    // newline is found. Scratch coordinates never move, so this needs no adjusting.
    let boundary = -1;
    // Newest-first. Newly read bytes are always older, so appending in reverse
    // keeps the whole list ordered and each line is parsed exactly once.
    const accepted: { event: ActivityEvent; offset: number }[] = [];
    const seen = new Set<string>();
    let rejectedLines = 0;
    let firstProblem: string | undefined;

    while (start > 0 && dataStart > 0) {
      const length = Math.min(CHUNK_BYTES, start, dataStart);
      const nextStart = start - length;
      dataStart -= length;
      await handle.read(scratch, dataStart, length, nextStart);
      start = nextStart;

      let newBoundary: number;
      if (start === 0) newBoundary = dataStart;
      else {
        const newline = scratch.subarray(dataStart, dataStart + length).indexOf(0x0a);
        if (newline >= 0) newBoundary = dataStart + newline + 1;
        else newBoundary = boundary;
      }
      // No complete record in the window yet: keep accumulating until the budget runs out.
      if (newBoundary < 0) continue;

      const regionEnd = boundary >= 0 ? boundary : MAX_PAGE_BYTES;
      const found: { offset: number; text: string }[] = [];
      let lineStart = newBoundary;
      for (let index = newBoundary; index <= regionEnd; index += 1) {
        if (index !== regionEnd && scratch[index] !== 0x0a) continue;
        let lineEnd = index;
        if (lineEnd > lineStart && scratch[lineEnd - 1] === 0x0d) lineEnd -= 1;
        found.push({
          offset: start + (lineStart - dataStart),
          text: scratch.subarray(lineStart, lineEnd).toString('utf8'),
        });
        lineStart = index + 1;
      }
      boundary = newBoundary;

      // Oldest-to-newest would break duplicate resolution, so walk the new region
      // backwards: every id already in `seen` is strictly newer and wins.
      for (let index = found.length - 1; index >= 0; index -= 1) {
        const record = found[index];
        if (!record.text.trim()) continue;
        let event: ActivityEvent;
        try {
          event = ActivityLineSchema.parse(JSON.parse(record.text)).event;
        } catch (error) {
          rejectedLines += 1;
          firstProblem ??= `byte ${record.offset}: ${String(error)}`;
          continue;
        }
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (accepted.length < limit) accepted.push({ event, offset: record.offset });
      }
      if (accepted.length >= limit || start === 0) break;
    }
    // Exiting with start > 0 means the 8MB budget, not the file, ended the scan.
    const scanCapped = start > 0 && accepted.length < limit;
    const chronological = accepted.slice().reverse();
    const nextBeforeByte = chronological[0]?.offset ?? start;
    const problemParts = [
      rejectedLines > 0 ? `isolated ${rejectedLines} malformed line(s); first: ${firstProblem}` : '',
      scanCapped ? `page scan capped at ${MAX_PAGE_BYTES} bytes` : '',
    ].filter(Boolean);
    return {
      events: chronological.map((item) => item.event),
      rejectedLines,
      hasEarlier: nextBeforeByte > 0,
      nextBeforeByte: nextBeforeByte > 0 ? nextBeforeByte : undefined,
      scanCapped,
      problem: problemParts.length ? `Activity history ${problemParts.join('; ')}` : undefined,
    };
  } catch (error) {
    return {
      events: [], rejectedLines: 0, hasEarlier: false, ioFailed: true,
      problem: `Activity history rejected: ${String(error)}`,
    };
  } finally {
    await handle.close();
  }
}

export async function clearActivity(stateDir: string): Promise<void> {
  const path = historyPath(stateDir);
  return mutateHistory(path, () => rm(path, { force: true }));
}
