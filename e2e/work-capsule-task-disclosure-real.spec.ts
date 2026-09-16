import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

const realOverlay = process.env.WB_REAL_OVERLAY;
const capsuleRoot = process.env.WB_REAL_WORK_CAPSULE_ROOT ?? 'E:/1project/work-capsule';
const shots = resolve('screenshots/work-capsule-task-disclosure-20260915');

test('REAL work-capsule keeps all 20 Tasks reachable through spatial drill-in', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-capsule-disclosure-'));
  const stateRoot = join(stateDir, 'state');
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(shots, { recursive: true });
  await rebindProjectRoot(stateRoot, {
    projectId: 'work-capsule', selectedRoot: capsuleRoot, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'work-capsule', expectedRemote: 'https://github.com/yunmin311/work-capsule.git',
  });
  writeFileSync(join(stateRoot, 'current-selection-v1.json'), JSON.stringify({
    schemaVersion: 1, projectId: 'work-capsule', workId: 'v1-core', taskId: 'v1-T09', updatedAt: '2026-09-15T00:00:00.000Z',
  }));

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: realOverlay!, WB_STATE_DIR: stateDir }),
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 900, height: 700 });
    await expect(win.locator('.approved-shell')).toBeVisible({ timeout: 30_000 });
    await win.evaluate(async () => window.wb.openWorkbenchFromCompact({
      projectId: 'work-capsule', workId: 'v1-core', taskId: 'v1-T09', action: 'continue',
    }));
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Add the CLI as the first usable host', { timeout: 30_000 });

    const facts = await win.evaluate(async () => {
      const revision = (await window.wb.getWorkGraphRevision('work-capsule')).revision;
      return {
        tasks: revision?.candidate.semanticFacts.nodes.filter((node) => node.kind === 'task').length ?? 0,
        semanticHash: revision?.semanticHash ?? null,
      };
    });
    expect(facts.tasks).toBe(20);
    const tasks = win.locator('.react-flow__node-wb-task');
    await expect(tasks).toHaveCount(6);
    await expect(win.locator('.react-flow__node[data-id="task:work-capsule:v1-T09"]')).toBeVisible();
    const showCore = win.locator('button[aria-label="Show 8 more tasks in Work Capsule v1 核心"]');
    await expect(showCore).toBeVisible();
    await expect(win.locator('button[aria-label="Show 6 more tasks in 仓库接入与自更新"]')).toBeVisible();
    await win.screenshot({ path: join(shots, '01-collapsed-current-task-real-900x700.png') });

    await showCore.click();
    await expect(tasks).toHaveCount(11);
    const expanded = win.locator('.react-flow__node-wb-region.is-region-expanded');
    await expect(expanded).toHaveCount(1);
    await expect.poll(() => win.locator('.react-flow__viewport').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
      .toBeGreaterThanOrEqual(0.62);
    const objectSize = await tasks.first().boundingBox();
    const objectWorldSize = await tasks.first().evaluate((element) => ({
      width: parseFloat(getComputedStyle(element).width),
      height: parseFloat(getComputedStyle(element).height),
    }));
    expect(objectWorldSize).toMatchObject({ width: 190, height: 156 });
    expect(objectSize?.width).toBeGreaterThanOrEqual(115);
    expect(objectSize?.height).toBeGreaterThanOrEqual(94);
    const initialZoom = await win.locator('.react-flow__viewport').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
    expect(initialZoom).toBeGreaterThanOrEqual(0.62);

    const plane = (await win.locator('.approved-bounded-plane').boundingBox())!;
    const lastTask = win.locator('.react-flow__node[data-id="task:work-capsule:v1-T11"]');
    await win.mouse.move(plane.x + plane.width * 0.72, plane.y + plane.height * 0.55);
    await win.mouse.wheel(0, 620);
    await win.waitForTimeout(400);
    await lastTask.click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Prove the complete core flow');
    await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toContainText('Prove the complete core flow');
    await expect(cabinet).toContainText('Will use 0');
    await expect(cabinet).toContainText('Available');
    await cabinet.getByRole('button', { name: 'Close Context Cabinet' }).click();
    await win.screenshot({ path: join(shots, '02-expanded-panned-real-900x700.png') });

    const drillExit = win.locator('.approved-drill-exit button[aria-label="Show fewer tasks in Work Capsule v1 核心"]');
    await expect(drillExit).toBeVisible();
    await drillExit.click();
    await expect(tasks).toHaveCount(6);
    await expect(win.locator('.react-flow__node[data-id="task:work-capsule:v1-T11"]')).toBeVisible();
    await win.getByRole('button', { name: 'Locate current work' }).click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Prove the complete core flow');
    const after = await win.evaluate(async () => (await window.wb.getWorkGraphRevision('work-capsule')).revision?.semanticHash ?? null);
    expect(after).toBe(facts.semanticHash);
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
