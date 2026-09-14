import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { exportPinnedRepository } from './pinnedRepoExport';

const realOverlay = process.env.WB_REAL_OVERLAY;
const creativeRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:/1project/creative-os';
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const outDir = resolve('screenshots/production-reconnect-20260914');

async function setViewport(win: Page, width: number, height: number) {
  await win.setViewportSize({ width, height });
  await win.waitForTimeout(500);
}

async function assertDockContract(win: Page) {
  const report = await win.evaluate(() => {
    const selectors = [
      '.approved-presence-rail',
      '.approved-work-rail',
      '.approved-main-surface',
      '.approved-team-dock',
      '.approved-bounded-plane',
      '.approved-action-surface',
    ];
    const boxes = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const box = element.getBoundingClientRect();
      return [selector, { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }];
    }));
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const outside = Object.entries(boxes).filter(([, box]) => box && (
      box.left < -0.5 || box.top < -0.5 || box.right > viewport.width + 0.5 || box.bottom > viewport.height + 0.5
    ));
    const plane = boxes['.approved-bounded-plane'];
    const protrudingObjects = plane ? [...document.querySelectorAll('.approved-bounded-plane .react-flow__node')]
      .filter((element) => getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { id: element.getAttribute('data-id'), left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      })
      .filter((box) => box.left < plane.left - 1 || box.top < plane.top - 1 || box.right > plane.right + 1 || box.bottom > plane.bottom + 1)
      : [];
    return {
      viewport,
      boxes,
      outside,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      protrudingObjects,
    };
  });
  expect(report.outside).toEqual([]);
  expect(report.scrollWidth).toBeLessThanOrEqual(report.viewport.width);
  expect(report.scrollHeight).toBeLessThanOrEqual(report.viewport.height);
  expect(report.protrudingObjects).toEqual([]);
  return report;
}

async function shot(win: Page, name: string) {
  await assertDockContract(win);
  await win.screenshot({ path: join(outDir, `${name}.png`), animations: 'disabled' });
  await win.locator('html').evaluate((element) => { element.style.filter = 'grayscale(1)'; });
  await win.screenshot({ path: join(outDir, `${name}-gray.png`), animations: 'disabled' });
  await win.locator('html').evaluate((element) => { element.style.filter = ''; });
}

test('approved blue prototype reconnect: real Full, Focus, Send-ready and Compact', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required for production reconnect visual acceptance');
  mkdirSync(outDir, { recursive: true });
  const overlayExport = exportPinnedRepository(realOverlay!, GOVERNANCE_PINNED_COMMIT, 'wb-reconnect-pin-');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-reconnect-'));
  const stateRoot = join(stateDir, 'state');
  mkdirSync(stateRoot, { recursive: true });
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os',
    selectedRoot: creativeRoot,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'creative-os',
    workId: '001-inspiration-capture',
    taskId: 'T006',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }));

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: overlayExport, WB_STATE_DIR: stateDir, WB_COMPACT_WINDOW: '1' }),
  });

  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const win = app.windows().find((candidate) => candidate.url().includes('renderer-vnext')) ?? await app.firstWindow();
    await expect(win.locator('.approved-shell')).toBeVisible();
    await expect(win.locator('.wb-fixture-badge')).toHaveCount(0);

    await setViewport(win, 1440, 900);
    await shot(win, '01-full-hero-production-1440x900');
    await setViewport(win, 900, 700);
    await shot(win, '01-full-hero-production-900x700');

    await setViewport(win, 1440, 900);
    await win.locator('.react-flow__node[data-id="task:creative-os:T006"]').click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    await shot(win, '02-focused-work-production-1440x900');
    await setViewport(win, 900, 700);
    await shot(win, '02-focused-work-production-900x700');

    await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await cabinet.locator('#prepare-conversation').selectOption('creative-os::claude::CO 主对话');
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();
    const dispatch = win.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch).toBeVisible();
    await setViewport(win, 1440, 900);
    await expect(dispatch.locator('.dispatch-ready')).toBeVisible();
    const availableExecutor = dispatch.locator('.dispatch-executor:not([disabled])').first();
    await expect(availableExecutor).toBeVisible();
    await availableExecutor.click();
    await expect(dispatch.locator('.dispatch-button')).toBeEnabled();
    await shot(win, '03-send-ready-production-1440x900');
    await setViewport(win, 900, 700);
    await shot(win, '03-send-ready-production-900x700');

    const compactWin = app.windows().find((candidate) => candidate !== win && candidate.url().includes('renderer-compact'));
    expect(compactWin).toBeTruthy();
    await expect(compactWin!.locator('.approved-compact-window')).toBeVisible();
    await compactWin!.screenshot({ path: join(outDir, '04-compact-production.png'), animations: 'disabled' });
    await compactWin!.locator('html').evaluate((element) => { element.style.filter = 'grayscale(1)'; });
    await compactWin!.screenshot({ path: join(outDir, '04-compact-production-gray.png'), animations: 'disabled' });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
