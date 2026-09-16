import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

/**
 * Hermetic cabinet staging acceptance: persistence is a SPARSE OVERRIDE SET,
 * never a resolved snapshot (no machine state, no local-only commits).
 *
 * One synthetic git repo + minimal overlay, built from scratch in temp dirs.
 * A single Exclude must persist exactly one explicit decision; reverting to
 * the inherited default must delete it; only the explicit item may ever read
 * as a user decision.
 */

const OBSERVED_AT = '2026-09-13T00:00:00.000Z';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function writeRepoFile(repo: string, rel: string, content: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

test('hermetic cabinet staging persists sparse overrides, never resolved snapshots', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'wb-hermetic-sparse-'));
  const stateDir = join(scratch, 'wb-state');
  const overlayRoot = join(scratch, 'overlay');
  const repo = join(scratch, 'repo-sparse');
  mkdirSync(join(stateDir, 'state'), { recursive: true });
  const stateRoot = join(stateDir, 'state');

  const remote = 'https://example.com/hermetic-sparse.git';
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'hermetic-test');
  git(repo, 'config', 'user.email', 'hermetic-test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'remote', 'add', 'origin', remote);
  writeRepoFile(repo, 'CLAUDE.md', '# Sparse Hermetic\nSynthetic constitution for sparse staging acceptance.\n');
  writeRepoFile(repo, 'spec.md', '# Sparse spec\n');
  writeRepoFile(repo, 'tasks.md', '# Sparse tasks\n## s-T1\n## s-T2\n');
  writeRepoFile(repo, 'src/sparse.ts', 'export const sparse = 1;\n');
  writeRepoFile(repo, 'canonical-facts.yaml', [
    'schema_version: "1.0"',
    'record_type: canonical_fact_manifest',
    'project_id: sparse-hermetic',
    'works:',
    '  - work_id: w-sparse',
    '    project_id: sparse-hermetic',
    '    label: Sparse work',
    '    source_ref: spec.md',
    `    observed_at: "${OBSERVED_AT}"`,
    '    verification: VERIFIED',
    '    currentness: CURRENT',
    '    task_ids:',
    '      - s-T1',
    '      - s-T2',
    '    conversation_ids: []',
    'tasks:',
    '  - task_id: s-T1',
    '    project_id: sparse-hermetic',
    '    work_id: w-sparse',
    '    label: Sparse task one',
    '    source_ref: tasks.md#s-T1',
    `    observed_at: "${OBSERVED_AT}"`,
    '    verification: VERIFIED',
    '    currentness: CURRENT',
    '    conversation_ids: []',
    '  - task_id: s-T2',
    '    project_id: sparse-hermetic',
    '    work_id: w-sparse',
    '    label: Sparse task two',
    '    source_ref: tasks.md#s-T2',
    `    observed_at: "${OBSERVED_AT}"`,
    '    verification: VERIFIED',
    '    currentness: CURRENT',
    '    conversation_ids: []',
    'artifacts:',
    '  - artifact_id: sparse-hermetic:s-T1:code',
    '    project_id: sparse-hermetic',
    '    kind: source_file',
    '    source_ref: src/sparse.ts',
    '    task_id: s-T1',
    `    observed_at: "${OBSERVED_AT}"`,
    '    currentness: CURRENT',
    '    verification: VERIFIED',
    '    evidence_refs: []',
    'evidence: []',
    '',
  ].join('\n'));
  git(repo, 'add', '--', '.');
  git(repo, 'commit', '-qm', 'hermetic project facts');
  const commit = git(repo, 'rev-parse', 'HEAD');
  expect(commit).toMatch(/^[0-9a-f]{40}$/);

  writeRepoFile(overlayRoot, 'projects/instances/sparse-hermetic.adapter.yaml', [
    'schema_version: 2',
    'adapter_type: project',
    'project_id: sparse-hermetic',
    'display_name: Sparse Hermetic',
    'status: CANDIDATE',
    `last_verified_at: '${OBSERVED_AT}'`,
    'constitution_copy: false',
    '',
    'canonical_source:',
    '  repository: hermetic/sparse-hermetic',
    `  remote: '${remote}'`,
    '  default_branch: main',
    '  path: CLAUDE.md',
    `  commit: ${commit}`,
    '  verification: VERIFIED',
    '',
    'canonical_fact_sources:',
    '  - kind: WORK',
    '    source_ref: canonical-facts.yaml#works',
    '    format: YAML',
    '    verification: VERIFIED',
    '  - kind: TASK',
    '    source_ref: canonical-facts.yaml#tasks',
    '    format: YAML',
    '    verification: VERIFIED',
    '  - kind: ARTIFACT',
    '    source_ref: canonical-facts.yaml#artifacts',
    '    format: YAML',
    '    verification: VERIFIED',
    '',
    'project_gates:',
    '  sparse-ship: sparse owner',
    '',
    'loading_contract:',
    '  - treat inaccessible or changed sources as UNKNOWN and stop write actions',
    '',
  ].join('\n'));
  writeRepoFile(overlayRoot, 'INBOX.md', '# Hermetic inbox\n');
  writeRepoFile(overlayRoot, 'memory/MEMORY.md', '# Hermetic memory\n');
  writeRepoFile(overlayRoot, 'harness/manifest.yaml', '# Hermetic harness\n{}\n');

  await rebindProjectRoot(stateRoot, {
    projectId: 'sparse-hermetic', selectedRoot: repo, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'sparse-hermetic', expectedRemote: remote,
  });

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: overlayRoot, WB_STATE_DIR: stateDir }),
  });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.vnext-app')).toBeVisible({ timeout: 30_000 });

    const openCabinet = async () => {
      const workRail = win.getByRole('complementary', { name: 'Work regions' });
      await workRail.locator('.approved-work-focus').first().click();
      await win.locator('.react-flow__node[data-id="task:sparse-hermetic:s-T1"]').click();
      await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
      const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
      await expect(cabinet).toBeVisible();
      return cabinet;
    };
    const storedDecisions = () => win.evaluate(async () =>
      (await window.wb.loadCabinetStaging('sparse-hermetic')).staging?.decisions ?? []);

    // Fresh project: no staging record at all.
    expect(await storedDecisions()).toEqual([]);

    const cabinet = await openCabinet();
    // No conversations in the hermetic overlay: the honest dead-end hint shows.
    await expect(cabinet.locator('.preparation-footer .cabinet-hint'))
      .toContainText('No conversations bound to sparse-hermetic');

    // One Exclude persists exactly one explicit decision — never the collection.
    await cabinet.getByRole('button', { name: /Governance/ }).click();
    await cabinet.getByRole('button', { name: 'Excluded: Gate: sparse-ship' }).click();
    await expect.poll(storedDecisions, { timeout: 10_000 }).toEqual([
      expect.objectContaining({ contextId: 'gate:sparse-hermetic:sparse-ship', state: 'excluded', pinned: false }),
    ]);

    // Provenance is exact: the touched item reads as a user decision,
    // the untouched canonical source keeps its source-default reason.
    // (The open detail aside overlays the list, so selection switches go
    // straight to the row element — same React onClick, no hit-test flake.)
    const openDetail = (title: string) => win.evaluate((text) => {
      const row = [...document.querySelectorAll('.cabinet-item-title')]
        .find((el) => el.textContent?.includes(text));
      if (!row) throw new Error(`missing cabinet row ${text}`);
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, title);
    await openDetail('Gate: sparse-ship');
    await expect(cabinet.locator('.cabinet-detail .cabinet-reason'))
      .toContainText('User staging decision: excluded');
    await openDetail('Canonical source: CLAUDE.md');
    await expect(cabinet.locator('.cabinet-detail .cabinet-reason'))
      .toContainText('Source default:');

    // Reverting to the inherited default (available) deletes the override.
    await cabinet.getByRole('button', { name: 'Available: Gate: sparse-ship' }).click();
    await expect.poll(storedDecisions, { timeout: 10_000 }).toEqual([]);

    // Reload the Cabinet: the reverted item is back to its source-default reason.
    await cabinet.getByRole('button', { name: 'Close Context Cabinet' }).click();
    const reopened = await openCabinet();
    expect(await storedDecisions()).toEqual([]);
    await reopened.getByRole('button', { name: /Governance/ }).click();
    await openDetail('Gate: sparse-ship');
    await expect(reopened.locator('.cabinet-detail .cabinet-reason'))
      .toContainText('Source default:');
  } finally {
    await app.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
