import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const screenshotDir = resolve('screenshots/workbench-vnext-20260907');

test('default launch loads vNext with the real WorkGraphRevision over preload IPC', async () => {
  const fixture = await useOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-vnext-e2e-'));
  await mkdir(screenshotDir, { recursive: true });
  const { app, win } = await launchWorkbench(stateDir, fixture.overlayRoot);
  try {
    await expect(win.locator('.vnext-app')).toBeVisible();
    await expect(win.locator('.wb-node').first()).toBeVisible();
    await expect(win.getByRole('button', { name: 'Fit view', exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Locate', exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Attention', exact: true })).toHaveCount(0);
    const graphReport = await win.evaluate(async () => {
      const response = await window.wb.getWorkGraphRevision();
      if (!response.revision) return { error: response.error ?? 'missing revision' };
      const facts = response.revision.candidate.semanticFacts;
      const countBy = (values: string[]) => values.reduce<Record<string, number>>((counts, value) => {
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
      }, {});
      return {
        nodeKinds: countBy(facts.nodes.map((node) => node.kind)),
        edgeKinds: countBy(facts.edges.map((edge) => edge.kind)),
        unknownNodes: facts.nodes.filter((node) => node.verification === 'UNKNOWN' || ('currentness' in node && node.currentness === 'UNKNOWN')).map((node) => node.id),
        problems: facts.problems,
      };
    });
    console.log(`[vnext-real-graph] ${JSON.stringify(graphReport)}`);
    expect(graphReport).not.toHaveProperty('error');
    await win.screenshot({ path: join(screenshotDir, '01-workgraph-overview.png') });
    await win.locator('.wb-node').first().click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toBeVisible();
    await win.screenshot({ path: join(screenshotDir, '02-workgraph-focus.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(fixture.searchRoot, { recursive: true, force: true });
  }
});

test('explicit legacy opt-in keeps the rollback renderer', async () => {
  const fixture = await useOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-legacy-e2e-'));
  const { app, win } = await launchWorkbench(stateDir, fixture.overlayRoot, { WB_RENDERER_LEGACY: '1' });
  try {
    await expect(win.locator('.prototype-chrome')).toBeVisible();
    await expect(win.locator('.vnext-app')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(fixture.searchRoot, { recursive: true, force: true });
  }
});

test('real attention facts enable the Attention control (TEST FIXTURE screenshot)', async () => {
  const fixture = await useOverlayFixture();
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-vnext-attention-e2e-'));
  const activityDir = join(stateDir, 'state', 'activity');
  mkdirSync(activityDir, { recursive: true });
  const event = {
    id: 'vnext-attention-fixture', projectId: 'creative-os', conversationKey: 'creative-os::claude::CO 主对话',
    kind: 'needs-user-input', summary: 'Confirm the Phase 3B acceptance evidence',
    runtimeRef: 'fixture-session', attentionKey: 'phase-3b-fixture', attentionStatus: 'active',
    observed: { source: 'protocol', sourceRef: 'protocol:test-fixture:phase-3b', observedAt: '2026-09-08T00:00:00.000Z', verification: 'OBSERVED' },
  };
  writeFileSync(join(activityDir, 'history.jsonl'), `${JSON.stringify({ schemaVersion: 1, event })}\n`, 'utf8');
  const { app, win } = await launchWorkbench(stateDir, fixture.overlayRoot);
  try {
    await expect(win.getByRole('button', { name: 'Attention', exact: true })).toBeVisible();
    await expect(win.locator('.wb-node[data-family="gate"]')).toBeVisible();
    await win.locator('body').evaluate((body) => {
      const label = document.createElement('div');
      label.className = 'test-fixture-label';
      label.textContent = 'TEST FIXTURE · attention event';
      Object.assign(label.style, {
        position: 'fixed', zIndex: '100', right: '14px', bottom: '14px', padding: '7px 10px',
        border: '1px solid #f59e0b', borderRadius: '6px', background: '#451a03', color: '#fde68a',
        font: '700 11px/1 system-ui, sans-serif', letterSpacing: '.05em',
      });
      body.appendChild(label);
    });
    await win.screenshot({ path: join(screenshotDir, '03-workgraph-attention.png') });
  } finally {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(fixture.searchRoot, { recursive: true, force: true });
  }
});
