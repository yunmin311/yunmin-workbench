import { expect, type Page } from '@playwright/test';

/**
 * Selector/flow bridge for the Reasonix prototype shell: session picker
 * (workspace trigger -> project switcher -> first conversation) plus the
 * chrome inspector trigger for the Packet tab. Behavioral assertions stay in
 * the specs; only the shell plumbing lives here.
 */
export async function openSessionPacket(win: Page, projectName: string): Promise<void> {
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  const projectOption = win.locator('.project-switcher option').filter({ hasText: projectName });
  const projectValue = await projectOption.getAttribute('value');
  await win.locator('.project-switcher select').selectOption(projectValue!);
  await win.locator('.sidebar-conversations button').first().click();
  await win.getByRole('button', { name: 'Packet', exact: true }).click();
  await expect(win.locator('.inspector-pane h2', { hasText: 'Task Packet' })).toBeVisible();
}
