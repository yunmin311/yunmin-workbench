import { appendFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderActivity, projectRuntimeSessions } from '../../src/core/project/activity';
import { projectRuntimeExecutions } from '../../src/core/project/runtimeInspector';
import { appendActivity, clearActivity, readActivity, readActivityPage } from '../../src/main/activityPersistence';
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

  it('loads Activity from disk in bounded newest-first pages without losing chronology', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-pages-'));
    const path = join(root, 'activity', 'history.jsonl');
    await appendActivity(root, event('seed', 'session-started', '2026-08-26T00:00:00.000Z'));
    const lines = Array.from({ length: 500 }, (_, index) => JSON.stringify({
      schemaVersion: 1,
      event: event(`page-${index}`, 'tool-completed', `2026-08-26T01:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`),
    }));
    await appendFile(path, `${lines.join('\n')}\n{partial-tail`, 'utf8');

    const latest = await readActivityPage(root, { limit: 200 });
    expect(latest.events).toHaveLength(200);
    expect(latest.events.at(0)?.id).toBe('page-300');
    expect(latest.events.at(-1)?.id).toBe('page-499');
    expect(latest.hasEarlier).toBe(true);
    expect(latest.rejectedLines).toBe(1);

    const earlier = await readActivityPage(root, { limit: 200, beforeByte: latest.nextBeforeByte });
    expect(earlier.events.at(0)?.id).toBe('page-100');
    expect(earlier.events.at(-1)?.id).toBe('page-299');
  });

  it('reports an unreadable Activity path instead of presenting an empty healthy page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-unreadable-'));
    await mkdir(join(root, 'activity', 'history.jsonl'), { recursive: true });
    const loaded = await readActivityPage(root);
    expect(loaded.events).toEqual([]);
    expect(loaded.problem).toContain('Activity history rejected');
    expect(loaded.rejectedLines).toBe(0);
    // an unreadable store must be distinguishable from a healthy empty one
    expect(loaded.ioFailed).toBe(true);
    expect(loaded.hasEarlier).toBe(false);
  });

  it('paging to exhaustion reproduces the whole history exactly once and terminates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-exhaust-'));
    const total = 250;
    for (let index = 0; index < total; index += 1) {
      await appendActivity(root, event(`paging-${String(index).padStart(3, '0')}`, 'tool-completed',
        `2026-08-26T02:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`));
    }

    const collected: ActivityEvent[] = [];
    let cursor: number | undefined;
    let pages = 0;
    for (;;) {
      pages += 1;
      expect(pages).toBeLessThan(50);
      const page: Awaited<ReturnType<typeof readActivityPage>> = await readActivityPage(root, { limit: 100, beforeByte: cursor });
      // every page is internally chronological, so the renderer can prepend it as-is
      expect(page.events.map((item) => item.observed.observedAt)).toEqual(
        [...page.events].sort((a, b) => a.observed.observedAt.localeCompare(b.observed.observedAt))
          .map((item) => item.observed.observedAt),
      );
      for (const item of page.events) collected.push(item);
      const previous = cursor;
      cursor = page.nextBeforeByte;
      if (!page.hasEarlier) {
        // the terminal page leaves no cursor behind, so the UI cannot loop forever
        expect(cursor).toBeUndefined();
        break;
      }
      expect(cursor).toBeTypeOf('number');
      // the byte cursor strictly retreats, so paging can never repeat a window
      if (previous !== undefined) expect(cursor!).toBeLessThan(previous);
    }

    const ids = collected.map((item) => item.id);
    expect(new Set(ids).size).toBe(total);
    expect(ids).toHaveLength(total);
    const whole = await readActivity(root);
    expect(collected.map((item) => item.id).sort()).toEqual(whole.events.map((item) => item.id).sort());
  });

  it('keeps execution identity stable no matter how the history was paged in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-identity-'));
    const binding = { harness: 'codex', machine: 'machine-1', cwd: '/workbench-fixtures/creative-os', externalSessionRef: 'thread-1' } as const;
    await appendActivity(root, event('old-start', 'session-started', '2026-08-26T03:00:00.000Z', {
      harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'unknown', binding,
    }));
    await appendActivity(root, event('old-turn', 'turn-completed', '2026-08-26T03:00:01.000Z', {
      harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'idle',
    }));
    await appendActivity(root, event('new-turn', 'turn-started', '2026-08-26T03:00:02.000Z', {
      harness: 'codex', runtimeRef: 'thread-1', runtimeState: 'working',
    }));

    const newest = await readActivityPage(root, { limit: 1 });
    expect(newest.events.map((item) => item.id)).toEqual(['new-turn']);
    // a page that cannot see the binding event must not claim a resolved session
    expect(projectRuntimeSessions(newest.events)).toEqual([]);
    const partial = projectRuntimeExecutions(newest.events);
    expect(partial).toHaveLength(1);
    expect(partial[0].executionId).toBe('codex::thread-1');
    expect(partial[0].binding).toBeNull();
    expect(partial[0].events.map((item) => item.id)).toEqual(['new-turn']);

    const earlier = await readActivityPage(root, { limit: 1_000, beforeByte: newest.nextBeforeByte });
    const merged = orderActivity([...newest.events, ...earlier.events]);
    expect(merged.map((item) => item.id)).toEqual(['old-start', 'old-turn', 'new-turn']);
    const sessions = projectRuntimeSessions(merged);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('codex::thread-1');
    // identity and chronology are identical to a single whole-file read
    const whole = projectRuntimeSessions((await readActivity(root)).events);
    expect(sessions[0].id).toBe(whole[0].id);
    expect(sessions[0].binding).toEqual(whole[0].binding);

    const executions = projectRuntimeExecutions(merged);
    expect(executions).toHaveLength(1);
    // identity is byte-identical before and after paging; only the evidence grows
    expect(executions[0].executionId).toBe(partial[0].executionId);
    expect(executions[0].nativeRef).toBe('thread-1');
    expect(executions[0].harness).toBe('codex');
    expect(executions[0].binding).toEqual(binding);
    expect(executions[0].events.map((item) => item.id)).toEqual(['old-start', 'old-turn', 'new-turn']);
  });

  it('caps a pathological page scan at 8MB and still makes forward progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-activity-capped-'));
    const path = join(root, 'activity', 'history.jsonl');
    await appendActivity(root, event('anchor', 'session-started', '2026-08-26T04:00:00.000Z'));
    // 12MB of unparseable payload reaches the page budget in every window
    const junk = `${'x'.repeat(1024)}\n`.repeat(1024);
    for (let index = 0; index < 12; index += 1) await appendFile(path, junk, 'utf8');

    const started = Date.now();
    const page = await readActivityPage(root, { limit: 10 });
    // the scan is linear in the page budget, so even a wholly corrupt 8MB window
    // must not stall the IPC call or the Doctor run
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(page.scanCapped).toBe(true);
    expect(page.rejectedLines).toBeGreaterThan(0);
    expect(page.ioFailed).toBeUndefined();
    expect(page.problem).toContain('capped');
    // the cursor still moves backwards, so the UI cannot stall on one window
    expect(page.hasEarlier).toBe(true);
    const next = await readActivityPage(root, { limit: 10, beforeByte: page.nextBeforeByte });
    expect(next.nextBeforeByte === undefined || next.nextBeforeByte < (page.nextBeforeByte ?? 0)).toBe(true);
  });
});
