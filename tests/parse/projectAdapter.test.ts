import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';

const fixture = readFileSync(join(__dirname, '../fixtures/legacy/creative-os.adapter.yaml'), 'utf8');

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

  it('preserves canonical fact discovery locators without promoting them to facts', () => {
    const parsed = parseProjectAdapter(`
schema_version: 2
project_id: creative-os
canonical_source:
  repository: yunmin311/creative-os
  remote: https://github.com/yunmin311/creative-os.git
  commit: 50e0eb1750e8e1441accc2d5e706acb60eacd7c0
  verification: VERIFIED
canonical_fact_sources:
  - kind: WORK
    source_ref: specs/001-inspiration-capture/canonical-facts.yaml#works
    format: YAML
    verification: VERIFIED
  - kind: FUTURE_KIND
    source_ref: future.yaml#facts
    format: YAML
    verification: UNVERIFIED
`)!;

    expect((parsed as { canonicalFactSources?: unknown }).canonicalFactSources).toEqual([
      {
        kind: 'WORK',
        sourceRef: 'specs/001-inspiration-capture/canonical-facts.yaml#works',
        format: 'YAML',
        verification: 'VERIFIED',
      },
      {
        kind: 'FUTURE_KIND',
        sourceRef: 'future.yaml#facts',
        format: 'YAML',
        verification: 'UNVERIFIED',
      },
    ]);
  });
});
