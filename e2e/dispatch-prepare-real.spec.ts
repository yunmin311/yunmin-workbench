import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { exportPinnedRepository } from './pinnedRepoExport';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');

/**
 * Authored Governance locator state (same pin as workgraph-real): the commit
 * that registered the creative-os canonical fact sources. Exported to a temp
 * overlay so the accepted Task/Work identity does not depend on the user's
 * current checkout branch.
 */
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const CONVERSATION_KEY = 'creative-os::claude::CO 主对话';

function exportGovernanceState(overlayRoot: string): string {
  return exportPinnedRepository(overlayRoot, GOVERNANCE_PINNED_COMMIT, 'wb-dispatch-pin-');
}

test('headed real canonical Task prepares an explicit dispatch and stops before the button', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required for the machine-local real walkthrough');
  const overlayExport = exportGovernanceState(realOverlay!);
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-real-dispatch-'));
  const stateRoot = join(stateDir, 'state');
  await rebindProjectRoot(stateRoot, {
    projectId: 'creative-os',
    selectedRoot: realCreativeOsRoot,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });

  await mkdir(screenshotDir, { recursive: true });
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: overlayExport, WB_STATE_DIR: stateDir, WB_RENDERER_VNEXT: '1' }),
  });
  const win = await app.firstWindow();
  try {
    await expect(win.locator('.vnext-app')).toBeVisible();
    const baseline = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      return {
        semanticHash: response.revision?.semanticHash ?? null,
        executionNodes: response.revision?.candidate.semanticFacts.nodes.filter((node) => node.kind === 'execution').length ?? 0,
        usesContextEdges: response.revision?.candidate.semanticFacts.edges.filter((edge) => edge.kind === 'uses-context').length ?? 0,
      };
    });
    expect(baseline.semanticHash).toBeTruthy();

    // Enter from the canonical Task selection: exact lineage only.
    const taskNode = win.locator('.react-flow__node[data-id="task:creative-os:T006"]');
    await expect(taskNode).toBeVisible();
    await taskNode.click();
    const focusDetail = win.getByRole('complementary', { name: 'Focus Detail' });
    await expect(focusDetail).toBeVisible();
    // Canonical manifest declares no lifecycle: the UI shows no fabricated
    // lifecycle claim (UNKNOWN stays out of the chips entirely).
    await expect(focusDetail).toContainText('定义主/渲染共享类型');
    await expect(focusDetail).not.toContainText('unknown');

    await win.getByRole('button', { name: 'Prepare work', exact: true }).click();
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet).toBeVisible();
    await cabinet.locator('#prepare-conversation').selectOption(CONVERSATION_KEY);
    await cabinet.getByRole('button', { name: 'Freeze and review preflight' }).click();
    const surface = win.getByRole('region', { name: 'Dispatch' });
    await expect(surface).toBeVisible();
    await expect(surface.locator('.dispatch-ready')).toBeVisible();
    // Exact lineage entered the draft — never re-inferred.
    await expect(surface.locator('.dispatch-lineage.is-canonical')).toHaveText('Task T006 · Work 001-inspiration-capture');

    // Conversation and newly frozen packet carry forward from Context.
    await expect(surface.locator('#dispatch-conversation')).toHaveValue(CONVERSATION_KEY);
    const preparedPacketId = await surface.locator('#dispatch-packet').inputValue();
    expect(preparedPacketId).toBeTruthy();
    await expect(surface.locator('.dispatch-preflight')).toContainText(preparedPacketId);

    // Instruction is typed by hand, visible, reviewable.
    await surface.locator('#dispatch-instruction').fill('验收 preflight only — 不执行（T006 无未完成 canonical 状态）');

    // Executor buttons reflect REAL capability; pick one only if its dispatch
    // capability is proven. Never an auto-pick.
    const executors = surface.getByRole('group', { name: 'Executor selection' });
    await expect(executors).toBeVisible();
    const enabledExecutors = executors.locator('button:not([disabled])');
    if (await enabledExecutors.count() > 0) {
      await enabledExecutors.first().click();
    }

    await win.screenshot({ path: join(screenshotDir, '18-dispatch-prepare-real.png') });

    // Preflight must show every check explicitly; UNKNOWN capability stays UNKNOWN.
    const preflight = await surface.getByRole('list', {}).locator('.preflight-check').allInnerTexts();
    expect(preflight.join('\n')).toContain('Frozen Packet');
    expect(preflight.join('\n')).toContain(preparedPacketId);
    expect(preflight.join('\n')).toContain('this dispatch only');
    expect(preflight.join('\n')).toContain('canonical Task T006');
    await win.screenshot({ path: join(screenshotDir, '19-dispatch-preflight-real.png') });

    // REAL EXECUTION BOUNDARY: no legitimate live canonical Task exists
    // (T006/T007/T008 carry no unfinished state the source can prove), so the
    // walkthrough stops here — the Dispatch button is never clicked.

    // Preparing alone produced no runtime trace and moved no semantic fact.
    const after = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      const activity = await window.wb.loadActivity({ limit: 50 });
      return {
        semanticHash: response.revision?.semanticHash ?? null,
        executionNodes: response.revision?.candidate.semanticFacts.nodes.filter((node) => node.kind === 'execution').length ?? 0,
        usesContextEdges: response.revision?.candidate.semanticFacts.edges.filter((edge) => edge.kind === 'uses-context').length ?? 0,
        dispatchEvents: activity.events.filter((event) => event.kind === 'handoff-dispatched').length,
        intentEvents: activity.events.filter((event) => event.intentId).length,
      };
    });
    expect(after.semanticHash).toBe(baseline.semanticHash);
    expect(after).toMatchObject({ executionNodes: 0, usesContextEdges: 0, dispatchEvents: 0, intentEvents: 0 });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
