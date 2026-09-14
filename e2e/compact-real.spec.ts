import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { exportPinnedRepository } from './pinnedRepoExport';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';

function exportGovernanceState(overlayRoot: string): string {
  return exportPinnedRepository(overlayRoot, GOVERNANCE_PINNED_COMMIT, 'wb-compact-pin-');
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
      WB_COMPACT_WINDOW: '1',
    }),
  });
  const firstWindow = await app.firstWindow();
  let win = app.windows().find((candidate) => !candidate.url().includes('renderer-compact')) ?? firstWindow;
  try {
    await expect(async () => {
      win = app.windows().find((candidate) => !candidate.url().includes('renderer-compact')) ?? win;
      await expect(win.locator('.vnext-app')).toBeVisible();
    }).toPass({ timeout: 15_000 });
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

    // Canonical facts mirrored: project / Work / Task. Unproven state stays
    // out of the chips entirely (same rule as the Full Workbench).
    await expect(compactWindow.locator('.compact-project')).toHaveText('creative-os');
    await expect(compactWindow.locator('.compact-title')).toContainText('灵感采集');
    await expect(compactWindow.locator('.approved-compact-task')).toContainText('T006');
    await expect(compactWindow.locator('.approved-compact-task')).not.toContainText('unknown');
    // Empty facts remain visible as honest idle states; the approved edge
    // panel never collapses into a task card plus two buttons.
    await expect(compactWindow.locator('.compact-running')).toContainText('No live execution fact.');
    await expect(compactWindow.locator('.compact-running')).toContainText('sessions here');
    await expect(compactWindow.locator('.compact-attention')).toContainText('Nothing needs review');
    await expect(compactWindow.getByRole('button', { name: 'Continue current work' })).toBeVisible();
    await expect(compactWindow.getByRole('button', { name: 'Prepare current work' })).toBeVisible();
    // Invalid persisted bounds (-4000,-4000) restored inside a visible work
    // area — asserted through real window bounds after hide/show below.
    await compactWindow.screenshot({ path: join(screenshotDir, '20-compact-real.png') });

    // Expand → the same window grows in place.
    await compactWindow.getByRole('button', { name: 'Expand Compact panel' }).click();
    await expect(compactWindow.locator('.compact')).toHaveAttribute('data-expanded', 'true');
    await compactWindow.screenshot({ path: join(screenshotDir, '21-compact-expanded-real.png') });

    // Expand handoff: identity-only navigation into the focused full window.
    await compactWindow.getByRole('button', { name: 'Continue current work' }).click();
    const focusDetail = win.getByRole('complementary', { name: 'Focus Detail' });
    await expect(focusDetail).toBeVisible();
    await expect(focusDetail).toContainText('定义主/渲染共享类型');
    await win.screenshot({ path: join(screenshotDir, '22-compact-workbench-handoff-real.png') });

    // Prepare carries the same exact identity plus a UI-only navigation
    // intent; Context staging still loads from the Full Workbench source.
    await compactWindow.getByRole('button', { name: 'Prepare current work' }).click();
    const preparation = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(preparation).toBeVisible();
    await expect(preparation).toContainText('staging for · 定义主/渲染共享类型');
    await preparation.getByRole('button', { name: 'Close Context Cabinet' }).click();

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
    const toggleOutcome = await win.evaluate(async () => {
      try {
        const result = await window.wb.toggleCompactWindow();
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
    const compactInfo = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), destroyed: w.isDestroyed() })));
    writeFileSync(join(stateDir, 'diagnostics.json'), JSON.stringify({ toggleOutcome, compactInfo }), 'utf8');
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

test('closing the main window quits even with a hidden Compact window alive', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-compact-quit-'));
  await mkdir(screenshotDir, { recursive: true });
  // No overlay needed: this is pure window lifecycle (donor audit, PHASE 4A.1).
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ WB_STATE_DIR: stateDir, WB_COMPACT_WINDOW: '1' }),
  });
  const firstWindow = await app.firstWindow();
  let win = app.windows().find((candidate) => !candidate.url().includes('renderer-compact')) ?? firstWindow;
  try {
    await expect(async () => {
      win = app.windows().find((candidate) => !candidate.url().includes('renderer-compact')) ?? win;
      await expect(win.locator('.prototype-chrome, .vnext-app').first()).toBeVisible();
    }).toPass({ timeout: 15_000 });
    // The launch flag already shows the Compact window.
    await expect(async () => {
      const visible = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.getTitle() === 'Workbench Compact' && w.isVisible()));
      expect(visible).toBe(true);
    }).toPass({ timeout: 15_000 });

    // Hide the compact, then close the main window: window-all-closed must
    // fire (the hidden compact must not keep the process alive with no
    // visible surface and no tray).
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'Workbench Compact')
        ?.hide();
    });
    await win.close();
    await expect.poll(async () => {
      try {
        const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        return count;
      } catch {
        return 0; // process already exited
      }
    }, { timeout: 10_000 }).toBe(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(stateDir, { recursive: true, force: true });
  }
});
