import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readAmbientPreference,
  writeAmbientPreferenceAtomic,
} from '../../src/main/ambientPersistence';

describe('Ambient Island Workbench-local preference', () => {
  it('round-trips enable, expansion, and position atomically across restart', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wb-ambient-'));
    const preference = { schemaVersion: 1 as const, enabled: true, expanded: true, x: 120, y: 18 };
    await writeAmbientPreferenceAtomic(stateDir, preference);
    expect(await readAmbientPreference(stateDir)).toEqual(preference);
    expect(JSON.parse(await readFile(join(stateDir, 'ambient', 'island-v1.json'), 'utf8'))).toEqual(preference);
  });

  it('isolates malformed preference state and falls back disabled', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wb-ambient-bad-'));
    await writeAmbientPreferenceAtomic(stateDir, { schemaVersion: 1, enabled: true, expanded: false });
    await writeFile(join(stateDir, 'ambient', 'island-v1.json'), '{broken', 'utf8');
    expect(await readAmbientPreference(stateDir)).toEqual({ schemaVersion: 1, enabled: false, expanded: false });
  });
});
