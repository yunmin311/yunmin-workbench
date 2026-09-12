import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  CABINET_STAGING_SCHEMA_VERSION,
  migrateLegacyCabinetDraft,
  type CabinetStagingV1,
} from '../core/project/cabinetStaging';
import { LEGACY_CABINET_SCOPE_PREFIX } from '../core/project/cabinetStaging';
import { cabinetScopeKey } from '../core/project/cabinet';
import { draftPath, WorkbenchDraftSchema } from './draftPersistence';
import { encodeStateKey } from './stateKey';

/**
 * Durable Cabinet staging state (PHASE 3C.2 formal scope).
 *
 * Stored OUTSIDE the legacy drafts tree on purpose: the portability draft
 * sweep strict-parses every file under drafts/v1 as a conversation-scope
 * WorkbenchDraftV1, and a Cabinet scope kind must never enter (or break)
 * that contract. Legacy 3C.1 cabinet drafts ARE migrated out of the drafts
 * tree once, then removed so they cannot be double-read.
 */

const CabinetStagingSchema = z.object({
  schemaVersion: z.literal(CABINET_STAGING_SCHEMA_VERSION),
  scope: z.object({
    kind: z.literal('project-context-cabinet'),
    projectId: z.string().min(1),
    workId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
  }),
  taskSummary: z.string(),
  decisions: z.array(z.object({
    contextId: z.string().min(1),
    state: z.enum(['available', 'included', 'excluded']),
    pinned: z.boolean(),
    order: z.number().int().nonnegative(),
  })),
  projectFiles: z.array(z.object({
    projectId: z.string().min(1),
    relativePath: z.string().min(1),
    asReference: z.boolean(),
    lastKnownSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })),
  pinnedCanonicalFile: z.boolean(),
}).strict().superRefine((staging, ctx) => {
  for (const file of staging.projectFiles) {
    if (file.projectId !== staging.scope.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectFiles'],
        message: 'project file locator does not match cabinet scope',
      });
    }
  }
});

export interface CabinetStagingLoadResult {
  staging: CabinetStagingV1 | null;
  problem?: string;
  /** True when a legacy 3C.1 draft was converted into the formal scope. */
  migrated?: boolean;
}

export function cabinetStagingPath(stateRoot: string, projectId: string): string {
  return join(stateRoot, 'cabinet-staging', 'v1', `${encodeStateKey(projectId)}.json`);
}

async function writeCabinetStagingAtomic(stateRoot: string, staging: CabinetStagingV1): Promise<string> {
  const file = cabinetStagingPath(stateRoot, staging.scope.projectId);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(staging, null, 2)}\n`, 'utf8');
    await rename(temp, file);
    return file;
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function saveCabinetStagingState(stateRoot: string, raw: unknown): Promise<{ path: string }> {
  const staging = CabinetStagingSchema.parse(raw);
  return { path: await writeCabinetStagingAtomic(stateRoot, staging) };
}

export async function readCabinetStagingState(stateRoot: string, projectId: string): Promise<CabinetStagingLoadResult> {
  let raw: string;
  try {
    raw = await readFile(cabinetStagingPath(stateRoot, projectId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { staging: null, problem: `cabinet staging unreadable: ${String(error)}` };
    }
    return migrateLegacyCabinet(stateRoot, projectId);
  }
  try {
    const parsed = CabinetStagingSchema.parse(JSON.parse(raw));
    if (parsed.scope.projectId !== projectId || parsed.scope.kind !== 'project-context-cabinet') {
      return { staging: null, problem: 'cabinet staging scope does not match its storage key' };
    }
    return { staging: parsed };
  } catch (error) {
    return { staging: null, problem: `cabinet staging rejected: ${String(error)}` };
  }
}

/** One-time migration: legacy `cabinet:v1:<projectId>` draft → formal scope. */
async function migrateLegacyCabinet(stateRoot: string, projectId: string): Promise<CabinetStagingLoadResult> {
  const legacyKey = `${LEGACY_CABINET_SCOPE_PREFIX}${projectId}`;
  let raw: string;
  try {
    raw = await readFile(draftPath(stateRoot, projectId, cabinetScopeKey(projectId)), 'utf8');
  } catch {
    return { staging: null };
  }
  let migrated: CabinetStagingV1 | null = null;
  let problem: string | undefined;
  try {
    const draft = WorkbenchDraftSchema.parse(JSON.parse(raw));
    migrated = migrateLegacyCabinetDraft(projectId, draft);
    if (!migrated) problem = 'legacy cabinet draft did not match the cabinet scope; ignored';
  } catch (error) {
    problem = `legacy cabinet draft rejected: ${String(error)}`;
  }
  if (!migrated) return { staging: null, ...(problem ? { problem } : {}) };
  try {
    await writeCabinetStagingAtomic(stateRoot, migrated);
    await unlink(draftPath(stateRoot, projectId, legacyKey));
  } catch (error) {
    return { staging: migrated, migrated: true, problem: `migrated in memory but not persisted: ${String(error)}` };
  }
  return { staging: migrated, migrated: true };
}
