import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

/**
 * GOAL MODE final visual acceptance. Real Creative OS canonical facts
 * (hermetic governance pin) drive 40-44; the clearly-badged TEST FIXTURE
 * scene drives 45 (Execution/Gate/Evidence/Handoff visuals).
 */
const realOverlay = process.env.WB_REAL_OVERLAY;
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const outDir = resolve('screenshots/workbench-vnext-20260907');

function exportGovernanceState(overlayRoot: string): string {
  const exportDir = mkdtempSync(join(tmpdir(), 'wb-visual-pin-'));
  const tar = execFileSync('git', ['-C', overlayRoot, 'archive', GOVERNANCE_PINNED_COMMIT], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', exportDir], { input: tar, stdio: ['pipe', 'ignore', 'inherit'] });
  return exportDir;
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
      WB_RENDERER_VNEXT: '1', WB_COMPACT_WINDOW: '1',
    }),
  });
  const win = await app.firstWindow();
  try {
    await win.setViewportSize({ width: 1728, height: 1000 });
    await expect(win.locator('.vnext-app')).toBeVisible();
    await win.evaluate(() => window.wb.getWorkGraphRevision('creative-os'));
    await win.waitForTimeout(1400);
    await win.screenshot({ path: join(outDir, '40-full-workspace-real.png') });

    // Task focus: contextual dim + glass detail + actions.
    await win.locator('.react-flow__node[data-id="task:creative-os:T006"]').click();
    await win.waitForTimeout(800);
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    await win.screenshot({ path: join(outDir, '41-task-focus-real.png') });

    // Context Cabinet as a contextual workspace over the focused task.
    await win.getByRole('button', { name: 'Context Cabinet' }).click();
    await win.waitForTimeout(1400);
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await win.screenshot({ path: join(outDir, '42-context-cabinet-real.png') });
    await cabinet.getByRole('button', { name: 'Close Context Cabinet' }).click();

    // Prepare Work: task lineage + preflight.
    await win.getByRole('button', { name: 'Prepare Work' }).click();
    await win.waitForTimeout(900);
    const dispatch = win.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch).toBeVisible();
    await expect(dispatch.locator('.dispatch-lineage.is-canonical')).toHaveText('Task T006 · Work 001-inspiration-capture');
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
    await win.screenshot({ path: join(outDir, '45-governance-fixture.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
