import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;
const PROJECT_CANONICAL = overlay.projectCanonicalPath;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test.describe('Reasonix harness renderer prototype (GOV_OVERLAY fixture, isolated Workbench state)', () => {
  test('session surface, on-demand context, and projection graph', async () => {
    const inboxBefore = hash(join(OVERLAY, 'INBOX.md'));
    const memoryBefore = hash(join(OVERLAY, 'memory', 'MEMORY.md'));
    const canonicalBefore = hash(PROJECT_CANONICAL);
    const stateDir = mkdtempSync(join(tmpdir(), 'wb-reasonix-prototype-'));
    const screenshotDir = join(process.cwd(), 'screenshots', 'reasonix-harness-prototype');
    mkdirSync(screenshotDir, { recursive: true });

    const { app, win } = await launchWorkbench(stateDir, OVERLAY);

    await expect(win.locator('.session-welcome h1')).toContainText('Start from a session');
    await expect(win.locator('.inspector-pane')).toHaveCount(0);

    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    const projectOption = win.locator('.project-switcher option').filter({ hasText: FIXTURE_PROJECT_DISPLAY_NAME });
    const projectValue = await projectOption.getAttribute('value');
    expect(projectValue).toBeTruthy();
    await win.locator('.project-switcher select').selectOption(projectValue!);
    await expect(win.locator('.sidebar-conversations button').first()).toBeVisible();
    await win.locator('.sidebar-conversations button').first().click();

    await expect(win.locator('.session-header h1')).toBeVisible();
    await expect(win.locator('.session-composer textarea')).toBeEnabled();
    // Composer is a real dispatch entry point: agent selector + enabled Send.
    await expect(win.locator('.composer-agent')).toBeVisible();
    await expect(win.getByRole('button', { name: /Send to/ })).toBeEnabled();
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
