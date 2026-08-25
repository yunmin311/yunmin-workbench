import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInbox } from '../../src/core/parse/inbox';

const fixture = readFileSync(join(__dirname, '../fixtures/INBOX.md'), 'utf8');

describe('parseInbox', () => {
  const items = parseInbox(fixture);

  it('parses open and done items with line numbers back to canonical file', () => {
    expect(items).toHaveLength(4);
    expect(items.filter((i) => i.done)).toHaveLength(1);
    expect(items[0].line).toBe(5);
  });

  it('extracts date and owner', () => {
    expect(items[0].date).toBe('2026-08-19');
    expect(items[0].owner).toBe('用户');
  });

  it('flags attention on open items only', () => {
    expect(items[0].attention).toBe(true);
    expect(items[3].attention).toBe(false); // done
  });
});
