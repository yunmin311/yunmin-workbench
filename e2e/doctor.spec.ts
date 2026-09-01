import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('Doctor is bounded, read-only, honest, and available on demand', async () => {
  const canonicalBefore = hash(overlay.projectCanonicalPath);
  const { app, win } = await launchWorkbench(mkdtempSync(join(tmpdir(), 'wb-doctor-e2e-')), overlay.overlayRoot);
  try {
    await win.getByRole('button', { name: 'Open command palette' }).click();
    await win.getByText('Workbench Doctor', { exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'Workbench Doctor diagnostics' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.doctor-check')).toHaveCount(15);
    await expect(dialog.getByText('DeepSeek executable and capability')).toBeVisible();
    await expect(dialog.getByText('Read-only · bounded · on demand')).toBeVisible();
    const statuses = await dialog.locator('.doctor-status').allTextContents();
    expect(statuses.every((status) => ['PASS', 'WARN', 'FAIL', 'UNKNOWN'].includes(status))).toBe(true);
    expect(hash(overlay.projectCanonicalPath)).toBe(canonicalBefore);
  } finally {
    await app.close();
  }
});
