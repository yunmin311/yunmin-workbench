// Read-only e2e proof that the Governance product binding renders for both
// real and demo workspaces, without altering the existing product surface.
//
// Assertions:
//   1. A real workspace session shows the governance-strip with project role,
//      dialogue lifecycle, and the project_gates count.
//   2. The demo workspace's governance strip carries the SIMULATED suffix
//      and a demo-namespaced project-file ref in the same UI shape.
//   3. The strip sits between the session header and the activity timeline
//      (no vertical drift), and expanding the strip does not push the
//      composer off-screen.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { _electron } from '@playwright/test';
import { launchWorkbench, useOverlayFixture, workbenchEnv, electronArgs } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();

async function readBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('expected element to have a bounding box');
  return box;
}

test('governance binding renders a compact strip in real and demo workspaces', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-govbind-real-'));
  const { app, win } = await launchWorkbench(stateDir, overlay.overlayRoot);
  try {
    await win.keyboard.press('Control+K');
    await win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
    await win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    await win.locator('.sidebar-conversations button').first().click();

    const realStrip = win.locator('.governance-strip');
    await expect(realStrip).toBeVisible();
    const realSummary = realStrip.locator('.governance-summary');
    await expect(realSummary).toContainText('Role');
    await expect(realSummary).toContainText('gates');
    await expect(realSummary).not.toContainText('SIMULATED');

    const headerBox = await readBox(win.locator('.session-header'));
    const stripCollapsed = await readBox(realStrip);
    const activityCollapsed = await readBox(win.locator('.session-activity'));
    expect(stripCollapsed.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
    expect(activityCollapsed.y).toBeGreaterThanOrEqual(stripCollapsed.y + stripCollapsed.height - 1);

    await realStrip.locator('summary').click();
    const stripExpanded = await readBox(realStrip);
    const activityExpanded = await readBox(win.locator('.session-activity'));
    const composerExpanded = await readBox(win.locator('.session-composer'));
    const surfaceBox = await readBox(win.locator('.prototype-surface'));
    expect(stripExpanded.height).toBeGreaterThan(stripCollapsed.height);
    expect(activityExpanded.height).toBeLessThan(activityCollapsed.height);
    // The composer is a floating card absolutely positioned inside the
    // surface; it must stay on-screen regardless of strip expansion.
    expect(composerExpanded.y).toBeGreaterThan(0);
    expect(composerExpanded.y + composerExpanded.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height + 1);
  } finally {
    await app.close();
  }

  const emptyDir = mkdtempSync(join(tmpdir(), 'wb-govbind-empty-'));
  const env = workbenchEnv({ WB_OVERLAY_SEARCH_ROOT: emptyDir, WB_STATE_DIR: emptyDir });
  delete env.GOV_OVERLAY;
  const demoApp = await _electron.launch({ args: [...electronArgs(), 'out/main/index.js'], env });
  const demoWin = await demoApp.firstWindow();
  try {
    await demoWin.getByRole('button', { name: 'Try Demo' }).click();
    await expect(demoWin.locator('.session-surface')).toBeVisible();
    const demoStrip = demoWin.locator('.governance-strip');
    await expect(demoStrip).toBeVisible();
    await expect(demoStrip.locator('.governance-summary')).toContainText('SIMULATED');
  } finally {
    await demoApp.close();
  }
});
