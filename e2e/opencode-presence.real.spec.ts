import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { materializeOverlayFixture } from '../tests/fixtures/overlayFixture';
import { electronArgs, workbenchEnv } from './prototype-shell';

test('real OpenCode native sessions cross production Electron IPC without model execution', async () => {
  test.skip(process.env.WB_REAL_OPENCODE_SMOKE !== '1', 'WB_REAL_OPENCODE_SMOKE=1 is required');
  const fixture = materializeOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-opencode-presence-'));
  const profile = join(fixture.overlayRoot, 'profiles', 'machines', 'instances', 'fixture-machine.yaml');
  const original = readFileSync(profile, 'utf8');
  const rebound = original.replace(
    /  - id: creative-os\r?\n    local_path: '[^']*'/,
    `  - id: creative-os\n    local_path: '${process.cwd()}'`,
  );
  expect(rebound).not.toBe(original);
  writeFileSync(profile, rebound, 'utf8');

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: fixture.overlayRoot, WB_STATE_DIR: stateDir }),
  });
  try {
    const win = await app.firstWindow();
    const sessions = await win.evaluate(() => window.wb.listHarnessSessions('creative-os'));
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.harness === 'opencode')).toBe(true);
    expect(sessions.every((session) => /^ses_/.test(session.nativeRef))).toBe(true);
    expect(sessions.every((session) => session.runtimeState === 'unknown')).toBe(true);
  } finally {
    await app.close();
    rmSync(fixture.searchRoot, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});
