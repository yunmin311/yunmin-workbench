import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { WorkbenchDraftV1 } from '../core/project/draft';
import {
  buildProfileBundle,
  parseProfileBundle,
  type WorkbenchProfileBundleV1,
} from '../core/portability/bundle';
import type { WorkspaceSessionV1 } from '../core/project/workspaceSession';
import { draftPath, WorkbenchDraftSchema, writeWorkbenchDraftAtomic } from './draftPersistence';
import { readWorkspaceSession, workspaceSessionPath, writeWorkspaceSessionAtomic } from './workspacePersistence';
import {
  projectRootBindingsPath,
  readProjectRootBindings,
  writeProjectRootBindingsAtomic,
} from './projectRootBindings';
import type { BindingImportStatus } from '../core/portability/bundle';

async function listDrafts(stateRoot: string): Promise<WorkbenchDraftV1[]> {
  const base = join(stateRoot, 'drafts', 'v1');
  if (!existsSync(base)) return [];
  const drafts: WorkbenchDraftV1[] = [];
  const projects = await readdir(base, { withFileTypes: true });
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    for (const file of (await readdir(join(base, project.name))).filter((name) => name.endsWith('.json'))) {
      const actualPath = join(base, project.name, file);
      let draft: WorkbenchDraftV1;
      try { draft = WorkbenchDraftSchema.parse(JSON.parse(await readFile(actualPath, 'utf8'))); }
      catch (error) { throw new Error(`portable draft rejected at ${actualPath}: ${String(error)}`); }
      const expectedPath = draftPath(stateRoot, draft.scope.projectId, draft.scope.conversationKey);
      if (resolve(actualPath).toLocaleLowerCase() !== resolve(expectedPath).toLocaleLowerCase()) {
        throw new Error(`portable draft storage key mismatch at ${actualPath}`);
      }
      drafts.push(draft);
    }
  }
  return drafts;
}

export async function readPortableState(stateRoot: string): Promise<{
  workspaceSession: WorkspaceSessionV1 | null;
  drafts: WorkbenchDraftV1[];
}> {
  const workspace = await readWorkspaceSession(stateRoot);
  if (workspace.problem) throw new Error(workspace.problem);
  return { workspaceSession: workspace.session, drafts: await listDrafts(stateRoot) };
}

export async function exportProfileBundle(stateRoot: string, input: {
  createdAt?: string;
  projectRoots: Record<string, string>;
}): Promise<string> {
  const state = await readPortableState(stateRoot);
  return JSON.stringify(buildProfileBundle({ ...state, ...input }), null, 2);
}

interface Backup { target: string; bytes: Buffer | null }

export async function applyProfileImportAtomic(
  stateRoot: string,
  bundleInput: WorkbenchProfileBundleV1 | string,
  options: {
    dryRun: boolean;
    failAfterWrites?: number;
    bindingStatuses?: { projectId: string; status: BindingImportStatus; historicalLocator: string }[];
  },
): Promise<void> {
  const bundle = typeof bundleInput === 'string' ? parseProfileBundle(bundleInput) : parseProfileBundle(JSON.stringify(bundleInput));
  if (options.dryRun) return;
  const targets = [
    ...(bundle.profile.workspaceSession ? [workspaceSessionPath(stateRoot)] : []),
    ...bundle.profile.drafts.map((draft) => draftPath(stateRoot, draft.scope.projectId, draft.scope.conversationKey)),
    ...(options.bindingStatuses?.some((item) => item.status !== 'SAME') ? [projectRootBindingsPath(stateRoot)] : []),
  ];
  const backups: Backup[] = await Promise.all(targets.map(async (target) => ({
    target,
    bytes: await readFile(target).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error)),
  })));
  let writes = 0;
  try {
    if (bundle.profile.workspaceSession) {
      await writeWorkspaceSessionAtomic(stateRoot, bundle.profile.workspaceSession);
      writes += 1;
      if (options.failAfterWrites === writes) throw new Error('injected portability transaction failure');
    }
    for (const draft of bundle.profile.drafts) {
      await writeWorkbenchDraftAtomic(stateRoot, draft);
      writes += 1;
      if (options.failAfterWrites === writes) throw new Error('injected portability transaction failure');
    }
    if (options.bindingStatuses?.some((item) => item.status !== 'SAME')) {
      const roots = await readProjectRootBindings(stateRoot);
      for (const item of options.bindingStatuses) {
        if (item.status === 'SAME') continue;
        roots.unresolved[item.projectId] = {
          projectId: item.projectId,
          historicalLocator: item.historicalLocator,
          status: item.status,
          importedAt: new Date().toISOString(),
        };
      }
      await writeProjectRootBindingsAtomic(stateRoot, roots);
      writes += 1;
      if (options.failAfterWrites === writes) throw new Error('injected portability transaction failure');
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const backup of backups) {
      try {
        if (backup.bytes === null) {
          await unlink(backup.target).catch((unlinkError: NodeJS.ErrnoException) => {
            if (unlinkError.code !== 'ENOENT') throw unlinkError;
          });
        } else {
          await mkdir(dirname(backup.target), { recursive: true });
          const temp = `${backup.target}.${process.pid}.${Date.now()}.rollback.tmp`;
          try { await writeFile(temp, backup.bytes); await rename(temp, backup.target); }
          catch (restoreError) { await unlink(temp).catch(() => undefined); throw restoreError; }
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'profile import failed and rollback was incomplete');
    }
    throw error;
  }
}

export async function writeBundleFileAtomic(path: string, raw: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temp, raw, 'utf8'); await rename(temp, path); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}
