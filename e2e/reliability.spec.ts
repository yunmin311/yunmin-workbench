import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { electronArgs, launchWorkbench, openSessionPacket, useOverlayFixture, workbenchEnv } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;

test.describe('reliability gate (P0 containment)', () => {
  test('missing Codex and Claude executables keep the app alive with structured unavailable capabilities', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-nocodex-'));
    const emptyPath = join(stateDir, 'empty-path');
    mkdirSync(emptyPath);
    const { app, win } = await launchWorkbench(stateDir, OVERLAY, { PATH: emptyPath });

    await openSessionPacket(win, FIXTURE_PROJECT_DISPLAY_NAME);

    await expect(win.locator('button', { hasText: 'Send to Codex' })).toBeDisabled();
    const evidence = await win.evaluate(() => window.wb.loadHarnessCapabilities());
    expect(evidence.canDispatch).toBe(false);
    expect(evidence.evidence).toContain('unavailable');
    const all = await win.evaluate(() => window.wb.loadAllHarnessCapabilities());
    expect(all.codex.canDispatch).toBe(false);
    expect(all.claude.canDispatch).toBe(false);
    expect(all.codex.evidence).toContain('unavailable');
    expect(all.claude.evidence).toContain('unavailable');

    await expect(win.locator('.prototype-chrome')).toBeVisible();
    await app.close();
  });

  test('second app instance exits and never steals the Workbench state', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-single-'));
    const { app, win } = await launchWorkbench(stateDir, OVERLAY);
    const electronBinary = require('electron') as unknown as string;
    const second = spawn(electronBinary, [...electronArgs(), 'out/main/index.js'], {
      env: workbenchEnv({ GOV_OVERLAY: OVERLAY, WB_STATE_DIR: stateDir }),
      stdio: 'ignore',
    });
    const exited = await Promise.race([
      new Promise<string>((resolve) => second.on('exit', (code) => resolve(`exit:${code}`))),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
    ]);
    expect(exited).toMatch(/^exit:/);
    await expect(win.locator('.prototype-chrome')).toBeVisible();
    await app.close();
  });
});
