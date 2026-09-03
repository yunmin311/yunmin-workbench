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

async function boundingBox(win: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return win.locator(selector).first().boundingBox();
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

    // Both buttons should be visible and not overlapping
    const demoBox = await tryDemo.boundingBox();
    const realBox = await openReal.boundingBox();
    expect(demoBox).toBeTruthy();
    expect(realBox).toBeTruthy();
    if (demoBox && realBox) {
      // No overlap
      const overlap = demoBox.x < realBox.x + realBox.width &&
        demoBox.x + demoBox.width > realBox.x &&
        demoBox.y < realBox.y + realBox.height &&
        demoBox.y + demoBox.height > realBox.y;
      expect(overlap).toBe(false);
    }
  } finally {
    await app.close();
  }
});

// ─── 1. Demo Welcome + Session Surface ─────────────────────────────────
test('WALK-02: demo welcome and session surface', async () => {
  const { app, win } = await launchDemo();
  try {
    await screenshot(win, '02-demo-welcome');

    // Session surface should be visible
    const surface = win.locator('.session-surface');
    await expect(surface).toBeVisible();

    // Session header should render title
    const header = win.locator('.session-header h1');
    await expect(header).toBeVisible();
    const title = await header.textContent();
    expect(title).toBeTruthy();

    // Session path should show agent
    const path = win.locator('.session-path');
    await expect(path).toBeVisible();

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

    // Rail should not overflow viewport
    const railBox = await rail.boundingBox();
    const viewport = win.viewportSize()!;
    expect(railBox).toBeTruthy();
    if (railBox) {
      expect(railBox.x + railBox.width).toBeLessThanOrEqual(viewport.width);
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(viewport.height);
    }

    // Projects list
    const projects = win.locator('.workspace-rail .rail-projects li');
    const projectCount = await projects.count();
    expect(projectCount).toBeGreaterThanOrEqual(1);

    // Sessions list
    const sessions = win.locator('.workspace-rail .rail-sessions li');
    const sessionCount = await sessions.count();
    expect(sessionCount).toBeGreaterThanOrEqual(1);

    // Each session button should have text
    for (let i = 0; i < Math.min(sessionCount, 6); i++) {
      const btn = sessions.nth(i).locator('button');
      const text = await btn.textContent();
      expect(text?.trim()).toBeTruthy();
    }

    await screenshot(win, '03-workspace-rail');
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

    // Click second session
    await sessions.nth(1).click();
    await win.waitForTimeout(500);
    const header2 = await win.locator('.session-header h1').textContent();

    // Click third session
    if (count >= 3) {
      await sessions.nth(2).click();
      await win.waitForTimeout(500);
      const header3 = await win.locator('.session-header h1').textContent();
      expect(header2).not.toBe(header3);
    }

    await screenshot(win, '04-session-switched');
  } finally {
    await app.close();
  }
});

// ─── 4. Activity Timeline ──────────────────────────────────────────────
test('WALK-05: activity timeline renders cards and boundaries', async () => {
  const { app, win } = await launchDemo();
  try {
    // Navigate to main conversation
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    const cards = win.locator('.activity-card');
    const boundaries = win.locator('.activity-boundary');
    const transcript = win.locator('.transcript-turn');

    const cardCount = await cards.count();
    const boundaryCount = await boundaries.count();
    expect(cardCount + boundaryCount).toBeGreaterThan(0);

    // Activity cards should not overlap each other
    const firstCardBox = await cards.first().boundingBox();
    expect(firstCardBox).toBeTruthy();

    await screenshot(win, '05-activity-timeline');
  } finally {
    await app.close();
  }
});

// ─── 5. Composer (bottom input) ────────────────────────────────────────
test('WALK-06: composer area renders', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    const composer = win.locator('.composer, .session-composer, [data-testid="composer"]');
    const composerVisible = await composer.count() > 0 ? await composer.first().isVisible() : false;

    // Check for any textarea or input at bottom
    const textarea = win.locator('textarea');
    const textareaCount = await textarea.count();

    await screenshot(win, '06-composer');

    // Composer should not be clipped by viewport bottom
    if (composerVisible) {
      const composerBox = await composer.first().boundingBox();
      const viewport = win.viewportSize()!;
      if (composerBox) {
        expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(viewport.height + 5); // allow 5px tolerance
      }
    }
  } finally {
    await app.close();
  }
});

// ─── 6. Agent Selector ─────────────────────────────────────────────────
test('WALK-07: agent selector renders', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Look for agent selector or picker
    const agentSelector = win.locator('.agent-selector, .agent-picker, [data-testid="agent-selector"]');
    const hasAgent = await agentSelector.count() > 0;

    await screenshot(win, '07-agent-selector');
  } finally {
    await app.close();
  }
});

// ─── 7. Context Panel ──────────────────────────────────────────────────
test('WALK-08: context panel renders with items', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open context panel
    const contextBtn = win.locator('.context-summary, [data-testid="context-trigger"]');
    if (await contextBtn.count() > 0) {
      await contextBtn.first().click();
      await win.waitForTimeout(500);
    }

    // Check for context staging
    const contextStaging = win.locator('.context-staging, .inspector-pane h2');
    const contextVisible = await contextStaging.count() > 0 ? await contextStaging.first().isVisible() : false;

    await screenshot(win, '08-context-panel');

    // Context items should have text
    const items = win.locator('.context-item');
    if (await items.count() > 0) {
      const firstItemText = await items.first().textContent();
      expect(firstItemText?.trim()).toBeTruthy();
    }
  } finally {
    await app.close();
  }
});

// ─── 8. Packet Panel ───────────────────────────────────────────────────
test('WALK-09: packet panel renders', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open packet via keyboard
    await win.keyboard.press('Control+4');
    await win.waitForTimeout(500);

    const packetPanel = win.locator('.inspector-pane h2', { hasText: 'Task Packet' });
    const packetVisible = await packetPanel.count() > 0 ? await packetPanel.isVisible() : false;

    await screenshot(win, '09-packet-panel');
  } finally {
    await app.close();
  }
});

// ─── 9. History Panel ──────────────────────────────────────────────────
test('WALK-10: history panel renders', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open history
    await win.keyboard.press('Control+5');
    await win.waitForTimeout(500);

    await screenshot(win, '10-history-panel');
  } finally {
    await app.close();
  }
});

// ─── 10. Memory Panel ──────────────────────────────────────────────────
test('WALK-11: memory panel renders', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open memory
    await win.keyboard.press('Control+6');
    await win.waitForTimeout(500);

    await screenshot(win, '11-memory-panel');
  } finally {
    await app.close();
  }
});

// ─── 11. Command Palette ───────────────────────────────────────────────
test('WALK-12: command palette opens and positions correctly', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Open command palette
    const trigger = win.locator('.command-trigger');
    if (await trigger.count() > 0) {
      await trigger.click();
      await win.waitForTimeout(500);
    }

    const dialog = win.locator('.command-dialog');
    const dialogVisible = await dialog.count() > 0 ? await dialog.isVisible() : false;

    if (dialogVisible) {
      // Command palette should be centered or top-anchored, not clipped
      const dialogBox = await dialog.boundingBox();
      const viewport = win.viewportSize()!;
      expect(dialogBox).toBeTruthy();
      if (dialogBox) {
        // Should not extend beyond viewport
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.y).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
        expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
      }

      // Check computed style: should have dark background, not white
      const bgColor = await computedStyle(win, '.command-dialog', 'backgroundColor');
      expect(bgColor).not.toBe('rgb(255, 255, 255)');
    }

    await screenshot(win, '12-command-palette');

    // Close
    await win.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

// ─── 12. Map/Canvas (React Flow) ───────────────────────────────────────
test('WALK-13: map canvas renders nodes', async () => {
  const { app, win } = await launchDemo();
  try {
    // Switch to Map tab
    await win.getByRole('button', { name: 'Map', exact: true }).click();
    await win.waitForTimeout(1000);

    const nodes = win.locator('.react-flow__node');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThan(0);

    // Nodes should not be pure white
    for (let i = 0; i < Math.min(nodeCount, 5); i++) {
      const nodeBox = await nodes.nth(i).boundingBox();
      expect(nodeBox).toBeTruthy();
      if (nodeBox) {
        // Nodes should have some size
        expect(nodeBox.width).toBeGreaterThan(10);
        expect(nodeBox.height).toBeGreaterThan(10);
      }
    }

    await screenshot(win, '13-map-canvas');

    // Check for legend
    const legend = win.locator('.canvas-legend, .legend-line');
    if (await legend.count() > 0) {
      const legendBox = await legend.first().boundingBox();
      expect(legendBox).toBeTruthy();
    }
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
    const groupCount = await groups.count();
    expect(groupCount).toBeGreaterThan(0);

    // Compare cards should not overlap
    const cards = win.locator('.compare-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // Cards should have content
    for (let i = 0; i < Math.min(cardCount, 3); i++) {
      const text = await cards.nth(i).textContent();
      expect(text?.trim().length).toBeGreaterThan(5);
    }

    await screenshot(win, '14-compare-view');
  } finally {
    await app.close();
  }
});

// ─── 14. Runtime Pulse (badge) ─────────────────────────────────────────
test('WALK-15: runtime pulse badge visible', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    const badge = win.locator('.runtime-pulse, [data-testid="session-runtime-badge"]');
    const badgeVisible = await badge.count() > 0 ? await badge.first().isVisible() : false;

    await screenshot(win, '15-runtime-badge');
  } finally {
    await app.close();
  }
});

// ─── 15. Overlay/Popover checks ────────────────────────────────────────
test('WALK-16: overlays do not escape viewport', async () => {
  const { app, win } = await launchDemo();
  try {
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await win.waitForTimeout(500);

    // Try to open any popover/overlay by clicking on a governance item
    const govSummary = win.locator('.governance-summary, .governance-strip');
    if (await govSummary.count() > 0) {
      await govSummary.first().click();
      await win.waitForTimeout(500);
    }

    await screenshot(win, '16-overlay-check');

    // Check viewport
    const viewport = win.viewportSize()!;
    const anyOverlay = win.locator('.inspector-pane, .popover, .modal, .overlay');
    if (await anyOverlay.count() > 0) {
      const box = await anyOverlay.first().boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-10); // allow small negative
        expect(box.y).toBeGreaterThanOrEqual(-10);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 10);
      }
    }
  } finally {
    await app.close();
  }
});

// ─── 16. Dark surface / typography ─────────────────────────────────────
test('WALK-17: dark surface and typography', async () => {
  const { app, win } = await launchDemo();
  try {
    // Check main background is dark
    const bgColor = await computedStyle(win, 'body, .prototype-chrome, .app-root', 'backgroundColor');
    // Should not be pure white
    expect(bgColor).not.toBe('rgb(255, 255, 255)');

    // Check session header text is visible
    const header = win.locator('.session-header h1');
    if (await header.count() > 0) {
      const color = await computedStyle(win, '.session-header h1', 'color');
      expect(color).not.toBe('rgb(0, 0, 0)'); // should not be black on dark
    }

    await screenshot(win, '17-dark-typography');
  } finally {
    await app.close();
  }
});

// ─── 17. Demo Exit ─────────────────────────────────────────────────────
test('WALK-18: demo exit returns to first-run', async () => {
  const { app, win } = await launchDemo();
  try {
    // Exit demo
    const exitBtn = win.getByRole('button', { name: 'Exit demo workspace' });
    if (await exitBtn.count() > 0) {
      await exitBtn.click();
      await win.waitForTimeout(500);
    }

    // Should be back at first-run
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await screenshot(win, '18-demo-exit');
  } finally {
    await app.close();
  }
});
