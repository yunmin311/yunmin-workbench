import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const enabled = process.env.WB_REAL_RUNTIME_SMOKE === '1';
const overlay = useOverlayFixture();
const conversationKey = 'creative-os::claude::CO 主对话';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function externalSourceState() {
  return {
    canonical: hash(overlay.projectCanonicalPath),
    inbox: hash(join(overlay.overlayRoot, 'INBOX.md')),
    memory: hash(join(overlay.overlayRoot, 'memory', 'MEMORY.md')),
  };
}

function claudeState(): Map<string, string> {
  const home = process.env.USERPROFILE ?? '';
  const roots = [join(home, '.claude.json'), join(home, '.claude', 'settings.json'), join(home, '.claude', 'history.jsonl')];
  const projects = join(home, '.claude', 'projects');
  const walk = (root: string): string[] => {
    if (!existsSync(root)) return [];
    if (statSync(root).isFile()) return [root];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => walk(join(root, entry.name)));
  };
  return new Map([...roots.flatMap(walk), ...walk(projects)].sort().map((path) => [path, `${statSync(path).size}:${hash(path)}`]));
}

function codexHistoryFiles(): string[] {
  const sessions = join(process.env.USERPROFILE ?? '', '.codex', 'sessions');
  const walk = (root: string): string[] => {
    if (!existsSync(root)) return [];
    if (statSync(root).isFile()) return [root];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => walk(join(root, entry.name)));
  };
  // This test itself runs inside an active Codex task whose own JSONL can grow
  // concurrently. An ephemeral dispatch must not create a new session file.
  return walk(sessions).sort();
}

async function selectFixtureSession(win: import('@playwright/test').Page) {
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  const option = win.locator('.project-switcher option').filter({ hasText: 'Creative OS' });
  await win.locator('.project-switcher select').selectOption((await option.getAttribute('value'))!);
  await win.locator('.sidebar-conversations button', { hasText: 'CO 主对话' }).click();
}

test.describe('real Runtime adapter → Activity → Inspector smoke', () => {
  test.skip(!enabled, 'set WB_REAL_RUNTIME_SMOKE=1 to call real Codex and Claude adapters');
  test('Codex returns native identity, completes Activity, and projects the exact Inspector execution', async () => {
    test.setTimeout(180_000);
    const sourcesBefore = externalSourceState();
    const historyBefore = codexHistoryFiles();
    const { app, win } = await launchWorkbench(
      mkdtempSync(join(tmpdir(), 'wb-real-codex-')),
      overlay.overlayRoot,
      { WB_CODEX_EPHEMERAL_DISPATCH: '1' },
    );
    try {
      const receipt = await win.evaluate(async ({ intentId, conversation }) => window.wb.dispatchToHarness({
        intentId,
        groupId: crypto.randomUUID(),
        projectId: 'creative-os',
        conversationKey: conversation,
        harness: 'codex',
        environment: { kind: 'real' },
        packetText: 'Reply with exactly: YUNMIN_CODEX_RUNTIME_SMOKE_OK. Do not use tools or modify files.',
      }), { intentId: randomUUID(), conversation: conversationKey });
      expect(receipt).toMatchObject({ harness: 'codex', status: 'ACCEPTED', source: 'protocol' });
      expect(receipt.runtimeRef).toMatch(/^[0-9a-f-]{36}$/i);
      await selectFixtureSession(win);
      await expect(win.locator('.activity-kind-handoff-accepted')).toBeVisible();
      await expect(win.locator('.activity-kind-turn-completed')).toBeVisible({ timeout: 120_000 });
      await win.getByTestId('session-runtime-badge').click();
      await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', `codex::${receipt.runtimeRef}`);
      await expect(win.getByTestId('runtime-detail')).toContainText('Receipt accepted');
      await expect(win.getByTestId('runtime-detail')).toContainText('Turn completed');
      await expect(win.getByRole('button', { name: 'Attention, 0 active items' })).toBeVisible();
    } finally {
      await app.close();
    }
    expect(externalSourceState()).toEqual(sourcesBefore);
    expect(codexHistoryFiles()).toEqual(historyBefore);
  });

  test('real Session Composer sends to Claude and renders native result/tool/receipt Activity', async () => {
    test.setTimeout(180_000);
    const sourcesBefore = externalSourceState();
    const claudeBefore = claudeState();
    const { app, win } = await launchWorkbench(mkdtempSync(join(tmpdir(), 'wb-real-claude-')), overlay.overlayRoot);
    try {
      await selectFixtureSession(win);
      await win.locator('.agent-selector').click();
      await win.getByRole('menuitemcheckbox', { name: /claude/i }).click();
      await win.getByRole('menuitemcheckbox', { name: /codex/i }).click();
      await win.getByRole('textbox', { name: 'Task for Agent' }).fill('Use the Bash tool once to run pwd (read-only), then reply exactly: YUNMIN_CLAUDE_RUNTIME_SMOKE_OK. Do not modify files.');
      await win.getByRole('button', { name: 'Send to claude' }).click();
      await expect(win.locator('.activity-kind-handoff-accepted')).toBeVisible();
      await expect(win.locator('.activity-kind-tool-started')).toBeVisible();
      await expect(win.locator('.activity-kind-tool-completed')).toBeVisible();
      await expect(win.locator('.activity-kind-agent-response')).toContainText('YUNMIN_CLAUDE_RUNTIME_SMOKE_OK');
      await win.getByTestId('session-runtime-badge').click();
      await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', /^claude::[0-9a-f-]{36}$/i);
      await expect(win.getByTestId('runtime-detail')).toContainText('Assistant result');
      await expect(win.getByTestId('runtime-detail')).toContainText('Receipt accepted');
    } finally {
      await app.close();
    }
    expect(externalSourceState()).toEqual(sourcesBefore);
    expect(claudeState()).toEqual(claudeBefore);
  });

  test('Claude Cancel crosses live IPC, stops the real child, and does not create Attention', async () => {
    test.setTimeout(180_000);
    const sourcesBefore = externalSourceState();
    const claudeBefore = claudeState();
    const { app, win } = await launchWorkbench(mkdtempSync(join(tmpdir(), 'wb-real-claude-cancel-')), overlay.overlayRoot);
    try {
      await selectFixtureSession(win);
      await win.evaluate(({ intentId, conversation }) => {
        (window as typeof window & { __runtimeCancelReceipt?: Promise<unknown> }).__runtimeCancelReceipt = window.wb.dispatchToHarness({
          intentId,
          groupId: crypto.randomUUID(),
          projectId: 'creative-os',
          conversationKey: conversation,
          harness: 'claude',
          environment: { kind: 'real' },
          packetText: 'Use the Bash tool exactly once to run: sleep 30. Do not modify files. After it finishes, reply with CANCEL_MISSED.',
        });
      }, { intentId: randomUUID(), conversation: conversationKey });
      await expect(win.getByTestId('session-runtime-badge')).toContainText('claude', { timeout: 60_000 });
      await win.getByTestId('session-runtime-badge').click();
      await expect(win.getByTestId('runtime-cancel')).toBeEnabled();
      await win.getByTestId('runtime-cancel').click();
      await expect(win.locator('.runtime-cancel-message')).toContainText('delivered');
      const receipt = await win.evaluate(async () =>
        (window as typeof window & { __runtimeCancelReceipt?: Promise<unknown> }).__runtimeCancelReceipt);
      expect(receipt).toMatchObject({
        harness: 'claude', status: 'CANCELLED', source: 'process', protocolEvidence: 'Claude dispatch cancelled',
      });
      await expect(win.getByRole('button', { name: 'Attention, 0 active items' })).toBeVisible();
      await expect(win.getByTestId('runtime-detail')).toContainText('stopped · historical');
      await expect(win.getByTestId('runtime-detail')).toContainText('intent CANCELLED');
      await expect(win.getByTestId('runtime-detail')).toContainText('Process cancelled');
      await expect(win.getByTestId('runtime-cancel')).toBeDisabled();
    } finally {
      await app.close();
    }
    expect(externalSourceState()).toEqual(sourcesBefore);
    expect(claudeState()).toEqual(claudeBefore);
  });
});
