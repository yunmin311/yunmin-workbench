import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';

function exportGovernanceState(overlayRoot: string): string {
  const exportDir = mkdtempSync(join(tmpdir(), 'wb-compact-pin-'));
  const tar = execFileSync('git', ['-C', overlayRoot, 'archive', GOVERNANCE_PINNED_COMMIT], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  });
  execFileSync('tar', ['-xf', '-', '-C', exportDir], { input: tar, stdio: ['pipe', 'ignore', 'inherit'] });
  return exportDir;
}

test('headed real Compact edge surface mirrors canonical facts and hands off to the full Workbench', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required for the machine-local real walkthrough');
  const overlayExport = exportGovernanceState(realOverlay!);
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-real-compact-'));
  const stateRoot = join(stateDir, 'state');
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os',
    selectedRoot: realCreativeOsRoot,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });

  // Explicit user selection bookmark (exactly what a Full-Workbench click
  // writes through the same seam) + deliberately invalid persisted bounds to
  // prove restore clamps into a visible work area.
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'creative-os',
    workId: '001-inspiration-capture',
    taskId: 'T006',
    updatedAt: '2026-09-12T00:00:00.000Z',
  }), 'utf8');
  writeFileSync(join(stateRoot, 'compact-window-preference-v1.json'), JSON.stringify({
    schemaVersion: 1,
    expanded: false,
    x: -4000,
    y: -4000,
  }), 'utf8');

  await mkdir(screenshotDir, { recursive: true });
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({
      GOV_OVERLAY: overlayExport,
      WB_STATE_DIR: stateDir,
      WB_RENDERER_VNEXT: '1',
      WB_COMPACT_WINDOW: '1',
    }),
  });
  const win = await app.firstWindow();
  try {
    await expect(win.locator('.vnext-app')).toBeVisible();
    const baseline = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      return response.revision?.semanticHash ?? null;
    });

    // The Compact window is a separate renderer surface.
    let compact = app.windows().find((candidate) => candidate !== win);
    await expect(async () => {
      compact = app.windows().find((candidate) => candidate !== win);
      await expect(compact!.locator('.compact')).toBeVisible();
    }).toPass({ timeout: 15_000 });
    const compactWindow = compact!;

    // Canonical facts mirrored: project / Work / Task, honest UNKNOWN state.
    await expect(compactWindow.locator('.compact-project')).toHaveText('creative-os');
    await expect(compactWindow.locator('.compact-work')).toContainText('灵感采集');
    await expect(compactWindow.locator('.compact-task')).toContainText('T006');
    await expect(compactWindow.locator('.compact-task')).toContainText('unknown');
    // No real execution exists -> no Running module. No attention instance -> none.
    await expect(compactWindow.locator('.compact-running')).toHaveCount(0);
    await expect(compactWindow.locator('.compact-attention')).toHaveCount(0);
    // Invalid persisted bounds (-4000,-4000) restored inside a visible work
    // area — asserted through real window bounds after hide/show below.
    await compactWindow.screenshot({ path: join(screenshotDir, '20-compact-real.png') });

    // Expand → the same window grows in place.
    await compactWindow.getByRole('button', { name: 'Expand Compact panel' }).click();
    await expect(compactWindow.locator('.compact')).toHaveAttribute('data-expanded', 'true');
    await compactWindow.screenshot({ path: join(screenshotDir, '21-compact-expanded-real.png') });

    // Expand handoff: identity-only navigation into the focused full window.
    await compactWindow.getByRole('button', { name: 'Open Workbench' }).click();
    const focusDetail = win.getByRole('complementary', { name: 'Focus Detail' });
    await expect(focusDetail).toBeVisible();
    await expect(focusDetail).toContainText('定义主/渲染共享类型');
    await win.screenshot({ path: join(screenshotDir, '22-compact-workbench-handoff-real.png') });

    // hide/show keeps the window lifecycle inside the existing process and
    // the bounds inside a visible work area. (Window visibility is asserted
    // in the main process — DOM locators cannot see OS-level hide.)
    await compactWindow.getByRole('button', { name: 'Hide Compact panel' }).click();
    await expect(async () => {
      const visible = await app.evaluate(({ BrowserWindow }) => {
        const candidate = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Workbench Compact');
        return candidate?.isVisible() ?? false;
      });
      expect(visible).toBe(false);
    }).toPass({ timeout: 10_000 });
    await win.evaluate(() => window.wb.toggleCompactWindow());
    await expect(async () => {
      const visible = await app.evaluate(({ BrowserWindow }) => {
        const candidate = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Workbench Compact');
        return candidate?.isVisible() ?? false;
      });
      expect(visible).toBe(true);
    }).toPass({ timeout: 10_000 });
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const compactCandidate = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Workbench Compact');
      if (!compactCandidate) return null;
      const { x, y, width, height } = compactCandidate.getBounds();
      const inside = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        return x >= area.x && y >= area.y && x + width <= area.x + area.width && y + height <= area.y + area.height;
      });
      return { x, y, width, height, inside, displayCount: screen.getAllDisplays().length };
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.inside).toBe(true);

    // Compact never touched the semantic facts.
    const after = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      return response.revision?.semanticHash ?? null;
    });
    expect(after).toBe(baseline);
    console.log(`[compact-real] displays=${bounds!.displayCount} bounds=${JSON.stringify(bounds)}`);
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
