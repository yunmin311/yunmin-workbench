import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('Memory search expands source and explicitly adds a source-backed reference to Context', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wb-memory-e2e-'));
  const stateDir = join(temp, 'user-data');
  const claudeRoot = join(temp, 'claude');
  const codexRoot = join(temp, 'codex');
  const archiveRoot = join(temp, 'archive');
  mkdirSync(join(codexRoot, '2026', '08', '31'), { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });
  const source = join(codexRoot, '2026', '08', '31', 'memory.jsonl');
  writeFileSync(source,
    line({ timestamp: '2026-08-31T08:00:00Z', type: 'session_meta', payload: { id: 'memory-e2e' } }) +
    line({ timestamp: '2026-08-31T08:01:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[memory fact] The cobalt release requires explicit approval' }] } }),
  );
  const before = hash(source);
  let expectedSourceHash = before;
  const externalFiles = [
    join(overlay.overlayRoot, 'INBOX.md'),
    join(overlay.overlayRoot, 'memory', 'MEMORY.md'),
    overlay.projectCanonicalPath,
  ];
  const externalBefore = externalFiles.map(hash);
  const env = {
    WB_CLAUDE_HISTORY_ROOT: claudeRoot, WB_CODEX_HISTORY_ROOT: codexRoot, WB_CODEX_ARCHIVED_HISTORY_ROOT: archiveRoot,
  };
  let launched = await launchWorkbench(stateDir, overlay.overlayRoot, env);
  try {
    const { win } = launched;
    await win.keyboard.press('Control+K');
    await win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
    await win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    await win.locator('.sidebar-conversations button').first().click();

    await win.keyboard.press('Control+K');
    await win.locator('[cmdk-input]').fill('Search Memory');
    await win.locator('[cmdk-item]', { hasText: 'Search Memory' }).click();
    const memory = win.getByRole('dialog', { name: 'Derived Memory search' });
    await memory.getByRole('searchbox').fill('cobalt release');
    await memory.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(memory.locator('.memory-hit')).toHaveCount(1);
    await memory.locator('.memory-hit').click();
    await expect(memory.locator('.memory-detail')).toContainText('[memory fact] The cobalt release requires explicit approval');
    await expect(memory.locator('.memory-detail')).toContainText('Evidence SUFFICIENT');
    await memory.getByRole('button', { name: 'Add to Context' }).click();
    await expect(memory.locator('.memory-hit')).toContainText('used 0');

    await memory.getByRole('button', { name: 'Inspect Source' }).click();
    const history = win.getByRole('dialog', { name: 'Read-only History search' });
    await expect(history.locator('.history-detail')).toContainText('[memory fact] The cobalt release requires explicit approval');
    await history.getByRole('button', { name: 'Close History' }).click();
    await win.getByRole('button', { name: 'Context', exact: true }).click();
    const stagedMemory = win.locator('.context-item', { hasText: 'Memory: The cobalt release requires explicit approval' });
    await expect(stagedMemory).toContainText('included');
    await stagedMemory.locator('button.pin').click();
    await expect(stagedMemory.locator('button.pin')).toHaveClass(/on/);
    expect(readFileSync(join(stateDir, 'state', 'memory', 'use-v1.json'), 'utf8')).toContain('"count":2');
    await win.getByRole('button', { name: 'Packet', exact: true }).click();
    await expect(win.locator('.inspector-pane .validity-current')).toBeVisible();

    await launched.app.close();
    launched = await launchWorkbench(stateDir, overlay.overlayRoot, env);
    const resumed = launched.win;
    await expect(resumed.getByRole('button', { name: 'Context', exact: true })).toBeEnabled();
    await resumed.getByRole('button', { name: 'Context', exact: true }).click();
    await expect(resumed.locator('.context-item', { hasText: 'Memory: The cobalt release requires explicit approval' })).toContainText('included');
    await resumed.getByRole('button', { name: 'Packet', exact: true }).click();
    await expect(resumed.locator('.inspector-pane .validity-current')).toBeVisible();

    expect(hash(source)).toBe(before);
    writeFileSync(source,
      line({ timestamp: '2026-08-31T08:00:00Z', type: 'session_meta', payload: { id: 'memory-e2e' } }) +
      line({ timestamp: '2026-08-31T08:02:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[memory fact] The cobalt release is replaced' }] } }),
    );
    const future = new Date(Date.now() + 2_000);
    utimesSync(source, future, future);
    expectedSourceHash = hash(source);
    await resumed.getByRole('button', { name: 'Reload external truth' }).click();
    await resumed.getByRole('button', { name: 'Context', exact: true }).click();
    await expect(resumed.locator('.context-item', { hasText: 'Memory: The cobalt release requires explicit approval' })).toHaveCount(0);
    await expect(resumed.locator('.context-message')).toContainText('Orphaned draft decisions');
    await resumed.getByRole('button', { name: 'Packet', exact: true }).click();
    await expect(resumed.locator('.inspector-pane')).not.toContainText('The cobalt release requires explicit approval');
  } finally {
    await launched.app.close();
  }
  expect(hash(source)).toBe(expectedSourceHash);
  expect(externalFiles.map(hash)).toEqual(externalBefore);
});
