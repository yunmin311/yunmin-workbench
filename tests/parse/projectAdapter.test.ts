import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';

const fixture = readFileSync(join(__dirname, '../fixtures/creative-os.adapter.yaml'), 'utf8');

describe('parseProjectAdapter', () => {
  const adapter = parseProjectAdapter(fixture)!;

  it('parses identity and canonical source', () => {
    expect(adapter.projectId).toBe('creative-os');
    expect(adapter.displayName).toBe('Creative OS');
    expect(adapter.canonicalSource?.verification).toBe('VERIFIED');
    expect(adapter.trust).toBe('VERIFIED');
  });

  it('parses roles and gates as plain records', () => {
    expect(adapter.roles).toHaveLength(2);
    expect(adapter.gates.commit_decider).toBe('主对话');
    expect(adapter.gates.history_rewrite_approver).toBe('用户');
  });

  it('returns null when project_id missing', () => {
    expect(parseProjectAdapter('schema_version: 2')).toBeNull();
  });
});
