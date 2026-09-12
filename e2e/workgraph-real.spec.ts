import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { exportPinnedRepository } from './pinnedRepoExport';

const realOverlay = process.env.WB_REAL_OVERLAY;
const realStateRoot = process.env.WB_REAL_STATE_ROOT;
const realCreativeOsRoot = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const screenshotDir = resolve('screenshots/workbench-vnext-20260907');

/**
 * The authored acceptance state: the Governance commit that registers the
 * creative-os canonical fact sources (WORK/TASK/ARTIFACT locators). The
 * Work Graph stays fail-closed in production — without those locators there
 * are simply no Work/Task/Artifact nodes. The test must not depend on which
 * branch the user's Governance checkout happens to be on, so it exports THIS
 * committed state into a temp overlay and points GOV_OVERLAY at the export.
 * The user's repo is never checked out, stashed, or modified.
 */
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';

function exportGovernanceState(overlayRoot: string): string {
  return exportPinnedRepository(overlayRoot, GOVERNANCE_PINNED_COMMIT, 'wb-overlay-pin-');
}

test('headed real overlay renders enriched WorkGraph facts', async () => {
  test.skip(!realOverlay, 'WB_REAL_OVERLAY is required for the machine-local real walkthrough');
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-real-workgraph-'));
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
  const overlayExport = exportGovernanceState(realOverlay!);
  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({ GOV_OVERLAY: overlayExport, WB_STATE_DIR: stateDir, WB_RENDERER_VNEXT: '1' }),
  });
  const win = await app.firstWindow();
  try {
    await expect(win.locator('.vnext-app')).toBeVisible();
    await expect(win.locator('.revision-info')).toHaveCount(0);
    await expect(win.locator('.node-source-ref')).toHaveCount(0);
    const report = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision('creative-os');
      if (!response.revision) return { error: response.error ?? 'missing revision' };
      const repeated = await window.wb.getWorkGraphRevision('creative-os');
      const facts = response.revision.candidate.semanticFacts;
      const count = (values: string[]) => values.reduce<Record<string, number>>((result, value) => {
        result[value] = (result[value] ?? 0) + 1;
        return result;
      }, {});
      return {
        nodeKinds: count(facts.nodes.map((node) => node.kind)),
        edgeKinds: count(facts.edges.map((edge) => edge.kind)),
        sources: Object.fromEntries(facts.nodes.map((node) => [node.id, { source: node.source, sourceRef: node.sourceRef }])),
        unknown: facts.nodes.filter((node) => node.verification === 'UNKNOWN' || ('currentness' in node && node.currentness === 'UNKNOWN')).map((node) => node.id),
        omitted: ['project', 'work', 'task', 'conversation', 'execution', 'context', 'memory-source', 'artifact', 'gate', 'evidence', 'handoff']
          .filter((kind) => !facts.nodes.some((node) => node.kind === kind)),
        problems: facts.problems,
        semanticHash: response.revision.semanticHash,
        repeatedSemanticHash: repeated.revision?.semanticHash,
        nodeIds: facts.nodes.map((node) => node.id),
        edges: facts.edges.map((edge) => ({ kind: edge.kind, source: edge.source, target: edge.target })),
      };
    });
    console.log(`[real-workgraph-enriched] ${JSON.stringify(report)}`);
    expect(report).not.toHaveProperty('error');
    if ('nodeKinds' in report && report.nodeKinds) {
      const nodeKinds = report.nodeKinds;
      expect(nodeKinds).toMatchObject({ project: 1, work: 1, task: 3, conversation: 6, context: 12, artifact: 3 });
      expect(nodeKinds.execution ?? 0).toBe(0);
      expect(nodeKinds.evidence ?? 0).toBe(0);
      expect(nodeKinds.gate ?? 0).toBe(0);
      expect(nodeKinds.handoff ?? 0).toBe(0);
      expect(report.repeatedSemanticHash).toBe(report.semanticHash);
      expect(report.nodeIds).toEqual(expect.arrayContaining([
        'work:creative-os:001-inspiration-capture',
        'task:creative-os:T006', 'task:creative-os:T007', 'task:creative-os:T008',
        'artifact:creative-os:creative-os:T006:shared-types',
        'artifact:creative-os:creative-os:T007:image-domain',
        'artifact:creative-os:creative-os:T008:inspiration-domain',
      ]));
      expect(report.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'membership', source: 'project:creative-os', target: 'work:creative-os:001-inspiration-capture' }),
        expect.objectContaining({ kind: 'membership', source: 'work:creative-os:001-inspiration-capture', target: 'task:creative-os:T006' }),
      ]));
      expect(report.edges.some((edge) => edge.kind === 'produces')).toBe(false);
    }
    await win.screenshot({ path: join(screenshotDir, '07-real-canonical-work-task.png') });

    const focusNode = win.locator('.react-flow__node[data-id="task:creative-os:T006"]');
    await focusNode.click();
    const detail = win.getByRole('complementary', { name: 'Focus Detail' });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Source ref', { exact: true })).toBeVisible();
    const [nodeBox, detailBox] = await Promise.all([focusNode.boundingBox(), detail.boundingBox()]);
    expect(nodeBox && detailBox && (
      nodeBox.x + nodeBox.width <= detailBox.x || detailBox.x + detailBox.width <= nodeBox.x
      || nodeBox.y + nodeBox.height <= detailBox.y || detailBox.y + detailBox.height <= nodeBox.y
    )).toBeTruthy();
    await win.screenshot({ path: join(screenshotDir, '08-real-canonical-task-focus.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(overlayExport, { recursive: true, force: true });
  }
});
