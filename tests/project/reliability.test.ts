import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultOverlaySearchRoot,
  loadOverlay,
  readMemoryBody,
  watchTargets,
} from '../../src/main/adapters/overlaySource';
import { encodeStateKey } from '../../src/main/stateKey';

describe('watchTargets scope guard (P6: no watcher scope creep)', () => {
  it('watches only the five canonical targets', () => {
    const t = watchTargets('D:\\ov');
    expect(t).toHaveLength(5);
    expect(t.some((p) => p.includes('node_modules'))).toBe(false);
    expect(t.join('|')).toContain('INBOX.md');
    expect(t.join('|')).toContain('MEMORY.md');
  });
});

describe('readMemoryBody lazy + safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-mem-'));
  mkdirSync(join(root, 'memory'), { recursive: true });
  writeFileSync(join(root, 'memory', 'atom.md'), '正文内容', 'utf8');

  it('loads a body on demand', async () => {
    expect(await readMemoryBody(root, 'atom')).toBe('正文内容');
  });

  it('rejects traversal and never guesses', async () => {
    expect(await readMemoryBody(root, '../outside')).toBeNull();
    expect(await readMemoryBody(root, 'a\\b')).toBeNull();
    expect(await readMemoryBody(root, 'missing')).toBeNull();
  });
});

describe('projection boundary hygiene', () => {
  it('uses a configurable overlay discovery root instead of a business hardcode', () => {
    expect(defaultOverlaySearchRoot({ WB_OVERLAY_SEARCH_ROOT: 'E:\\' } as NodeJS.ProcessEnv)).toBe('E:\\');
  });

  it('surfaces unsupported machine schema errors in snapshot.problems', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-overlay-'));
    const machineDir = join(root, 'profiles', 'machines', 'instances');
    mkdirSync(machineDir, { recursive: true });
    writeFileSync(
      join(machineDir, 'broken.yaml'),
      'schema_version: 99\nprofile_type: machine\ndevice_id: broken',
      'utf8',
    );
    const snapshot = await loadOverlay(root);
    expect(snapshot.problems.some((p) => p.source.endsWith('broken.yaml') && p.message.includes('schema_version'))).toBe(true);
  });

  it('encodes every filesystem key into one path-safe representation', () => {
    const encoded = encodeStateKey('../CON:项目\\task');
    expect(encoded).toMatch(/^k-[A-Za-z0-9_-]+$/);
    expect(encoded).not.toMatch(/[\\/:*?"<>|]/);
    expect(encodeStateKey('project')).not.toBe(encodeStateKey('conversation'));
  });
});
