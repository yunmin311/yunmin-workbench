import type { OverlaySnapshot, TrustLevel } from '../types';

/**
 * Project Discovery / Coverage (PDF §7).
 * One project may enter through several existing sources; we never build a
 * second project registry — coverage is derived from sources that already exist:
 *   adapter      -> project adapter instance (governance project)
 *   git          -> machine profile project_roots/binding (plain git project)
 *   conversation -> claimed by dialogue registry only (session-only temp project)
 * Trust: adapter+VERIFIED canonical => VERIFIED; adapter => REGISTERED;
 *        git-bound => DISCOVERED; conversation-only => UNKNOWN.
 */
export type CoverageSource = 'adapter' | 'git' | 'conversation';

export interface ProjectEntry {
  projectId: string;
  displayName: string;
  trust: TrustLevel;
  coverage: CoverageSource[];
  conversationCount: number;
  localRoot?: string;
}

export function discoverProjects(snapshot: OverlaySnapshot): ProjectEntry[] {
  const ids = new Set<string>([
    ...snapshot.projects.map((p) => p.projectId),
    ...Object.keys(snapshot.machine?.projectRoots ?? {}),
    ...Object.keys(snapshot.workbenchProjectRoots ?? {}),
    ...snapshot.conversations.map((c) => c.project),
  ]);
  return [...ids].sort().map((id) => {
    const adapter = snapshot.projects.find((p) => p.projectId === id);
    const localRoot = snapshot.workbenchProjectRoots?.[id]?.root ?? snapshot.machine?.projectRoots[id];
    const conversationCount = snapshot.conversations.filter((c) => c.project === id).length;
    const coverage: CoverageSource[] = [];
    if (adapter) coverage.push('adapter');
    if (localRoot) coverage.push('git');
    if (conversationCount > 0) coverage.push('conversation');
    const trust: TrustLevel = adapter
      ? adapter.trust // VERIFIED | REGISTERED
      : localRoot
        ? 'DISCOVERED'
        : 'UNKNOWN'; // conversation-only: exists as a claim, nothing verified
    return {
      projectId: id,
      displayName: adapter?.displayName ?? id,
      trust,
      coverage,
      conversationCount,
      localRoot,
    };
  });
}
