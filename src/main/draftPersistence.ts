import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { WorkbenchDraftV1 } from '../core/project/draft';
import { encodeStateKey } from './stateKey';

const DecisionSchema = {
  state: z.enum(['available', 'included', 'excluded']),
  pinned: z.boolean(),
  order: z.number().int().nonnegative(),
};

export const WorkbenchDraftSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.object({
    kind: z.literal('migration-conversation-key'),
    projectId: z.string().min(1),
    conversationKey: z.string().min(1),
    canonicalConversationId: z.string().min(1).optional(),
  }),
  taskSummary: z.string(),
  manualContexts: z.array(z.object({
    ...DecisionSchema,
    id: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    provenance: z.literal('USER PROVIDED'),
  })),
  projectFiles: z.array(z.object({
    ...DecisionSchema,
    projectId: z.string().min(1),
    relativePath: z.string().min(1),
    asReference: z.boolean(),
    lastKnownSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })),
  projectedDecisions: z.array(z.object({
    ...DecisionSchema,
    itemId: z.string().min(1),
  })),
}).strict().superRefine((draft, ctx) => {
  for (const file of draft.projectFiles) {
    if (file.projectId !== draft.scope.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectFiles'],
        message: 'project file locator does not match draft scope',
      });
    }
  }
});

export interface DraftLoadResult {
  draft: WorkbenchDraftV1 | null;
  problem?: string;
}

export function draftPath(stateRoot: string, projectId: string, conversationKey: string): string {
  return join(
    stateRoot,
    'drafts',
    'v1',
    encodeStateKey(projectId),
    `${encodeStateKey(conversationKey)}.json`,
  );
}

export async function readWorkbenchDraft(
  stateRoot: string,
  projectId: string,
  conversationKey: string,
): Promise<DraftLoadResult> {
  const file = draftPath(stateRoot, projectId, conversationKey);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { draft: null };
    return { draft: null, problem: `draft unreadable: ${String(error)}` };
  }
  try {
    const parsed = WorkbenchDraftSchema.parse(JSON.parse(raw));
    if (parsed.scope.projectId !== projectId || parsed.scope.conversationKey !== conversationKey) {
      return { draft: null, problem: 'draft scope does not match its storage key' };
    }
    return { draft: parsed };
  } catch (error) {
    return { draft: null, problem: `draft rejected: ${String(error)}` };
  }
}

/** Same-directory temp + rename prevents readers from observing partial JSON. */
export async function writeWorkbenchDraftAtomic(
  stateRoot: string,
  draft: WorkbenchDraftV1,
): Promise<string> {
  const file = draftPath(stateRoot, draft.scope.projectId, draft.scope.conversationKey);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(draft, null, 2), 'utf8');
    await rename(temp, file);
    return file;
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function clearWorkbenchDraft(
  stateRoot: string,
  projectId: string,
  conversationKey: string,
): Promise<void> {
  await unlink(draftPath(stateRoot, projectId, conversationKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
