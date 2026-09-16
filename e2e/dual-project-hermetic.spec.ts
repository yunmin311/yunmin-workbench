import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { rebindProjectRoot } from '../src/main/projectRootBindings';

/**
 * Hermetic dual-project acceptance (no machine state, no local-only commits,
 * no temp composite).
 *
 * Both projects AND the overlay are constructed from scratch in temp dirs at
 * runtime: two miniature git repos with real commits (pinned reads, remote
 * verification and YAML validation all run through the production machinery)
 * plus a minimal overlay that only registers the two adapters.
 *
 * These are explicitly SYNTHETIC repos (`-hermetic` ids) built to exercise
 * the production adapter path with two projects. They are not REAL canonical
 * facts and never touch the TEST FIXTURE scene.
 */

const OBSERVED_AT = '2026-09-13T00:00:00.000Z';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function writeRepoFile(repo: string, rel: string, content: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

/** Init a synthetic project repo with real commits; returns the HEAD SHA. */
function initHermeticRepo(repo: string, remote: string, files: Record<string, string>): string {
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'hermetic-test');
  git(repo, 'config', 'user.email', 'hermetic-test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'remote', 'add', 'origin', remote);
  for (const [rel, content] of Object.entries(files)) {
    writeRepoFile(repo, rel, content);
    git(repo, 'add', '--', rel);
  }
  git(repo, 'commit', '-qm', 'hermetic project facts');
  return git(repo, 'rev-parse', 'HEAD');
}

function manifestYaml(projectId: string, works: { id: string; label: string; spec: string; tasks: { id: string; label: string }[] }[], artifacts: { id: string; file: string; task: string }[]): string {
  const lines = [
    'schema_version: "1.0"',
    'record_type: canonical_fact_manifest',
    `project_id: ${projectId}`,
    'works:',
  ];
  for (const work of works) {
    lines.push(
      `  - work_id: ${work.id}`,
      `    project_id: ${projectId}`,
      `    label: ${work.label}`,
      `    source_ref: ${work.spec}`,
      `    observed_at: "${OBSERVED_AT}"`,
      '    verification: VERIFIED',
      '    currentness: CURRENT',
      '    task_ids:',
      ...work.tasks.map((task) => `      - ${task.id}`),
      '    conversation_ids: []',
    );
  }
  lines.push('tasks:');
  for (const work of works) {
    for (const task of work.tasks) {
      lines.push(
        `  - task_id: ${task.id}`,
        `    project_id: ${projectId}`,
        `    work_id: ${work.id}`,
        `    label: ${task.label}`,
        `    source_ref: tasks.md#${task.id}`,
        `    observed_at: "${OBSERVED_AT}"`,
        '    verification: VERIFIED',
        '    currentness: CURRENT',
        '    conversation_ids: []',
      );
    }
  }
  lines.push('artifacts:');
  for (const artifact of artifacts) {
    lines.push(
      `  - artifact_id: ${artifact.id}`,
      `    project_id: ${projectId}`,
      `    kind: source_file`,
      `    source_ref: ${artifact.file}`,
      `    task_id: ${artifact.task}`,
      `    observed_at: "${OBSERVED_AT}"`,
      '    currentness: CURRENT',
      '    verification: VERIFIED',
      '    evidence_refs: []',
    );
  }
  lines.push('evidence: []', '');
  return lines.join('\n');
}

function adapterYaml(projectId: string, displayName: string, remote: string, commit: string, gates: Record<string, string>): string {
  return [
    'schema_version: 2',
    'adapter_type: project',
    `project_id: ${projectId}`,
    `display_name: ${displayName}`,
    'status: CANDIDATE',
    `last_verified_at: '${OBSERVED_AT}'`,
    'constitution_copy: false',
    '',
    'canonical_source:',
    `  repository: hermetic/${projectId}`,
    `  remote: '${remote}'`,
    '  default_branch: main',
    '  path: CLAUDE.md',
    `  commit: ${commit}`,
    '  verification: VERIFIED',
    '',
    'canonical_fact_sources:',
    '  - kind: WORK',
    '    source_ref: canonical-facts.yaml#works',
    '    format: YAML',
    '    verification: VERIFIED',
    '  - kind: TASK',
    '    source_ref: canonical-facts.yaml#tasks',
    '    format: YAML',
    '    verification: VERIFIED',
    '  - kind: ARTIFACT',
    '    source_ref: canonical-facts.yaml#artifacts',
    '    format: YAML',
    '    verification: VERIFIED',
    '',
    'project_gates:',
    ...Object.entries(gates).map(([key, value]) => `  ${key}: ${value}`),
    '',
    'loading_contract:',
    '  - treat inaccessible or changed sources as UNKNOWN and stop write actions',
    '',
  ].join('\n');
}

test('hermetic dual projects: discovery, switch, selection, compact handoff, staging isolation', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'wb-hermetic-dual-'));
  const stateDir = join(scratch, 'wb-state');
  const overlayRoot = join(scratch, 'overlay');
  const alphaRepo = join(scratch, 'repo-alpha');
  const betaRepo = join(scratch, 'repo-beta');
  mkdirSync(join(stateDir, 'state'), { recursive: true });
  const stateRoot = join(stateDir, 'state');

  const alphaRemote = 'https://example.com/hermetic-alpha.git';
  const betaRemote = 'https://example.com/hermetic-beta.git';
  const alphaCommit = initHermeticRepo(alphaRepo, alphaRemote, {
    'CLAUDE.md': '# Alpha Hermetic\nSynthetic constitution for hermetic dual-project acceptance.\n',
    'spec.md': '# Alpha spec\nReal-enough spec body.\n',
    'tasks.md': '# Alpha tasks\n## a-T1\n## a-T2\n## a-T3\n## a-T4\n## a-T5\n',
    'src/alpha.ts': 'export const alpha = 1;\n',
    'canonical-facts.yaml': manifestYaml('alpha-hermetic', [
      { id: 'w-alpha', label: 'Alpha work', spec: 'spec.md', tasks: [
        { id: 'a-T1', label: 'Alpha task one' },
        { id: 'a-T2', label: 'Alpha task two' },
        { id: 'a-T3', label: 'Alpha task three' },
        { id: 'a-T4', label: 'Alpha task four' },
        { id: 'a-T5', label: 'Alpha task five' },
      ] },
    ], [{ id: 'alpha-hermetic:a-T1:code', file: 'src/alpha.ts', task: 'a-T1' }]),
  });
  const betaCommit = initHermeticRepo(betaRepo, betaRemote, {
    'CLAUDE.md': '# Beta Hermetic\nSynthetic constitution for hermetic dual-project acceptance.\n',
    'spec-one.md': '# Beta spec one\n',
    'spec-two.md': '# Beta spec two\n',
    'tasks.md': '# Beta tasks\n## b-T1\n## b-T2\n## b-T3\n',
    'src/beta.ts': 'export const beta = 2;\n',
    'canonical-facts.yaml': manifestYaml('beta-hermetic', [
      { id: 'w-beta-1', label: 'Beta work one', spec: 'spec-one.md', tasks: [{ id: 'b-T1', label: 'Beta task one' }] },
      { id: 'w-beta-2', label: 'Beta work two', spec: 'spec-two.md', tasks: [{ id: 'b-T2', label: 'Beta task two' }, { id: 'b-T3', label: 'Beta task three' }] },
    ], [{ id: 'beta-hermetic:b-T2:code', file: 'src/beta.ts', task: 'b-T2' }]),
  });
  expect(alphaCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(betaCommit).toMatch(/^[0-9a-f]{40}$/);

  writeRepoFile(overlayRoot, 'projects/instances/alpha-hermetic.adapter.yaml',
    adapterYaml('alpha-hermetic', 'Alpha Hermetic', alphaRemote, alphaCommit, { 'alpha-ship': 'alpha owner' }));
  writeRepoFile(overlayRoot, 'projects/instances/beta-hermetic.adapter.yaml',
    adapterYaml('beta-hermetic', 'Beta Hermetic', betaRemote, betaCommit, { 'beta-ship': 'beta owner', 'beta-review': 'beta reviewer' }));
  // Optional overlay surfaces exist but empty, so overlay-level diagnostics
  // stay clean and `problems: []` asserts purely the project-fact resolution.
  writeRepoFile(overlayRoot, 'INBOX.md', '# Hermetic inbox\n');
  writeRepoFile(overlayRoot, 'memory/MEMORY.md', '# Hermetic memory\n');
  writeRepoFile(overlayRoot, 'harness/manifest.yaml', '# Hermetic harness\n{}\n');

  await rebindProjectRoot(stateRoot, {
    projectId: 'alpha-hermetic', selectedRoot: alphaRepo, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'alpha-hermetic', expectedRemote: alphaRemote,
  });
  await rebindProjectRoot(stateRoot, {
    projectId: 'beta-hermetic', selectedRoot: betaRepo, canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'beta-hermetic', expectedRemote: betaRemote,
  });

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({
      GOV_OVERLAY: overlayRoot, WB_STATE_DIR: stateDir,
      WB_COMPACT_WINDOW: '1',
    }),
  });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const win = app.windows().find((candidate) => candidate.url().includes('renderer-vnext')) ?? await app.firstWindow();
    const compactWin = app.windows().find((candidate) => candidate !== win)!;
    await expect(win.locator('.vnext-app')).toBeVisible({ timeout: 30_000 });

    // Discovery: both projects resolve pinned canonical facts with no problems.
    const discovered = await win.evaluate(async () => {
      const overlay = await window.wb.loadOverlay();
      const out: Record<string, unknown> = { projects: overlay.projects.map((p) => p.projectId) };
      for (const pid of ['alpha-hermetic', 'beta-hermetic']) {
        const response = await window.wb.getWorkGraphRevision(pid);
        if (!response.revision) { out[pid] = { error: response.error }; continue; }
        const kinds: Record<string, number> = {};
        for (const node of response.revision.candidate.semanticFacts.nodes) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
        out[pid] = { nodeKinds: kinds, problems: response.revision.candidate.semanticFacts.problems };
      }
      return out;
    });
    expect(discovered.projects).toEqual(['alpha-hermetic', 'beta-hermetic']);
    expect(discovered['alpha-hermetic']).toMatchObject({ nodeKinds: { project: 1, work: 1, task: 5, artifact: 1 }, problems: [] });
    expect(discovered['beta-hermetic']).toMatchObject({ nodeKinds: { project: 1, work: 2, task: 3, artifact: 1 }, problems: [] });

    // Switch: region rows follow the current project (1 vs 2 works).
    const nav = win.getByRole('complementary', { name: 'Work regions' });
    const select = nav.getByLabel('Switch project');
    await expect(select).toBeEnabled();
    await expect(nav.locator('.approved-work-row')).toHaveCount(1);
    await select.selectOption('beta-hermetic');
    await expect(nav.locator('.approved-work-row')).toHaveCount(2);
    await select.selectOption('alpha-hermetic');
    await expect(nav.locator('.approved-work-row')).toHaveCount(1);

    // Progressive disclosure: the resting Work composition keeps three Task
    // objects, exposes the exact hidden count, and drills into every Task
    // without changing semantic facts.
    const alphaRegion = win.locator('.react-flow__node-wb-region');
    const alphaTasks = win.locator('.react-flow__node-wb-task');
    await expect(alphaTasks).toHaveCount(3);
    const showAll = win.locator('button[aria-label="Show 2 more tasks in Alpha work"]');
    await expect(showAll).toBeVisible();
    await showAll.click();
    await expect(alphaTasks).toHaveCount(5);
    await expect(alphaRegion).toHaveClass(/is-region-expanded/);
    await win.locator('.react-flow__node[data-id="task:alpha-hermetic:a-T4"]').click();
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Alpha task four');
    await win.locator('.approved-drill-exit button[aria-label="Show fewer tasks in Alpha work"]').click();
    await expect(alphaTasks).toHaveCount(3);
    await expect(win.locator('.react-flow__node[data-id="task:alpha-hermetic:a-T4"]')).toBeVisible();
    await win.getByRole('button', { name: 'Locate current work' }).click();

    // Drill-in state belongs to this project only.
    await nav.locator('.approved-work-focus').click();
    await showAll.click();
    await select.selectOption('beta-hermetic');
    await expect(win.locator('button[aria-label^="Show fewer tasks in"]')).toHaveCount(0);
    await select.selectOption('alpha-hermetic');
    await expect(alphaTasks).toHaveCount(3);

    // Cross-project selection never mints a chimera.
    await select.selectOption('beta-hermetic');
    const betaTask = win.locator('.react-flow__node[data-id="task:beta-hermetic:b-T1"]');
    await expect(betaTask).toBeVisible();
    await win.waitForTimeout(400);
    await betaTask.click();
    await expect.poll(() => win.evaluate(async () => window.wb.getCurrentSelection())).toMatchObject({
      projectId: 'beta-hermetic', workId: 'w-beta-1', taskId: 'b-T1',
    });
    await select.selectOption('alpha-hermetic');
    await win.waitForTimeout(1500);
    await expect(await win.evaluate(async () => window.wb.getCurrentSelection())).toMatchObject({
      projectId: 'beta-hermetic', workId: 'w-beta-1', taskId: 'b-T1',
    });

    // Compact Continue crosses projects to the exact task.
    await expect.poll(async () => compactWin.locator('.compact-body').innerText().catch(() => ''), { timeout: 20_000 })
      .toContain('beta-hermetic');
    await compactWin.getByRole('button', { name: 'Continue current work' }).click();
    await expect.poll(() => win.evaluate(() =>
      (document.querySelector('select[aria-label="Switch project"]') as HTMLSelectElement | null)?.value ?? null,
    ), { timeout: 20_000 }).toBe('beta-hermetic');
    await expect(win.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Beta task one');

    // Compact Prepare crosses projects and opens beta staging with beta identity.
    await select.selectOption('alpha-hermetic');
    await win.waitForTimeout(1200);
    await compactWin.getByRole('button', { name: 'Prepare current work' }).click();
    await expect.poll(() => win.evaluate(async () => ({
      project: (document.querySelector('select[aria-label="Switch project"]') as HTMLSelectElement | null)?.value ?? null,
      cabinet: document.querySelector('[aria-label="Context Cabinet"]') !== null,
    })), { timeout: 20_000 }).toMatchObject({ project: 'beta-hermetic', cabinet: true });
    const cabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(cabinet.locator('.cabinet-scope')).toHaveText('beta-hermetic');
    await expect(cabinet).toContainText('staging for · Beta task one');

    // Staging isolation: an explicit decision in beta never leaks into alpha.
    // Compact handoff can replace the Cabinet projection while Playwright is
    // waiting for actionability. Dispatch against the current exact controls;
    // the persisted decision below remains the product assertion.
    await win.evaluate(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '.context-cabinet .cabinet-group-toggle[aria-controls="cabinet-group-governance"]',
      );
      if (!toggle) throw new Error('missing Governance group');
      toggle.click();
    });
    await expect(cabinet.locator('#cabinet-group-governance')).toBeVisible();
    await win.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.context-cabinet button')]
        .find((candidate) => candidate.getAttribute('aria-label') === 'Excluded: Gate: beta-ship');
      if (!button) throw new Error('missing beta-ship Excluded control');
      button.click();
    });
    await expect.poll(() => win.evaluate(async () => window.wb.loadCabinetStaging('beta-hermetic'))
      .then((result) => result.staging?.decisions.length ?? 0), { timeout: 10_000 }).toBeGreaterThan(0);
    const alphaStaging = await win.evaluate(async () => (await window.wb.loadCabinetStaging('alpha-hermetic')).staging);
    expect(alphaStaging).toBeNull();
    await cabinet.getByRole('button', { name: 'Close Context Cabinet' }).click();
    await select.selectOption('alpha-hermetic');
    await win.locator('.react-flow__node[data-id="task:alpha-hermetic:a-T1"]').click();
    await win.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const alphaCabinet = win.getByRole('region', { name: 'Context Cabinet' });
    await expect(alphaCabinet).toBeVisible();
    await expect(alphaCabinet.locator('.cabinet-scope')).toHaveText('alpha-hermetic');
    await expect(alphaCabinet).toContainText('Gate: alpha-ship');
    await expect(alphaCabinet).not.toContainText('Gate: beta-ship');

    // UNKNOWN identity is ignored, never guessed: project stays put, app stays up.
    await win.evaluate(async () => window.wb.openWorkbenchFromCompact({ projectId: 'unknown-hermetic' }));
    await win.waitForTimeout(1200);
    await expect(win.locator('.vnext-app')).toBeVisible();
    await expect(select).toHaveValue('alpha-hermetic');
    await expect(win.getByRole('complementary', { name: 'Work regions' }).locator('.approved-work-row')).toHaveCount(1);
  } finally {
    await app.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
