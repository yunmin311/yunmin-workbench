import { describe, expect, it } from 'vitest';
import { normalizeGitFacts, type RawGitObservation } from '../../src/main/adapters/gitFacts';

function raw(over: Partial<RawGitObservation['status']> = {}): RawGitObservation {
  return {
    status: {
      current: 'main',
      modified: [],
      not_added: [],
      created: [],
      deleted: [],
      ahead: 0,
      behind: 0,
      isClean: () => true,
      ...over,
    },
    remotes: [{ name: 'origin', fetch: 'git@github.com:yunmin311/yunmin-workbench.git' }],
    head: '  78d2278abc  ',
    observedAt: '2026-08-25T03:00:00Z',
  };
}

describe('normalizeGitFacts (read-only projection)', () => {
  it('normalizes clean repo facts', () => {
    const f = normalizeGitFacts('yunmin-workbench', 'D:\\agent-workbench', raw());
    expect(f.branch).toBe('main');
    expect(f.head).toBe('78d2278abc'); // trimmed
    expect(f.remotes.origin).toContain('yunmin-workbench');
    expect(f.dirty).toBe(false);
    expect(f.modified).toBe(0);
    expect(f.observed.source).toBe('process');
    expect(f.observed.verification).toBe('OBSERVED');
  });

  it('counts dirty across modified/untracked/created/deleted and keeps ahead/behind', () => {
    const f = normalizeGitFacts('p', '/x', raw({
      modified: ['a.ts', 'b.ts'],
      not_added: ['c.ts'],
      created: ['d.ts'],
      deleted: [],
      ahead: 2,
      behind: 1,
      isClean: () => false,
    }));
    expect(f.dirty).toBe(true);
    expect(f.modified).toBe(4);
    expect(f.ahead).toBe(2);
    expect(f.behind).toBe(1);
  });

  it('detached HEAD and missing head stay undefined, not guessed', () => {
    const f = normalizeGitFacts('p', '/x', { ...raw({ current: null }), head: undefined });
    expect(f.branch).toBeUndefined();
    expect(f.head).toBeUndefined();
  });

  it('repo without remotes yields empty map', () => {
    const f = normalizeGitFacts('p', '/x', { ...raw(), remotes: [] });
    expect(f.remotes).toEqual({});
  });
});
