import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { describe, expect, it } from 'vitest';
import {
  readPinnedProjectFile,
  safeRelativePath,
  searchProjectFiles,
} from '../../src/main/adapters/projectFileSources';
import type { ProjectAdapter } from '../../src/core/types';

const REMOTE = 'https://github.com/yunmin311/p1.git';

function adapterFixture(commit: string, overrides: Partial<NonNullable<ProjectAdapter['canonicalSource']>> = {}): ProjectAdapter {
  return {
    projectId: 'p1',
    displayName: 'P1',
    status: 'active',
    canonicalSource: {
      repository: 'yunmin311/p1',
      remote: REMOTE,
      path: 'CLAUDE.md',
      commit,
      verification: 'VERIFIED',
      ...overrides,
    },
    roles: [],
    gates: {},
    trust: 'VERIFIED',
    observed: { source: 'canonical-file', sourceRef: 'adapter', observedAt: '2026-09-12T00:00:00.000Z', verification: 'OBSERVED' },
  };
}

describe('explicit project-file source helpers', () => {
  it('safeRelativePath rejects traversal, absolute paths, backslashes, and NUL', () => {
    expect(safeRelativePath('src/main/domain/image.ts')).toBe(true);
    expect(safeRelativePath('CLAUDE.md')).toBe(true);
    expect(safeRelativePath('../secrets')).toBe(false);
    expect(safeRelativePath('a/../../b')).toBe(false);
    expect(safeRelativePath('C:\\temp\\x')).toBe(false);
    expect(safeRelativePath('/etc/passwd')).toBe(false);
    expect(safeRelativePath('a\\b.md')).toBe(false);
    expect(safeRelativePath('a\0b')).toBe(false);
    expect(safeRelativePath('')).toBe(false);
  });

  it('bounded search finds explicit candidates, skips vendored dirs, returns locators only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-filesearch-'));
    writeFileSync(join(root, 'README.md'), 'x', 'utf8');
    mkdirSync(join(root, 'src', 'domain'), { recursive: true });
    writeFileSync(join(root, 'src', 'domain', 'image.ts'), 'x', 'utf8');
    mkdirSync(join(root, 'node_modules', 'somepkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'somepkg', 'image.ts'), 'x', 'utf8');

    const byName = await searchProjectFiles(root, 'image');
    expect(byName.matches).toEqual(['src/domain/image.ts']);
    const exact = await searchProjectFiles(root, 'src/domain/image.ts');
    expect(exact.matches[0]).toBe('src/domain/image.ts');
    const none = await searchProjectFiles(root, 'zzz-nothing');
    expect(none.matches).toEqual([]);
    const short = await searchProjectFiles(root, 'i');
    expect(short.matches).toEqual([]);
  });

  it('reads the pinned canonical file at the verified commit with a pinned sourceRef', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-pinned-'));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'test');
    writeFileSync(join(root, 'CLAUDE.md'), '# constitution\npinned truth\n', 'utf8');
    await git.add(['CLAUDE.md']);
    await git.commit('constitution');
    await git.addRemote('origin', REMOTE);
    const head = (await git.raw(['rev-parse', 'HEAD'])).trim();

    // Working tree drifts after the pin: the pinned read must NOT see it.
    writeFileSync(join(root, 'CLAUDE.md'), '# constitution\nWORKING TREE DRIFT\n', 'utf8');

    const result = await readPinnedProjectFile(adapterFixture(head), root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item).toMatchObject({
        id: 'pinned:p1:CLAUDE.md',
        source: 'pinned-file:p1',
        sourceRef: `git:yunmin311/p1@${head}:CLAUDE.md`,
        state: 'available',
        provenance: 'EXTERNAL',
      });
      expect(result.item.body).toContain('pinned truth');
      expect(result.item.body).not.toContain('WORKING TREE DRIFT');
      expect(result.fingerprint.sourceRef).toBe(result.item.sourceRef);
      expect(result.fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('fails closed: unverified source, missing commit, remote mismatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-pinned-fail-'));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'test');
    writeFileSync(join(root, 'CLAUDE.md'), 'x', 'utf8');
    await git.add(['CLAUDE.md']);
    await git.commit('c');
    await git.addRemote('origin', REMOTE);
    const head = (await git.raw(['rev-parse', 'HEAD'])).trim();

    const unverified = await readPinnedProjectFile(adapterFixture(head, { verification: 'UNVERIFIED' }), root);
    expect(unverified).toMatchObject({ ok: false });

    const missingCommit = await readPinnedProjectFile(adapterFixture('0'.repeat(40)), root);
    expect(missingCommit).toMatchObject({ ok: false });

    const wrongRemote = await readPinnedProjectFile(adapterFixture(head, { remote: 'https://github.com/someone/else.git' }), root);
    expect(wrongRemote).toMatchObject({ ok: false });
    if (!wrongRemote.ok) expect(wrongRemote.error).toContain('pinned source unverifiable');
  });
});
