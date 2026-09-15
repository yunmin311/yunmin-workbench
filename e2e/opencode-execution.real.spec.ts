import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { rebindProjectRoot } from '../src/main/projectRootBindings';
import { electronArgs, workbenchEnv } from './prototype-shell';
import { exportPinnedRepository } from './pinnedRepoExport';

const GOVERNANCE_ROOT = process.env.WB_REAL_OVERLAY ?? 'E:\\1project\\ai-governance-system';
const PROJECT_ROOT = process.env.WB_REAL_CREATIVE_OS_ROOT ?? 'E:\\1project\\creative-os';
const GOVERNANCE_PINNED_COMMIT = 'bdaa2e83229d3339a9d3830d9306f8991a442cf1';
const PROJECT_PINNED_COMMIT = 'aa0395fcc741a0d8e0cc5f4138f2664542223417';
const CONVERSATION_KEY = 'creative-os::claude::CO 主对话';
const MODEL = 'opencode/muse-spark-1.3-contributor-free';
const EXPECTED_TEXT = 'OPEN_CODE_REAL_OK';
const SESSION_TO_CONTINUE = process.env.WB_REAL_OPENCODE_SESSION;
const CONTINUE_DIRECTORY = process.env.WB_REAL_OPENCODE_PROJECT_DIR;

function clonePinnedProject(): string {
  const target = CONTINUE_DIRECTORY ?? mkdtempSync(join(tmpdir(), 'wb-opencode-project-'));
  if (CONTINUE_DIRECTORY && existsSync(target)) {
    const head = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', target, 'status', '--porcelain'], { encoding: 'utf8' });
    if (head !== PROJECT_PINNED_COMMIT || dirty !== '') throw new Error(`continued-session directory is not the clean proof clone: ${target}`);
    return target;
  }
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', PROJECT_ROOT, target]);
  execFileSync('git', ['-C', target, 'checkout', '--quiet', '--detach', PROJECT_PINNED_COMMIT]);
  execFileSync('git', ['-C', target, 'remote', 'set-url', 'origin', 'https://github.com/yunmin311/creative-os.git']);
  return target;
}

test('real Prepare and Send reaches OpenCode native runtime and returns protocol evidence', async () => {
  test.setTimeout(180_000);
  test.skip(process.env.WB_REAL_OPENCODE_EXECUTION !== '1', 'WB_REAL_OPENCODE_EXECUTION=1 is required');
  test.skip(!existsSync(GOVERNANCE_ROOT) || !existsSync(PROJECT_ROOT), 'real local source repositories are required');
  const overlayRoot = exportPinnedRepository(GOVERNANCE_ROOT, GOVERNANCE_PINNED_COMMIT, 'wb-opencode-overlay-');
  const projectRoot = clonePinnedProject();
  expect(projectRoot.toLocaleLowerCase().startsWith(tmpdir().toLocaleLowerCase())).toBe(true);
  if (SESSION_TO_CONTINUE) {
    const dialogueFile = join(overlayRoot, 'profiles', 'machines', 'instances', 'claude-company-d-dialogues.yaml');
    const dialogue = readFileSync(dialogueFile, 'utf8');
    const patched = dialogue.replace(
      /(  - role: CO 主对话\r?\n    level: L2\r?\n    project: creative-os\r?\n)    platform: claude\r?\n    session_id: UNVERIFIED\r?\n    status: [^\r\n]+\r?\n    verification: UNVERIFIED/,
      `$1    platform: opencode\n    session_id: ${SESSION_TO_CONTINUE}\n    status: ACTIVE\n    verification: VERIFIED`,
    );
    expect(patched).not.toBe(dialogue);
    writeFileSync(dialogueFile, patched, 'utf8');
  }
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-opencode-state-'));
  await rebindProjectRoot(join(stateDir, 'state'), {
    projectId: 'creative-os',
    selectedRoot: projectRoot,
    canonicalPath: 'CLAUDE.md',
    expectedProjectId: 'creative-os',
    expectedRemote: 'https://github.com/yunmin311/creative-os.git',
  });
  expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');

  const app = await _electron.launch({
    args: [...electronArgs(), 'out/main/index.js'],
    env: workbenchEnv({
      GOV_OVERLAY: overlayRoot,
      WB_STATE_DIR: stateDir,
      WB_COMPACT_WINDOW: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: MODEL, permission: { '*': 'deny' } }),
      OPENCODE_PURE: '1',
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    }),
  });
  try {
    const main = (await app.windows()).find((page) => page.url().includes('renderer-vnext')) ?? await app.firstWindow();
    await expect(main.locator('.vnext-app')).toBeVisible({ timeout: 20_000 });
    const compact = (await app.windows()).find((page) => page.url().includes('renderer-compact'))!;
    await expect(compact.locator('.approved-compact-window')).toBeVisible({ timeout: 20_000 });

    const task = main.locator('.react-flow__node[data-id="task:creative-os:T006"]');
    await expect(task).toBeVisible();
    await task.click();
    await main.getByRole('complementary', { name: 'Focus Detail' }).getByRole('button', { name: 'Prepare Work', exact: true }).click();
    const cabinet = main.getByRole('region', { name: 'Context Cabinet' });
    const conversationKey = SESSION_TO_CONTINUE ? 'creative-os::opencode::CO 主对话' : CONVERSATION_KEY;
    await cabinet.locator('#prepare-conversation').selectOption(conversationKey);
    await cabinet.getByRole('button', { name: 'Snapshot and continue' }).click();

    const surface = main.getByRole('region', { name: 'Dispatch' });
    await expect(surface.locator('.dispatch-ready')).toBeVisible();
    await surface.locator('#dispatch-instruction').fill(`Return exactly ${EXPECTED_TEXT}. Do not call tools. Do not modify files.`);
    await surface.getByRole('button', { name: /opencode/i }).click();
    const send = surface.getByRole('button', { name: 'Send packet' });
    await expect(send).toBeEnabled();
    await send.click();

    let liveNativeRef = '';
    await expect.poll(async () => {
      const live = await main.evaluate(() => window.wb.loadLiveExecutions());
      const opencode = live.find((entry) => entry.harness === 'opencode');
      liveNativeRef = opencode?.externalSessionRef ?? '';
      return opencode ? { native: /^ses_/.test(opencode.externalSessionRef), canCancel: opencode.canCancel } : null;
    }, { timeout: 30_000, intervals: [50, 100, 200] }).toEqual({ native: true, canCancel: true });
    if (SESSION_TO_CONTINUE) expect(liveNativeRef).toBe(SESSION_TO_CONTINUE);

    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('1 working', { timeout: 10_000 });
    await expect(surface.getByRole('status', { name: 'Dispatch receipt' })).toContainText('ACCEPTED', { timeout: 120_000 });
    await expect.poll(async () => (await main.evaluate(() => window.wb.loadLiveExecutions())).filter((entry) => entry.harness === 'opencode').length, { timeout: 10_000 }).toBe(0);
    await expect(compact.getByRole('status', { name: 'Runtime and session presence' })).toContainText('No live execution fact.', { timeout: 10_000 });

    const proof = await main.evaluate(async ({ nativeRef, expectedText }) => {
      const activity = await window.wb.loadActivity({ limit: 200 });
      const events = activity.events.filter((event) => event.harness === 'opencode' && event.runtimeRef === nativeRef);
      const receipt = events.find((event) => event.kind === 'handoff-accepted');
      return {
        kinds: events.map((event) => event.kind),
        output: events.find((event) => event.kind === 'agent-response')?.content ?? '',
        receiptSource: receipt?.observed.sourceRef ?? '',
        lineage: receipt && {
          projectId: receipt.projectId,
          workId: receipt.workId,
          taskId: receipt.taskId,
          packetId: receipt.packetId,
          intentId: receipt.intentId,
        },
        exactOutput: events.some((event) => event.kind === 'agent-response' && event.content?.includes(expectedText)),
      };
    }, { nativeRef: liveNativeRef, expectedText: EXPECTED_TEXT });
    expect(proof.kinds).toEqual(expect.arrayContaining(['session-started', 'turn-started', 'agent-response', 'turn-completed', 'handoff-accepted']));
    expect(proof.exactOutput).toBe(true);
    expect(proof.receiptSource).toContain('opencode:opencode:run:step_start+step_finish');
    expect(proof.lineage).toMatchObject({ projectId: 'creative-os', workId: '001-inspiration-capture', taskId: 'T006' });
    expect(proof.lineage?.packetId).toBeTruthy();
    expect(proof.lineage?.intentId).toBeTruthy();
    console.log(`[real-opencode-execution] ${JSON.stringify({ nativeRef: liveNativeRef, receiptSource: proof.receiptSource, lineage: proof.lineage, output: proof.output })}`);

    await surface.getByRole('button', { name: 'Close Dispatch' }).click();
    await expect(main.locator('.approved-presence-group .approved-session-row').filter({ hasText: 'opencode' }).first()).toBeVisible({ timeout: 10_000 });

    const exported = JSON.parse(execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'opencode.cmd', 'export', liveNativeRef], { cwd: projectRoot, encoding: 'utf8' })) as {
      info?: { id?: string; directory?: string };
      messages?: Array<{ info?: { providerID?: string; modelID?: string; cost?: number } }>;
    };
    const modelMessages = (exported.messages ?? []).filter((message) => message.info?.providerID && message.info?.modelID);
    expect(exported.info).toMatchObject({ id: liveNativeRef, directory: projectRoot });
    expect(modelMessages.some((message) => `${message.info?.providerID}/${message.info?.modelID}` === MODEL)).toBe(true);
    expect(modelMessages.reduce((sum, message) => sum + (message.info?.cost ?? 0), 0)).toBe(0);
    expect(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
  } finally {
    await app.close();
    rmSync(overlayRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});
