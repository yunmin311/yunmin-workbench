import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryService } from '../../src/main/history/historyService';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wb-history-service-'));
  const stateDir = join(root, 'user-data', 'state');
  const claudeRoot = join(root, 'claude');
  const codexRoot = join(root, 'codex');
  mkdirSync(join(claudeRoot, 'encoded-project'), { recursive: true });
  mkdirSync(join(codexRoot, '2026', '08', '30'), { recursive: true });
  return { root, stateDir, claudeRoot, codexRoot };
}

describe('HistoryService', () => {
  it('discovers Claude and Codex, exposes provenance/problems, and never writes source files', async () => {
    const f = fixture();
    const claudeFile = join(f.claudeRoot, 'encoded-project', 'claude.jsonl');
    const codexFile = join(f.codexRoot, '2026', '08', '30', 'rollout.jsonl');
    const badFile = join(f.claudeRoot, 'encoded-project', 'bad.jsonl');
    writeFileSync(claudeFile,
      line({ type: 'user', sessionId: 'claude-1', cwd: 'E:\\alpha', timestamp: '2026-08-30T10:00:00Z', message: { role: 'user', content: 'violet history' } }) +
      line({ type: 'assistant', sessionId: 'claude-1', timestamp: '2026-08-30T10:01:00Z', message: { role: 'assistant', content: 'claude answer' } }),
    );
    writeFileSync(codexFile,
      line({ timestamp: '2026-08-30T11:00:00Z', type: 'session_meta', payload: { id: 'codex-1', cwd: 'E:\\beta', model_provider: 'openai' } }) +
      line({ timestamp: '2026-08-30T11:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'violet codex' }] } }),
    );
    writeFileSync(badFile, '{broken\n' + line({ type: 'user', sessionId: 'claude-bad', message: { role: 'user', content: 'survives malformed neighbor' } }));
    const before = [hash(claudeFile), hash(codexFile), hash(badFile)];

    const service = new HistoryService({ stateDir: f.stateDir, roots: [
      { harness: 'claude-code', root: f.claudeRoot },
      { harness: 'codex', root: f.codexRoot },
    ] });
    const result = await service.search({ text: 'violet' });

    expect(result.hits.map((hit) => hit.session.sessionId).sort()).toEqual(['claude-code::claude-1', 'codex::codex-1']);
    expect(result.hits.every((hit) => hit.session.observed.sourceRef.startsWith('history:'))).toBe(true);
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'json_parse', lineNumber: 1 })]);
    expect([hash(claudeFile), hash(codexFile), hash(badFile)]).toEqual(before);
    expect(readFileSync(join(f.stateDir, 'history', 'index-v1.json'), 'utf8')).toContain('claude-code::claude-1');

    rmSync(join(f.stateDir, 'history'), { recursive: true });
    const rebuilt = await new HistoryService({ stateDir: f.stateDir, roots: [
      { harness: 'claude-code', root: f.claudeRoot },
      { harness: 'codex', root: f.codexRoot },
    ] }).search({ text: 'violet' });
    expect(rebuilt.hits).toHaveLength(2);
    expect([hash(claudeFile), hash(codexFile), hash(badFile)]).toEqual(before);
  });

  it('invalidates a same-size file replacement when its mtime changes', async () => {
    const f = fixture();
    const file = join(f.claudeRoot, 'encoded-project', 'same-size.jsonl');
    writeFileSync(file, line({ type: 'user', sessionId: 'claude-old', message: { role: 'user', content: 'old-marker' } }));
    const size = statSync(file).size;
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'claude-code', root: f.claudeRoot }] });
    expect((await service.search({ text: 'old-marker' })).hits).toHaveLength(1);

    writeFileSync(file, line({ type: 'user', sessionId: 'claude-new', message: { role: 'user', content: 'new-marker' } }));
    expect(statSync(file).size).toBe(size);
    const future = new Date(Date.now() + 2_000);
    utimesSync(file, future, future);
    expect((await service.search({ text: 'old-marker' })).hits).toEqual([]);
    expect((await service.search({ text: 'new-marker' })).hits[0].session.sessionId).toBe('claude-code::claude-new');
  });

  it('invalidates a larger replacement that preserves both sampled ends but changes the middle', async () => {
    const f = fixture();
    const file = join(f.claudeRoot, 'encoded-project', 'long-prefix.jsonl');
    const prefix = line({ type: 'user', sessionId: 'claude-prefix', message: { role: 'user', content: `shared-${'p'.repeat(5_000)}` } });
    const stableTail = line({ type: 'assistant', sessionId: 'claude-prefix', message: { role: 'assistant', content: `stable-${'t'.repeat(5_000)}` } });
    writeFileSync(file, prefix + line({ type: 'assistant', sessionId: 'claude-prefix', message: { role: 'assistant', content: 'old-middle' } }) + stableTail);
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'claude-code', root: f.claudeRoot }] });
    expect((await service.search({ text: 'old-middle' })).hits).toHaveLength(1);

    writeFileSync(file, prefix + line({ type: 'assistant', sessionId: 'claude-prefix', message: { role: 'assistant', content: 'new-middle' } }) + stableTail + line({ type: 'assistant', sessionId: 'claude-prefix', message: { role: 'assistant', content: 'appended-after-replacement' } }));
    const future = new Date(Date.now() + 2_000);
    utimesSync(file, future, future);
    expect((await service.search({ text: 'old-middle' })).hits).toEqual([]);
    expect((await service.search({ text: 'new-middle' })).hits).toHaveLength(1);
  });

  it('ignores a structurally corrupt cache and rebuilds it from sources', async () => {
    const f = fixture();
    const file = join(f.claudeRoot, 'encoded-project', 'valid.jsonl');
    writeFileSync(file, line({ type: 'user', sessionId: 'claude-cache', message: { role: 'user', content: 'cache-rebuild-marker' } }));
    mkdirSync(join(f.stateDir, 'history'), { recursive: true });
    writeFileSync(join(f.stateDir, 'history', 'index-v1.json'), JSON.stringify({ schemaVersion: 1, files: { broken: null } }));
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'claude-code', root: f.claudeRoot }] });
    const result = await service.search({ text: 'cache-rebuild-marker' });
    expect(result.hits).toHaveLength(1);
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'cache_corrupt' })]);
  });

  it('returns a session when lexical text matches only observed metadata', async () => {
    const f = fixture();
    const file = join(f.claudeRoot, 'encoded-project', 'metadata.jsonl');
    writeFileSync(file,
      line({ type: 'user', sessionId: 'claude-meta', cwd: 'E:\\unique-cwd-marker', message: { role: 'user', content: 'ordinary body' } }) +
      line({ type: 'ai-title', sessionId: 'claude-meta', aiTitle: 'Unique Title Marker' }),
    );
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'claude-code', root: f.claudeRoot }] });
    expect((await service.search({ text: 'unique title marker' })).hits).toHaveLength(1);
    expect((await service.search({ text: 'unique-cwd-marker' })).hits).toHaveLength(1);
  });

  it('indexes only an appended tail, then invalidates on truncate, replacement, and deletion', async () => {
    const f = fixture();
    const file = join(f.claudeRoot, 'encoded-project', 'session.jsonl');
    writeFileSync(file, line({ type: 'user', sessionId: 'claude-append', message: { role: 'user', content: 'first-only' } }));
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'claude-code', root: f.claudeRoot }] });

    const first = await service.search({ text: 'first-only' });
    expect(first.stats).toMatchObject({ filesIndexed: 1, filesSkipped: 0, messages: 1 });
    const unchanged = await service.search({ text: 'first-only' });
    expect(unchanged.stats).toMatchObject({ filesIndexed: 0, filesSkipped: 1, messages: 1 });

    appendFileSync(file, line({ type: 'assistant', sessionId: 'claude-append', message: { role: 'assistant', content: 'appended-only' } }));
    const appended = await service.search({ text: 'appended-only' });
    expect(appended.stats).toMatchObject({ filesIndexed: 1, messages: 2 });
    expect((await service.detail('claude-code::claude-append'))?.messages.map((message) => message.seq)).toEqual([0, 1]);

    writeFileSync(file, line({ type: 'user', sessionId: 'claude-truncated', message: { role: 'user', content: 'replacement-short' } }));
    expect((await service.search({ text: 'first-only' })).hits).toEqual([]);
    expect((await service.search({ text: 'replacement-short' })).hits[0].session.sessionId).toBe('claude-code::claude-truncated');

    writeFileSync(file, line({ type: 'user', sessionId: 'claude-replaced', message: { role: 'user', content: 'replacement-long-with-a-new-prefix-and-body' } }));
    expect((await service.search({ text: 'replacement-short' })).hits).toEqual([]);
    expect((await service.search({ text: 'new-prefix' })).hits[0].session.sessionId).toBe('claude-code::claude-replaced');

    rmSync(file);
    expect((await service.search({ text: 'new-prefix' })).hits).toEqual([]);
    expect((await service.list()).sessions).toEqual([]);
  });

  it('leaves an incomplete trailing line unconsumed and reports it until completion', async () => {
    const f = fixture();
    const file = join(f.codexRoot, '2026', '08', '30', 'partial.jsonl');
    writeFileSync(file,
      line({ timestamp: '2026-08-30T11:00:00Z', type: 'session_meta', payload: { id: 'codex-partial' } }) +
      '{"timestamp":"2026-08-30T11:01:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"partial',
    );
    const service = new HistoryService({ stateDir: f.stateDir, roots: [{ harness: 'codex', root: f.codexRoot }] });
    const partial = await service.list();
    expect(partial.problems).toEqual([expect.objectContaining({ kind: 'truncated_source' })]);

    appendFileSync(file, ' completed"}]}}\n');
    const completed = await service.search({ text: 'partial completed' });
    expect(completed.hits).toHaveLength(1);
    expect(completed.problems).toEqual([]);
  });
});
