import { mkdtemp, readFile } from 'node:fs/promises';
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
      event('3', 'turn-completed', '2026-08-26T01:00:02.000Z', { runtimeRef: 'thread-1', runtimeState: 'idle' }),
      event('1', 'session-started', '2026-08-26T01:00:00.000Z', {
        runtimeRef: 'thread-1', runtimeState: 'unknown',
        binding: { harness: 'codex', machine: 'machine-1', cwd: '/workbench-fixtures/creative-os', externalSessionRef: 'thread-1' },
      }),
      event('2', 'turn-started', '2026-08-26T01:00:01.000Z', { runtimeRef: 'thread-1', runtimeState: 'working' }),
    ];
    expect(orderActivity(events).map((item) => item.id)).toEqual(['1', '2', '3']);
    const sessions = projectRuntimeSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'thread-1', state: 'idle' });
    expect(sessions[0].endedAt).toBeUndefined();
  });

  it('does not create execution evidence when no event carries a protocol binding', () => {
    const local = event('1', 'handoff-dispatched', '2026-08-26T01:00:00.000Z');
    local.observed = { ...local.observed, source: 'process', verification: 'OBSERVED' };
    expect(projectRuntimeSessions([local])).toEqual([]);
  });

  it('restores JSONL history across restart and clearing touches only Workbench state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-'));
    const first = event('1', 'session-started', '2026-08-26T01:00:00.000Z', {
      runtimeRef: 'thread-1',
      binding: { harness: 'codex', machine: 'machine-1', externalSessionRef: 'thread-1' },
    });
    await appendActivity(root, first);
    expect((await readActivity(root)).events).toEqual([first]);
    const raw = await readFile(join(root, 'activity', 'history.jsonl'), 'utf8');
    expect(raw).toContain('"schemaVersion":1');
    await clearActivity(root);
    expect((await readActivity(root)).events).toEqual([]);
  });
});
