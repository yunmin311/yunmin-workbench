import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron, expect, test } from '@playwright/test';

const OVERLAY = 'D:\\ai-governance-system';
const hasOverlay = existsSync(join(OVERLAY, 'overlay.yaml'));

async function launch(stateDir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...env, WB_STATE_DIR: stateDir },
  });
  const win = await app.firstWindow();
  await expect(win.locator('.titlebar-brand')).toContainText('Yunmin Workbench');
  return { app, win };
}

test.describe('reliability gate (P0 containment)', () => {
  test.skip(!hasOverlay, 'real overlay not present on this machine');

  test('missing Codex executable keeps the app alive with structured unavailable capability', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-nocodex-'));
    const emptyPath = join(stateDir, 'empty-path');
    mkdirSync(emptyPath);
    const { app, win } = await launch(stateDir, { ...process.env, PATH: emptyPath });

    await win.locator('.sidebar-projects button', { hasText: 'Creative OS' }).click();
    await win.locator('.sidebar-conversations button').first().click();
    await win.keyboard.press('Control+5');
    await expect(win.locator('h2', { hasText: 'Task Packet' })).toBeVisible();

    await expect(win.locator('button', { hasText: 'Send to Codex' })).toBeDisabled();
    const evidence = await win.evaluate(() => window.wb.loadHarnessCapabilities());
    expect(evidence.canDispatch).toBe(false);
    expect(evidence.evidence).toContain('unavailable');

    await expect(win.locator('.titlebar-brand')).toContainText('Yunmin Workbench');
    await app.close();
  });

  test('second app instance exits and never steals the Workbench state', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-single-'));
    const { app, win } = await launch(stateDir);
    const electronBinary = require('electron') as unknown as string;
    const second = spawn(electronBinary, ['out/main/index.js'], {
      env: { ...process.env, WB_STATE_DIR: stateDir },
      stdio: 'ignore',
    });
    const exited = await Promise.race([
      new Promise<string>((resolve) => second.on('exit', (code) => resolve(`exit:${code}`))),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
    ]);
    expect(exited).toMatch(/^exit:/);
    await expect(win.locator('.titlebar-brand')).toBeVisible();
    await app.close();
  });
});
