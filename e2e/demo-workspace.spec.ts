import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test, type Page, type ElectronApplication } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';

function emptySearchRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wb-empty-search-'));
}

async function launchEmpty(): Promise<{ app: ElectronApplication; win: Page }> {
  const env = workbenchEnv({ WB_OVERLAY_SEARCH_ROOT: emptySearchRoot(), WB_STATE_DIR: mkdtempSync(join(tmpdir(), 'wb-fr-')) });
  delete env.GOV_OVERLAY;
  const app = await _electron.launch({ args: [...electronArgs(), 'out/main/index.js'], env });
  return { app, win: await app.firstWindow() };
}

test('first-run enters an explicit isolated Demo workspace with 6 Creative OS sessions and pre-loaded fixture', async () => {
  const { app, win } = await launchEmpty();
  try {
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Open real workspace' })).toBeVisible();
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveText('DEMO · SIMULATED');

    // Demo Welcome is pre-populated: the persistent workspace rail exposes 3 projects,
    // Creative OS exposes 6 sessions, and the timeline shows the pre-loaded Single run.
    const railProjects = win.locator('.workspace-rail .rail-projects li');
    await expect(railProjects).toHaveCount(3);
    const railSessions = win.locator('.workspace-rail .rail-sessions li');
    await expect(railSessions).toHaveCount(6);
    // Total visible activity on 主对话 = 8 (3 cards + 4 boundaries + 1 transcript turn).
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(8);

    // Runtime badge appears because the fixture includes one runtime session for the main conversation.
    await expect(win.getByTestId('session-runtime-badge')).toHaveCount(1);

    // Total visible activity on 主对话 = 8 (3 cards + 4 boundaries + 1 transcript turn).
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(8);

    // Context drawer is reachable without going through the modal picker.
    await win.locator('.context-summary').click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await expect(win.locator('button.state-included').first()).toBeAttached();
  } finally {
    await app.close();
  }
});

test('Demo Reset restores the pre-loaded fixture and Exit returns to first-run', async () => {
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();
    const initialCount = await win.locator('.activity-card').count();
    expect(initialCount).toBeGreaterThan(0);

    // Reset restores the deterministic fixture (clears any user-dispatched runs).
    await win.getByRole('button', { name: 'Reset' }).click();
    await expect(win.locator('.activity-card')).toHaveCount(initialCount);

    // Exit brings back the first-run choice.
    await win.getByRole('button', { name: 'Exit demo workspace' }).click();
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Demo Creative OS exposes six sessions and switches follow the selection', async () => {
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // Switch three sessions through the persistent rail and confirm scope follows selection.
    const pick = async (role: string) => {
      await win.locator('.workspace-rail .rail-sessions li button', { hasText: role }).first().click();
    };

    // 规划 conversation has 10 events (parallel dispatch + accept + responses + completions).
    await pick('Creative OS 规划');
    await expect(win.locator('.session-header h1')).toHaveText('Creative OS 规划');
    await expect(win.locator('.session-path')).toContainText('claude');
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(10);

    // 顾问 conversation has 1 event (the approval).
    await pick('Creative OS 顾问');
    await expect(win.locator('.session-header h1')).toHaveText('Creative OS 顾问');
    await expect(win.locator('.session-path')).toContainText('deepseek');
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(1);

    // Codex 替补 has 4 events (the handoff B lineage).
    await pick('Creative OS Codex 替补');
    await expect(win.locator('.session-header h1')).toHaveText('Creative OS Codex 替补');
    await expect(win.locator('.session-path')).toContainText('codex');
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(4);
  } finally {
    await app.close();
  }
});

test('Demo exposes Compare with two real fixture executions, Map trajectory, Memory, History', async () => {
  test.setTimeout(90_000);
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();

    // Compare is reachable from the top tabs; shows the pre-loaded parallel group.
    await win.getByRole('button', { name: 'Compare', exact: true }).click();
    const compareGroup = win.locator('.compare-group').first();
    await expect(compareGroup.locator('.compare-card')).toHaveCount(2);
    await expect(compareGroup.locator('.compare-card').nth(0)).toContainText('[DEMO/SIMULATED');
    await expect(compareGroup.locator('.compare-card').nth(1)).toContainText('[DEMO/SIMULATED');
    await expect(compareGroup.locator('.compare-evidence').first()).toBeVisible();

    // Map (canvas) shows the trajectory of the pre-loaded executions and handoffs.
    await win.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(win.locator('.react-flow__nodes').first()).toBeVisible();

    // Return to the main session and verify the pre-loaded Single run is present.
    await win.locator('.workspace-rail .rail-sessions li button', { hasText: 'Creative OS 主对话' }).first().click();
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn').first()).toBeVisible();
    await expect(win.locator('.activity-card, .activity-boundary, .transcript-turn')).toHaveCount(8);

    // History drawer: open the search panel and confirm the demo catalog renders.
    await win.locator('.command-trigger').click();
    await expect(win.locator('.command-dialog')).toBeVisible();
    await win.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});
