import { simpleGit } from 'simple-git';
import type { GitFacts, Observation } from '../../core/types';

/**
 * Read-only git facts for one project repo (simple-git, Reuse Map).
 * Only remote/branch/status/HEAD — no writes, ever.
 */
export async function readGitFacts(projectId: string, localRoot: string): Promise<GitFacts> {
  const observed: Observation = {
    source: 'process',
    sourceRef: `git -C ${localRoot}`,
    observedAt: new Date().toISOString(),
    verification: 'OBSERVED',
  };
  const git = simpleGit(localRoot);
  const [status, remotes, head] = await Promise.all([
    git.status(),
    git.getRemotes(true),
    git.revparse(['HEAD']).catch(() => undefined),
  ]);
  return {
    projectId,
    localRoot,
    branch: status.current ?? undefined,
    head: head?.trim(),
    remotes: Object.fromEntries(remotes.map((r) => [r.name, r.refs.fetch ?? ''])),
    dirty: !status.isClean(),
    modified: status.modified.length + status.not_added.length + status.created.length + status.deleted.length,
    ahead: status.ahead,
    behind: status.behind,
    observed,
  };
}
