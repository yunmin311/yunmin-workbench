import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkJsonl } from '../../src/main/history/discovery';

describe('history discovery isolation', () => {
  it('keeps valid transcripts when one nested directory is unreadable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-history-discovery-'));
    const valid = join(root, 'valid.jsonl');
    const blocked = join(root, 'blocked');
    mkdirSync(blocked);
    writeFileSync(valid, '{}\n');
    writeFileSync(join(blocked, 'hidden.jsonl'), '{}\n');
    const problems: string[] = [];

    const files = await walkJsonl(root, (directory) => problems.push(directory), async (directory) => {
      if (directory === blocked) throw new Error('fixture unreadable');
      return readdir(directory, { withFileTypes: true });
    });

    expect(files).toEqual([valid]);
    expect(problems).toEqual([blocked]);
  });
});
