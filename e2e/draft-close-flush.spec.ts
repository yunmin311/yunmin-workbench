import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const DRAFT_TEXT = 'Draft must survive an immediate close';

/**
 * The close-flush contract, exercised on the exact window it owns: a draft
 * mutation whose 350 ms debounce is still pending when the user closes
 * Workbench must survive. The spec closes while the save is pending — it
 * does NOT wait for "Draft saved" (that path is covered by memory.spec).
 * Removing the close-flush protocol in the main process makes this spec
 * fail: the resumed app loses the draft.
 */
test('closing while a draft save is pending flushes it; the draft survives relaunch', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wb-close-flush-'));
  const stateDir = join(temp, 'user-data');
  let launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  const { win } = launched;

  await win.keyboard.press('Control+K');
  await win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
  await win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  await win.locator('.sidebar-conversations button').first().click();

  // Mutate the draft; the debounced save is now pending.
  await win.locator('.session-composer textarea').fill(DRAFT_TEXT);
  // The save must be pending right now — not already settled.
  await expect(win.locator('.draft-state')).toContainText(/dirty|saving/);

  // Quit Workbench immediately, while the debounce has not fired. This is
  // the real user path (app quit fires each window's close, which the
  // flush protocol holds); playwright's page-level close bypasses the
  // window close event entirely and is NOT the product surface.
  await launched.app.close();
  // Relaunch: the same workspace resumes and the draft must be on disk.
  launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  const resumed = launched.win;
  await expect(resumed.locator('.session-header')).toBeVisible({ timeout: 30_000 });
  await expect(resumed.locator('.session-composer textarea')).toHaveValue(DRAFT_TEXT, { timeout: 15_000 });
  await launched.app.close();
});
