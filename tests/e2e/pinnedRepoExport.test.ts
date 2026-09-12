import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportPinnedRepository } from '../../e2e/pinnedRepoExport';

describe('exportPinnedRepository', () => {
  it('materializes a pinned commit with Unicode paths on Windows', () => {
    const repo = mkdtempSync(join(tmpdir(), 'wb-pin-source-'));
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Workbench Test'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'workbench@example.invalid'], { cwd: repo });
    writeFileSync(join(repo, '中文路径.md'), 'pinned', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repo });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    const exported = exportPinnedRepository(repo, commit, 'wb-pin-export-');
    try {
      expect(existsSync(join(exported, '中文路径.md'))).toBe(true);
      expect(existsSync(join(exported, '.git'))).toBe(false);
    } finally {
      rmSync(exported, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
