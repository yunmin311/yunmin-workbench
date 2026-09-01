import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const conversationKey = 'creative-os::claude::CO 主对话';

test('measures a 5,000-event Session and Runtime Inspector timeline', async () => {
  test.setTimeout(120_000);
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-scale-e2e-'));
  const activityDir = join(stateDir, 'state', 'activity');
  mkdirSync(activityDir, { recursive: true });
  const events = Array.from({ length: 5_000 }, (_, index) => ({
    schemaVersion: 1,
    event: {
      id: `scale-event-${index}`,
      projectId: 'creative-os', conversationKey, harness: 'claude',
      adapter: 'claude-code-stream-json',
      kind: index === 0 ? 'session-started' : index === 4_999 ? 'turn-completed' : 'tool-completed',
      summary: `scale timeline event ${index}`,
      runtimeRef: 'scale-native-session',
      runtimeState: index === 0 ? 'working' : index === 4_999 ? 'idle' : undefined,
      binding: index === 0 ? {
        harness: 'claude', machine: 'scale-machine', externalSessionRef: 'scale-native-session',
      } : undefined,
      observed: {
        source: 'protocol', sourceRef: `scale:${index}`,
        observedAt: new Date(Date.UTC(2026, 7, 31) + index).toISOString(), verification: 'OBSERVED',
      },
    },
  }));
  writeFileSync(join(activityDir, 'history.jsonl'), `${events.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const launchStarted = performance.now();
  const { app, win } = await launchWorkbench(stateDir, overlay.overlayRoot);
  const launchMs = performance.now() - launchStarted;
  try {
    const sessionStarted = performance.now();
    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    const option = win.locator('.project-switcher option').filter({ hasText: 'Creative OS' });
    await win.locator('.project-switcher select').selectOption((await option.getAttribute('value'))!);
    await win.locator('.sidebar-conversations button', { hasText: 'CO 主对话' }).click();
    await expect(win.locator('.session-timeline')).toBeVisible();
    const sessionOpenMs = performance.now() - sessionStarted;
    const sessionRows = await win.locator('.session-timeline > li').count();
    expect(sessionRows).toBe(200);
    await win.getByRole('button', { name: /Show earlier activity/ }).click();
    await expect(win.locator('.session-timeline > li')).toHaveCount(400);

    const scrollStarted = performance.now();
    await win.locator('.session-timeline > li').last().scrollIntoViewIfNeeded();
    const scrollMs = performance.now() - scrollStarted;

    const inspectorStarted = performance.now();
    await win.getByTestId('session-runtime-badge').click();
    await expect(win.getByTestId('runtime-detail')).toBeVisible();
    const inspectorOpenMs = performance.now() - inspectorStarted;
    const inspectorRows = await win.locator('.runtime-chronology-row').count();
    expect(inspectorRows).toBe(200);
    await win.getByRole('button', { name: /Show earlier events/ }).click();
    await expect(win.locator('.runtime-chronology-row')).toHaveCount(400);
    const heapBytes = await win.evaluate(() =>
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);

    console.info('[scale:electron]', JSON.stringify({
      events: 5_000, launchMs, sessionOpenMs, sessionRows, scrollMs,
      inspectorOpenMs, inspectorRows, rendererHeapBytes: heapBytes,
    }));
  } finally {
    await app.close();
  }
});
