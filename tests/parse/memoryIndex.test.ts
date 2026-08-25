import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMemoryIndex } from '../../src/core/parse/memoryIndex';

const fixture = readFileSync(join(__dirname, '../fixtures/legacy/MEMORY.md'), 'utf8');

describe('parseMemoryIndex', () => {
  const entries = parseMemoryIndex(fixture);

  it('parses hook lines with categories', () => {
    expect(entries).toHaveLength(3);
    expect(entries[0].category).toBe('用户画像 / 工作纪律');
    expect(entries[2].category).toBe('git / 回复习惯');
    expect(entries[1].id).toBe('fail-closed-not-silent');
  });
});
