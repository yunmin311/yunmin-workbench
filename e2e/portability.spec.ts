import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildProfileBundle } from '../src/core/portability/bundle';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('Command Palette previews import before writing and keeps external truth read-only', async () => {
  const overlay = useOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-portability-e2e-'));
  const bundlePath = join(mkdtempSync(join(tmpdir(), 'wb-portability-bundle-')), 'profile.json');
  const bundle = buildProfileBundle({
    createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: null, drafts: [],
    projectRoots: { 'creative-os': 'D:\\retired\\creative-os' },
  });
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
  const overlayFile = join(overlay.overlayRoot, 'INBOX.md');
  const before = hash(overlayFile);
  const launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  await launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, bundlePath);

  await launched.win.keyboard.press('Control+K');
  await launched.win.locator('[cmdk-input]').fill('Profile Portability');
  await launched.win.locator('[cmdk-item]', { hasText: 'Profile Portability' }).click();
  const panel = launched.win.getByRole('dialog', { name: 'Workbench profile portability' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Import Profile…' }).click();
  await expect(panel.getByLabel('Profile import preview')).toContainText('CONFLICT');
  const bindingFile = join(stateDir, 'state', 'portability', 'project-root-bindings-v1.json');
  expect(existsSync(bindingFile)).toBe(false);

  await expect(panel.getByRole('button', { name: 'Apply Import' })).toBeDisabled();
  await expect(panel).toContainText('Nothing has been written');
  expect(existsSync(bindingFile)).toBe(false);
  expect(hash(overlayFile)).toBe(before);
  await launched.app.close();
});

test('successful import reloads and restores Manual Context without touching external files', async () => {
  const overlay = useOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-portability-restore-'));
  const bundlePath = join(mkdtempSync(join(tmpdir(), 'wb-portability-restore-bundle-')), 'profile.json');
  const bundle = buildProfileBundle({
    createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: null, projectRoots: {},
    drafts: [{
      schemaVersion: 1,
      scope: { kind: 'migration-conversation-key', projectId: 'creative-os', conversationKey: 'creative-os::claude::CO 主对话' },
      taskSummary: 'restored portable summary',
      manualContexts: [{
        id: 'manual:portable-e2e', title: 'Portable decision', body: 'Restored Workbench-owned Manual Context',
        provenance: 'USER PROVIDED', state: 'included', pinned: false, order: 0,
      }],
      projectFiles: [], projectedDecisions: [],
    }],
  });
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
  const externalFile = join(overlay.overlayRoot, 'memory', 'MEMORY.md');
  const before = hash(externalFile);
  const launched = await launchWorkbench(stateDir, overlay.overlayRoot);
  await launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, bundlePath);
  await launched.win.keyboard.press('Control+K');
  await launched.win.locator('[cmdk-input]').fill('Profile Portability');
  await launched.win.locator('[cmdk-item]', { hasText: 'Profile Portability' }).click();
  const panel = launched.win.getByRole('dialog', { name: 'Workbench profile portability' });
  await panel.getByRole('button', { name: 'Import Profile…' }).click();
  await expect(panel.getByLabel('Profile import preview')).toContainText('Will add');
  await panel.getByRole('button', { name: 'Apply Import' }).click();
  await expect(panel).toHaveCount(0);
  await expect(launched.win.locator('.prototype-chrome')).toBeVisible();

  await launched.win.keyboard.press('Control+K');
  await launched.win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
  await launched.win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
  await launched.win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  await launched.win.locator('.sidebar-conversations button', { hasText: 'CO 主对话' }).click();
  await launched.win.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(launched.win.locator('.inspector-pane')).toContainText('Portable decision');
  await launched.win.locator('.context-item .item-title', { hasText: 'Portable decision' }).click();
  await expect(launched.win.locator('.inspector-pane')).toContainText('Restored Workbench-owned Manual Context');
  expect(hash(externalFile)).toBe(before);
  await launched.app.close();
});
