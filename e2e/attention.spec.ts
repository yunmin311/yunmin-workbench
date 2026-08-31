import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('Attention stays local, opens the exact Session, and restores dismissal after restart', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-attention-e2e-'));
  const activityPath = join(stateDir, 'state', 'activity', 'history.jsonl');
  mkdirSync(join(stateDir, 'state', 'activity'), { recursive: true });
  const event = {
    id: 'approval-event-1',
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::CO 主对话',
    kind: 'approval-required',
    summary: 'Approve the reviewed release action',
    runtimeRef: 'session-explicit-1',
    attentionKey: 'approval:release-1',
    observed: {
      source: 'protocol', sourceRef: 'protocol:approval:release-1',
      observedAt: '2026-08-30T18:00:00.000Z', verification: 'OBSERVED',
    },
  };
  writeFileSync(activityPath, `${JSON.stringify({ schemaVersion: 1, event })}\n`);
  const activityBefore = hash(activityPath);
  const overlayBefore = hash(overlay.projectCanonicalPath);

  let launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  await expect(launched.win.getByRole('button', { name: 'Attention, 1 active item' })).toBeVisible();
  await launched.win.getByRole('button', { name: 'Attention, 1 active item' }).click();
  const panel = launched.win.getByRole('dialog', { name: 'Attention requiring review' });
  await expect(panel).toContainText('Approve the reviewed release action');
  await expect(panel).toContainText('protocol:approval:release-1');

  await panel.locator('.attention-item-main').click();
  await expect(launched.win.locator('.session-surface')).toContainText('CO 主对话');
  await expect(launched.win.locator('[data-event-ref="approval-event-1"]')).toHaveClass(/attention-source-focus/);
  await launched.win.getByRole('button', { name: 'Attention, 1 active item' }).click();
  await launched.win.getByRole('dialog', { name: 'Attention requiring review' })
    .getByRole('button', { name: 'Dismiss this observation' }).click();
  await expect(launched.win.getByRole('button', { name: 'Attention, 0 active items' })).toBeVisible();
  expect(hash(activityPath)).toBe(activityBefore);
  expect(hash(overlay.projectCanonicalPath)).toBe(overlayBefore);
  await launched.app.close();

  launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  await expect(launched.win.getByRole('button', { name: 'Attention, 0 active items' })).toBeVisible();
  await launched.win.getByRole('button', { name: 'Attention, 0 active items' }).click();
  await expect(launched.win.getByRole('dialog', { name: 'Attention requiring review' })).toContainText('Nothing needs review right now');
  expect(hash(activityPath)).toBe(activityBefore);
  expect(hash(overlay.projectCanonicalPath)).toBe(overlayBefore);
  await launched.app.close();
});
