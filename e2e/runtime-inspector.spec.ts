import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchWorkbench, useOverlayFixture } from './prototype-shell';

const overlay = useOverlayFixture();
const conversationKey = 'creative-os::claude::CO 主对话';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function observed(id: string, at: string) {
  return { source: 'protocol', sourceRef: `runtime-fixture:${id}`, observedAt: at, verification: 'VERIFIED' };
}

function activity(
  id: string,
  kind: string,
  at: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id, projectId: 'creative-os', conversationKey, kind, summary: `${kind} ${id}`,
    observed: observed(id, at), ...extra,
  };
}

test('Runtime Inspector keeps exact execution identity, navigation, state, controls, and external no-write', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-runtime-inspector-'));
  const activityDir = join(stateDir, 'state', 'activity');
  const activityPath = join(activityDir, 'history.jsonl');
  mkdirSync(activityDir, { recursive: true });
  const binding = (harness: string, externalSessionRef: string) => ({
    harness, machine: 'fixture-machine', cwd: 'E:\\fixtures\\creative-os',
    worktree: 'E:\\fixtures\\creative-os', branch: 'phase/runtime-inspector',
    head: 'b32540186e0d09f0b6eaf9edf5a1a6f80fc13b78', externalSessionRef,
  });
  const events = [
    activity('accepted-only', 'handoff-accepted', '2026-08-31T01:00:00.000Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'receipt',
      attentionKey: 'intent-accepted-only', runtimeRef: 'accepted-only',
    }),
    activity('codex-session', 'session-started', '2026-08-31T01:00:01.000Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'externalSessionRef',
      runtimeRef: 'same-ref', runtimeState: 'unknown', binding: binding('codex', 'same-ref'),
    }),
    activity('codex-accepted', 'handoff-accepted', '2026-08-31T01:00:01.100Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'receipt',
      attentionKey: 'intent-codex', runtimeRef: 'same-ref',
    }),
    activity('codex-tool', 'tool-started', '2026-08-31T01:00:01.200Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'toolEvents',
      runtimeRef: 'same-ref', turnRef: 'turn-codex', runtimeState: 'working',
    }),
    activity('thread-2-session', 'session-started', '2026-08-31T01:00:02.000Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'externalSessionRef',
      runtimeRef: 'thread-2', runtimeState: 'working', binding: binding('codex', 'thread-2'),
    }),
    activity('thread-2-error', 'harness-error', '2026-08-31T01:00:03.000Z', {
      harness: 'codex', adapter: 'codex-app-server', capability: 'observe',
      runtimeRef: 'thread-2', runtimeState: 'error', attentionKey: 'runtime:thread-2',
    }),
    activity('claude-session', 'session-started', '2026-08-31T01:00:04.000Z', {
      harness: 'claude', adapter: 'claude-code-stream-json', capability: 'externalSessionRef',
      runtimeRef: 'same-ref', runtimeState: 'idle', binding: binding('claude', 'same-ref'),
    }),
    activity('intent-without-runtime', 'handoff-dispatched', '2026-08-31T01:00:05.000Z', {
      harness: 'claude', adapter: 'claude-code-stream-json', capability: 'dispatch',
      attentionKey: 'intent-no-native-ref',
    }),
  ];
  writeFileSync(activityPath, events.map((event) => JSON.stringify({ schemaVersion: 1, event })).join('\n') + '\n');
  const activityBefore = hash(activityPath);
  const canonicalBefore = hash(overlay.projectCanonicalPath);
  const inboxBefore = hash(join(overlay.overlayRoot, 'INBOX.md'));
  const memoryBefore = hash(join(overlay.overlayRoot, 'memory', 'MEMORY.md'));

  const { app, win } = await launchWorkbench(stateDir, overlay.overlayRoot);
  await win.getByRole('button', { name: 'Open workspace and session switcher' }).click();
  const projectOption = win.locator('.project-switcher option').filter({ hasText: 'Creative OS' });
  await win.locator('.project-switcher select').selectOption((await projectOption.getAttribute('value'))!);
  await win.locator('.sidebar-conversations button', { hasText: 'CO 主对话' }).click();

  await expect(win.getByTestId('session-runtime-badge')).toContainText('claude');
  await win.getByTestId('session-runtime-badge').click();
  const runtimeTabColumns = await win.locator('.inspector-tabs').evaluate((node) =>
    getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length);
  expect(runtimeTabColumns).toBe(5);
  await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', 'claude::same-ref');
  await expect(win.getByTestId('runtime-detail')).toContainText('claude::same-ref');
  await expect(win.getByTestId('runtime-detail')).toContainText('same-ref');
  await expect(win.getByTestId('runtime-detail')).toContainText('historical');
  await expect(win.getByTestId('runtime-cancel')).toBeDisabled();
  await expect(win.locator('.runtime-execution-row')).toHaveCount(4);
  await win.getByTestId('runtime-inspect-source').click();
  await expect(win.locator('.inspector-pane')).toHaveCount(0);
  await expect(win.locator('[data-event-ref="claude-session"]')).toHaveClass(/attention-source-focus/);
  await expect(win.locator('.session-surface h1')).toContainText('CO 主对话');

  await expect(win.locator('[data-event-ref="intent-without-runtime"] .activity-inspect')).toHaveCount(0);
  await win.locator('[data-event-ref="codex-tool"] .activity-inspect').click();
  await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', 'codex::same-ref');
  await expect(win.getByTestId('runtime-detail')).toContainText('Tool invocation');
  await win.locator('.inspector-close').click();

  await win.getByRole('button', { name: 'Attention, 1 active item' }).click();
  await win.getByTestId('attention-inspect-runtime').click();
  await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', 'codex::thread-2');
  await win.locator('.inspector-close').click();

  await win.locator('.session-header-actions button', { hasText: 'Evidence' }).click();
  await win.getByTestId('evidence-open-runtime').click();
  await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', 'claude::same-ref');
  await win.locator('.inspector-close').click();

  await win.locator('[data-event-ref="accepted-only"] .activity-inspect').click();
  await expect(win.getByTestId('runtime-detail')).toHaveAttribute('data-execution-id', 'codex::accepted-only');
  await expect(win.getByTestId('runtime-detail')).toContainText('receipt ACCEPTED');
  await expect(win.getByTestId('runtime-detail')).toContainText('UNKNOWN · historical');
  await win.locator('.inspector-close').click();

  expect(hash(activityPath)).toBe(activityBefore);
  expect(hash(overlay.projectCanonicalPath)).toBe(canonicalBefore);
  expect(hash(join(overlay.overlayRoot, 'INBOX.md'))).toBe(inboxBefore);
  expect(hash(join(overlay.overlayRoot, 'memory', 'MEMORY.md'))).toBe(memoryBefore);
  await app.close();
});
