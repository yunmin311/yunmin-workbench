import { simpleGit, type StatusResult } from 'simple-git';
import type { GitFacts, Observation } from '../../core/types';

/**
 * Read-only git facts for one project repo (simple-git, Reuse Map).
 * Only remote/branch/status/HEAD — no writes, ever.
 * IO is thin; normalization is pure and unit-tested with fixtures.
 */

export interface RawGitObservation {
  status: Pick<StatusResult, 'current' | 'modified' | 'not_added' | 'created' | 'deleted' | 'ahead' | 'behind'> & {
    isClean: () => boolean;
  };
  remotes: { name: string; fetch?: string }[];
  head?: string;
  observedAt: string;
}

export function normalizeGitFacts(projectId: string, localRoot: string, raw: RawGitObservation): GitFacts {
  const observed: Observation = {
    source: 'process',
    sourceRef: `git -C ${localRoot}`,
    observedAt: raw.observedAt,
    verification: 'OBSERVED',
  };
  const { status } = raw;
  return {
    projectId,
    localRoot,
    branch: status.current ?? undefined,
    head: raw.head?.trim() || undefined,
    remotes: Object.fromEntries(raw.remotes.map((r) => [r.name, r.fetch ?? ''])),
    dirty: !status.isClean(),
    modified:
      status.modified.length + status.not_added.length + status.created.length + status.deleted.length,
    ahead: status.ahead,
    behind: status.behind,
    observed,
  };
}

export async function readGitFacts(projectId: string, localRoot: string): Promise<GitFacts> {
  const git = simpleGit(localRoot);
  const [status, remotes, head] = await Promise.all([
    git.status(),
    git.getRemotes(true),
    git.revparse(['HEAD']).catch(() => undefined),
  ]);
  return normalizeGitFacts(projectId, localRoot, {
    status,
    remotes: remotes.map((r) => ({ name: r.name, fetch: r.refs.fetch })),
    head,
    observedAt: new Date().toISOString(),
  });
}
