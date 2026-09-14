import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { exportPinnedRepository } from './pinnedRepoExport';

/**
 * GOAL MODE final visual acceptance. Real Creative OS canonical facts
 * (hermetic governance pin) drive 40-44; the clearly-badged TEST FIXTURE
 * scene drives 45 (Execution/Gate/Evidence/Handoff visuals).
 */
const realOverlay = process.env.WB_REAL_OVERLAY;
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const outDir = resolve('screenshots/workbench-vnext-20260907');

function exportGovernanceState(overlayRoot: string): string {
  return exportPinnedRepository(overlayRoot, GOVERNANCE_PINNED_COMMIT, 'wb-visual-pin-');
}

test('workspace visual acceptance (real facts + badged fixture)', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required');
  const overlayExport = exportGovernanceState(realOverlay!);
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-visual-'));
  const stateRoot = join(stateDir, 'state');
  mkdirSync(stateRoot, { recursive: true });
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os',
    selectedRoot: process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:/1project/creative-os',
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1, projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006', updatedAt: '2026-09-12T00:00:00.000Z',
  }));
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({
      GOV_OVERLAY: overlayExport, WB_STATE_DIR: stateDir,
      WB_COMPACT_WINDOW: '1',
    }),
  });
  await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
  const windows = app.windows();
  const surfaces = windows.map((page) => ({ page, url: page.url() }));
  const win = surfaces.find((candidate) => candidate.url.includes('renderer-vnext'))?.page ?? await app.firstWindow();
  try {
    await win.setViewportSize({ width: 1728, height: 1000 });
    await expect(win.locator('.vnext-app')).toBeVisible();
    await win.evaluate(() => window.wb.getWorkGraphRevision('creative-os'));
    await win.waitForTimeout(1400);
    await expect(win.getByRole('complementary', { name: 'Work regions' })).toBeVisible();
    await expect(win.getByRole('complementary', { name: 'Work regions' })).toContainText('Creative OS');
    await win.screenshot({ path: join(outDir, '40-full-workspace-real.png') });

    // Task focus: contextual dim + glass detail + actions.
    await win.locator('.react-flow__node[data-id="task:creative-os:T006"]').click();
    await win.waitForTimeout(800);
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    await win.screenshot({ path: join(outDir, '41-task-focus-real.png') });

    // Prepare enters one continuous Context -> packet -> preflight workflow.
    await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    await win.waitForTimeout(1400);
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await expect(cabinet).toContainText('Available is not used');
    await expect(cabinet).toContainText('Will use');
    const governanceGroup = cabinet.locator('.cabinet-group', { hasText: 'Governance' });
    const unboundMemoryGroup = cabinet.locator('.cabinet-group', { hasText: 'Memory · unbound' });
    await expect(governanceGroup.getByRole('button', { name: /Governance/ })).toHaveAttribute('aria-expanded', 'true');
    const memoryDisclosure = unboundMemoryGroup.getByRole('button', { name: /Memory · unbound/ });
    await expect(memoryDisclosure).toContainText('0 will use');
    await expect(memoryDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(unboundMemoryGroup.locator('ul')).toBeHidden();
    await memoryDisclosure.click();
    await expect(memoryDisclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(unboundMemoryGroup.locator('.cabinet-row').first()).toBeVisible();
    await memoryDisclosure.click();
    await expect(unboundMemoryGroup.locator('ul')).toBeHidden();
    await win.screenshot({ path: join(outDir, '42-context-cabinet-real.png') });
    await cabinet.locator('#prepare-conversation').selectOption('creative-os::claude::CO 主对话');
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();
    const dispatch = win.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch).toBeVisible();
    await expect(dispatch.locator('.dispatch-ready')).toBeVisible();
    await expect(dispatch.locator('.dispatch-lineage.is-canonical')).toHaveText('Task T006 · Work 001-inspiration-capture');
    await expect(dispatch.getByRole('button', { name: 'Back to Context' })).toBeVisible();
    await win.screenshot({ path: join(outDir, '43-prepare-work-real.png') });
    await dispatch.getByRole('button', { name: 'Close Dispatch' }).click();

    // Compact: the compressed state of the same product.
    const compactWin = app.windows().find((candidate) => candidate !== win);
    await expect(async () => {
      const visible = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.getTitle() === 'Workbench Compact' && w.isVisible()));
      expect(visible).toBe(true);
    }).toPass({ timeout: 15_000 });
    if (compactWin) {
      await compactWin.waitForTimeout(2500);
      await expect(compactWin.getByRole('button', { name: 'Continue current work' })).toBeVisible();
      await expect(compactWin.getByRole('button', { name: 'Prepare current work' })).toBeVisible();
      await compactWin.screenshot({ path: join(outDir, '44-compact-real.png') });
    }

    // 45: TEST FIXTURE scene through the same view path.
    const fixtureUrl = await win.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('fixture', '1');
      return url.toString();
    });
    await win.evaluate((url) => { window.location.href = url; }, fixtureUrl);
    await win.waitForTimeout(2600);
    await expect(win.locator('.wb-fixture-badge')).toBeVisible();
    const fixtureRegions = win.getByRole('complementary', { name: 'Work regions' });
    await expect(fixtureRegions.locator('.approved-work-row')).toHaveCount(2);
    await expect(win.getByRole('region', { name: 'Runtime summary' })).toContainText('claude · working');
    await expect(win.getByRole('region', { name: 'Runtime summary' })).toContainText('codex · stopped');
    await win.locator('.react-flow__node[data-id="task:fixture-os:T100"]').click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Fixture · implement flow');
    await win.getByRole('button', { name: 'Evidence', exact: true }).click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('verified relation');
    await win.screenshot({ path: join(outDir, '45-governance-fixture.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
