import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeWindowState,
  readWindowState,
  writeWindowStateAtomic,
} from '../../src/main/windowStatePersistence';

describe('desktop window continuity', () => {
  it('restores a valid saved window state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-window-'));
    const state = { schemaVersion: 1 as const, x: 80, y: 60, width: 1200, height: 760, maximized: false };
    await writeWindowStateAtomic(root, state);
    expect(await readWindowState(root)).toEqual(state);
  });

  it('clamps stale monitor coordinates and supports 1440x768 work areas', () => {
    const normalized = normalizeWindowState(
      { schemaVersion: 1, x: 9000, y: -9000, width: 1800, height: 1200, maximized: false },
      { x: 0, y: 0, width: 1440, height: 768 },
    );
    expect(normalized).toMatchObject({ x: 0, y: 0, width: 1440, height: 768 });
  });
});
