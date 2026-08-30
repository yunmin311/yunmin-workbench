import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonlFromOffset } from '../../src/main/history/jsonlFile';

describe('incremental JSONL reader', () => {
  it('advances only through complete lines and resumes a partial tail by byte offset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-history-jsonl-'));
    const file = join(root, 'session.jsonl');
    writeFileSync(file, '{"n":1}\n{"n":', 'utf8');

    const first = await readJsonlFromOffset(file, 0, 0, 5);
    expect(first.lines).toEqual([{ lineNumber: 1, text: '{"n":1}' }]);
    expect(first.newOffset).toBe(Buffer.byteLength('{"n":1}\n'));
    expect(first.partialTailBytes).toBe(Buffer.byteLength('{"n":'));

    appendFileSync(file, '2}\n', 'utf8');
    const second = await readJsonlFromOffset(file, first.newOffset, first.newLineCursor, 4);
    expect(second.lines).toEqual([{ lineNumber: 2, text: '{"n":2}' }]);
    expect(second.partialTailBytes).toBe(0);
  });
});
