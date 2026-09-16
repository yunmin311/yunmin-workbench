import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

const realOverlay = process.env.WB_REAL_OVERLAY;
const creativeRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:/1project/creative-os';
const capsuleRoot = process.env.WB_REAL_WORK_CAPSULE_ROOT ?? 'E:/1project/work-capsule';

async function camera(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a };
  });
}

async function layoutReport(page: Page) {
  return page.evaluate(() => {
    const selectors = ['.approved-presence-rail', '.approved-work-rail', '.approved-main-surface', '.approved-team-dock', '.approved-bounded-plane', '.approved-action-surface'];
    const viewport = { width: innerWidth, height: innerHeight };
    const outside = selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === 'none') return [];
      const box = element.getBoundingClientRect();
      return box.left < -0.5 || box.top < -0.5 || box.right > viewport.width + 0.5 || box.bottom > viewport.height + 0.5 ? [selector] : [];
    });
    return {
      outside,
      bodyScroll: { x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      active: document.activeElement ? { tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label'), text: document.activeElement.textContent?.trim().slice(0, 40) } : null,
    };
  });
}

test('continuous production interaction mechanics use natural ownership', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-interaction-'));
  const stateRoot = join(stateDir, 'state');
  mkdirSync(stateRoot, { recursive: true });
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os', selectedRoot: creativeRoot, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os', expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  await rebindProjectRoot(stateRoot, {
    projectId: 'work-capsule', selectedRoot: capsuleRoot, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'work-capsule', expectedRemote: 'https://github.com/yunmin311/work-capsule.git',
  });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1, projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006', updatedAt: '2026-09-14T00:00:00.000Z',
  }));

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: realOverlay!, WB_STATE_DIR: stateDir, WB_COMPACT_WINDOW: '1' }),
  });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const win = app.windows().find((candidate) => candidate.url().includes('renderer-vnext')) ?? await app.firstWindow();
    await expect(win.locator('.approved-shell')).toBeVisible({ timeout: 30_000 });
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.evaluate(async () => window.wb.openWorkbenchFromCompact({ projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006' }));
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible({ timeout: 30_000 });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);

    const plane = await win.locator('.approved-bounded-plane').boundingBox();
    expect(plane).not.toBeNull();
    const pointer = { x: plane!.x + plane!.width * 0.72, y: plane!.y + plane!.height * 0.36 };
    await win.mouse.move(pointer.x, pointer.y);
    const wheelBefore = await camera(win);
    await win.mouse.wheel(0, 240);
    await win.waitForTimeout(220);
    const wheelAfter = await camera(win);

    await win.getByRole('button', { name: 'Locate current work' }).click();
    await win.waitForTimeout(360);
    const selectionBefore = await camera(win);
    await win.locator('.react-flow__node[data-id="task:creative-os:T006"]').click();
    await win.waitForTimeout(360);
    const selectionAfter = await camera(win);

    await win.getByRole('button', { name: 'Activity', exact: true }).click();
    const activeDockTab = await win.locator('.approved-dock-tabs button.active').textContent();
    const projectSelectorCount = await win.getByLabel('Switch project').count();

    const diagnostics = {
      plainWheel: {
        before: wheelBefore,
        after: wheelAfter,
        zoomChanged: Math.abs(wheelAfter.zoom - wheelBefore.zoom) > 0.001,
        panChanged: Math.abs(wheelAfter.x - wheelBefore.x) > 0.5 || Math.abs(wheelAfter.y - wheelBefore.y) > 0.5,
      },
      selection: {
        cameraChanged: Math.abs(selectionAfter.x - selectionBefore.x) > 0.5
          || Math.abs(selectionAfter.y - selectionBefore.y) > 0.5
          || Math.abs(selectionAfter.zoom - selectionBefore.zoom) > 0.001,
      },
      activeDockTab,
      projectSelectorCount,
    };
    console.log(`[interaction-diagnostics] ${JSON.stringify(diagnostics)}`);
    expect(diagnostics).toMatchObject({
      plainWheel: { zoomChanged: false, panChanged: true },
      selection: { cameraChanged: false },
      activeDockTab: 'Activity',
      projectSelectorCount: 1,
    });

    // Control+wheel (and trackpad pinch, which Chromium reports with ctrlKey)
    // zooms around the pointer instead of the canvas centre.
    const anchorBeforeCamera = await camera(win);
    const anchorBefore = {
      x: (pointer.x - plane!.x - anchorBeforeCamera.x) / anchorBeforeCamera.zoom,
      y: (pointer.y - plane!.y - anchorBeforeCamera.y) / anchorBeforeCamera.zoom,
    };
    await win.evaluate(() => document.querySelector('.react-flow')?.addEventListener('wheel', (event) => { const wheel = event as WheelEvent; (window as unknown as { __lastWheel?: { ctrlKey: boolean; deltaY: number } }).__lastWheel = { ctrlKey: wheel.ctrlKey, deltaY: wheel.deltaY }; }, { once: true, capture: true }));
    await win.mouse.move(pointer.x, pointer.y);
    await win.keyboard.down('Control');
    await win.waitForTimeout(60);
    await win.mouse.wheel(0, -220);
    await win.keyboard.up('Control');
    await win.waitForTimeout(220);
    const anchorAfterCamera = await camera(win);
    console.log(`[wheel-modifier] ${JSON.stringify(await win.evaluate(() => (window as unknown as { __lastWheel?: unknown }).__lastWheel))}`);
    const anchorAfter = {
      x: (pointer.x - plane!.x - anchorAfterCamera.x) / anchorAfterCamera.zoom,
      y: (pointer.y - plane!.y - anchorAfterCamera.y) / anchorAfterCamera.zoom,
    };
    expect(anchorAfterCamera.zoom).toBeGreaterThan(anchorBeforeCamera.zoom);
    expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(2);
    expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(2);

    // Blank-space drag pans without changing zoom.
    const dragBefore = await camera(win);
    await win.mouse.move(plane!.x + plane!.width - 36, plane!.y + plane!.height - 44);
    await win.mouse.down();
    await win.mouse.move(plane!.x + plane!.width - 116, plane!.y + plane!.height - 94, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(120);
    const dragAfter = await camera(win);
    expect(Math.abs(dragAfter.x - dragBefore.x) + Math.abs(dragAfter.y - dragBefore.y)).toBeGreaterThan(20);
    expect(dragAfter.zoom).toBeCloseTo(dragBefore.zoom, 3);

    // Object drag belongs to the spatial world; it moves the object without
    // silently recentering the camera or changing semantic selection.
    const draggableTask = win.locator('.react-flow__node[data-id="task:creative-os:T008"]');
    await draggableTask.hover();
    const objectBefore = await draggableTask.boundingBox();
    expect(objectBefore).not.toBeNull();
    const objectCameraBefore = await camera(win);
    await win.mouse.move(objectBefore!.x + objectBefore!.width / 2, objectBefore!.y + objectBefore!.height / 2);
    await win.mouse.down();
    await win.mouse.move(objectBefore!.x + objectBefore!.width / 2 + 28, objectBefore!.y + objectBefore!.height / 2 + 18, { steps: 5 });
    await win.mouse.up();
    await win.waitForTimeout(140);
    const objectAfter = await draggableTask.boundingBox();
    expect(objectAfter).not.toBeNull();
    expect(Math.abs(objectAfter!.x - objectBefore!.x) + Math.abs(objectAfter!.y - objectBefore!.y)).toBeGreaterThan(20);
    expect(await camera(win)).toEqual(objectCameraBefore);

    // Repeated selection and empty-space dismissal never move the camera.
    await win.getByRole('button', { name: 'Locate current work' }).click();
    await win.waitForTimeout(360);
    const task = win.locator('.react-flow__node[data-id="task:creative-os:T006"]');
    const stableBefore = await camera(win);
    await task.click();
    await task.click();
    const stableAfter = await camera(win);
    expect(stableAfter).toEqual(stableBefore);
    await win.locator('.react-flow__pane').click({ position: { x: 24, y: 24 } });
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toHaveCount(0);
    expect(await camera(win)).toEqual(stableBefore);

    // Keyboard selection, visible focus, Space/Enter tab activation and ESC.
    await task.focus();
    await win.keyboard.press('Enter');
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    const taskFocusStyle = await task.evaluate((element) => ({ focused: document.activeElement === element, shadow: getComputedStyle(element.querySelector('.wb-node')!).boxShadow }));
    expect(taskFocusStyle.focused).toBe(true);
    expect(taskFocusStyle.shadow).not.toBe('none');
    const evidenceTab = win.getByRole('button', { name: 'Evidence', exact: true });
    await evidenceTab.focus();
    await expect(evidenceTab).toBeFocused();
    await evidenceTab.evaluate((element) => {
      (window as unknown as { __keyEvents?: string[] }).__keyEvents = [];
      for (const name of ['keydown', 'keyup', 'click']) element.addEventListener(name, (event) => (window as unknown as { __keyEvents: string[] }).__keyEvents.push(`${event.type}:${(event as KeyboardEvent).key ?? ''}`));
    });
    await win.keyboard.press('Space');
    console.log(`[tab-key-events] ${JSON.stringify(await win.evaluate(() => (window as unknown as { __keyEvents?: string[] }).__keyEvents))}`);
    await expect(evidenceTab).toHaveAttribute('aria-pressed', 'true');
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Source ref');
    const contextTab = win.getByRole('button', { name: 'Context', exact: true });
    await contextTab.focus();
    await win.keyboard.press('Enter');
    await expect(contextTab).toHaveAttribute('aria-pressed', 'true');

    // Sibling scroll regions own their wheel events; body and Canvas stay put.
    const scrollCamera = await camera(win);
    const rightDock = await win.locator('.approved-dock-scroll').boundingBox();
    await win.mouse.move(rightDock!.x + rightDock!.width / 2, rightDock!.y + rightDock!.height / 2);
    await win.mouse.wheel(0, 600);
    expect(await camera(win)).toEqual(scrollCamera);
    const workRail = await win.locator('.approved-work-list').boundingBox();
    await win.mouse.move(workRail!.x + workRail!.width / 2, workRail!.y + workRail!.height / 2);
    await win.mouse.wheel(0, 600);
    expect(await camera(win)).toEqual(scrollCamera);
    expect((await layoutReport(win)).bodyScroll.y).toBe(0);

    // Responsive sequence retains selection and all frozen surface bounds.
    for (const [width, height] of [[1200, 800], [900, 700], [1440, 900]] as const) {
      await win.setViewportSize({ width, height });
      await win.waitForTimeout(520);
      const report = await layoutReport(win);
      expect(report.outside).toEqual([]);
      expect(report.bodyScroll.x).toBe(0);
      expect(report.bodyScroll.y).toBe(0);
      expect(report.bodyScroll.width).toBeLessThanOrEqual(width);
      expect(report.bodyScroll.height).toBeLessThanOrEqual(height);
      await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
      await expect(task).toBeInViewport();
    }

    // Real project switch uses the same rail slot and preserves exact identity.
    const projectSelector = win.getByLabel('Switch project');
    await expect(projectSelector.locator('option[value="work-capsule"]')).toHaveCount(1);
    await projectSelector.selectOption('work-capsule');
    await expect(projectSelector).toHaveValue('work-capsule', { timeout: 30_000 });
    await expect(win.locator('.approved-current-work')).toContainText('Work Capsule');
    const capsuleTask = win.locator('.react-flow__node-wb-task').first();
    await expect(capsuleTask).toBeVisible();
    await capsuleTask.click();
    const capsuleSelection = await win.evaluate(async () => window.wb.getCurrentSelection()) as { projectId?: string } | null;
    expect(capsuleSelection?.projectId).toBe('work-capsule');
    await projectSelector.selectOption('creative-os');
    await expect(projectSelector).toHaveValue('creative-os', { timeout: 30_000 });
    expect(((await win.evaluate(async () => window.wb.getCurrentSelection())) as { projectId?: string } | null)?.projectId).toBe('work-capsule');
    await win.locator('.react-flow__node[data-id="task:creative-os:T006"]').click();
    expect(((await win.evaluate(async () => window.wb.getCurrentSelection())) as { projectId?: string } | null)?.projectId).toBe('creative-os');

    // Context scroll and Back-to-edit preserve exact target and staging.
    await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await win.setViewportSize({ width: 900, height: 700 });
    await win.waitForTimeout(700);
    const cabinetCamera = await camera(win);
    const cabinetBody = await cabinet.locator('.cabinet-body').boundingBox();
    await win.mouse.move(cabinetBody!.x + cabinetBody!.width / 2, cabinetBody!.y + cabinetBody!.height / 2);
    await win.mouse.wheel(0, 600);
    expect(await camera(win)).toEqual(cabinetCamera);
    expect((await layoutReport(win)).bodyScroll.y).toBe(0);
    const targetConversation = 'creative-os::claude::CO 主对话';
    await cabinet.locator('#prepare-conversation').selectOption(targetConversation);
    const stagingGroup = cabinet.locator('.cabinet-states').first();
    await stagingGroup.getByRole('button', { name: /^Excluded:/ }).click();
    const stagedLabel = await stagingGroup.getAttribute('aria-label');
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();
    const dispatch = win.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch.locator('.dispatch-ready')).toBeVisible({ timeout: 30_000 });
    const availableRunner = dispatch.locator('.dispatch-executor:not([disabled])').first();
    await availableRunner.click();
    await dispatch.locator('#dispatch-instruction').fill('Interaction acceptance: report the selected Task identity only; do not modify files.');
    await win.getByRole('button', { name: 'Packet', exact: true }).click();
    await expect(win.getByRole('region', { name: 'Packet review' })).toContainText(await dispatch.locator('#dispatch-packet').inputValue());
    await win.getByRole('button', { name: 'Evidence', exact: true }).click();
    await expect(win.getByRole('region', { name: 'Preflight evidence' })).toContainText('Snapshot');
    await win.getByRole('button', { name: 'Preflight', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Preflight', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // The real Send click/receipt is exercised once in the explicit REAL gate;
    // the repeatable interaction pass stops at an enabled, fully disclosed
    // action so routine full-suite runs never create external sessions.
    const send = dispatch.getByRole('button', { name: 'Send packet' });
    await expect(send).toBeEnabled();
    await expect(dispatch.locator('.dispatch-consequence')).toContainText('Sends');

    await dispatch.getByRole('button', { name: 'Back to Context' }).click();
    await expect(cabinet).toBeVisible();
    await expect(cabinet.locator('#prepare-conversation')).toHaveValue(targetConversation);
    await expect(cabinet.locator(`.cabinet-states[aria-label="${stagedLabel}"]`).getByRole('button', { name: /^Excluded:/ })).toHaveAttribute('aria-pressed', 'true');

    // ESC closes one layer at a time and keeps the Task focus beneath it.
    await win.keyboard.press('Escape');
    await expect(cabinet).toHaveCount(0);
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toHaveCount(0);

    // Presence rows are interactive identities, not stats. Interaction must
    // not mint an Execution or mutate semantic truth.
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForTimeout(620);
    const semanticBeforePresence = await win.evaluate(async () => (await window.wb.getWorkGraphRevision('creative-os')).revision?.semanticHash ?? null);
    const presenceRows = win.locator('.approved-presence-group .approved-session-row');
    await expect(presenceRows).toHaveCount(4);
    await expect(win.locator('.approved-runtime-summary')).toContainText('RUNNING');
    await expect(win.locator('.approved-runtime-summary')).toContainText('0');
    await expect(win.locator('.approved-runtime-summary')).toContainText('No live execution fact.');
    const secondPresence = presenceRows.nth(1);
    await secondPresence.hover();
    expect(await secondPresence.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    const presenceLabel = (await secondPresence.locator('b').textContent())!;
    await secondPresence.click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText(presenceLabel);
    const semanticAfterPresence = await win.evaluate(async () => (await window.wb.getWorkGraphRevision('creative-os')).revision?.semanticHash ?? null);
    expect(semanticAfterPresence).toBe(semanticBeforePresence);
    await win.keyboard.press('Escape');

    // Compact lifecycle: expand, exact handoff, hide/reopen, shortcut
    // registration, and real window-event clamping.
    const compact = app.windows().find((candidate) => candidate !== win && candidate.url().includes('renderer-compact'))!;
    await expect(compact.locator('.approved-compact-window')).toBeVisible();
    await expect.poll(() => compact.locator('.compact-project').textContent()).toContain('creative-os');
    const collapsedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact')?.getBounds() ?? null);
    await compact.getByRole('button', { name: 'Expand Compact panel' }).click();
    await expect(compact.locator('.approved-compact-window')).toHaveAttribute('data-expanded', 'true');
    const expandedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact')?.getBounds() ?? null);
    expect(expandedBounds!.height).toBeGreaterThan(collapsedBounds!.height);
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+B'))).toBe(true);
    await compact.getByRole('button', { name: 'Continue current work' }).click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('定义主/渲染共享类型');
    await compact.getByRole('button', { name: 'Prepare current work' }).click();
    await expect(win.getByRole('region', { name: 'Context Cabinet' })).toContainText('定义主/渲染共享类型');
    await win.getByRole('region', { name: 'Context Cabinet' }).getByRole('button', { name: 'Close Context Cabinet' }).click();
    await compact.getByRole('button', { name: 'Hide Compact panel' }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact')?.isVisible() ?? false)).toBe(false);
    await win.evaluate(async () => window.wb.toggleCompactWindow());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact')?.isVisible() ?? false)).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact')?.setBounds({ x: -5000, y: -5000, width: 640, height: 560 }));
    await win.waitForTimeout(850);
    const clamped = await app.evaluate(({ BrowserWindow, screen }) => {
      const compactWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact');
      if (!compactWindow) return null;
      const bounds = compactWindow.getBounds();
      const inside = screen.getAllDisplays().some((display) => bounds.x >= display.workArea.x && bounds.y >= display.workArea.y && bounds.x + bounds.width <= display.workArea.x + display.workArea.width && bounds.y + bounds.height <= display.workArea.y + display.workArea.height);
      return { bounds, inside };
    });
    expect(clamped?.inside).toBe(true);
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
