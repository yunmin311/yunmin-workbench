import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { exportPinnedRepository } from './pinnedRepoExport';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

const realOverlay = process.env.WB_REAL_OVERLAY;
const creativeRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:/1project/creative-os';
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const shots = resolve('screenshots/production-compact-acceptance-20260914');

async function containment(compact: Page) {
  return compact.evaluate(() => {
    const shell = document.querySelector('.approved-compact-window')!.getBoundingClientRect();
    const selectors = ['.approved-compact-head', '.approved-compact-task', '.attention-strip', '.runtime-strip', '.approved-compact-actions'];
    const outside = selectors.filter((selector) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return box.left < shell.left - 0.5 || box.top < shell.top - 0.5 || box.right > shell.right + 0.5 || box.bottom > shell.bottom + 0.5;
    });
    const borderWidths = ['html', 'body', '#compact-root', '.approved-compact-window'].map((selector) => ({
      selector,
      width: getComputedStyle(document.querySelector(selector)!).borderTopWidth,
    }));
    return {
      outside,
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight },
      borderWidths,
      actions: document.querySelector('.approved-compact-actions')!.getBoundingClientRect().toJSON(),
    };
  });
}

test('approved Compact IA remains complete across default, attention, runtime and minimum states', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required');
  mkdirSync(shots, { recursive: true });
  const overlayExport = exportPinnedRepository(realOverlay!, GOVERNANCE_PINNED_COMMIT, 'wb-compact-ia-pin-');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-compact-ia-'));
  const stateRoot = join(stateDir, 'state');
  mkdirSync(stateRoot, { recursive: true });
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os', selectedRoot: creativeRoot, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os', expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1, projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006', updatedAt: '2026-09-14T00:00:00.000Z',
  }));

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: overlayExport, WB_STATE_DIR: stateDir, WB_COMPACT_WINDOW: '1' }),
  });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const compact = app.windows().find((page) => page.url().includes('renderer-compact'))!;
    await expect(compact.locator('.approved-compact-window')).toBeVisible({ timeout: 20_000 });
    await expect(compact.locator('.approved-compact-task')).toContainText('T006');
    await expect(compact.getByRole('status', { name: 'Attention' })).toContainText('Nothing needs review');
    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('sessions here');
    await expect(compact.getByRole('button', { name: 'Continue current work' })).toBeVisible();
    await expect(compact.getByRole('button', { name: 'Prepare current work' })).toBeVisible();
    const defaultReport = await containment(compact);
    expect(defaultReport.outside).toEqual([]);
    expect(defaultReport.scroll).toMatchObject({ width: defaultReport.scroll.viewportWidth, height: defaultReport.scroll.viewportHeight });
    expect(defaultReport.borderWidths.slice(0, 3).map((entry) => entry.width)).toEqual(['0px', '0px', '0px']);
    expect(parseFloat(defaultReport.borderWidths[3].width)).toBeGreaterThan(0);
    await compact.screenshot({ path: join(shots, '01-default-real.png') });

    const observedAt = '2026-09-14T00:01:00.000Z';
    const activityDir = join(stateRoot, 'activity');
    mkdirSync(activityDir, { recursive: true });
    writeFileSync(join(activityDir, 'history.jsonl'), `${JSON.stringify({ schemaVersion: 1, event: {
      id: 'compact-ia-attention', projectId: 'creative-os', conversationKey: 'creative-os::claude::CO 主对话',
      kind: 'needs-user-input', summary: 'TEST FIXTURE · Compact attention state', attentionKey: 'compact-ia-attention', attentionStatus: 'active',
      observed: { source: 'protocol', sourceRef: 'protocol:test-fixture:compact-attention', observedAt, verification: 'OBSERVED' },
    } })}\n`);
    await expect(compact.getByRole('status', { name: 'Attention' })).toContainText('User input needed', { timeout: 9_000 });
    await compact.screenshot({ path: join(shots, '02-attention-test-fixture.png') });

    await compact.evaluate(async ({ observedAt: at }) => {
      await window.wb.dismissAttention('attention:needs-user-input:explicit%3Acompact-ia-attention', at);
    }, { observedAt });
    await expect(compact.getByRole('status', { name: 'Attention' })).toContainText('Nothing needs review', { timeout: 9_000 });

    const runtimeProbe = await compact.evaluate(async () => {
      const dispatch = window.wb.dispatchToHarness({
        intentId: '6f5f9665-a537-4c47-a47f-4a16b85082ec', projectId: 'creative-os', conversationKey: 'creative-os::codex::CO Codex 替补',
        packetText: 'TEST FIXTURE · remain read-only while Compact runtime presence is captured.', harness: 'codex',
        environment: { kind: 'demo', sessionId: 'compact-ia-runtime' }, groupId: '1558ef0c-b56b-4691-8b15-a571ee8419ef',
        workId: '001-inspiration-capture', taskId: 'T006',
      });
      const samples = [];
      const deadline = performance.now() + 640;
      while (performance.now() < deadline) {
        const live = await window.wb.loadLiveExecutions();
        if (live.length > 0) samples.push(live);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { samples, receipt: await dispatch };
    });
    expect(runtimeProbe.receipt.status).toBe('ACCEPTED');
    expect(runtimeProbe.samples.at(0)).toHaveLength(1);
    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('1 working', { timeout: 400 });
    await compact.screenshot({ path: join(shots, '03-runtime-presence-test-fixture.png') });

    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('No live execution fact.', { timeout: 5_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'Workbench Compact')?.setBounds({ width: 320, height: 300 }));
    await compact.waitForTimeout(600);
    const minimumReport = await containment(compact);
    expect(minimumReport.outside).toEqual([]);
    expect(minimumReport.scroll).toMatchObject({ width: minimumReport.scroll.viewportWidth, height: minimumReport.scroll.viewportHeight });
    expect(minimumReport.actions.bottom).toBeLessThanOrEqual(minimumReport.scroll.viewportHeight + 0.5);
    await compact.screenshot({ path: join(shots, '04-minimum-real.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
