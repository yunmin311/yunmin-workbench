import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { WorkspaceSessionV1 } from '../core/project/workspaceSession';

const TargetSchema = z.object({
  projectId: z.string().min(1).max(1024),
  conversationScope: z.object({
    kind: z.literal('migration-conversation-key'),
    conversationKey: z.string().min(1).max(1024),
    canonicalConversationId: z.string().min(1).optional(),
  }).optional(),
  view: z.enum(['projects', 'control', 'canvas', 'context', 'packet']),
  usedAt: z.string().datetime(),
}).strict();

export const WorkspaceSessionSchema = z.object({
  schemaVersion: z.literal(1),
  last: TargetSchema.nullable(),
  recent: z.array(TargetSchema).max(20),
}).strict();

export interface WorkspaceSessionLoadResult {
  session: WorkspaceSessionV1 | null;
  problem?: string;
}

export function workspaceSessionPath(stateRoot: string): string {
  return join(stateRoot, 'workspace-session-v1.json');
}

export async function readWorkspaceSession(stateRoot: string): Promise<WorkspaceSessionLoadResult> {
  try {
    const raw = await readFile(workspaceSessionPath(stateRoot), 'utf8');
    return { session: WorkspaceSessionSchema.parse(JSON.parse(raw)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { session: null };
    return { session: null, problem: `workspace session rejected: ${String(error)}` };
  }
}

export async function writeWorkspaceSessionAtomic(
  stateRoot: string,
  session: WorkspaceSessionV1,
): Promise<string> {
  const parsed = WorkspaceSessionSchema.parse(session);
  const file = workspaceSessionPath(stateRoot);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(temp, file);
    return file;
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
