import { describe, expect, it } from 'vitest';
import { discoverOverlayRoot } from '../../src/main/adapters/overlaySource';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makeOverlay(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'overlay.yaml'), 'schemaVersion: 1\n', 'utf8');
  return dir;
}

describe('overlay discovery · bounded depth-2 scan, never guesses', () => {
  it('finds an overlay at depth 1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-disc-1-'));
    const overlay = await makeOverlay(join(root, 'governance'));
    const result = await discoverOverlayRoot(root, {} as NodeJS.ProcessEnv);
    expect(result.root).toBe(overlay);
    expect(result.candidates).toEqual([overlay]);
  });

  it('finds an overlay two levels deep (common workspace-folder layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-disc-2-'));
    const overlay = await makeOverlay(join(root, '1project', 'ai-governance-system'));
    const result = await discoverOverlayRoot(root, {} as NodeJS.ProcessEnv);
    expect(result.root).toBe(overlay);
    expect(result.candidates).toEqual([overlay]);
  });

  it('refuses to guess between a depth-1 and a depth-2 candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-disc-3-'));
    await makeOverlay(join(root, 'a'));
    await makeOverlay(join(root, 'b', 'c'));
    const result = await discoverOverlayRoot(root, {} as NodeJS.ProcessEnv);
    expect(result.root).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  it('prefers the explicit GOV_OVERLAY seam over scanning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-disc-4-'));
    const overlay = await makeOverlay(join(root, 'explicit'));
    const result = await discoverOverlayRoot(root, { GOV_OVERLAY: overlay } as NodeJS.ProcessEnv);
    expect(result.root).toBe(overlay);
    expect(result.candidates).toEqual([overlay]);
  });

  it('does not scan into node_modules or hidden directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-disc-5-'));
    await makeOverlay(join(root, 'node_modules', 'somepkg'));
    await makeOverlay(join(root, '.hidden', 'overlay'));
    const result = await discoverOverlayRoot(root, {} as NodeJS.ProcessEnv);
    expect(result.root).toBeUndefined();
    expect(result.candidates).toEqual([]);
  });
});
