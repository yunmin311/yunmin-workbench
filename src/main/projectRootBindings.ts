import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';
import simpleGit from 'simple-git';
import { z } from 'zod';
import { resolveProjectFile } from './adapters/projectFiles';

const BindingSchema = z.object({
  schemaVersion: z.literal(1),
  bindings: z.record(z.string(), z.object({
    projectId: z.string().min(1),
    root: z.string().min(1),
    canonicalPath: z.string().min(1),
    verifiedAt: z.string().datetime(),
    verification: z.literal('VERIFIED'),
  }).strict()),
  unresolved: z.record(z.string(), z.object({
    projectId: z.string().min(1),
    historicalLocator: z.string().min(1),
    status: z.enum(['REBIND REQUIRED', 'CONFLICT', 'UNKNOWN']),
    importedAt: z.string().datetime(),
  }).strict()),
}).strict();
export type ProjectRootBindingsV1 = z.infer<typeof BindingSchema>;

const empty = (): ProjectRootBindingsV1 => ({ schemaVersion: 1, bindings: {}, unresolved: {} });
export const projectRootBindingsPath = (stateRoot: string) => join(stateRoot, 'portability', 'project-root-bindings-v1.json');

export async function readProjectRootBindings(stateRoot: string): Promise<ProjectRootBindingsV1> {
  try { return BindingSchema.parse(JSON.parse(await readFile(projectRootBindingsPath(stateRoot), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw new Error(`project root bindings rejected: ${String(error)}`);
  }
}

export async function writeProjectRootBindingsAtomic(stateRoot: string, state: ProjectRootBindingsV1): Promise<void> {
  const file = projectRootBindingsPath(stateRoot);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temp, JSON.stringify(BindingSchema.parse(state), null, 2), 'utf8'); await rename(temp, file); }
  catch (error) { await unlink(temp).catch(() => undefined); throw error; }
}

export async function rebindProjectRoot(stateRoot: string, request: {
  projectId: string;
  selectedRoot: string;
  canonicalPath: string;
  expectedProjectId: string;
  expectedRemote?: string;
}): Promise<ProjectRootBindingsV1> {
  if (request.projectId !== request.expectedProjectId) throw new Error('project identity request mismatch');
  const info = await stat(request.selectedRoot);
  if (!info.isDirectory()) throw new Error('selected project root is not a directory');
  const root = await realpath(request.selectedRoot);
  const canonical = await resolveProjectFile(root, request.canonicalPath);
  let identityVerified = false;
  if (/\.ya?ml$/i.test(canonical.relativePath)) {
    const doc = load(await readFile(canonical.absolutePath, 'utf8')) as Record<string, unknown> | null;
    const declared = doc?.project_id ?? doc?.projectId;
    if (typeof declared === 'string' && declared !== request.expectedProjectId) {
      throw new Error(`project identity mismatch: expected ${request.expectedProjectId}, observed ${declared}`);
    }
    identityVerified = declared === request.expectedProjectId;
  }
  if (request.expectedRemote) {
    const normalizeRemote = (value: string) => value.trim().replace(/\.git$/i, '').replace(/^git@([^:]+):/, 'https://$1/').toLowerCase();
    const remotes = await simpleGit(root).getRemotes(true).catch(() => []);
    identityVerified = remotes.some((remote) => [remote.refs.fetch, remote.refs.push]
      .some((value) => value && normalizeRemote(value) === normalizeRemote(request.expectedRemote!)));
    if (!identityVerified) throw new Error(`project identity mismatch: expected remote ${request.expectedRemote}`);
  }
  if (!identityVerified) throw new Error('project identity is UNKNOWN at selected root');
  const state = await readProjectRootBindings(stateRoot);
  state.bindings[request.projectId] = {
    projectId: request.projectId,
    root,
    canonicalPath: canonical.relativePath,
    verifiedAt: new Date().toISOString(),
    verification: 'VERIFIED',
  };
  delete state.unresolved[request.projectId];
  await writeProjectRootBindingsAtomic(stateRoot, state);
  return state;
}

export async function effectiveProjectRoot(
  stateRoot: string,
  projectId: string,
  externalRoots: Record<string, string> = {},
): Promise<string | undefined> {
  const local = await readProjectRootBindings(stateRoot);
  return local.bindings[projectId]?.root ?? externalRoots[projectId];
}
