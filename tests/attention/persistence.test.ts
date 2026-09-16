import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dismissAttention, readAttentionLocalState } from '../../src/main/attentionPersistence';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('Attention local persistence', () => {
  it('quarantines corrupt v1 local state but rejects a future schema without overwriting it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-attention-corrupt-'));
    const stateDir = join(root, 'state');
    const dir = join(stateDir, 'attention');
    const file = join(dir, 'local-v1.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{broken', 'utf8');
    expect(await readAttentionLocalState(stateDir)).toEqual({ schemaVersion: 1, dismissed: {} });
    expect(readdirSync(dir).some((name) => name.startsWith('local-v1.json.rejected-'))).toBe(true);
    await dismissAttention(stateDir, 'attention:receipt:recovered', '2026-09-16T00:00:00Z');
    expect((await readAttentionLocalState(stateDir)).dismissed).toHaveProperty('attention:receipt:recovered');

    writeFileSync(file, JSON.stringify({ schemaVersion: 2, dismissed: {} }), 'utf8');
    await expect(readAttentionLocalState(stateDir)).rejects.toThrow(/unsupported attention local schema/i);
    expect(readFileSync(file, 'utf8')).toContain('"schemaVersion":2');
  });

  it('restores a dismissal across restart and never writes the external source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-attention-'));
    const external = join(root, 'external-source.jsonl');
    writeFileSync(external, '{"external":true}\n');
    const before = hash(external);

    await dismissAttention(join(root, 'state'), 'attention:receipt:one', '2026-08-30T10:00:00Z');
    expect(await readAttentionLocalState(join(root, 'state'))).toEqual({
      schemaVersion: 1,
      dismissed: { 'attention:receipt:one': '2026-08-30T10:00:00Z' },
    });
    expect(hash(external)).toBe(before);
  });

  it('does not let a late older dismissal replace a newer observed version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-attention-order-'));
    const stateDir = join(root, 'state');
    await Promise.all([
      dismissAttention(stateDir, 'attention:runtime:one', '2026-08-30T10:02:00Z'),
      dismissAttention(stateDir, 'attention:runtime:one', '2026-08-30T10:01:00Z'),
    ]);
    expect((await readAttentionLocalState(stateDir)).dismissed['attention:runtime:one'])
      .toBe('2026-08-30T10:02:00Z');
  });
});
