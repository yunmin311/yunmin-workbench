import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const jsonl = (value: unknown) => `${JSON.stringify(value)}\n`;

test('Command Palette opens read-only History search and a provenance-backed detail', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wb-history-e2e-'));
  const stateDir = join(temp, 'user-data');
  const claudeRoot = join(temp, 'claude-projects');
  const codexRoot = join(temp, 'codex-sessions');
  const codexArchive = join(temp, 'codex-archive');
  mkdirSync(join(claudeRoot, 'encoded-project'), { recursive: true });
  mkdirSync(join(codexRoot, '2026', '08', '30'), { recursive: true });
  mkdirSync(codexArchive, { recursive: true });
  const claudeFile = join(claudeRoot, 'encoded-project', 'session.jsonl');
  const badFile = join(claudeRoot, 'encoded-project', 'bad.jsonl');
  const codexFile = join(codexRoot, '2026', '08', '30', 'rollout.jsonl');
  writeFileSync(claudeFile,
    jsonl({ type: 'user', sessionId: 'claude-e2e', cwd: 'E:\\project', timestamp: '2026-08-30T10:00:00Z', message: { role: 'user', content: 'cobalt history query' } }) +
    jsonl({ type: 'assistant', sessionId: 'claude-e2e', timestamp: '2026-08-30T10:01:00Z', message: { role: 'assistant', content: 'history detail body' } }),
  );
  writeFileSync(badFile, '{bad-json\n' + jsonl({ type: 'user', sessionId: 'claude-neighbor', message: { role: 'user', content: 'valid neighbor survives' } }));
  writeFileSync(codexFile,
    jsonl({ timestamp: '2026-08-30T11:00:00Z', type: 'session_meta', payload: { id: 'codex-e2e', cwd: 'E:\\project' } }) +
    jsonl({ timestamp: '2026-08-30T11:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'cobalt codex record' }] } }),
  );
  const before = [hash(claudeFile), hash(badFile), hash(codexFile)];

  const launched = await launchWorkbench(stateDir, overlay.overlayRoot, {
    WB_CLAUDE_HISTORY_ROOT: claudeRoot,
    WB_CODEX_HISTORY_ROOT: codexRoot,
    WB_CODEX_ARCHIVED_HISTORY_ROOT: codexArchive,
  });
  try {
    const { win } = launched;
    await win.keyboard.press('Control+K');
    await win.locator('[cmdk-input]').fill('History');
    await win.locator('[cmdk-item]', { hasText: 'Search History' }).click();
    const panel = win.getByRole('dialog', { name: 'Read-only History search' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('does not mean current Context, agent-read, or Runtime active');
    await panel.getByRole('searchbox').fill('cobalt');
    await panel.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(panel.locator('.history-hit')).toHaveCount(2);
    await expect(panel).toContainText('1 parser problem');
    await panel.locator('.history-hit', { hasText: 'claude-code' }).click();
    await expect(panel.locator('.history-detail')).toContainText('history detail body');
    await expect(panel.locator('.history-detail')).toContainText('history:claude-code:');
    expect(readFileSync(join(stateDir, 'state', 'history', 'index-v1.json'), 'utf8')).toContain('claude-e2e');
  } finally {
    await launched.app.close();
  }
  expect([hash(claudeFile), hash(badFile), hash(codexFile)]).toEqual(before);
});
