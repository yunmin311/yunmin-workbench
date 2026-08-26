import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const OVERLAY = 'D:\\ai-governance-system';
const PROJECT_CANONICAL = 'D:\\project\\CLAUDE.md';
const hasOverlay = existsSync(join(OVERLAY, 'overlay.yaml'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test.describe('Harness desktop shell (real overlay, isolated Workbench state)', () => {
  test.skip(!hasOverlay, 'real overlay not present on this machine');

  test('session-first shell and embedded inspectors', async () => {
    const inboxBefore = hash(join(OVERLAY, 'INBOX.md'));
    const memoryBefore = hash(join(OVERLAY, 'memory', 'MEMORY.md'));
    const canonicalBefore = hash(PROJECT_CANONICAL);
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-shell-e2e-'));
    const screenshotDir = join(process.cwd(), 'screenshots', 'harness-shell-rebuild');
    mkdirSync(screenshotDir, { recursive: true });

    const app = await electron.launch({
      args: ['out/main/index.js'],
      env: { ...process.env, WB_STATE_DIR: stateDir },
    });
    const win = await app.firstWindow();

    await expect(win.locator('.titlebar-brand')).toContainText('Yunmin Workbench');
    await expect(win.locator('.harness-rail')).toBeVisible();
    await expect(win.locator('.workspace-sidebar')).toBeVisible();
    await expect(win.locator('.inspector-pane')).toBeVisible();
    await expect(win.locator('.status-bar')).toContainText('NO PROJECT');
    await win.screenshot({ path: join(screenshotDir, '01-no-workspace.png') });

    await win.locator('.sidebar-projects button', { hasText: 'Creative OS' }).click();
    await expect(win.locator('.sidebar-conversations button').first()).toBeVisible();
    await expect(win.locator('.surface-empty h1')).toContainText('Creative OS');
    await win.screenshot({ path: join(screenshotDir, '02-project-session-selected.png') });

    await win.locator('.sidebar-conversations button').first().click();
    await expect(win.locator('.session-header h1')).toBeVisible();
    await expect(win.locator('.activity-empty')).toContainText('No structured runtime activity');
    await expect(win.locator('.session-composer textarea')).toBeEnabled();
    await expect(win.locator('.composer-actions button', { hasText: 'Follow up / Steer unavailable' })).toBeDisabled();
    await win.locator('.session-composer textarea').fill('Review the current packet before a structured handoff.');
    await expect(win.locator('.status-bar')).toContainText('Draft dirty');
    await win.screenshot({ path: join(screenshotDir, '03-active-session.png') });

    await win.getByRole('tab', { name: 'Context' }).click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '04-context-inspector.png') });

    await win.getByRole('tab', { name: 'Packet' }).click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Task Packet' })).toBeVisible();
    await expect(win.locator('.inspector-pane .validity-current')).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '05-packet-inspector.png') });

    await win.getByRole('button', { name: 'Canvas' }).click();
    await expect(win.locator('.active-surface-canvas .react-flow')).toBeVisible();
    await expect(win.locator('.wb-project')).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '06-canvas-mode.png') });

    await app.close();
    expect(hash(join(OVERLAY, 'INBOX.md'))).toBe(inboxBefore);
    expect(hash(join(OVERLAY, 'memory', 'MEMORY.md'))).toBe(memoryBefore);
    expect(hash(PROJECT_CANONICAL)).toBe(canonicalBefore);
  });
});
