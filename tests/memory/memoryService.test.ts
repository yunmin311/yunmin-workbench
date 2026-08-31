import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryService } from '../../src/main/history/historyService';
import { MemoryService } from '../../src/main/memory/memoryService';

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wb-memory-'));
  const stateDir = join(root, 'user-data', 'state');
  const historyRoot = join(root, 'codex');
  mkdirSync(join(historyRoot, '2026', '08', '31'), { recursive: true });
  const source = join(historyRoot, '2026', '08', '31', 'rollout.jsonl');
  writeFileSync(source,
    line({ timestamp: '2026-08-31T08:00:00Z', type: 'session_meta', payload: { id: 'memory-session' } }) +
    line({ timestamp: '2026-08-31T08:01:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[memory fact] Portability is closed' }] } }),
  );
  const history = new HistoryService({ stateDir, roots: [{ harness: 'codex', root: historyRoot }] });
  return { root, stateDir, historyRoot, source, service: new MemoryService(stateDir, history) };
}

describe('MemoryService', () => {
  it('searches compact projections, expands raw evidence, and retrieval does not record use', async () => {
    const f = fixture();
    const before = hash(f.source);
    const result = await f.service.search({ text: 'portability' });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).not.toHaveProperty('body');
    expect(await f.service.readUseState()).toEqual({ schemaVersion: 1, uses: {} });
    const expanded = await f.service.expand(result.hits[0].id);
    expect(expanded?.messages[0]).toMatchObject({ text: '[memory fact] Portability is closed', observed: { sourceRef: expect.stringMatching(/^history:/) } });
    expect(expanded?.evidence).toMatchObject({ verdict: 'SUFFICIENT', nextStrategy: 'NONE' });
    expect(hash(f.source)).toBe(before);

    await f.service.recordMemoryUse(result.hits[0].id);
    expect((await f.service.readUseState()).uses[result.hits[0].id]).toMatchObject({ count: 1 });
  });

  it('keeps bad or missing source isolated and never writes History source files', async () => {
    const f = fixture();
    const bad = join(f.historyRoot, '2026', '08', '31', 'bad.jsonl');
    writeFileSync(bad, '{broken\n');
    const before = [hash(f.source), hash(bad)];
    const result = await f.service.search({ text: 'portability' });
    expect(result.hits).toHaveLength(1);
    expect(result.problems).toContainEqual(expect.objectContaining({ kind: 'json_parse' }));
    expect([hash(f.source), hash(bad)]).toEqual(before);

    rmSync(f.source);
    const invalid = await f.service.search({ text: 'portability', includeInvalid: true });
    expect(invalid.hits[0].currentness).toBe('INVALID');
    expect(await f.service.expand(invalid.hits[0].id)).toMatchObject({
      messages: [], missingSourceRefs: [expect.stringMatching(/^history:/)],
      evidence: { verdict: 'PARTIAL', nextStrategy: 'REFRESH_SOURCE' },
    });
  });
});
