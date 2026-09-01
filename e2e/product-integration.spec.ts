import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;

test('Session workspace keeps Context, Packet, evidence and low-frequency tools on demand', async () => {
  const inboxBefore = createHash('sha256').update(readFileSync(join(OVERLAY, 'INBOX.md'))).digest('hex');
  const memoryBefore = createHash('sha256').update(readFileSync(join(OVERLAY, 'memory', 'MEMORY.md'))).digest('hex');
  const canonicalBefore = createHash('sha256').update(readFileSync(overlay.projectCanonicalPath)).digest('hex');
  const { app, win } = await launchWorkbench(mkdtempSync(join(tmpdir(), 'wb-e2e-product-')), OVERLAY);
  try {
    await win.keyboard.press('Control+K');
    await win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
    await win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    await win.locator('.sidebar-conversations button').first().click();

    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.locator('.session-composer')).toBeVisible();
    await expect(win.getByRole('textbox', { name: 'Task for Agent' })).toBeEnabled();
    await expect(win.locator('.composer-agent')).toBeVisible();
    await expect(win.getByRole('button', { name: /Send to|Choose Agent/ })).toBeVisible();

    await win.locator('.context-summary').click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await win.locator('button', { hasText: '+ Manual Context' }).click();
    await win.locator('.manual-context-form input').fill('Product integration probe');
    await win.locator('.manual-context-form textarea').fill('Product glue for Context to Packet');
    await win.locator('.manual-context-form button', { hasText: 'Add to Included' }).click();
    await win.locator('.inspector-close').click();
    await expect(win.locator('.context-summary')).toContainText('6 contexts');

    await win.keyboard.press('Control+4');
    await expect(win.locator('.panel h2', { hasText: 'Task Packet' })).toBeVisible();
    await expect(win.locator('.packet-preview .agent-input-text')).toContainText('Product glue for Context to Packet');
    await expect(win.locator('button', { hasText: 'Copy Agent Input' })).toBeVisible();
    await win.locator('.inspector-close').click();

    for (const command of ['Search History', 'Search Memory', 'Appearance']) {
      await win.keyboard.press('Control+K');
      await win.locator('[cmdk-input]').fill(command);
      await win.locator('[cmdk-item]', { hasText: command }).click();
      await expect(win.locator('.history-panel, .material-panel').first()).toBeVisible();
      await win.locator('.history-panel-header button, .material-panel button', { hasText: '×' }).first().click();
    }

    await expect(win.locator('.session-activity')).toBeVisible();
    expect(createHash('sha256').update(readFileSync(join(OVERLAY, 'INBOX.md'))).digest('hex')).toBe(inboxBefore);
    expect(createHash('sha256').update(readFileSync(join(OVERLAY, 'memory', 'MEMORY.md'))).digest('hex')).toBe(memoryBefore);
    expect(createHash('sha256').update(readFileSync(overlay.projectCanonicalPath)).digest('hex')).toBe(canonicalBefore);
  } finally {
    await app.close();
  }
});
