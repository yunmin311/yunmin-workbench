import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realStateRoot = process.env.WB_REAL_STATE_ROOT;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');

test('headed real overlay stages Context in the vNext Context Cabinet', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required for the machine-local real walkthrough');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-real-cabinet-'));
  if (realStateRoot && existsSync(join(realStateRoot, 'state'))) {
    cpSync(join(realStateRoot, 'state'), join(stateDir, 'state'), { recursive: true });
  }
  await rebindProjectRoot(join(stateDir, 'state'), {
    projectId: 'creative-os',
    selectedRoot: realCreativeOsRoot,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  await mkdir(screenshotDir, { recursive: true });
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: realOverlay, WB_STATE_DIR: stateDir, WB_RENDERER_VNEXT: '1' }),
  });
  const win = await app.firstWindow();
  try {
    await expect(win.locator('.vnext-app')).toBeVisible();

    // Canvas semanticHash baseline before any staging happens.
    const baselineHash = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      return response.revision?.semanticHash ?? null;
    });
    expect(baselineHash).toBeTruthy();

    // Open the Cabinet from the Canvas and wait for real source groups.
    await win.getByRole('button', { name: 'Cabinet', exact: true }).click();
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await expect(cabinet.locator('.cabinet-group h3', { hasText: 'Governance' })).toBeVisible();
    await expect(cabinet.locator('.cabinet-group h3', { hasText: 'Memory' })).toBeVisible();

    const realReport = await win.evaluate(async () => {
      const snapshot = await window.wb.loadOverlay();
      const adapter = snapshot.projects.find((project) => project.projectId === 'creative-os');
      return {
        gateCount: Object.keys(adapter?.gates ?? {}).length,
        memoryCount: snapshot.memoryIndex.length,
        fingerprintedRefs: snapshot.sourceFingerprints.length,
      };
    });
    expect(realReport.gateCount).toBeGreaterThan(0);
    expect(realReport.memoryCount).toBeGreaterThan(0);
    // Governance rows = adapter gates + canonical source, all included by source default.
    const governanceRows = cabinet.locator('.cabinet-group', { hasText: 'Governance' }).locator('.cabinet-row');
    await expect(governanceRows).toHaveCount(realReport.gateCount + 1);
    await expect(governanceRows.first()).toHaveClass(/is-included/);
    // Memory rows exist and are unbound Available.
    const memoryGroup = cabinet.locator('.cabinet-group', { hasText: 'Memory' });
    const memoryRows = memoryGroup.locator('.cabinet-row');
    expect(await memoryRows.count()).toBe(realReport.memoryCount);
    await expect(memoryRows.first()).toHaveClass(/is-available/);
    await expect(memoryRows.first().locator('.cabinet-unbound')).toHaveText('unbound');
    await win.screenshot({ path: join(screenshotDir, '11-context-cabinet-real.png') });

    // One memory item: Available -> Included, then pinned.
    const includedTitle = await memoryRows.nth(0).locator('.cabinet-item-title').innerText();
    await memoryRows.nth(0).getByRole('button', { name: `Included: ${includedTitle}` }).click();
    await expect(memoryRows.nth(0)).toHaveClass(/is-included/);
    await memoryRows.nth(0).getByRole('button', { name: `Pin ${includedTitle}` }).click();
    await expect(memoryRows.nth(0)).toHaveClass(/is-pinned/);

    // Another memory item: Available -> Excluded.
    const excludedTitle = await memoryRows.nth(1).locator('.cabinet-item-title').innerText();
    await memoryRows.nth(1).getByRole('button', { name: `Excluded: ${excludedTitle}` }).click();
    await expect(memoryRows.nth(1)).toHaveClass(/is-excluded/);

    // Summary reflects the staging set.
    await expect(cabinet.locator('.sum-pinned')).toHaveText('Pinned 1');

    // Staging persisted through the Workbench draft seam with exact identity.
    const draftReport = await win.evaluate(async () => {
      const snapshot = await window.wb.loadOverlay();
      const stored = await window.wb.loadDraft('creative-os', 'cabinet:v1:creative-os');
      const decisions = stored.draft?.projectedDecisions ?? [];
      return {
        scope: stored.draft?.scope,
        expectedFirstMemoryId: snapshot.memoryIndex[0]?.id,
        expectedSecondMemoryId: snapshot.memoryIndex[1]?.id,
        decisionCount: decisions.length,
        included: decisions.filter((decision) => decision.state === 'included' && decision.pinned).map((decision) => decision.itemId),
        excluded: decisions.filter((decision) => decision.state === 'excluded').map((decision) => decision.itemId),
        manual: stored.draft?.manualContexts.length ?? 0,
      };
    });
    expect(draftReport.scope).toMatchObject({ projectId: 'creative-os', conversationKey: 'cabinet:v1:creative-os' });
    expect(draftReport.included).toEqual([`memory:${draftReport.expectedFirstMemoryId}`]);
    expect(draftReport.excluded).toEqual([`memory:${draftReport.expectedSecondMemoryId}`]);
    expect(draftReport.manual).toBe(0);

    // Close and reopen: decisions restore from identity, pinned survives.
    await cabinet.getByRole('button', { name: 'Close Context Cabinet' }).click();
    await expect(cabinet).toHaveCount(0);
    await win.getByRole('button', { name: 'Cabinet', exact: true }).click();
    await expect(cabinet).toBeVisible();
    await expect(memoryRows.nth(0)).toHaveClass(/is-included/);
    await expect(memoryRows.nth(0)).toHaveClass(/is-pinned/);
    await expect(memoryRows.nth(1)).toHaveClass(/is-excluded/);
    await win.screenshot({ path: join(screenshotDir, '12-context-staging-real.png') });

    // Focus detail: identity, source, verification, deterministic reason.
    await memoryRows.nth(0).locator('.cabinet-item-title').click();
    const detail = cabinet.getByRole('complementary', { name: 'Context detail' });
    await expect(detail).toBeVisible();
    await expect(detail.locator('dt', { hasText: 'Source ref' })).toBeVisible();
    await expect(detail.locator('.cabinet-reason')).toContainText(/Source default|User staging decision/);
    // Recheck is deterministic and never silently upgrades to CURRENT.
    await detail.getByRole('button', { name: 'Recheck source' }).click();
    await expect(detail.locator('.currentness')).toHaveText(/CURRENT|STALE|INVALID|UNVERIFIED/);
    await win.screenshot({ path: join(screenshotDir, '13-context-detail-real.png') });

    // Compile Packet with an explicitly selected conversation target.
    await win.locator('.react-flow__node[data-id^="conversation:"]').first().click();
    await cabinet.getByRole('button', { name: 'Compile Packet' }).click();
    const packetFooter = cabinet.getByRole('status', { name: 'Compiled packet' });
    await expect(packetFooter).toBeVisible({ timeout: 15_000 });
    await expect(packetFooter.locator('dd').first()).toHaveText(/^[0-9a-f-]{36}$/);
    await expect(packetFooter.locator('.currentness')).toHaveText(/CURRENT|STALE/);
    await win.screenshot({ path: join(screenshotDir, '14-frozen-packet-real.png') });

    // Compile produced a frozen packet record but no Execution and no uses-context.
    const afterReport = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      if (!response.revision) return { error: response.error ?? 'missing revision' };
      const facts = response.revision.candidate.semanticFacts;
      return {
        semanticHash: response.revision.semanticHash,
        executionNodes: facts.nodes.filter((node) => node.kind === 'execution').length,
        usesContextEdges: facts.edges.filter((edge) => edge.kind === 'uses-context').length,
      };
    });
    expect(afterReport).toMatchObject({ executionNodes: 0, usesContextEdges: 0 });
    // Staging/layout never moved the Canvas semanticHash.
    expect(afterReport.semanticHash).toBe(baselineHash);
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
