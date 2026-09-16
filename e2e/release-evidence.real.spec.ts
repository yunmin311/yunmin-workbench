import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { exportPinnedRepository } from './pinnedRepoExport';

const GOVERNANCE_ROOT = process.env.WB_REAL_OVERLAY ?? 'E:\\1project\\ai-governance-system';
const PROJECT_ROOT = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const GOVERNANCE_COMMIT = '7cd5be384cd2370f69279a9e1dc1327ba55a47ba';
const PROJECT_COMMIT = '50e0eb1750e8e1441accc2d5e706acb60eacd7c0';
const MODEL = 'opencode/muse-spark-1.3-contributor-free';
const RESULT_TEXT = 'YUNMIN_WORKBENCH_RC_EVIDENCE';
const OUTPUT = resolve('docs/images/workbench');

function clonePinnedProject(): string {
  const target = mkdtempSync(join(tmpdir(), 'wb-release-project-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', PROJECT_ROOT, target]);
  execFileSync('git', ['-C', target, 'checkout', '--quiet', '--detach', PROJECT_COMMIT]);
  execFileSync('git', ['-C', target, 'remote', 'set-url', 'origin', 'https://github.com/yunmin311/creative-os.git']);
  return target;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUTPUT, name), animations: 'disabled' });
}

test('capture current production Electron release evidence with one real free OpenCode execution', async () => {
  test.setTimeout(180_000);
  const compactOnly = process.env.WB_RELEASE_COMPACT_ONLY === '1';
  test.skip(process.env.WB_REAL_RELEASE_EVIDENCE !== '1' && !compactOnly, 'explicit real release evidence run only');
  test.skip(!existsSync(GOVERNANCE_ROOT) || !existsSync(PROJECT_ROOT), 'real local source repositories are required');
  mkdirSync(OUTPUT, { recursive: true });
  const overlay = exportPinnedRepository(GOVERNANCE_ROOT, GOVERNANCE_COMMIT, 'wb-release-overlay-');
  const project = clonePinnedProject();
  const state = mkdtempSync(join(tmpdir(), 'wb-release-state-'));
  await rebindProjectRoot(join(state, 'state'), {
    projectId: 'creative-os',
    selectedRoot: project,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({
      GOV_OVERLAY: overlay,
      WB_STATE_DIR: state,
      WB_COMPACT_WINDOW: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: MODEL, permission: { '*': 'deny' } }),
      OPENCODE_PURE: '1',
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    }),
  });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const main = app.windows().find((page) => page.url().includes('renderer-vnext')) ?? await app.firstWindow();
    const compact = app.windows().find((page) => page.url().includes('renderer-compact'))!;
    await main.setViewportSize({ width: 1440, height: 900 });
    await expect(main.locator('.approved-shell')).toBeVisible({ timeout: 30_000 });
    await expect(main.locator('.wb-fixture-badge')).toHaveCount(0);
    await screenshot(main, '01-full-hero.png');

    const task = main.locator('.react-flow__node[data-id="task:creative-os:T006"]');
    await expect(task).toBeVisible();
    await task.click();
    await expect(main.getByRole('complementary', { name: 'Focus Detail' })).toContainText('T006');
    await screenshot(main, '02-focused-task.png');
    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('sessions here', { timeout: 15_000 });
    await screenshot(compact, '07-compact.png');
    if (compactOnly) return;

    await main.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const cabinet = main.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await screenshot(main, '03-context-cabinet.png');
    await cabinet.locator('#prepare-conversation').selectOption('creative-os::claude::CO 主对话');
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();

    const dispatch = main.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch.locator('.dispatch-ready')).toBeVisible();
    await dispatch.locator('#dispatch-instruction').fill(`Return exactly ${RESULT_TEXT}. Do not call tools. Do not modify files.`);
    await dispatch.getByRole('button', { name: /opencode/i }).click();
    await expect(dispatch.getByRole('button', { name: 'Send packet' })).toBeEnabled();
    await screenshot(main, '04-send-ready.png');
    await dispatch.getByRole('button', { name: 'Send packet' }).click();

    let nativeRef = '';
    await expect.poll(async () => {
      const live = (await main.evaluate(() => window.wb.loadLiveExecutions())).find((entry) => entry.harness === 'opencode');
      nativeRef = live?.externalSessionRef ?? '';
      return Boolean(live && /^ses_/.test(live.externalSessionRef));
    }, { timeout: 30_000, intervals: [25, 50, 100] }).toBe(true);
    await screenshot(main, '05-real-running.png');

    await expect(dispatch.getByRole('status', { name: 'Dispatch receipt' })).toContainText('ACCEPTED', { timeout: 120_000 });
    await expect.poll(async () => (await main.evaluate(() => window.wb.loadLiveExecutions())).length).toBe(0);
    const proof = await main.evaluate(async ({ expected, native }) => {
      const page = await window.wb.loadActivity({ limit: 200 });
      const events = page.events.filter((event) => event.runtimeRef === native && event.harness === 'opencode');
      return {
        output: events.find((event) => event.kind === 'agent-response')?.content ?? '',
        kinds: events.map((event) => event.kind),
        exact: events.some((event) => event.kind === 'agent-response' && event.content?.includes(expected)),
      };
    }, { expected: RESULT_TEXT, native: nativeRef });
    expect(proof.exact).toBe(true);
    expect(proof.kinds).toEqual(expect.arrayContaining(['session-started', 'turn-started', 'agent-response', 'turn-completed', 'handoff-accepted']));
    expect(execFileSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');

    await dispatch.getByRole('button', { name: 'Close Dispatch' }).click();
    await main.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(main.getByRole('complementary', { name: 'Focus Detail' })).toContainText(RESULT_TEXT);
    await screenshot(main, '06-result.png');
    await expect(compact.locator('.approved-compact-window')).toBeVisible();
    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('sessions here', { timeout: 10_000 });
    await screenshot(compact, '07-compact.png');
    console.log(`[release-evidence] ${JSON.stringify({ nativeRef, model: MODEL, output: proof.output })}`);
  } finally {
    await app.close();
    rmSync(overlay, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
