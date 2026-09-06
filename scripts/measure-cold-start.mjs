import { _electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cold-start measurement for the production build (run `pnpm build` first).
 *   node scripts/measure-cold-start.mjs <runs> [warm]
 * fresh: new userData per run; reports time to workspace chooser.
 * warm:  first run seeds a resumed workspace interactively, then measures
 *        cold launches that must restore the session (`.session-header`).
 */
const runs = Number(process.argv[2] ?? 5);
const mode = process.argv[3] ?? 'fresh';
const overlay = 'E:' + String.fromCharCode(92) + '1project' + String.fromCharCode(92) + 'ai-governance-system';
const envFor = (stateDir) => Object.fromEntries(
  Object.entries({ ...process.env, GOV_OVERLAY: overlay, WB_STATE_DIR: stateDir }).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'),
);

let seededDir = null;
if (mode === 'warm') {
  seededDir = mkdtempSync(join(tmpdir(), 'wb-cold-seed-'));
  const app = await _electron.launch({ args: ['out/main/index.js'], env: envFor(seededDir) });
  const win = await app.firstWindow();
  await win.waitForSelector('.prototype-chrome', { timeout: 60000 });
  await win.keyboard.press('Control+K');
  await win.locator('[cmdk-input]').fill('Open Workspace governance');
  await win.locator('[cmdk-item]').first().click();
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  await win.locator('.sidebar-conversations button').first().click();
  await win.waitForSelector('.session-header', { timeout: 60000 });
  await win.waitForTimeout(1200); // let the debounced saves settle
  await app.close();
}

const samples = [];
for (let i = 0; i < runs; i += 1) {
  const stateDir = mode === 'warm' ? seededDir : mkdtempSync(join(tmpdir(), `wb-cold-${i}-`));
  const t0 = Date.now();
  const app = await _electron.launch({ args: ['out/main/index.js'], env: envFor(stateDir) });
  const t1 = Date.now();
  const win = await app.firstWindow();
  const t2 = Date.now();
  await win.waitForSelector('.prototype-chrome', { timeout: 60000 });
  const t3 = Date.now();
  const usableSelector = mode === 'warm' ? '.session-header' : 'h1:has-text("Start from a session")';
  await win.waitForSelector(usableSelector, { timeout: 60000 });
  const t4 = Date.now();
  const sessionResumed = await win.locator('.session-header').count().then((n) => n > 0);
  samples.push({ launch: t1 - t0, window: t2 - t0, firstFrame: t3 - t0, usable: t4 - t0, sessionResumed });
  await app.close();
}
const col = (k) => samples.map((s) => s[k]).sort((a, b) => a - b);
const fmt = (k) => `${col(k)[0]}..${col(k)[col(k).length - 1]}ms (median ${col(k)[Math.floor(col(k).length / 2)]}ms)`;
console.log(JSON.stringify({ mode, runs: samples, summary: {
  launchToMainReady: fmt('launch'),
  windowCreated: fmt('window'),
  firstRendererFrame: fmt('firstFrame'),
  workspaceUsable: fmt('usable'),
  sessionsResumed: samples.filter((s) => s.sessionResumed).length,
} }, null, 2));
