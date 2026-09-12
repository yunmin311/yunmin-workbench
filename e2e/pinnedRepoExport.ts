import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Materialize a committed repository state without Windows tar pathname
 * decoding. A local no-hardlinks clone leaves the source checkout untouched;
 * its Git metadata is removed so consumers see the same plain-tree shape as
 * the former archive export.
 */
export function exportPinnedRepository(repoRoot: string, commit: string, prefix: string): string {
  const exportDir = mkdtempSync(join(tmpdir(), prefix));
  try {
    execFileSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', repoRoot, exportDir]);
    execFileSync('git', ['-C', exportDir, 'checkout', '--quiet', '--detach', commit]);
    rmSync(join(exportDir, '.git'), { recursive: true, force: true });
    return exportDir;
  } catch (error) {
    rmSync(exportDir, { recursive: true, force: true });
    throw error;
  }
}
