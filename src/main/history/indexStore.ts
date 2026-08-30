import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type {
  HistoryFileState,
  HistoryHarness,
  HistoryMessage,
  HistoryProblem,
  HistorySessionPatch,
} from '../../core/history/types';

export interface StoredHistoryFile {
  harness: HistoryHarness;
  sourceRef: string;
  state: HistoryFileState;
  /** SHA-256 of every source byte at the indexed size. */
  contentHash: string;
  patch: HistorySessionPatch;
  messages: HistoryMessage[];
  problems: HistoryProblem[];
}

export interface HistoryIndexV1 {
  schemaVersion: 1;
  files: Record<string, StoredHistoryFile>;
}

export const emptyHistoryIndex = (): HistoryIndexV1 => ({ schemaVersion: 1, files: {} });

export function historyIndexPath(stateDir: string): string {
  return join(stateDir, 'history', 'index-v1.json');
}

const ObservationSchema = z.object({
  source: z.enum(['canonical-file', 'protocol', 'hook', 'process', 'heuristic']),
  sourceRef: z.string(), observedAt: z.string(),
  verification: z.enum(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']),
});
const ProblemSchema = z.object({
  fileKey: z.string(), sourceRef: z.string(),
  kind: z.enum(['unreadable', 'json_parse', 'invalid_structure', 'missing_identity', 'truncated_source', 'cache_corrupt']),
  message: z.string(), lineNumber: z.number().int().positive().optional(),
});
const MessageSchema = z.object({
  id: z.string(), sessionId: z.string(), seq: z.number().int().nonnegative(), at: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'unknown']), text: z.string(), truncated: z.boolean(),
  observed: ObservationSchema,
});
const PatchSchema = z.object({
  nativeId: z.string().optional(), cwd: z.string().optional(), title: z.string().optional(),
  gitBranch: z.string().optional(), model: z.string().optional(), startedAt: z.string().optional(),
  endedAt: z.string().optional(), compacted: z.boolean().optional(),
});
const FileStateSchema = z.object({
  fileKey: z.string(), path: z.string(), relativePath: z.string(), size: z.number().nonnegative(),
  mtimeMs: z.number(), watermark: z.number().nonnegative(), lineCursor: z.number().int().nonnegative(),
  sessionId: z.string().optional(), indexedAt: z.string(),
});
const StoredFileSchema = z.object({
  harness: z.enum(['claude-code', 'codex']), sourceRef: z.string(), state: FileStateSchema,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), patch: PatchSchema,
  messages: z.array(MessageSchema), problems: z.array(ProblemSchema),
});
const IndexSchema = z.object({ schemaVersion: z.literal(1), files: z.record(StoredFileSchema) });

export async function readHistoryIndex(stateDir: string): Promise<{ index: HistoryIndexV1; problem?: HistoryProblem }> {
  const path = historyIndexPath(stateDir);
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return { index: IndexSchema.parse(parsed) as HistoryIndexV1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { index: emptyHistoryIndex() };
    return {
      index: emptyHistoryIndex(),
      problem: {
        fileKey: 'workbench-history-index',
        sourceRef: `workbench-cache:${path}`,
        kind: 'cache_corrupt',
        message: `history cache was ignored and will be rebuilt: ${String(error)}`,
      },
    };
  }
}

export async function writeHistoryIndex(stateDir: string, index: HistoryIndexV1): Promise<void> {
  const path = historyIndexPath(stateDir);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(index), 'utf8');
  await rename(temp, path);
}
