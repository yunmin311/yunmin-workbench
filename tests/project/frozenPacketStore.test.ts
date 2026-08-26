import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TaskPacket } from '../../src/core/types';
import {
  frozenPacketDir,
  listFrozenPackets,
  readFrozenPacketDetail,
  writeFrozenPacket,
} from '../../src/main/frozenPacketStore';

function packet(overrides: Partial<TaskPacket> = {}): TaskPacket {
  return {
    schemaVersion: 1,
    packetId: 'p-' + Math.random().toString(36).slice(2),
    createdAt: '2026-08-26T00:00:00.000Z',
    projectId: 'demo',
    conversationKey: 'demo::claude::main',
    taskSummary: 'task',
    governanceRefs: [],
    included: [],
    references: [],
    sourceFingerprints: [],
    unresolvedDependencies: [],
    roughTokens: 0,
    ...overrides,
  };
}

const root = () => mkdtempSync(join(tmpdir(), 'wb-frozen-store-'));
const CONV = 'demo::claude::main';

describe('frozen packet store (failure injection, ported from qa/frozen-store-failure-injection)', () => {
  it('T1: one corrupted sibling must not hide every frozen packet', async () => {
    const state = root();
    await writeFrozenPacket(state, packet({ taskSummary: 'v1' }));
    await writeFrozenPacket(state, packet({ taskSummary: 'v2' }));
    const convDir = frozenPacketDir(state, 'demo', CONV);
    writeFileSync(join(convDir, 'v3-broken.json'), '{"schemaVersion":1,"packetI', 'utf8');

    const listed = await listFrozenPackets(state, 'demo', CONV);
    expect(listed.packets.map((p) => p.taskSummary)).toEqual(['v1', 'v2']);
    expect(listed.problems.some((p) => p.file === 'v3-broken.json')).toBe(true);
  });

  it('T2: a corrupt sibling must not reset version numbering or overwrite a frozen file', async () => {
    const state = root();
    const first = await writeFrozenPacket(state, packet({ taskSummary: 'original' }));
    const v1Before = readFileSync(first.path, 'utf8');
    const convDir = frozenPacketDir(state, 'demo', CONV);
    writeFileSync(join(convDir, 'v9-corrupt.json'), '{not json', 'utf8');

    const refrozen = await writeFrozenPacket(state, packet({ taskSummary: 'original' }));

    expect(refrozen.frozen.version).toBe(2);
    expect(readFileSync(first.path, 'utf8')).toBe(v1Before);
    expect(readFileSync(join(convDir, 'v9-corrupt.json'), 'utf8')).toBe('{not json');
  });

  it('T3: concurrent freezes of different packets must allocate distinct versions', async () => {
    const state = root();
    const [a, b] = await Promise.all([
      writeFrozenPacket(state, packet({ taskSummary: 'a' })),
      writeFrozenPacket(state, packet({ taskSummary: 'b' })),
    ]);
    expect(a.frozen.version).not.toBe(b.frozen.version);
    expect(a.path).not.toBe(b.path);
    const listed = await listFrozenPackets(state, 'demo', CONV);
    expect(new Set(listed.packets.map((p) => p.version)).size).toBe(listed.packets.length);
  });

  it('T4: rapid double-freeze serializes into distinct versions (no duplicate v1)', async () => {
    const state = root();
    const samePacket = packet({ taskSummary: 'double click' });
    const results = await Promise.all([
      writeFrozenPacket(state, samePacket),
      writeFrozenPacket(state, samePacket),
      writeFrozenPacket(state, samePacket),
    ]);
    expect(results.map((r) => r.frozen.version).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const listed = await listFrozenPackets(state, 'demo', CONV);
    expect(listed.packets).toHaveLength(3);
    expect(listed.problems).toHaveLength(0);
  });

  it('T5: an existing frozen file is never silently overwritten', async () => {
    const state = root();
    const first = await writeFrozenPacket(state, packet({ taskSummary: 'original' }));
    const before = readFileSync(first.path, 'utf8');
    await expect(writeFrozenPacket(state, packet({ taskSummary: 'other' }))).resolves.toMatchObject({
      frozen: { version: 2 },
    });
    expect(readFileSync(first.path, 'utf8')).toBe(before);
  });

  it('T6: a structurally wrong file is reported and excluded, not trusted', async () => {
    const state = root();
    const convDir = frozenPacketDir(state, 'demo', CONV);
    mkdirSync(convDir, { recursive: true });
    writeFileSync(
      join(convDir, 'v1-fake.json'),
      JSON.stringify({ schemaVersion: 1, version: 1, hash: 'not-a-hash', taskSummary: 'fake' }),
      'utf8',
    );
    const listed = await listFrozenPackets(state, 'demo', CONV);
    expect(listed.packets).toHaveLength(0);
    expect(listed.problems.some((p) => p.file === 'v1-fake.json')).toBe(true);
    const next = await writeFrozenPacket(state, packet({ taskSummary: 'fresh' }));
    expect(next.frozen.version).toBe(1);
  });

  it('T7: atomic writes leave no temp files behind on success', async () => {
    const state = root();
    await writeFrozenPacket(state, packet({ taskSummary: 'clean' }));
    const convDir = frozenPacketDir(state, 'demo', CONV);
    const leftovers = readdirSync(convDir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
    expect(existsSync(join(convDir, 'v1-'))).toBe(false);
  });

  it('T8: listing returns summaries without dragging full bodies across the boundary', async () => {
    const state = root();
    await writeFrozenPacket(state, packet({
      taskSummary: 'big',
      included: [{
        id: 'ctx', title: 'Context', source: 'manual', body: 'x'.repeat(50_000),
        state: 'included', pinned: false, isReference: false,
      }],
    }));
    const listed = await listFrozenPackets(state, 'demo', CONV);
    expect(listed.packets).toHaveLength(1);
    const summary = listed.packets[0] as unknown as Record<string, unknown>;
    expect(summary).not.toHaveProperty('included');
    expect(summary).not.toHaveProperty('references');
    expect(summary).toHaveProperty('hash');
    expect(summary).toHaveProperty('roughTokens');
    expect(summary).toHaveProperty('sourceFingerprints');
    expect(summary).toHaveProperty('unresolvedDependencies');
  });

  it('T9: detail reads return the full immutable packet by version or hash', async () => {
    const state = root();
    const { frozen } = await writeFrozenPacket(state, packet({
      taskSummary: 'detail',
      included: [{
        id: 'ctx', title: 'Context', source: 'manual', body: 'body-content',
        state: 'included', pinned: false, isReference: false,
      }],
    }));
    const byVersion = await readFrozenPacketDetail(state, 'demo', CONV, { version: frozen.version });
    expect(byVersion?.included[0]?.body).toBe('body-content');
    expect(byVersion?.hash).toBe(frozen.hash);
    const byHash = await readFrozenPacketDetail(state, 'demo', CONV, { hash: frozen.hash });
    expect(byHash?.taskSummary).toBe('detail');
    expect(await readFrozenPacketDetail(state, 'demo', CONV, { version: 99 })).toBeNull();
    expect(await readFrozenPacketDetail(state, 'demo', CONV, { hash: 'b'.repeat(64) })).toBeNull();
  });

  it('T10: version numbering continues over gaps from valid history only', async () => {
    const state = root();
    await writeFrozenPacket(state, packet({ taskSummary: 'v1' }));
    await writeFrozenPacket(state, packet({ taskSummary: 'v2' }));
    await writeFrozenPacket(state, packet({ taskSummary: 'v3' }));
    const convDir = frozenPacketDir(state, 'demo', CONV);
    writeFileSync(join(convDir, 'v7-corrupt.json'), 'garbage', 'utf8');
    const next = await writeFrozenPacket(state, packet({ taskSummary: 'v4' }));
    expect(next.frozen.version).toBe(4);
  });
});
