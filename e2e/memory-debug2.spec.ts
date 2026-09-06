import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

test('DEBUG memory restore full flow', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wb-memory-debug2-'));
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
  const env = { WB_CLAUDE_HISTORY_ROOT: claudeRoot, WB_CODEX_HISTORY_ROOT: codexRoot, WB_CODEX_ARCHIVED_HISTORY_ROOT: archiveRoot };
  let launched = await launchWorkbench(stateDir, overlay.overlayRoot, env);
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
  await memory.getByRole('button', { name: 'Add to Context' }).click();
  await memory.getByRole('button', { name: 'Inspect Source' }).click();
  const history = win.getByRole('dialog', { name: 'Read-only History search' });
  await expect(history.locator('.history-detail')).toContainText('[memory fact] The cobalt release requires explicit approval');
  await history.getByRole('button', { name: 'Close History' }).click();
  await win.keyboard.press('Control+3');
  const stagedMemory = win.locator('.context-item', { hasText: 'Memory: The cobalt release requires explicit approval' });
  await expect(stagedMemory).toContainText('included');
  await stagedMemory.locator('button.pin').click();
  await expect(stagedMemory.locator('button.pin')).toHaveClass(/on/);
  await win.keyboard.press('Control+4');
  await expect(win.locator('.inspector-pane .validity-current')).toBeVisible();
  await win.waitForTimeout(1500);
  await launched.app.close();

  launched = await launchWorkbench(stateDir, overlay.overlayRoot, env);
  const resumed = launched.win;
  resumed.on('console', (message) => {
    if (message.text().includes('[dbg]')) console.log('DBG', message.text());
  });
  await expect(resumed.locator('.session-header')).toBeVisible({ timeout: 30_000 });
  await resumed.waitForTimeout(4000);
  const dbg = await resumed.evaluate(() => JSON.stringify((window as unknown as { __wbDbg?: unknown[] }).__wbDbg ?? []));
  console.log('WBDBG', dbg);
  await resumed.keyboard.press('Control+3');
  const items = await resumed.locator('.context-item').allInnerTexts();
  console.log('CONTEXT-ITEMS-COUNT', items.length);
  console.log('HAS-COBALT', items.some((t) => t.includes('cobalt')));
  const texts = await resumed.locator('.context-item').allTextContents();
  console.log('TEXTCONTENT-HAS-COBALT', texts.some((t) => t.includes('cobalt')), JSON.stringify(texts.find((t) => t.includes('cobalt'))?.slice(0, 120) ?? null));

  console.log('ITEM-HTML', await resumed.locator('.context-item').first().evaluate((el) => el.outerHTML.slice(0, 400)).catch((e) => String(e)));
  console.log('PANE-HEAD', await resumed.locator('.inspector-pane h2').allInnerTexts().catch(() => []));
  const dumpDir = (dir: string, depth: number) => {
    if (!existsSync(dir) || depth > 3) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) dumpDir(full, depth + 1);
      else {
        const text = readFileSync(full, 'utf8');
        if (text.includes('memory-projection') || text.includes('cobalt')) {
          console.log('DRAFT-HIT', full.replace(stateDir, ''), text.includes('memory-projection'), text.includes('cobalt'));
        }
      }
    }
  };
  dumpDir(join(stateDir, 'state'), 0);
  console.log('DRAFT-SCAN-DONE');
  const draftFiles2: string[] = [];
  const collect = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else draftFiles2.push(full);
    }
  };
  collect(join(stateDir, 'state', 'drafts'));
  const draftText = draftFiles2.map((f) => readFileSync(f, 'utf8')).find((t) => t.includes('memory-projection')) ?? '';
  const draft = JSON.parse(draftText);
  const memDecisions = draft.projectedDecisions.filter((d: { itemId: string }) => d.itemId.startsWith('memory-projection:'));
  console.log('MEM-DECISIONS', JSON.stringify(memDecisions));
  for (const d of memDecisions) {
    const memoryId = d.itemId.slice('memory-projection:'.length);
    const expanded = await resumed.evaluate(async (id) => {
      const wb = (window as unknown as { wb: { expandMemory: (id: string) => Promise<unknown> } }).wb;
      return JSON.stringify(await wb.expandMemory(id));
    }, memoryId);
    const expandedObj = JSON.parse(expanded ?? '{}') as { evidence?: { verdict?: string }, record?: { sourceRefs?: string[] } };
    console.log('VERDICT', expandedObj.evidence?.verdict, 'SOURCEREFS', JSON.stringify(expandedObj.record?.sourceRefs));
    const recheck = await resumed.evaluate(async (refs) => {
      const wb = (window as unknown as { wb: { recheckSources: (p: string, refs: string[]) => Promise<unknown> } }).wb;
      return JSON.stringify(await wb.recheckSources('creative-os', refs));
    }, expandedObj.record?.sourceRefs ?? []);
    console.log('RECHECK', recheck.slice(0, 400));
  }
  const msg = await resumed.locator('.context-message').allInnerTexts().catch(() => []);
  console.log('CONTEXT-MESSAGE', JSON.stringify(msg));
  const draftsDir = join(stateDir, 'state', 'drafts', 'v1');
  console.log('DRAFT-FILES', existsSync(draftsDir) ? readdirSync(draftsDir) : 'none');
  await launched.app.close();
  expect(true).toBe(true);
});
