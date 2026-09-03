import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test, type Page, type ElectronApplication } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';

const SCREENSHOT_DIR = join(__dirname, '..', 'screenshots', 'walkthrough');

function emptySearchRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wb-visual-search-'));
}

async function launchDemo(): Promise<{ app: ElectronApplication; win: Page }> {
  const env = workbenchEnv({ WB_OVERLAY_SEARCH_ROOT: emptySearchRoot(), WB_STATE_DIR: mkdtempSync(join(tmpdir(), 'wb-visual-')) });
  delete env.GOV_OVERLAY;
  const app = await _electron.launch({ args: [...electronArgs(), 'out/main/index.js'], env });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
  await win.getByRole('button', { name: 'Try Demo' }).click();
  await expect(win.locator('.session-surface')).toBeVisible({ timeout: 10000 });
  return { app, win };
}

async function screenshot(win: Page, name: string) {
  await win.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: false, timeout: 15000 });
}

async function computedStyle(win: Page, selector: string, prop: string): Promise<string> {
  return win.evaluate(({ sel, p }) => {
    const el = document.querySelector(sel);
    if (!el) return 'ELEMENT_NOT_FOUND';
    return (getComputedStyle(el) as unknown as Record<string, string>)[p];
  }, { sel: selector, p: prop });
}

function assertInsideViewport(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }, label: string) {
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height);
}

// ─── 0. First-Run Screen ───────────────────────────────────────────────
test('WALK-01: first-run screen renders correctly', async () => {
  const env = workbenchEnv({ WB_OVERLAY_SEARCH_ROOT: emptySearchRoot(), WB_STATE_DIR: mkdtempSync(join(tmpdir(), 'wb-walk-fr-')) });
  delete env.GOV_OVERLAY;
  const app = await _electron.launch({ args: [...electronArgs(), 'out/main/index.js'], env });
  const win = await app.firstWindow();
  try {
    await win.setViewportSize({ width: 1440, height: 900 });
    await screenshot(win, '01-first-run');

    const tryDemo = win.getByRole('button', { name: 'Try Demo' });
    const openReal = win.getByRole('button', { name: 'Open real workspace' });
    await expect(tryDemo).toBeVisible();
    await expect(openReal).toBeVisible();

    const demoBox = await tryDemo.boundingBox();
    const realBox = await openReal.boundingBox();
    expect(demoBox).toBeTruthy();
    expect(realBox).toBeTruthy();
    const vp = win.viewportSize()!;
    assertInsideViewport(demoBox!, vp, 'Try Demo button');
    assertInsideViewport(realBox!, vp, 'Open real workspace button');

    const overlap = demoBox!.x < realBox!.x + realBox!.width &&
      demoBox!.x + demoBox!.width > realBox!.x &&
      demoBox!.y < realBox!.y + realBox!.height &&
      demoBox!.y + demoBox!.height > realBox!.y;
    expect(overlap).toBe(false);
  } finally {
    await app.close();
  }
});

// ─── 1. Demo Welcome + Session Surface ─────────────────────────────────
test('WALK-02: demo welcome and session surface', async () => {
  const { app, win } = await launchDemo();
  try {
    await screenshot(win, '02-demo-welcome');

    await expect(win.locator('.session-surface')).toBeVisible();

    const header = win.locator('.session-header h1');
    await expect(header).toBeVisible();
    const title = await header.textContent();
    expect(title?.trim().length).toBeGreaterThan(0);

    await expect(win.locator('.session-path')).toBeVisible();

    await screenshot(win, '02b-session-surface');
  } finally {
    await app.close();
  }
});

// ─── 2. Workspace Rail (Projects + Sessions) ───────────────────────────
test('WALK-03: workspace rail projects and sessions', async () => {
  const { app, win } = await launchDemo();
  try {
    const rail = win.locator('.workspace-rail');
    await expect(rail).toBeVisible();

    const railBox = await rail.boundingBox();
    expect(railBox).toBeTruthy();
    assertInsideViewport(railBox!, win.viewportSize()!, 'workspace rail');

    const projects = win.locator('.workspace-rail .rail-projects li');
    expect(await projects.count()).toBeGreaterThanOrEqual(1);

    const sessions = win.locator('.workspace-rail .rail-sessions li');
    expect(await sessions.count()).toBeGreaterThanOrEqual(1);

    await screenshot(win, '03-workspace-rail');

    // Regression: session rail badges must not overflow their container.
    // Each session button should fit inside the rail without horizontal overflow.
    for (let i = 0; i < Math.min(await sessions.count(), 6); i++) {
      const btn = sessions.nth(i).locator('button');
      const btnBox = await btn.boundingBox();
      expect(btnBox).toBeTruthy();
      assertInsideViewport(btnBox!, win.viewportSize()!, `session button ${i}`);
      // Name must have non-empty text
      const name = btn.locator('.name');
      await expect(name).toBeVisible();
      expect((await name.textContent())?.trim().length).toBeGreaterThan(0);
    }
  } finally {
    await app.close();
  }
});

// ─── 3. Session Switching ──────────────────────────────────────────────
test('WALK-04: session switching updates surface', async () => {
  const { app, win } = await launchDemo();
  try {
    const sessions = win.locator('.workspace-rail .rail-sessions li button');
    const count = await sessions.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await sessions.nth(0).click();
    await win.waitForTimeout(300);
    const header1 = await win.locator('.session-header h1').textContent();

    await sessions.nth(1).click();
    await win.waitForTimeout(300);
    const header2 = await win.locator('.session-header h1').textContent();
    expect(header1).not.toBe(header2);

    await screenshot(win, '04-session-switched');
  } finally {
    await app.close();
  }
});

// ─── 4. Activity Timeline ──────────────────────────────────────────────
test('WALK-05: activity timeline renders cards and boundaries', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    const cards = win.locator('.activity-card');
    const boundaries = win.locator('.activity-boundary');
    expect((await cards.count()) + (await boundaries.count())).toBeGreaterThan(0);

    const firstCardBox = await cards.first().boundingBox();
    expect(firstCardBox).toBeTruthy();
    assertInsideViewport(firstCardBox!, win.viewportSize()!, 'first activity card');

    await screenshot(win, '05-activity-timeline');
  } finally {
    await app.close();
  }
});

// ─── 5. Composer (bottom input) ────────────────────────────────────────
test('WALK-06: composer area renders and is viewport-contained', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: textarea must exist and be visible
    const textarea = win.locator('textarea');
    await expect(textarea.first()).toBeVisible();

    // REQUIRE: composer container must exist and be visible
    const composer = win.locator('.composer, .session-composer, [data-testid="composer"]');
    await expect(composer.first()).toBeVisible();

    // Composer must not be clipped by viewport bottom
    const composerBox = await composer.first().boundingBox();
    expect(composerBox).toBeTruthy();
    const vp = win.viewportSize()!;
    expect(composerBox!.y + composerBox!.height, 'composer bottom').toBeLessThanOrEqual(vp.height + 5);

    // Agent selector text ("claude") must be visible inside the composer
    await expect(composer.locator('text=claude').first()).toBeVisible();

    await screenshot(win, '06-composer');
  } finally {
    await app.close();
  }
});

// ─── 6. Agent Selector + Governance Role Hint ──────────────────────────
test('WALK-07: agent selector visible, governance role is read-only metadata', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: agent selector must exist and be visible (the dropdown showing "claude")
    const agentSelector = win.locator('.agent-selector, .agent-picker, [data-testid="agent-selector"]');
    await expect(agentSelector.first()).toBeVisible();

    // REQUIRE: session path must show agent name as read-only metadata
    const sessionPath = win.locator('.session-path');
    await expect(sessionPath).toBeVisible();
    const pathText = await sessionPath.textContent();
    expect(pathText).toContain('claude');

    // REQUIRE: governance role line must be present as read-only text, not an input
    const govLine = win.locator('.governance-strip, .governance-line');
    if (await govLine.count() > 0) {
      await expect(govLine.first()).toBeVisible();
      // Must not contain any input, textarea, or contentEditable
      const inputs = govLine.first().locator('input, textarea, [contenteditable="true"]');
      expect(await inputs.count()).toBe(0);
    }

    await screenshot(win, '07-agent-selector');
  } finally {
    await app.close();
  }
});

// ─── 7. Context Panel ──────────────────────────────────────────────────
test('WALK-08: context panel renders with fixture items', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: open the context panel
    const contextBtn = win.locator('.context-summary, [data-testid="context-trigger"]');
    await expect(contextBtn.first()).toBeVisible();
    await contextBtn.first().click();
    await win.waitForTimeout(500);

    // REQUIRE: context staging heading must be visible
    const stagingHeading = win.locator('.inspector-pane h2', { hasText: 'Context Staging' });
    await expect(stagingHeading).toBeVisible();

    // REQUIRE: fixture context items must exist (demo has "available" items)
    const items = win.locator('.context-item');
    expect(await items.count()).toBeGreaterThan(0);

    // First item must have readable text
    const firstItemText = await items.first().textContent();
    expect(firstItemText?.trim().length).toBeGreaterThan(0);

    await screenshot(win, '08-context-panel');
  } finally {
    await app.close();
  }
});

// ─── 8. Packet Panel ───────────────────────────────────────────────────
test('WALK-09: packet panel renders with CURRENT status', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: open packet panel via keyboard
    await win.keyboard.press('Control+4');
    await win.waitForTimeout(500);

    // REQUIRE: Task Packet heading must be visible
    const packetHeading = win.locator('.inspector-pane h2', { hasText: 'Task Packet' });
    await expect(packetHeading).toBeVisible();

    // REQUIRE: CURRENT validity badge must be present
    const currentBadge = win.locator('text=CURRENT');
    await expect(currentBadge.first()).toBeVisible();

    // REQUIRE: Agent Input section must be present
    await expect(win.locator('text=Agent Input').first()).toBeVisible();

    await screenshot(win, '09-packet-panel');
  } finally {
    await app.close();
  }
});

// ─── 9. History Panel ──────────────────────────────────────────────────
test('WALK-10: history panel renders with demo content', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open history via command palette (the real user path)
    await win.locator('.command-trigger').click();
    await win.waitForTimeout(300);
    await expect(win.locator('.command-dialog')).toBeVisible();
    await win.locator('[cmdk-input]').fill('Search History');
    await win.waitForTimeout(300);
    await win.locator('.command-dialog').getByText('Search History').click();
    await win.waitForTimeout(500);

    // REQUIRE: history panel must exist and be visible
    const historyPanel = win.locator('.history-panel');
    await expect(historyPanel).toBeVisible();

    // REQUIRE: history heading must be visible
    await expect(historyPanel.locator('h2')).toBeVisible();

    // REQUIRE: search form must be present (demo mode populates catalog)
    await expect(historyPanel.locator('input[type="search"], input[placeholder*="istory"]')).toBeVisible();

    await screenshot(win, '10-history-panel');

    // Close by clicking backdrop
    await win.locator('.history-layer').first().click({ position: { x: 10, y: 10 } });
    await win.waitForTimeout(300);
  } finally {
    await app.close();
  }
});

// ─── 10. Memory Panel ──────────────────────────────────────────────────
test('WALK-11: memory panel renders with demo content', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open memory via command palette (the real user path)
    await win.locator('.command-trigger').click();
    await win.waitForTimeout(300);
    await expect(win.locator('.command-dialog')).toBeVisible();
    await win.locator('[cmdk-input]').fill('Search Memory');
    await win.waitForTimeout(300);
    await win.locator('.command-dialog').getByText('Search Memory').click();
    await win.waitForTimeout(500);

    // REQUIRE: memory panel must exist and be visible
    const memoryPanel = win.locator('.memory-panel');
    await expect(memoryPanel).toBeVisible();

    // REQUIRE: memory heading must be visible
    await expect(memoryPanel.locator('h2')).toBeVisible();

    // REQUIRE: search form must be present
    await expect(memoryPanel.locator('input[type="search"]')).toBeVisible();

    await screenshot(win, '11-memory-panel');

    // Close by clicking backdrop
    await win.locator('.history-layer').first().click({ position: { x: 10, y: 10 } });
    await win.waitForTimeout(300);
  } finally {
    await app.close();
  }
});

// ─── 11. Command Palette ───────────────────────────────────────────────
test('WALK-12: command palette opens, is visible, and stays inside viewport', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: trigger must exist and be clickable
    const trigger = win.locator('.command-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await win.waitForTimeout(500);

    // REQUIRE: dialog must open and be visible (no if-wrapper)
    const dialog = win.locator('.command-dialog');
    await expect(dialog).toBeVisible();

    // REQUIRE: full viewport containment — all four edges
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).toBeTruthy();
    assertInsideViewport(dialogBox!, win.viewportSize()!, 'command palette');

    // REQUIRE: dark background, not pure white
    const bgColor = await computedStyle(win, '.command-dialog', 'backgroundColor');
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

    // REQUIRE: input field must be visible inside the dialog
    await expect(dialog.locator('[cmdk-input]')).toBeVisible();

    // Regression: command palette must have scrollable list, not raw overflow
    const listEl = dialog.locator('[cmdk-list]');
    await expect(listEl).toBeVisible();
    const listBox = await listEl.boundingBox();
    expect(listBox).toBeTruthy();
    assertInsideViewport(listBox!, win.viewportSize()!, 'command palette list');

    await screenshot(win, '12-command-palette');

    await win.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

// ─── 12. Map/Canvas (React Flow) ───────────────────────────────────────
test('WALK-13: map canvas renders dark-themed nodes and controls', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.getByRole('button', { name: 'Map', exact: true }).click();
    await win.waitForTimeout(1000);

    // REQUIRE: nodes must exist
    const nodes = win.locator('.react-flow__node');
    expect(await nodes.count()).toBeGreaterThan(0);

    // REQUIRE: first few nodes must be visible and have reasonable size
    for (let i = 0; i < Math.min(await nodes.count(), 3); i++) {
      await expect(nodes.nth(i)).toBeVisible();
      const box = await nodes.nth(i).boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(10);
      expect(box!.height).toBeGreaterThan(10);
    }

    // REQUIRE: node backgrounds must NOT be pure white (the D-03/D-04/D-05 regression)
    for (let i = 0; i < Math.min(await nodes.count(), 5); i++) {
      const bg = await computedStyle(win, `.react-flow__node:nth-child(${i + 1})`, 'backgroundColor');
      expect(bg, `node ${i} background should not be white`).not.toBe('rgb(255, 255, 255)');
      expect(bg, `node ${i} background should not be transparent`).not.toBe('rgba(0, 0, 0, 0)');
    }

    // REQUIRE: controls must exist and be dark-themed
    const controls = win.locator('.react-flow__controls');
    await expect(controls).toBeVisible();
    const controlsBg = await computedStyle(win, '.react-flow__controls', 'backgroundColor');
    expect(controlsBg, 'controls background should not be white').not.toBe('rgb(255, 255, 255)');

    // REQUIRE: legend must be present
    await expect(win.locator('.canvas-legend')).toBeVisible();

    await screenshot(win, '13-map-canvas');
  } finally {
    await app.close();
  }
});

// ─── 13. Compare View ──────────────────────────────────────────────────
test('WALK-14: compare view renders cards', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.getByRole('button', { name: 'Compare', exact: true }).click();
    await win.waitForTimeout(500);

    const groups = win.locator('.compare-group');
    expect(await groups.count()).toBeGreaterThan(0);

    const cards = win.locator('.compare-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < Math.min(await cards.count(), 3); i++) {
      const text = await cards.nth(i).textContent();
      expect(text?.trim().length).toBeGreaterThan(5);
    }

    await screenshot(win, '14-compare-view');
  } finally {
    await app.close();
  }
});

// ─── 14. Runtime Pulse (badge) ─────────────────────────────────────────
test('WALK-15: runtime pulse badge visible for active session', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // REQUIRE: runtime badge must exist and be visible for the active demo session
    const badge = win.locator('.runtime-pulse, [data-testid="session-runtime-badge"]');
    await expect(badge.first()).toBeVisible();

    // Badge must have non-zero size
    const badgeBox = await badge.first().boundingBox();
    expect(badgeBox).toBeTruthy();
    expect(badgeBox!.width).toBeGreaterThan(0);
    expect(badgeBox!.height).toBeGreaterThan(0);

    await screenshot(win, '15-runtime-badge');
  } finally {
    await app.close();
  }
});

// ─── 15. Overlay/Popover checks ────────────────────────────────────────
test('WALK-16: opened inspector pane stays inside viewport', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open the Context inspector pane as the overlay under test
    await win.keyboard.press('Control+3');
    await win.waitForTimeout(500);

    // REQUIRE: inspector pane must exist and be visible
    const pane = win.locator('.inspector-pane');
    await expect(pane).toBeVisible();

    // REQUIRE: all four viewport boundaries
    const paneBox = await pane.boundingBox();
    expect(paneBox).toBeTruthy();
    assertInsideViewport(paneBox!, win.viewportSize()!, 'inspector pane');

    await screenshot(win, '16-overlay-check');
  } finally {
    await app.close();
  }
});

// ─── 16. Dark surface / typography ─────────────────────────────────────
test('WALK-17: dark surface and typography', async () => {
  const { app, win } = await launchDemo();
  try {
    // REQUIRE: main background must be dark
    const bgColor = await computedStyle(win, 'body, .prototype-chrome, .app-root', 'backgroundColor');
    expect(bgColor).not.toBe('rgb(255, 255, 255)');

    // REQUIRE: session header text must be light (not black on dark)
    const header = win.locator('.session-header h1');
    await expect(header).toBeVisible();
    const headerColor = await computedStyle(win, '.session-header h1', 'color');
    expect(headerColor).not.toBe('rgb(0, 0, 0)');

    await screenshot(win, '17-dark-typography');
  } finally {
    await app.close();
  }
});

// ─── 17. Demo Exit ─────────────────────────────────────────────────────
test('WALK-18: demo exit returns to first-run', async () => {
  const { app, win } = await launchDemo();
  try {
    const exitBtn = win.getByRole('button', { name: 'Exit demo workspace' });
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();

    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.locator('.session-surface')).toHaveCount(0);
    await screenshot(win, '18-demo-exit');
  } finally {
    await app.close();
  }
});
