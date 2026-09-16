import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { workbenchEnv } from './prototype-shell';

const OBSERVED_AT = '2026-09-16T00:00:00.000Z';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function write(root: string, relative: string, body: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

function createPortableFacts(scratch: string): { overlay: string; project: string; state: string } {
  const project = join(scratch, '项目 with spaces');
  const overlay = join(scratch, '治理 overlay');
  const state = join(scratch, '用户 state');
  const remote = 'https://example.com/yunmin-release-smoke.git';
  mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'release-smoke');
  git(project, 'config', 'user.email', 'release-smoke@example.com');
  git(project, 'config', 'commit.gpgsign', 'false');
  git(project, 'config', 'core.autocrlf', 'false');
  git(project, 'remote', 'add', 'origin', remote);
  write(project, 'CLAUDE.md', '# Release smoke\nPortable packaged-app fixture.\n');
  write(project, 'work.md', '# Work\n');
  write(project, 'tasks.md', '# Tasks\n## rc-T1\n');
  write(project, 'artifact.txt', 'packaged release evidence\n');
  write(project, 'canonical-facts.yaml', [
    'schema_version: "1.0"',
    'record_type: canonical_fact_manifest',
    'project_id: release-smoke',
    'works:',
    '  - work_id: rc-work',
    '    project_id: release-smoke',
    '    label: Release closure',
    '    source_ref: work.md',
    `    observed_at: "${OBSERVED_AT}"`,
    '    verification: VERIFIED',
    '    currentness: CURRENT',
    '    task_ids: [rc-T1]',
    '    conversation_ids: []',
    'tasks:',
    '  - task_id: rc-T1',
    '    project_id: release-smoke',
    '    work_id: rc-work',
    '    label: Verify packaged product',
    '    source_ref: tasks.md#rc-T1',
    `    observed_at: "${OBSERVED_AT}"`,
    '    verification: VERIFIED',
    '    currentness: CURRENT',
    '    conversation_ids: []',
    'artifacts:',
    '  - artifact_id: release-smoke:rc-T1:evidence',
    '    project_id: release-smoke',
    '    kind: source_file',
    '    source_ref: artifact.txt',
    '    task_id: rc-T1',
    `    observed_at: "${OBSERVED_AT}"`,
    '    currentness: CURRENT',
    '    verification: VERIFIED',
    '    evidence_refs: []',
    'evidence: []',
    '',
  ].join('\n'));
  git(project, 'add', '.');
  git(project, 'commit', '-qm', 'release smoke facts');
  const commit = git(project, 'rev-parse', 'HEAD');

  write(overlay, 'projects/instances/release-smoke.adapter.yaml', [
    'schema_version: 2',
    'adapter_type: project',
    'project_id: release-smoke',
    'display_name: Release Smoke',
    'status: CANDIDATE',
    `last_verified_at: '${OBSERVED_AT}'`,
    'constitution_copy: false',
    'canonical_source:',
    '  repository: hermetic/release-smoke',
    `  remote: '${remote}'`,
    '  default_branch: main',
    '  path: CLAUDE.md',
    `  commit: ${commit}`,
    '  verification: VERIFIED',
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
    'project_gates: {}',
    'loading_contract:',
    '  - treat inaccessible or changed sources as UNKNOWN and stop write actions',
    '',
  ].join('\n'));
  write(overlay, 'INBOX.md', '# Release smoke inbox\n');
  write(overlay, 'memory/MEMORY.md', '# Release smoke memory\n');
  write(overlay, 'harness/manifest.yaml', '{}\n');
  mkdirSync(join(state, 'state'), { recursive: true });
  return { overlay, project, state };
}

async function launchPackaged(executablePath: string, env: Record<string, string>): Promise<{
  app: ElectronApplication;
  main: Page;
  compact: Page;
  errors: string[];
}> {
  const errors: string[] = [];
  const app = await _electron.launch({ executablePath, env });
  app.process().stderr?.on('data', (chunk) => errors.push(String(chunk)));
  await expect.poll(() => app.windows().length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const main = app.windows().find((candidate) => candidate.url().includes('renderer-vnext')) ?? await app.firstWindow();
  const compact = app.windows().find((candidate) => candidate !== main)!;
  main.on('pageerror', (error) => errors.push(error.message));
  compact.on('pageerror', (error) => errors.push(error.message));
  await expect(main.locator('.vnext-app')).toBeVisible({ timeout: 30_000 });
  await expect(compact.locator('.approved-compact-window')).toBeVisible({ timeout: 30_000 });
  return { app, main, compact, errors };
}

async function waitForExit(executablePath: string, env: Record<string, string>): Promise<number | null> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(executablePath, [], { env, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('second packaged instance did not exit'));
    }, 10_000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

test('unsigned Windows package runs without source tree or dev server and preserves local state', async () => {
  test.skip(process.platform !== 'win32', 'Windows packaged smoke');
  const configured = process.env.WB_PACKAGED_EXE;
  test.skip(!configured, 'WB_PACKAGED_EXE points at the packaged executable');
  const executablePath = resolve(configured!);
  const scratch = mkdtempSync(join(tmpdir(), '云敏 packaged smoke '));
  const fixture = createPortableFacts(scratch);
  await rebindProjectRoot(join(fixture.state, 'state'), {
    projectId: 'release-smoke',
    selectedRoot: fixture.project,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'release-smoke',
    expectedRemote: 'https://example.com/yunmin-release-smoke.git',
  });
  const env = workbenchEnv({
    GOV_OVERLAY: fixture.overlay,
    WB_STATE_DIR: fixture.state,
    WB_COMPACT_WINDOW: '1',
  });

  let first: Awaited<ReturnType<typeof launchPackaged>> | undefined;
  let second: Awaited<ReturnType<typeof launchPackaged>> | undefined;
  try {
    first = await launchPackaged(executablePath, env);
    expect(first.main.url()).toMatch(/^file:\/\//);
    expect(first.compact.url()).toMatch(/^file:\/\//);
    const identity = await first.app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      name: app.getName(),
    }));
    expect(identity).toMatchObject({ packaged: true, userData: fixture.state, name: 'yunmin-workbench' });

    await expect(first.main.getByLabel('Switch project')).toHaveValue('release-smoke');
    await expect(first.main.locator('.react-flow__node-wb-region')).toHaveCount(1);
    const task = first.main.locator('.react-flow__node[data-id="task:release-smoke:rc-T1"]');
    await task.click();
    await expect(first.main.getByRole('complementary', { name: 'Focus Detail' })).toContainText('Verify packaged product');
    await first.main.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    await expect(first.main.getByRole('region', { name: 'Context Cabinet' })).toBeVisible();

    const capabilities = await first.main.evaluate(() => window.wb.loadAllHarnessCapabilities());
    expect(Object.keys(capabilities).sort()).toEqual(['claude', 'codex', 'deepseek', 'opencode'].sort());
    for (const capability of Object.values(capabilities)) {
      expect(typeof capability.canDispatch).toBe('boolean');
      expect(capability.evidence.length).toBeGreaterThan(0);
    }

    await first.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact');
      if (!win) throw new Error('Compact window missing');
      const bounds = win.getBounds();
      const next = { x: bounds.x - 24, y: bounds.y + 18, width: 392, height: 390 };
      win.setBounds(next);
    });
    await first.main.waitForTimeout(800);
    const compactBounds = await first.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact');
      if (!win) throw new Error('Compact window missing after resize');
      return win.getBounds();
    });
    expect(await waitForExit(executablePath, env)).toBe(0);
    await expect(first.main.locator('.vnext-app')).toBeVisible();
    await first.app.close();
    first = undefined;

    second = await launchPackaged(executablePath, env);
    await expect(second.main.getByLabel('Switch project')).toHaveValue('release-smoke');
    await expect.poll(() => second!.main.evaluate(() => window.wb.getCurrentSelection()))
      .toMatchObject({ projectId: 'release-smoke', workId: 'rc-work', taskId: 'rc-T1' });
    await expect(second.compact.locator('.approved-compact-task')).toContainText('Verify packaged product');
    const restoredBounds = await second.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Workbench Compact');
      if (!win) throw new Error('Compact window missing after restart');
      return win.getBounds();
    });
    expect(restoredBounds.width).toBe(compactBounds.width);
    expect(Math.abs(restoredBounds.height - compactBounds.height)).toBeLessThanOrEqual(8);
    expect(Math.abs(restoredBounds.x - compactBounds.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(restoredBounds.y - compactBounds.y)).toBeLessThanOrEqual(2);
    expect(second.errors.join('\n')).not.toMatch(/uncaught|unhandled|ERR_FILE_NOT_FOUND|failed to load/i);
  } finally {
    await first?.app.close().catch(() => undefined);
    await second?.app.close().catch(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
  }
});
