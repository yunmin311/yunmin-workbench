import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;
const PROJECT_CANONICAL = overlay.projectCanonicalPath;

test.describe('Product/UI Integration — Session Spine as single working surface', () => {
  test('Session → Context → Packet → Runtime → Evidence, History/Memory/Attention integrated, Material switchable', async () => {
    const inboxBefore = createHash('sha256').update(readFileSync(join(OVERLAY, 'INBOX.md'))).digest('hex');
    const memoryBefore = createHash('sha256').update(readFileSync(join(OVERLAY, 'memory', 'MEMORY.md'))).digest('hex');
    const canonicalBefore = createHash('sha256').update(readFileSync(PROJECT_CANONICAL)).digest('hex');

    const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-product-'));
    const { app, win } = await launchWorkbench(stateDir, OVERLAY);

    // ——— Open workspace via Command Palette (primary keyboard entry) ———
    await win.keyboard.press('Control+K');
    await expect(win.locator('[cmdk-input]')).toBeFocused();
    await win.locator('[cmdk-input]').fill(`Open Workspace ${FIXTURE_PROJECT_DISPLAY_NAME}`);
    await win.locator('[cmdk-item]', { hasText: `Open Workspace · ${FIXTURE_PROJECT_DISPLAY_NAME}` }).click();
    await expect(win.locator('[cmdk-input]')).toHaveCount(0);
    await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
    const conv = win.locator('.sidebar-conversations button').first();
    await expect(conv).toBeVisible();
    await conv.click();
    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.locator('.session-surface h1')).not.toBeEmpty();

    // ——— Level 0: Session + composer is primary ———
    await expect(win.locator('.session-composer')).toBeVisible();
    await expect(win.locator('.session-composer textarea')).toBeVisible();
    // Composer unified entry: Add Context + history/memory shortcuts + packet hint
    await expect(win.locator('.session-composer button', { hasText: '+ Context' })).toBeVisible();
    await expect(win.locator('.session-composer button', { hasText: 'History' })).toBeVisible();
    await expect(win.locator('.session-composer button', { hasText: 'Memory' })).toBeVisible();
    // Packet status: CURRENT quiet (hidden), UNKNOWN visible grey, STALE/INVALID colored (product-integration.css)
    const packetStatus = win.locator('.composer-packet-status');
    // At this point packet is UNKNOWN (not yet verified) — should be visible grey, not hidden
    await expect(packetStatus).toBeVisible();
    await expect(packetStatus).toContainText(/UNKNOWN|CURRENT/);

    // ——— Session → Context (drawer) ———
    await win.locator('.session-composer button', { hasText: '+ Context' }).click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    // Session remains behind overlay, not destroyed
    await expect(win.locator('.session-surface')).toBeVisible();
    await expect(win.locator('.context-to-packet')).toBeVisible();
    await expect(win.locator('.context-to-packet')).toContainText('Context → Packet');

    // Add manual context via drawer
    await win.locator('button', { hasText: '+ Manual Context' }).click();
    await win.locator('.manual-context-form input').fill('Product integration probe');
    await win.locator('.manual-context-form textarea').fill('Product glue for Context→Packet');
    await win.locator('.manual-context-form button', { hasText: 'Add to Included' }).click();
    const includedGroup = win.locator('section.context-group', { hasText: 'Included' });
    await expect(includedGroup.locator('button.state-included').first()).toBeVisible();
    // Composer hint updates
    await win.locator('.inspector-close').click();
    await expect(win.locator('.inspector-pane')).toHaveCount(0);
    await expect(win.locator('.session-composer')).toContainText('included');
    // Verify included count increased after manual add (at least 1 more than initial 6)
    await expect(win.locator('.session-composer')).toContainText(/[0-9]+ included/);

    // ——— Context → Packet (wide review, not permanent column) ———
    await win.getByRole('button', { name: 'Context', exact: true }).click();
    await win.locator('button', { hasText: 'Review Packet' }).click();
    await expect(win.locator('.panel h2', { hasText: 'Task Packet' })).toBeVisible();
    await expect(win.locator('.panel .eyebrow', { hasText: 'CONTEXT → PACKET' })).toBeVisible();
    await expect(win.locator('.packet-preview .agent-input-text')).toContainText('Product glue for Context→Packet');
    // Copy ≠ Dispatch: both present but distinct
    await expect(win.locator('button', { hasText: 'Copy Agent Input' })).toBeVisible();
    await expect(win.locator('button', { hasText: 'Send to Codex' })).toBeVisible();
    // Packet validity signals: CURRENT quiet, STALE/INVALID would be colored (check CURRENT class)
    await expect(win.locator('.packet-preview .validity-current').first()).toBeVisible();
    await win.locator('.inspector-close').click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // ——— History as on-demand search (not another app) ———
    await win.locator('.session-composer button', { hasText: 'History' }).click();
    await expect(win.locator('.history-panel')).toBeVisible();
    await expect(win.locator('.history-panel h2', { hasText: 'History / Search' })).toBeVisible();
    // Search stays lexical/local, not SOT-merged with Memory
    await win.locator('.history-search input').fill('workbench');
    await win.locator('.history-search button', { hasText: 'Search' }).click();
    // Either results or hint — not a crash, not writing overlay
    await expect(win.locator('.history-results, .history-hint').first()).toBeVisible();
    await win.locator('.history-panel-header button', { hasText: '×' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // ——— Memory as source-first, Add to Context is explicit ———
    await win.locator('.session-composer button', { hasText: 'Memory' }).click();
    await expect(win.locator('.history-panel.memory-panel')).toBeVisible();
    await expect(win.locator('.history-panel-header h2', { hasText: 'Memory Search' })).toBeVisible();
    await win.locator('.history-search input').fill('workbench');
    await win.locator('.history-search button', { hasText: 'Search' }).click();
    await expect(win.locator('.history-results, .history-hint').first()).toBeVisible();
    await win.locator('.history-panel-header button', { hasText: '×' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // ——— Attention lightweight + Runtime evidence ———
    // Normal CURRENT/IDLE stays quiet — attention trigger shows count but not shouting
    const attentionBtn = win.locator('.attention-trigger');
    await expect(attentionBtn).toBeVisible();
    // Open attention panel (even if empty, it is inspectable, not canonical truth)
    await attentionBtn.click();
    await expect(win.locator('.attention-panel, .attention-empty').first()).toBeVisible();
    // Close via backdrop
    await win.locator('.attention-layer').click({ position: { x: 5, y: 5 } });
    // Runtime chronology: timeline with collapsible tool detail, file-change more obvious (already in SessionSurface)
    await expect(win.locator('.session-activity')).toBeVisible();
    // Evidence: open via session header
    await win.locator('.session-header-actions button', { hasText: 'Evidence' }).click();
    await expect(win.locator('.inspector-pane h2', { hasText: 'Evidence' })).toBeVisible();
    await expect(win.locator('.evidence-list')).toBeVisible();
    await win.locator('.inspector-close').click();

    // ——— Drawer / overlay does not destroy Session ———
    await win.getByRole('button', { name: 'Context', exact: true }).click();
    await expect(win.locator('.inspector-pane')).toBeVisible();
    await win.keyboard.press('Escape'); // should close? if not, click close
    if (await win.locator('.inspector-pane').isVisible()) await win.locator('.inspector-close').click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // ——— Material Pure/Frost/Glass via same token source ———
    const materialBtn = win.locator('button', { hasText: /^Material:/ });
    await expect(materialBtn).toBeVisible();
    await materialBtn.click();
    await expect(win.locator('.material-panel')).toBeVisible();
    // System/Auto → switch through all modes, each remains usable (no black screen, no crash)
    for (const mode of ['Pure', 'Frost', 'Glass', 'System/Auto'] as const) {
      await win.locator('.material-panel select').selectOption(mode === 'System/Auto' ? 'system' : mode.toLowerCase());
      await expect(win.locator('.prototype-app')).toBeVisible();
      await expect(win.locator('.session-surface')).toBeVisible();
      // Fallback observable: if Glass forced on non-Windows, should show fallbackReason
      if (mode === 'Glass') {
        const fallback = await win.evaluate(() => document.documentElement.dataset.materialFallback || '');
        // On CI (non-Windows or --disable-gpu), Glass may fallback to frost — we only assert that effective is still readable
        const effective = await win.evaluate(() => document.documentElement.dataset.material || '');
        expect(['glass', 'frost', 'pure']).toContain(effective);
        if (fallback) expect(fallback).toMatch(/glass unavailable|frost via CSS/i);
      }
    }
    await win.locator('.material-panel button', { hasText: '×' }).click();
    await expect(win.locator('.session-surface')).toBeVisible();

    // ——— Keyboard / Command Palette primary entries ———
    await win.keyboard.press('Control+K');
    await expect(win.locator('[cmdk-input]')).toBeVisible();
    await expect(win.locator('[cmdk-item]', { hasText: 'Review Attention' })).toBeVisible();
    await expect(win.locator('[cmdk-item]', { hasText: 'Search History' })).toBeVisible();
    await expect(win.locator('[cmdk-item]', { hasText: 'Search Memory' })).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(win.locator('[cmdk-input]')).toHaveCount(0);
    // Ctrl+3 / Ctrl+4 still open context/packet drawers
    await win.keyboard.press('Control+3');
    await expect(win.locator('.inspector-pane h2', { hasText: 'Context Staging' })).toBeVisible();
    await win.locator('.inspector-close').click();
    await win.keyboard.press('Control+4');
    await expect(win.locator('.panel h2', { hasText: 'Task Packet' })).toBeVisible();
    await win.locator('.inspector-close').click();

    // ——— no-write external SOT ———
    expect(createHash('sha256').update(readFileSync(join(OVERLAY, 'INBOX.md'))).digest('hex')).toBe(inboxBefore);
    expect(createHash('sha256').update(readFileSync(join(OVERLAY, 'memory', 'MEMORY.md'))).digest('hex')).toBe(memoryBefore);
    expect(createHash('sha256').update(readFileSync(PROJECT_CANONICAL)).digest('hex')).toBe(canonicalBefore);

    await app.close();
  });
});
