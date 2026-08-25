import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry } from '../../src/core/parse/dialogueRegistry';
import { parseMachineProfile } from '../../src/core/parse/machineProfile';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';

/**
 * Migration boundary (rule §5): parsers fail loudly on unknown schema versions
 * so the adapter surfaces problems[] instead of silently misparsing.
 */
describe('schema version guards (MIGRATING boundary)', () => {
  it('dialogue registry: unknown version throws', () => {
    expect(() =>
      parseDialogueRegistry('schema_version: 99\ndialogues: []'),
    ).toThrow(/schema_version/);
  });

  it('dialogue registry: legacy v1 still parses', () => {
    expect(
      parseDialogueRegistry('schema_version: 1\ndialogues: [{role: r, project: p, platform: claude, status: ACTIVE}]'),
    ).toHaveLength(1);
  });

  it('project adapter: unknown version throws', () => {
    expect(() =>
      parseProjectAdapter('schema_version: 99\nproject_id: x'),
    ).toThrow(/schema_version/);
  });

  it('machine profile: unknown version throws', () => {
    expect(() =>
      parseMachineProfile('schema_version: 99\nprofile_type: machine\ndevice_id: m'),
    ).toThrow(/schema_version/);
  });
});
