import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMaterialPreference, writeMaterialPreferenceAtomic } from '../../src/main/materialPersistence';

describe('Material Workbench-local preference (only Workbench userData)', () => {
  it('round-trips System/Pure/Frost/Glass atomically across restart', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wb-material-'));
    for (const pref of ['system', 'pure', 'frost', 'glass'] as const) {
      await writeMaterialPreferenceAtomic(stateDir, { schemaVersion: 1, material: pref });
      expect(await readMaterialPreference(stateDir)).toEqual({ schemaVersion: 1, material: pref });
    }
    expect(JSON.parse(await readFile(join(stateDir, 'material', 'material-v1.json'), 'utf8'))).toEqual({ schemaVersion: 1, material: 'glass' });
  });

  it('isolates malformed preference and falls back to system', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wb-material-bad-'));
    await writeMaterialPreferenceAtomic(stateDir, { schemaVersion: 1, material: 'frost' });
    await writeFile(join(stateDir, 'material', 'material-v1.json'), '{broken', 'utf8');
    expect(await readMaterialPreference(stateDir)).toEqual({ schemaVersion: 1, material: 'system' });
    await writeFile(join(stateDir, 'material', 'material-v1.json'), JSON.stringify({ schemaVersion: 1, material: 'unknown-mode' }), 'utf8');
    expect(await readMaterialPreference(stateDir)).toEqual({ schemaVersion: 1, material: 'system' });
  });

  it('only writes to material/material-v1.json under userData — no overlay/history/memory write', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wb-material-nowrite-'));
    const fs = await import('node:fs');
    const before = fs.readdirSync(stateDir).length;
    await writeMaterialPreferenceAtomic(stateDir, { schemaVersion: 1, material: 'pure' });
    // Should have created material/ subdir only, not overlay/history
    expect(fs.existsSync(join(stateDir, 'material', 'material-v1.json'))).toBe(true);
    expect(fs.existsSync(join(stateDir, 'overlay'))).toBe(false);
    expect(fs.existsSync(join(stateDir, 'history'))).toBe(false);
    expect(fs.existsSync(join(stateDir, 'memory'))).toBe(false);
  });
});
