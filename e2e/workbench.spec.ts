import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron as electron, expect, test } from '@playwright/test';

const OVERLAY = 'D:\\ai-governance-system';
const PROJECT_CANONICAL = 'D:\\project\\CLAUDE.md';
const hasOverlay = existsSync(join(OVERLAY, 'overlay.yaml'));
const hasCodex = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

test.describe('Yunmin Workbench vertical slice (real overlay, read-only)', () => {
  test.skip(!hasOverlay, 'real overlay not present on this machine');

  test('Projects -> Control Room -> Canvas -> Context Staging -> Packet Freeze', async () => {
    // evidence for "UI never writes back into the overlay"
    const inboxBefore = hash(join(OVERLAY, 'INBOX.md'));
    const memoryBefore = hash(join(OVERLAY, 'memory', 'MEMORY.md'));
    const projectCanonicalBefore = hash(PROJECT_CANONICAL);

    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-'));
    let app = await electron.launch({
      args: ['out/main/index.js'],
      env: { ...process.env, WB_STATE_DIR: stateDir },
    });
    const win = await app.firstWindow();
    const screenshotDir = join(process.cwd(), 'screenshots', 'harness-grade-productization-20260826');
    mkdirSync(screenshotDir, { recursive: true });

    // Projects
    await expect(win.locator('.brand')).toHaveText('Yunmin Workbench');
    await win.screenshot({ path: join(screenshotDir, '01-projects.png') });
    await win.keyboard.press('Control+K');
    const commandInput = win.locator('[cmdk-input]');
    await expect(commandInput).toBeFocused();
    await commandInput.fill('Open Project Creative OS');
    await expect(win.locator('[cmdk-item]', { hasText: 'Open Project · Creative OS' })).toBeVisible();
    await win.keyboard.press('Escape');
    const card = win.locator('.project-card', { hasText: 'Creative OS' });
    await expect(card).toBeVisible();
    await expect(card.locator('.source-summary')).toBeVisible();
    await card.click();

    // Control Room shows real registry data
    await expect(win.locator('h2', { hasText: 'Creative OS' })).toBeVisible();
    await expect(win.locator('.convo').first()).toBeVisible();
    await expect(win.locator('.binding-summary')).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '02-control-room.png') });

    // Canvas: projection nodes, click a conversation -> Context
    await win.locator('nav button', { hasText: 'Canvas' }).click();
    await expect(win.locator('.wb-project')).toBeVisible();
    await expect(win.locator('.canvas-hint')).toHaveCount(0);
    const convoNode = win.locator('.wb-conversation').first();
    await expect(convoNode).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '03-canvas.png') });
    await convoNode.click();

    // Context Staging: toggle one available item to included
    await expect(win.locator('h2', { hasText: 'Context Staging' })).toBeVisible();
    const governanceContext = win.locator('details.governance-context');
    await expect(governanceContext).toBeVisible();
    await expect(governanceContext).not.toHaveAttribute('open', '');
    await win.screenshot({ path: join(screenshotDir, '04-context-staging.png') });
    await win.locator('button', { hasText: '+ Manual Context' }).click();
    await win.locator('.manual-context-form input').fill('E2E user context');
    await win.locator('.manual-context-form textarea').fill('User supplied text that must reach the Harness.');
    await win.locator('.manual-context-form button', { hasText: 'Add to Included' }).click();
    const availableBtn = win.locator('button.state-available').first();
    await availableBtn.click();
    await expect(win.locator('.state-included').first()).toBeVisible();

    // Packet: fill summary, freeze
    await win.keyboard.press('Control+5');
    await expect(win.locator('h2', { hasText: 'Task Packet' })).toBeVisible();
    await win.locator('textarea').fill('E2E 冒烟：验证 Freeze 链路');
    await expect(win.locator('.validity-current')).toBeVisible();
    if (hasCodex) {
      await expect(win.locator('button', { hasText: 'Send to Codex' })).toBeEnabled();
    } else {
      await expect(win.locator('button', { hasText: 'Send to Codex' })).toBeDisabled();
    }
    await win.screenshot({ path: join(screenshotDir, '05-packet-preview.png') });
    const previewText = await win.locator('.agent-input-text').textContent();
    await win.locator('button', { hasText: 'Copy Agent Input' }).click();
    const copiedText = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copiedText).toBe(previewText);
    expect(copiedText).toContain('E2E user context [USER PROVIDED]');
    await win.locator('button.primary', { hasText: 'Freeze Current Task Packet' }).click();
    await expect(win.locator('p.ok')).toContainText('v1');

    // frozen packet file exists in Workbench-owned state dir
    const packetsDir = join(stateDir, 'state', 'frozen-packets');
    const files = readdirSync(packetsDir, { recursive: true }).filter((f) => String(f).endsWith('.json'));
    expect(files.length).toBe(1);
    const frozen = JSON.parse(readFileSync(join(packetsDir, String(files[0])), 'utf8'));
    expect(frozen.version).toBe(1);
    expect(frozen.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(frozen.taskSummary).toBe('E2E 冒烟：验证 Freeze 链路');
    expect(frozen.included.some((item: { provenance?: string }) => item.provenance === 'USER PROVIDED')).toBe(true);

    // Debounced Workbench-owned draft survives a full application restart.
    await win.waitForTimeout(700);
    await expect(win.locator('.workspace-status')).toContainText('Draft saved');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 740 }));
    await win.waitForTimeout(500);
    await app.close();
    app = await electron.launch({
      args: ['out/main/index.js'],
      env: { ...process.env, WB_STATE_DIR: stateDir },
    });
    const resumed = await app.firstWindow();
    await expect(resumed.locator('.brand')).toHaveText('Yunmin Workbench');
    const resumedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    expect(resumedBounds.width).toBe(1100);
    expect(resumedBounds.height).toBe(740);
    // Workspace continuity restores the exact project/conversation/view after fresh truth loads.
    await expect(resumed.locator('textarea')).toHaveValue('E2E 冒烟：验证 Freeze 链路');
    await expect(resumed.locator('li', { hasText: 'v1' })).toBeVisible();
    await resumed.locator('button.refresh').click();
    await expect(resumed.locator('.validity-current').first()).toBeVisible();
    const resumedPreview = await resumed.locator('.agent-input-text').textContent();
    await resumed.locator('button', { hasText: 'Copy Agent Input' }).click();
    const resumedCopy = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(resumedCopy).toBe(resumedPreview);
    expect(resumedCopy).toContain('User supplied text that must reach the Harness.');

    await app.close();

    // overlay canonical files untouched by the whole UI session
    expect(hash(join(OVERLAY, 'INBOX.md'))).toBe(inboxBefore);
    expect(hash(join(OVERLAY, 'memory', 'MEMORY.md'))).toBe(memoryBefore);
    expect(hash(PROJECT_CANONICAL)).toBe(projectCanonicalBefore);
  });
});
