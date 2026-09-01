import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { materializeOverlayFixture } from '../tests/fixtures/overlayFixture';

/**
 * Selector/flow bridge for the Reasonix prototype shell: session picker
 * (workspace trigger -> project switcher -> first conversation) plus the
 * chrome inspector trigger for the Packet tab. Behavioral assertions stay in
 * the specs; only the shell plumbing lives here.
 */
export async function openSessionPacket(win: Page, projectName: string): Promise<void> {
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  const projectOption = win.locator('.project-switcher option').filter({ hasText: projectName });
  const projectValue = await projectOption.getAttribute('value');
  await win.locator('.project-switcher select').selectOption(projectValue!);
  await win.locator('.sidebar-conversations button').first().click();
  await win.keyboard.press('Control+4');
  await expect(win.locator('.inspector-pane h2', { hasText: 'Task Packet' })).toBeVisible();
}

/**
 * Every spec runs against its own copy of the portable Overlay fixture, reached
 * through the production `GOV_OVERLAY` seam. No spec may point at a
 * machine-specific Overlay path — that silently turns the whole suite into
 * skips on any other machine.
 */
export function useOverlayFixture() {
  return materializeOverlayFixture();
}

/**
 * Extra Electron switches for machines that cannot start Chromium's GPU process
 * (headless CI, remote or virtualised sessions): without `--disable-gpu` the
 * GPU process aborts and takes the whole app down. Opt-in only — a normal
 * desktop run keeps the Chromium sandbox and hardware acceleration it ships
 * with, so the E2E suite still exercises the real configuration.
 *
 *   WB_ELECTRON_ARGS="--no-sandbox --disable-gpu" npx playwright test
 */
export function electronArgs(): string[] {
  const raw = process.env.WB_ELECTRON_ARGS;
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

/**
 * Environment for every Workbench process the suite starts.
 *
 * Host shells frequently export `ELECTRON_RUN_AS_NODE=1` for their own child
 * processes (any tool built on Electron does). Inherited, it makes the Electron
 * binary boot as plain Node: `require('electron')` then resolves to the path
 * string instead of the API object, so the main process dies on its first
 * statement and Playwright reports "Process failed to launch!". The Workbench is
 * a GUI application, so the harness always clears the flag.
 */
export function workbenchEnv(extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (key === 'ELECTRON_RUN_AS_NODE') continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function launchWorkbench(
  stateDir: string,
  overlayRoot: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ ...extraEnv, GOV_OVERLAY: overlayRoot, WB_STATE_DIR: stateDir }),
  });
  const win = await app.firstWindow();
  await expect(win.locator('.prototype-chrome')).toBeVisible();
  return { app, win };
}
