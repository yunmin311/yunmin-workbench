import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test, type Page, type ElectronApplication } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';

// A truly empty discovery root with NO GOV_OVERLAY makes `discoverOverlayRoot`
// return no root -> `emptySnapshot` (no projects/conversations). That is the
// real first-run condition that must offer Try Demo / Open real workspace.
function emptySearchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-empty-search-'));
  return dir; // no overlay.yaml anywhere under it
}

async function launchEmpty(): Promise<{ app: ElectronApplication; win: Page }> {
  const env = workbenchEnv({ WB_OVERLAY_SEARCH_ROOT: emptySearchRoot(), WB_STATE_DIR: mkdtempSync(join(tmpdir(), 'wb-fr-')) });
  delete env.GOV_OVERLAY; // ensure we exercise discovery, not an explicit overlay
  const app = await _electron.launch({ args: [...electronArgs(), 'out/main/index.js'], env });
  const win = await app.firstWindow();
  return { app, win };
}

test('first-run offers Try Demo / Open real workspace when there is no real content', async () => {
  test.setTimeout(90_000);
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveText('DEMO');
    await expect(win.getByTestId('session-runtime-badge')).toBeVisible();
    await win.getByRole('button', { name: 'Context', exact: true }).click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    // Demo Context data is present in the staging inspector (Included items exist).
    await expect(win.locator('button.state-included').first()).toBeAttached();
  } finally {
    await app.close();
  }
});

test('demo exit returns to the first-run choice and never echoes demo data back', async () => {
  test.setTimeout(90_000);
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await expect(win.getByTestId('demo-live-badge')).toBeVisible();
    await win.getByRole('button', { name: 'Exit demo workspace' }).click();
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
