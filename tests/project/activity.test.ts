import { appendFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderActivity, projectRuntimeSessions } from '../../src/core/project/activity';
import { appendActivity, clearActivity, readActivity } from '../../src/main/activityPersistence';
import type { ActivityEvent } from '../../src/core/types';

function event(id: string, kind: ActivityEvent['kind'], at: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id,
    projectId: 'creative-os',
    conversationKey: 'creative-os:codex:main',
    kind,
    summary: kind,
    observed: {
      source: 'protocol', sourceRef: `codex-app-server:${kind}`,
      observedAt: at, verification: 'VERIFIED',
    },
    ...extra,
  };
}

describe('runtime observation history', () => {
  it('projects a session binding only from protocol evidence and updates state in event order', () => {
    const events = [
      event('3', 'turn-completed', '2026-08-26T01:00:02.000Z', { harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'idle' }),
      event('1', 'session-started', '2026-08-26T01:00:00.000Z', {
        harness: 'codex',
        runtimeRef: 'thread-1', runtimeState: 'unknown',
        binding: { harness: 'codex', machine: 'machine-1', cwd: '/workbench-fixtures/creative-os', externalSessionRef: 'thread-1' },
      }),
      event('2', 'turn-started', '2026-08-26T01:00:01.000Z', { harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'working' }),
    ];
    expect(orderActivity(events).map((item) => item.id)).toEqual(['1', '2', '3']);
    const sessions = projectRuntimeSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'codex::thread-1', state: 'idle' });
    expect(sessions[0].endedAt).toBeUndefined();
  });

  it('keeps equal native refs from different harnesses as separate executions', () => {
    const codex = event('codex', 'session-started', '2026-08-26T01:00:00.000Z', {
      harness: 'codex', runtimeRef: 'same-native-ref',
      binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'same-native-ref' },
    });
    const claude = event('claude', 'session-started', '2026-08-26T01:00:01.000Z', {
      harness: 'claude', runtimeRef: 'same-native-ref',
      binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'same-native-ref' },
    });
    expect(projectRuntimeSessions([codex, claude]).map((session) => session.id)).toEqual([
      'codex::same-native-ref', 'claude::same-native-ref',
    ]);
  });

  it('does not attach an event without explicit harness identity to a known native ref', () => {
    const started = event('started', 'session-started', '2026-08-26T01:00:00.000Z', {
      harness: 'codex', runtimeRef: 'shared-ref', runtimeState: 'unknown',
      binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'shared-ref' },
    });
    const unscoped = event('unscoped', 'turn-completed', '2026-08-26T01:00:01.000Z', {
      runtimeRef: 'shared-ref', runtimeState: 'idle',
    });
    expect(projectRuntimeSessions([started, unscoped])).toEqual([
      expect.objectContaining({ id: 'codex::shared-ref', state: 'unknown' }),
    ]);
  });

  it('does not create execution evidence when no event carries a protocol binding', () => {
    const local = event('1', 'handoff-dispatched', '2026-08-26T01:00:00.000Z');
    local.observed = { ...local.observed, source: 'process', verification: 'OBSERVED' };
    expect(projectRuntimeSessions([local])).toEqual([]);
  });

  it('restores JSONL history across restart and clearing touches only Workbench state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-'));
    const first = event('1', 'session-started', '2026-08-26T01:00:00.000Z', {
      harness: 'claude', adapter: 'claude-code-stream-json', capability: 'externalSessionRef',
      runtimeRef: 'thread-1',
      binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'thread-1' },
    });
    await appendActivity(root, first);
    expect((await readActivity(root)).events).toEqual([first]);
    const raw = await readFile(join(root, 'activity', 'history.jsonl'), 'utf8');
    expect(raw).toContain('"schemaVersion":1');
    await clearActivity(root);
    expect((await readActivity(root)).events).toEqual([]);
  });

  it('isolates malformed and contradictory runtime identity lines without discarding valid history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-invalid-'));
    const valid = event('valid', 'session-started', '2026-08-26T01:00:00.000Z', {
      harness: 'codex', runtimeRef: 'thread-1',
      binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'thread-1' },
    });
    await appendActivity(root, valid);
    await appendFile(join(root, 'activity', 'history.jsonl'), `${JSON.stringify({
      schemaVersion: 1,
      event: event('bad', 'session-started', '2026-08-26T01:00:01.000Z', {
        harness: 'codex', runtimeRef: 'thread-a',
        binding: { harness: 'claude', machine: 'machine-1', externalSessionRef: 'thread-b' },
      }),
    })}\nnot-json\n`, 'utf8');

    const loaded = await readActivity(root);
    expect(loaded.events).toEqual([valid]);
    expect(loaded.rejectedLines).toBe(2);
    expect(loaded.problem).toContain('isolated 2 malformed line(s)');
  });

  it('keeps a crash-truncated tail isolated while preserving the next valid append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-tail-recovery-'));
    const first = event('first', 'session-started', '2026-08-26T01:00:00.000Z', {
      harness: 'codex', runtimeRef: 'thread-1',
      binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'thread-1' },
    });
    const recovered = event('recovered', 'turn-started', '2026-08-26T01:00:01.000Z', {
      harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'working',
    });
    await appendActivity(root, first);
    await appendFile(join(root, 'activity', 'history.jsonl'), '{"schemaVersion":1,"event":', 'utf8');
    await appendActivity(root, recovered);

    const loaded = await readActivity(root);
    expect(loaded.events).toEqual([first, recovered]);
    expect(loaded.rejectedLines).toBe(1);
  });

  it('projects duplicate event ids deterministically using the last appended record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-duplicate-'));
    const first = event('same-id', 'turn-started', '2026-08-26T01:00:00.000Z', { summary: 'old observation' });
    const corrected = event('same-id', 'turn-completed', '2026-08-26T01:00:01.000Z', { summary: 'new observation' });
    await appendActivity(root, first);
    await appendActivity(root, corrected);

    expect((await readActivity(root)).events).toEqual([corrected]);
  });

  it('serializes concurrent appends and clear in invocation order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-serialization-'));
    await Promise.all(Array.from({ length: 100 }, (_, index) => appendActivity(
      root,
      event(`event-${index}`, 'tool-completed', `2026-08-26T01:00:${String(index % 60).padStart(2, '0')}.000Z`),
    )));
    expect((await readActivity(root)).events).toHaveLength(100);

    const beforeClear = appendActivity(root, event('before-clear', 'turn-started', '2026-08-26T02:00:00.000Z'));
    const clearing = clearActivity(root);
    const afterClear = appendActivity(root, event('after-clear', 'turn-started', '2026-08-26T02:00:01.000Z'));
    await Promise.all([beforeClear, clearing, afterClear]);
    expect((await readActivity(root)).events.map((item) => item.id)).toEqual(['after-clear']);
  });
});
