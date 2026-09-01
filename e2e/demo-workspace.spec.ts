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

test('first-run enters an explicit isolated Demo workspace', async () => {
  const { app, win } = await launchEmpty();
  try {
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Open real workspace' })).toBeVisible();
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveText('DEMO · SIMULATED');
    await expect(win.getByTestId('session-runtime-badge')).toHaveCount(0);
    await win.locator('.context-summary').click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await expect(win.locator('button.state-included').first()).toBeAttached();
  } finally {
    await app.close();
  }
});

test('Demo resets and exits without leaking simulated history', async () => {
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();
    await win.getByRole('textbox', { name: 'Task for Agent' }).fill('One isolated demo run');
    await win.getByRole('button', { name: /Send to/ }).click();
    await expect(win.locator('.activity-kind-agent-response')).toContainText('[DEMO/SIMULATED');
    await win.getByRole('button', { name: 'Reset' }).click();
    await expect(win.locator('.activity-kind-agent-response')).toHaveCount(0);
    await win.getByRole('button', { name: 'Exit demo workspace' }).click();
    await expect(win.getByRole('button', { name: 'Try Demo' })).toBeVisible();
    await expect(win.getByTestId('demo-live-badge')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Demo completes Single → Parallel → Handoff → Compare through real dispatch UI', async () => {
  test.setTimeout(90_000);
  const { app, win } = await launchEmpty();
  try {
    await win.getByRole('button', { name: 'Try Demo' }).click();

    await win.getByRole('textbox', { name: 'Task for Agent' }).fill('Summarize the launch goal');
    await win.getByRole('button', { name: /Send to/ }).click();
    await expect(win.locator('.activity-kind-agent-response')).toHaveCount(1);
    await expect(win.locator('.activity-kind-agent-response')).toContainText('[DEMO/SIMULATED');

    await win.locator('.agent-selector').click();
    await win.getByRole('menuitemcheckbox', { name: /claude/i }).click();
    await win.getByRole('textbox', { name: 'Task for Agent' }).fill('Compare two launch approaches');
    await win.getByRole('button', { name: 'Run with 2 agents' }).click();
    await expect(win.getByRole('status')).toContainText('2 Agents started');

    await win.getByRole('button', { name: 'Compare', exact: true }).click();
    const parallelGroup = win.locator('.compare-group').first();
    await expect(parallelGroup.locator('.compare-card')).toHaveCount(2);
    await expect(parallelGroup.locator('.compare-card').nth(0)).toContainText('[DEMO/SIMULATED');
    await expect(parallelGroup.locator('.compare-card').nth(1)).toContainText('[DEMO/SIMULATED');
    await expect(parallelGroup.locator('.compare-evidence')).toHaveCount(2);

    await parallelGroup.locator('.compare-card').first().getByRole('button', { name: 'Use as context' }).click();
    await expect(win.locator('.handoff-context-card')).toBeVisible();
    await win.locator('.agent-selector').click();
    await win.getByRole('menuitemcheckbox', { name: /claude/i }).click();
    await win.getByRole('menuitemcheckbox', { name: /codex/i }).click();
    await win.getByRole('textbox', { name: 'Task for Agent' }).fill('Continue from the selected result');
    await win.getByRole('button', { name: 'Send to claude' }).click();
    await expect(win.getByRole('status')).toContainText('1 Agent started');

    await win.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(win.locator('.compare-group')).toHaveCount(1);
    await win.screenshot({ path: join('test-results', 'product-rebuild-walkthrough.png'), fullPage: true });
  } finally {
    await app.close();
  }
});
