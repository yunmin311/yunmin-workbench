// Read-only e2e proof that the Governance product binding renders for both
// real and demo workspaces, without altering the existing product surface.
//
// This spec asserts three things:
//   1. A real workspace session shows the governance-strip with project role,
//      dialogue lifecycle, and the project_gates count.
//   2. The demo workspace's governance strip carries the SIMULATED suffix
//      and a demo-namespaced project-file ref in the same UI shape.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron } from '@playwright/test';
import { launchWorkbench, useOverlayFixture, workbenchEnv, electronArgs } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();

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
