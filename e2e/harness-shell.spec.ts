import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const OVERLAY = 'D:\\ai-governance-system';
const PROJECT_CANONICAL = 'D:\\project\\CLAUDE.md';
const hasOverlay = existsSync(join(OVERLAY, 'overlay.yaml'));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test.describe('Reasonix harness renderer prototype (real overlay, isolated Workbench state)', () => {
  test.skip(!hasOverlay, 'real overlay not present on this machine');

  test('session surface, on-demand context, and projection graph', async () => {
    const inboxBefore = hash(join(OVERLAY, 'INBOX.md'));
    const memoryBefore = hash(join(OVERLAY, 'memory', 'MEMORY.md'));
    const canonicalBefore = hash(PROJECT_CANONICAL);
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-reasonix-prototype-'));
    const screenshotDir = join(process.cwd(), 'screenshots', 'reasonix-harness-prototype');
    mkdirSync(screenshotDir, { recursive: true });

    const app = await electron.launch({
      args: ['out/main/index.js'],
      env: { ...process.env, WB_STATE_DIR: stateDir },
    });
    const win = await app.firstWindow();

    await expect(win.locator('.prototype-chrome')).toBeVisible();
    await expect(win.locator('.session-welcome h1')).toContainText('Start from a session');
    await expect(win.locator('.inspector-pane')).toHaveCount(0);

    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    const projectOption = win.locator('.project-switcher option').filter({ hasText: 'Creative OS' });
    const projectValue = await projectOption.getAttribute('value');
    expect(projectValue).toBeTruthy();
    await win.locator('.project-switcher select').selectOption(projectValue!);
    await expect(win.locator('.sidebar-conversations button').first()).toBeVisible();
    await win.locator('.sidebar-conversations button').first().click();

    await expect(win.locator('.session-header h1')).toBeVisible();
    await expect(win.locator('.session-composer textarea')).toBeEnabled();
    await expect(win.getByRole('button', { name: 'Follow up unavailable' })).toBeDisabled();
    await win.locator('.session-composer textarea').fill('Review the current packet before a structured handoff.');
    await win.screenshot({ path: join(screenshotDir, '01-active-session.png') });

    await win.getByRole('button', { name: 'Context', exact: true }).click();
    await expect(win.locator('.inspector-pane')).toBeVisible();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '02-context-on-demand.png') });
    await win.getByRole('button', { name: 'Close inspector' }).click();

    await win.getByRole('button', { name: 'Canvas', exact: true }).click();
    await expect(win.locator('.prototype-surface.is-canvas .react-flow')).toBeVisible();
    await expect(win.locator('.wb-project')).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '03-canvas-agent-graph.png') });

    await app.close();
    expect(hash(join(OVERLAY, 'INBOX.md'))).toBe(inboxBefore);
    expect(hash(join(OVERLAY, 'memory', 'MEMORY.md'))).toBe(memoryBefore);
    expect(hash(PROJECT_CANONICAL)).toBe(canonicalBefore);
  });
});
