import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';

const evidenceDir = resolve('screenshots/phase-a-spatial-world');

test('Phase A runs the DSH spatial world as the authoritative production canvas', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-spatial-a-'));
  mkdirSync(evidenceDir, { recursive: true });
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ WB_STATE_DIR: stateDir }),
    recordVideo: { dir: evidenceDir, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  try {
    const fixtureUrl = await win.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('fixture', '1');
      return url.toString();
    });
    await win.goto(fixtureUrl);
    await win.setViewportSize({ width: 1440, height: 900 });

    const viewport = win.locator('.spatial-viewport');
    await expect(viewport).toBeVisible();
    await expect(viewport.locator('.spatial-relation-layer')).toBeVisible();
    await expect(viewport.locator('.spatial-object-layer')).toBeVisible();
    await expect(viewport.locator('.react-flow')).toHaveCount(0);
    expect(await viewport.locator('.spatial-port').count()).toBeGreaterThan(1);

    const cameraBefore = await viewport.evaluate((element) => ({
      x: Number(element.getAttribute('data-camera-x')),
      y: Number(element.getAttribute('data-camera-y')),
      zoom: Number(element.getAttribute('data-zoom')),
    }));
    const box = await viewport.boundingBox();
    if (!box) throw new Error('spatial viewport has no bounds');
    await win.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35);
    await win.mouse.wheel(60, 120);
    await expect.poll(() => viewport.getAttribute('data-camera-y')).not.toBe(String(cameraBefore.y));
    const afterPan = await viewport.evaluate((element) => ({
      x: Number(element.getAttribute('data-camera-x')),
      y: Number(element.getAttribute('data-camera-y')),
      zoom: Number(element.getAttribute('data-zoom')),
    }));
    expect(afterPan.zoom).toBe(cameraBefore.zoom);
    expect(afterPan.y).not.toBe(cameraBefore.y);

    await win.keyboard.down('Control');
    await win.mouse.wheel(0, -180);
    await win.keyboard.up('Control');
    await expect.poll(() => viewport.getAttribute('data-zoom')).not.toBe(String(afterPan.zoom));
    const afterZoom = await viewport.evaluate((element) => ({
      x: Number(element.getAttribute('data-camera-x')),
      y: Number(element.getAttribute('data-camera-y')),
      zoom: Number(element.getAttribute('data-zoom')),
    }));
    expect(afterZoom.zoom).toBeGreaterThan(afterPan.zoom);
    const pointer = { x: box.width * 0.7, y: box.height * 0.35 };
    expect((pointer.x - afterZoom.x) / afterZoom.zoom)
      .toBeCloseTo((pointer.x - afterPan.x) / afterPan.zoom, 0);
    expect((pointer.y - afterZoom.y) / afterZoom.zoom)
      .toBeCloseTo((pointer.y - afterPan.y) / afterPan.zoom, 0);

    await win.getByRole('button', { name: 'Fit spatial world', exact: true }).click();
    const task = viewport.locator('.spatial-object[data-family="task"]').first();
    await task.click();
    await expect(task).toHaveAttribute('aria-selected', 'true');
    await win.getByRole('button', { name: 'Locate selected object' }).click();
    await expect(task).toBeInViewport();
    await win.screenshot({ path: join(evidenceDir, 'phase-a-spatial-world-1440x900.png') });

    const taskId = await task.getAttribute('data-object-id');
    const xBefore = Number(await task.getAttribute('data-world-x'));
    const yBefore = Number(await task.getAttribute('data-world-y'));
    const incident = viewport.locator(`.spatial-relation[data-source="${taskId}"], .spatial-relation[data-target="${taskId}"]`).first();
    const unrelated = viewport.locator(`.spatial-relation:not([data-source="${taskId}"]):not([data-target="${taskId}"])`).first();
    const incidentBefore = await incident.getAttribute('d');
    const unrelatedBefore = await unrelated.getAttribute('d');
    const taskBox = await task.boundingBox();
    if (!taskBox) throw new Error('task has no bounds');
    const hitId = await win.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('.spatial-object')?.dataset.objectId ?? null, {
      x: taskBox.x + 50,
      y: taskBox.y + 20,
    });
    expect(hitId).toBe(taskId);
    await win.mouse.move(taskBox.x + 50, taskBox.y + 20);
    await win.mouse.down();
    await win.mouse.move(taskBox.x + 150, taskBox.y - 20, { steps: 5 });
    await win.mouse.up();
    await expect.poll(async () => Number(await task.getAttribute('data-world-x'))).not.toBe(xBefore);
    expect(Number(await task.getAttribute('data-world-y'))).not.toBe(yBefore);
    expect(await incident.getAttribute('d')).not.toBe(incidentBefore);
    expect(await unrelated.getAttribute('d')).toBe(unrelatedBefore);

    const stored = await win.evaluate((id) => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('yunmin-workbench:spatial-world:v1:'));
      return keys.some((key) => JSON.parse(localStorage.getItem(key) ?? '{}')[id!]);
    }, taskId);
    expect(stored).toBe(true);

    const movedX = Number(await task.getAttribute('data-world-x'));
    const movedY = Number(await task.getAttribute('data-world-y'));
    await win.reload();
    await expect(viewport).toBeVisible();
    const restoredTask = viewport.locator(`.spatial-object[data-object-id="${taskId}"]`);
    await win.getByRole('button', { name: 'Fit spatial world', exact: true }).click();
    await expect(restoredTask).toBeVisible();
    expect(Number(await restoredTask.getAttribute('data-world-x'))).toBe(movedX);
    expect(Number(await restoredTask.getAttribute('data-world-y'))).toBe(movedY);

    const mountedBefore = await viewport.locator('.spatial-object').count();
    await viewport.dispatchEvent('wheel', { deltaX: 5000, deltaY: 5000, ctrlKey: false });
    await expect.poll(() => viewport.locator('.spatial-object').count()).toBeLessThan(mountedBefore);

    await win.getByRole('button', { name: 'Fit spatial world', exact: true }).click();
    await expect(restoredTask).toBeInViewport();
    expect(Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(0.6);
    await win.screenshot({ path: join(evidenceDir, 'phase-a-spatial-world-persisted.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
