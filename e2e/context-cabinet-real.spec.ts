import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { buildWorkbenchDraft } from '../src/core/project/draft';
import { writeWorkbenchDraftAtomic } from '../src/main/draftPersistence';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realStateRoot = process.env.WB_REAL_STATE_ROOT;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');
const LEGACY_CABINET_KEY = 'cabinet:v1:creative-os';

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

  // Seed a legacy 3C.1 cabinet draft so the one-time migration is exercised
  // against real data: first real Memory atom Included + pinned.
  const memoryIndexText = readFileSync(join(realOverlay!, 'memory', 'MEMORY.md'), 'utf8');
  const firstAtom = memoryIndexText.match(/^- \[[^\]]+\]\(([^)]+\.md)\)/m);
  expect(firstAtom).toBeTruthy();
  const firstMemoryId = firstAtom![1].replace(/\.md$/, '');
  await writeWorkbenchDraftAtomic(join(stateDir, 'state'), buildWorkbenchDraft('creative-os', LEGACY_CABINET_KEY, undefined, '', [
    {
      id: `memory:${firstMemoryId}`,
      title: firstMemoryId,
      source: `memory:${firstMemoryId}`,
      body: '',
      state: 'included',
      pinned: true,
      isReference: true,
      sourceRef: 'overlay:memory/MEMORY.md',
      provenance: 'EXTERNAL',
    },
  ], []));

  await mkdir(screenshotDir, { recursive: true });
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: realOverlay, WB_STATE_DIR: stateDir }),
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
    await win.locator('.approved-composer').getByRole('button', { name: 'Prepare Work', exact: true }).click();
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
        canonicalVerified: adapter?.canonicalSource?.verification === 'VERIFIED',
      };
    });
    expect(realReport.gateCount).toBeGreaterThan(0);
    expect(realReport.memoryCount).toBeGreaterThan(0);
    expect(realReport.canonicalVerified).toBe(true);

    // Formal scope: the legacy draft was migrated once into
    // project-context-cabinet (the Cabinet load itself performs the one-time
    // migration), preserving the seeded decision.
    const migration = await win.evaluate(async () => {
      const stored = await window.wb.loadCabinetStaging('creative-os');
      return {
        kind: stored.staging?.scope.kind,
        decisions: stored.staging?.decisions ?? [],
      };
    });
    expect(migration.kind).toBe('project-context-cabinet');
    expect(migration.decisions).toEqual([
      expect.objectContaining({ contextId: `memory:${firstMemoryId}`, state: 'included', pinned: true }),
    ]);
    const memoryGroup = cabinet.locator('.cabinet-group', { hasText: 'Memory' });
    const memoryRows = memoryGroup.locator('.cabinet-row');
    expect(await memoryRows.count()).toBe(realReport.memoryCount);
    await expect(memoryRows.nth(0)).toHaveClass(/is-included/);
    await expect(memoryRows.nth(0)).toHaveClass(/is-pinned/);
    await expect(memoryRows.first().locator('.cabinet-unbound')).toHaveText('unbound');
    await win.screenshot({ path: join(screenshotDir, '11-context-cabinet-real.png') });

    // Another memory item: Available -> Excluded.
    await memoryRows.nth(1).getByRole('button', { name: /Excluded: / }).click();
    await expect(memoryRows.nth(1)).toHaveClass(/is-excluded/);

    // --- Explicit project file: search -> pick -> Available -> Include -> Pin
    await cabinet.getByRole('button', { name: '+ Project File' }).click();
    const picker = cabinet.getByRole('search', { name: 'Add project file' });
    await expect(picker).toBeVisible();
    await picker.getByRole('textbox').fill('README.md');
    await picker.getByRole('button', { name: 'Search' }).click();
    // The exact path hit sorts first: the root README.md itself.
    const matchRow = picker.locator('.cabinet-picker-list li', { hasText: 'README.md' }).first();
    await expect(matchRow).toBeVisible();
    await expect(matchRow).toHaveText(/^\s*README\.md/);
    await win.screenshot({ path: join(screenshotDir, '15-project-file-picker-real.png') });
    await matchRow.getByRole('button', { name: /as context/ }).click();

    const fileGroup = cabinet.locator('.cabinet-group', { hasText: 'Project Files' });
    const fileRows = fileGroup.locator('.cabinet-row');
    await expect(fileRows).toHaveCount(1);
    const fileRow = fileRows.nth(0);
    // Explicitly added files start Available — never auto-included.
    await expect(fileRow).toHaveClass(/is-available/);
    await expect(fileRow.locator('.cabinet-origin')).toHaveText('worktree');
    await expect(fileRow.getByRole('button', { name: /Pin / })).toBeDisabled();
    await fileRow.getByRole('button', { name: /Included: / }).click();
    await expect(fileRow).toHaveClass(/is-included/);
    await fileRow.getByRole('button', { name: /Pin / }).click();
    await expect(fileRow).toHaveClass(/is-pinned/);

    // Pinned canonical source is a distinct, explicitly added fact.
    await cabinet.getByRole('button', { name: '+ Project File' }).click();
    await picker.getByRole('button', { name: 'Add pinned canonical' }).click();
    await expect(fileRows).toHaveCount(2);
    const pinnedRow = fileRows.nth(1);
    await expect(pinnedRow).toHaveClass(/is-available/);
    await expect(pinnedRow.locator('.cabinet-origin')).toHaveText('pinned');

    // Working-tree detail: WORKING TREE provenance + deterministic recheck.
    await fileRow.locator('.cabinet-item-title').click();
    let detail = cabinet.getByRole('complementary', { name: 'Context detail' });
    await expect(detail).toBeVisible();
    await expect(detail.locator('dd', { hasText: 'WORKING TREE' })).toBeVisible();
    // Deterministic reason: after the explicit include+pin it names the user decision.
    await expect(detail.locator('.cabinet-reason')).toContainText('User staging decision: included, pinned');
    await detail.getByRole('button', { name: 'Recheck source' }).click();
    await expect(detail.locator('.currentness')).toHaveText('CURRENT');
    await win.screenshot({ path: join(screenshotDir, '16-project-file-context-real.png') });

    // Formal staging state persisted through the cabinet seam.
    const stagingState = await win.evaluate(async () => {
      const stored = await window.wb.loadCabinetStaging('creative-os');
      return {
        scope: stored.staging?.scope,
        includedIds: (stored.staging?.decisions ?? []).filter((d) => d.state === 'included').map((d) => d.contextId),
        files: stored.staging?.projectFiles ?? [],
        pinnedCanonicalFile: stored.staging?.pinnedCanonicalFile,
      };
    });
    expect(stagingState.scope).toMatchObject({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    expect(stagingState.includedIds).toContain('project-file:creative-os:README.md:context');
    expect(stagingState.files).toEqual([
      expect.objectContaining({ projectId: 'creative-os', relativePath: 'README.md', asReference: false }),
    ]);
    expect(stagingState.pinnedCanonicalFile).toBe(true);

    // --- Freeze Packet with an explicitly selected conversation target,
    // then continue in-place to preflight.
    const conversationSelect = cabinet.locator('#prepare-conversation');
    const selectedConversationKey = await conversationSelect.locator('option').nth(1).getAttribute('value');
    expect(selectedConversationKey).toBeTruthy();
    await conversationSelect.selectOption(selectedConversationKey!);
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();
    const dispatch = win.getByRole('region', { name: 'Dispatch' });
    await expect(dispatch.locator('.dispatch-ready')).toBeVisible({ timeout: 15_000 });
    const preparedPacketId = await dispatch.locator('#dispatch-packet').inputValue();
    expect(preparedPacketId).toMatch(/^[0-9a-f-]{36}$/);

    // The frozen packet really contains the file, fingerprinted at compile.
    const packetCheck = await win.evaluate(async (conversationKey) => {
      const listed = await window.wb.listFrozen('creative-os', conversationKey);
      const summary = listed.packets.at(-1);
      if (!summary) return { error: 'no frozen packet' };
      const detailPacket = await window.wb.readFrozenDetail('creative-os', conversationKey, { version: summary.version });
      return {
        packetId: summary.packetId,
        includedIds: detailPacket?.included.map((item) => item.id) ?? [],
        fileFingerprints: detailPacket?.sourceFingerprints.filter((fingerprint) =>
          fingerprint.sourceRef.startsWith('project-file:creative-os:README.md')),
      };
    }, selectedConversationKey!);
    expect(packetCheck.includedIds).toContain('project-file:creative-os:README.md:context');
    expect(packetCheck.fileFingerprints).toHaveLength(1);
    await win.screenshot({ path: join(screenshotDir, '17-project-file-packet-real.png') });

    // Compile produced a frozen packet but no Execution and no uses-context.
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
