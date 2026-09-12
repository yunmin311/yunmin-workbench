import { createHash } from 'node:crypto';
import { isAbsolute, posix, relative, win32 } from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { ContextItem, ProjectAdapter, SourceFingerprint } from '../../core/types';
import { MAX_FILE_CONTEXT_BYTES, resolveProjectFile } from './projectFiles';
import { normalizedRemote, pinnedFileSourceRef } from './canonicalFacts';

/**
 * Explicit project-file Context sources for the vNext Cabinet (PHASE 3C.2).
 *
 * Two strictly separated identities for the same repo path:
 * - WORKING TREE: resolved from the machine-bound local root right now.
 *   sourceRef `project-file:<projectId>:<path>`; fingerprint hashes the
 *   current file, so edits move validity CURRENT -> STALE.
 * - PINNED: read with `git show <verifiedCommit>:<path>` from the bound
 *   repository. sourceRef `git:<repository>@<commit>:<path>`; the pinned
 *   commit is immutable, so the fingerprint can only be CURRENT or INVALID
 *   (repo/commit gone) — never silently replaced by working-tree content.
 *
 * There is no enumeration-to-context path here: search only returns
 * candidate locators for an explicit user pick.
 */

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Repo-relative, forward-slash, no traversal, no absolute, no backslash. */
export function safeRelativePath(path: string): boolean {
  return Boolean(path)
    && !isAbsolute(path) && !win32.isAbsolute(path)
    && !path.includes('\\') && !path.includes('\0')
    && posix.normalize(path) === path
    && !path.split('/').includes('..');
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage',
  'test-results', 'playwright-report', '.next', '.vite',
]);

const MAX_DEPTH = 8;
const MAX_VISITED = 20_000;
const MAX_MATCHES = 24;
const MIN_QUERY_CHARS = 2;

export interface ProjectFileSearchResult {
  /** Exact relative-path match first, then bounded filename-substring hits. */
  matches: string[];
  errors: string[];
}

/**
 * Bounded, user-initiated filename search over the bound project root.
 * Returns candidate locators only — nothing becomes Context until the user
 * explicitly adds it. Deterministic order: exact path hit, then sorted walk.
 */
export async function searchProjectFiles(boundRoot: string, rawQuery: string): Promise<ProjectFileSearchResult> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < MIN_QUERY_CHARS) return { matches: [], errors: [`search needs at least ${MIN_QUERY_CHARS} characters`] };
  const errors: string[] = [];
  const matches = new Set<string>();
  const rootReal = await realpath(boundRoot).catch((error: unknown) => {
    errors.push(String(error));
    return null;
  });
  if (!rootReal) return { matches: [], errors };

  const wanted = rawQuery.trim();
  if (safeRelativePath(wanted)) {
    try {
      const exact = await resolveProjectFile(boundRoot, wanted);
      matches.add(exact.relativePath);
    } catch { /* no exact file at that path; substring walk still runs */ }
  }

  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (matches.size >= MAX_MATCHES || visited >= MAX_VISITED || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (matches.size >= MAX_MATCHES || visited >= MAX_VISITED) return;
      visited += 1;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase().includes(query)) matches.add(relativePosix(rootReal, full));
    }
  };
  await walk(rootReal, 1);
  return { matches: [...matches].slice(0, MAX_MATCHES), errors };
}

function relativePosix(rootReal: string, full: string): string {
  const rel = relative(rootReal, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return rel.replace(/\\/g, '/');
  return rel.split('\\').join('/');
}

export type PinnedProjectFileRead =
  | { ok: true; item: ContextItem; fingerprint: SourceFingerprint }
  | { ok: false; error: string };

/**
 * Read THE project's canonical source at its verified pinned commit. Never
 * falls back to the working tree: a missing commit/object fails closed.
 */
export async function readPinnedProjectFile(
  adapter: ProjectAdapter,
  boundRoot: string,
): Promise<PinnedProjectFileRead> {
  const canonical = adapter.canonicalSource;
  const fail = (error: string): PinnedProjectFileRead => ({ ok: false, error });
  if (!canonical?.path || !canonical.commit || !canonical.remote) {
    return fail('the project adapter declares no canonical source to pin');
  }
  if (canonical.verification !== 'VERIFIED') {
    return fail(`canonical source is ${canonical.verification}; only VERIFIED sources can be pinned`);
  }
  if (!/^[0-9a-f]{40}$/.test(canonical.commit)) {
    return fail('canonical source requires a full 40-hex commit');
  }
  if (!safeRelativePath(canonical.path)) {
    return fail('canonical source path is not a safe repo-relative locator');
  }
  const git = simpleGit(boundRoot);
  try {
    const remotes = await git.getRemotes(true);
    const want = normalizedRemote(canonical.remote);
    const matches = remotes.some((item) =>
      normalizedRemote(item.refs.fetch || item.refs.push || '') === want);
    if (!matches) throw new Error('bound repository remote does not match the project adapter');
    await git.raw(['cat-file', '-e', `${canonical.commit}^{commit}`]);
  } catch (error) {
    return fail(`pinned source unverifiable: ${String(error)}`);
  }
  let text: string;
  try {
    text = await git.show([`${canonical.commit}:${canonical.path}`]);
  } catch (error) {
    return fail(`pinned source unreadable at ${canonical.commit}: ${String(error)}`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_CONTEXT_BYTES) {
    return fail(`pinned file is over the ${MAX_FILE_CONTEXT_BYTES} byte Context limit`);
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text, 'utf8'));
  } catch {
    return fail('pinned file is not valid UTF-8 text');
  }
  const sourceRef = pinnedFileSourceRef(
    canonical.repository ?? adapter.projectId,
    canonical.commit,
    canonical.path,
  );
  return {
    ok: true,
    item: {
      id: `pinned:${adapter.projectId}:${canonical.path}`,
      title: canonical.path,
      source: `pinned-file:${adapter.projectId}`,
      body: text,
      state: 'available',
      pinned: false,
      isReference: false,
      sourceRef,
      provenance: 'EXTERNAL',
      relativePath: canonical.path,
    },
    fingerprint: { sourceRef, sha256: sha256(text) },
  };
}
