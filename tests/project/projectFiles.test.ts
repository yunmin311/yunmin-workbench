import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPacketValidity, compilePacket } from '../../src/core/project/packet';
import { projectFileSourceRef } from '../../src/core/project/sourceIdentity';
import {
  createProjectFileContext,
  fingerprintProjectFile,
  MAX_FILE_CONTEXT_BYTES,
  resolveProjectFile,
} from '../../src/main/adapters/projectFiles';
import { createManualContext } from '../../src/core/project/staging';

const base = {
  projectId: 'demo',
  conversationKey: 'demo::claude::main',
  taskSummary: 'test',
  staging: [],
  now: '2026-08-25T00:00:00.000Z',
  packetId: 'fixed',
};

describe('project canonical file resolution + fingerprint', () => {
  it('moves CURRENT -> STALE -> INVALID from real file evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-project-'));
    const file = join(root, 'CLAUDE.md');
    writeFileSync(file, 'revision one', 'utf8');
    const sourceRef = projectFileSourceRef('demo', 'CLAUDE.md');
    const first = await fingerprintProjectFile('demo', root, 'CLAUDE.md');
    expect(first.sourceRef).toBe(sourceRef);

    const packet = compilePacket({ ...base, governanceRefs: [sourceRef], fingerprints: [first] });
    expect(checkPacketValidity(packet, [first])).toBe('CURRENT');

    writeFileSync(file, 'revision two', 'utf8');
    const second = await fingerprintProjectFile('demo', root, 'CLAUDE.md');
    expect(checkPacketValidity(packet, [second])).toBe('STALE');
    expect(checkPacketValidity(packet, [])).toBe('INVALID');
  });

  it('fails closed when a declared file is missing', () => {
    const sourceRef = projectFileSourceRef('demo', 'missing.md');
    const packet = compilePacket({ ...base, governanceRefs: [sourceRef], fingerprints: [] });
    expect(packet.unresolvedDependencies).toEqual([sourceRef]);
    expect(checkPacketValidity(packet, [])).toBe('INVALID');
  });

  it('rejects traversal, absolute paths, and project-root escape', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'wb-boundary-'));
    const root = join(parent, 'project');
    mkdirSync(root);
    writeFileSync(join(parent, 'outside.md'), 'outside', 'utf8');
    await expect(resolveProjectFile(root, '../outside.md')).rejects.toThrow(/escapes/);
    await expect(resolveProjectFile(root, join(parent, 'outside.md'))).rejects.toThrow(/relative/);
    await expect(resolveProjectFile(root, 'missing.md')).rejects.toThrow();
  });
});

describe('explicit File + Manual Context', () => {
  it('keeps File Context content and File Reference locator distinct', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-explicit-'));
    writeFileSync(join(root, 'brief.md'), 'real project content', 'utf8');
    const context = await createProjectFileContext('demo', root, 'brief.md', false);
    const reference = await createProjectFileContext('demo', root, 'brief.md', true);

    expect(context.item.isReference).toBe(false);
    expect(context.item.body).toBe('real project content');
    expect(context.item.provenance).toBe('EXTERNAL');
    expect(reference.item.isReference).toBe(true);
    expect(reference.item.body).toContain('locator: project-file:demo:brief.md');
    expect(reference.item.body).not.toBe(context.item.body);
    expect(context.fingerprint).toEqual(reference.fingerprint);
  });

  it('rejects oversized injected content without silently truncating it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-large-'));
    writeFileSync(join(root, 'large.txt'), 'x'.repeat(MAX_FILE_CONTEXT_BYTES + 1), 'utf8');
    await expect(createProjectFileContext('demo', root, 'large.txt', false)).rejects.toThrow(/Context limit/);
    const reference = await createProjectFileContext('demo', root, 'large.txt', true);
    expect(reference.item.isReference).toBe(true);
  });

  it('marks Manual Context as USER PROVIDED and Workbench-owned', () => {
    const manual = createManualContext('fixed', '  decision  ', '  user supplied truth  ');
    expect(manual).toMatchObject({
      id: 'manual:fixed',
      title: 'decision',
      body: 'user supplied truth',
      source: 'manual',
      state: 'included',
      pinned: false,
      isReference: false,
      provenance: 'USER PROVIDED',
    });
    expect(manual.sourceRef).toBeUndefined();
  });
});
