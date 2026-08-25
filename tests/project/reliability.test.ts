import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMemoryBody, watchTargets } from '../../src/main/adapters/overlaySource';

describe('watchTargets scope guard (P6: no watcher scope creep)', () => {
  it('watches only the five canonical targets', () => {
    const t = watchTargets('D:\\ov');
    expect(t).toHaveLength(5);
    expect(t.some((p) => p.includes('node_modules'))).toBe(false);
    expect(t.join('|')).toContain('INBOX.md');
    expect(t.join('|')).toContain('MEMORY.md');
  });
});

describe('readMemoryBody lazy + safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-mem-'));
  mkdirSync(join(root, 'memory'), { recursive: true });
  writeFileSync(join(root, 'memory', 'atom.md'), '正文内容', 'utf8');

  it('loads a body on demand', async () => {
    expect(await readMemoryBody(root, 'atom')).toBe('正文内容');
  });

  it('rejects traversal and never guesses', async () => {
    expect(await readMemoryBody(root, '../outside')).toBeNull();
    expect(await readMemoryBody(root, 'a\\b')).toBeNull();
    expect(await readMemoryBody(root, 'missing')).toBeNull();
  });
});
