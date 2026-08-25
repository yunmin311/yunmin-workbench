import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkbenchDraft,
  restoreWorkbenchDraft,
  type WorkbenchDraftV1,
} from '../../src/core/project/draft';
import { checkPacketValidity, compilePacket, freezePacket, renderAgentInput } from '../../src/core/project/packet';
import { createManualContext } from '../../src/core/project/staging';
import { createProjectFileContext } from '../../src/main/adapters/projectFiles';
import {
  draftPath,
  readWorkbenchDraft,
  writeWorkbenchDraftAtomic,
} from '../../src/main/draftPersistence';
import type { ContextItem } from '../../src/core/types';

const projected = (id: string, body: string): ContextItem => ({
  id,
  title: id,
  source: 'memory:test',
  body,
  state: 'available',
  pinned: false,
  isReference: true,
  sourceRef: 'overlay:memory/MEMORY.md',
  provenance: 'EXTERNAL',
});

describe('Workbench-owned durable draft', () => {
  it('round-trips Manual Context, summary, state, pin, and order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-draft-'));
    const external = { ...projected('memory:a', 'old body'), state: 'included' as const, pinned: true };
    const manual = { ...createManualContext('manual-1', 'Decision', 'full user body'), pinned: true };
    const draft = buildWorkbenchDraft('demo', 'demo::claude::main', undefined, 'resume this', [manual, external], []);

    await writeWorkbenchDraftAtomic(root, draft);
    // A second atomic save must safely replace the first file on Windows too.
    await writeWorkbenchDraftAtomic(root, draft);
    const loaded = await readWorkbenchDraft(root, 'demo', 'demo::claude::main');
    expect(loaded.problem).toBeUndefined();
    expect(loaded.draft?.taskSummary).toBe('resume this');

    const restored = restoreWorkbenchDraft([projected('memory:a', 'fresh body')], loaded.draft!, []);
    expect(restored.staging.map((item) => item.id)).toEqual(['manual:manual-1', 'memory:a']);
    expect(restored.staging[0]).toMatchObject({
      body: 'full user body',
      provenance: 'USER PROVIDED',
      state: 'included',
      pinned: true,
    });
    expect(restored.staging[1]).toMatchObject({ body: 'fresh body', state: 'included', pinned: true });
  });

  it('persists only a project-file locator and re-reads current content', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'wb-draft-file-'));
    const file = join(projectRoot, 'brief.md');
    writeFileSync(file, 'version one', 'utf8');
    const first = await createProjectFileContext('demo', projectRoot, 'brief.md', false);
    const draft = buildWorkbenchDraft(
      'demo',
      'demo::claude::main',
      undefined,
      '',
      [first.item],
      [first.fingerprint],
    );
    expect(JSON.stringify(draft)).not.toContain('version one');
    expect(draft.projectFiles[0]).toMatchObject({ relativePath: 'brief.md', asReference: false });

    writeFileSync(file, 'version two', 'utf8');
    const current = await createProjectFileContext('demo', projectRoot, 'brief.md', false);
    const restored = restoreWorkbenchDraft([], draft, [current.item]);
    expect(restored.staging[0].body).toBe('version two');
    expect(current.fingerprint.sha256).not.toBe(draft.projectFiles[0].lastKnownSha256);
  });

  it('does not recreate removed projected truth and reports the orphaned decision', () => {
    const draft = buildWorkbenchDraft(
      'demo',
      'demo::claude::main',
      undefined,
      '',
      [{ ...projected('removed', 'old external truth'), state: 'excluded' }],
      [],
    );
    const restored = restoreWorkbenchDraft([], draft, []);
    expect(restored.staging).toEqual([]);
    expect(restored.orphanedDecisionIds).toEqual(['removed']);
    expect(JSON.stringify(draft)).not.toContain('old external truth');
  });

  it('keeps a missing explicit locator so an included dependency is INVALID', () => {
    const draft: WorkbenchDraftV1 = {
      schemaVersion: 1,
      scope: { kind: 'migration-conversation-key', projectId: 'demo', conversationKey: 'local-key' },
      taskSummary: '',
      manualContexts: [],
      projectedDecisions: [],
      projectFiles: [{
        projectId: 'demo',
        relativePath: 'gone.md',
        asReference: false,
        state: 'included',
        pinned: false,
        order: 0,
      }],
    };
    const restored = restoreWorkbenchDraft([], draft, []);
    const packet = compilePacket({
      projectId: 'demo',
      conversationKey: 'local-key',
      taskSummary: '',
      governanceRefs: [],
      staging: restored.staging,
      fingerprints: [],
    });
    expect(restored.unavailableProjectFiles).toEqual(['gone.md']);
    expect(checkPacketValidity(packet, [])).toBe('INVALID');
  });

  it('fails closed for corrupt and unknown draft schemas', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-bad-draft-'));
    const file = draftPath(root, 'demo', 'key');
    // writeWorkbenchDraftAtomic creates the encoded parent without exposing its implementation here.
    const valid = buildWorkbenchDraft('demo', 'key', undefined, '', [], []);
    await writeWorkbenchDraftAtomic(root, valid);
    writeFileSync(file, '{not json', 'utf8');
    expect((await readWorkbenchDraft(root, 'demo', 'key')).problem).toMatch(/rejected/);
    writeFileSync(file, JSON.stringify({ ...valid, schemaVersion: 99 }), 'utf8');
    expect((await readWorkbenchDraft(root, 'demo', 'key')).problem).toMatch(/rejected/);
    writeFileSync(file, JSON.stringify({
      ...valid,
      projectFiles: [{
        projectId: 'another-project',
        relativePath: 'brief.md',
        asReference: false,
        state: 'included',
        pinned: false,
        order: 0,
      }],
    }), 'utf8');
    expect((await readWorkbenchDraft(root, 'demo', 'key')).problem).toMatch(/rejected/);
  });

  it('keeps frozen Manual and File bodies immutable while a resumed draft changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-frozen-draft-'));
    writeFileSync(join(root, 'brief.md'), 'freeze-time file', 'utf8');
    const file = await createProjectFileContext('demo', root, 'brief.md', false);
    const manual = createManualContext('m', 'Manual', 'freeze-time manual');
    const packet = compilePacket({
      projectId: 'demo',
      conversationKey: 'key',
      taskSummary: 'task',
      governanceRefs: [],
      staging: [manual, file.item],
      fingerprints: [file.fingerprint],
      packetId: 'fixed',
      now: '2026-08-25T00:00:00.000Z',
    });
    const frozen = freezePacket(packet, [], '2026-08-25T00:01:00.000Z');
    writeFileSync(join(root, 'brief.md'), 'later file', 'utf8');
    const laterFile = await createProjectFileContext('demo', root, 'brief.md', false);
    const laterManual = { ...manual, body: 'later manual' };
    const later = compilePacket({
      projectId: 'demo',
      conversationKey: 'key',
      taskSummary: 'task',
      governanceRefs: [],
      staging: [laterManual, laterFile.item],
      fingerprints: [laterFile.fingerprint],
    });
    expect(frozen.included.map((item) => item.body)).toEqual(['freeze-time manual', 'freeze-time file']);
    expect(checkPacketValidity(frozen, [laterFile.fingerprint])).toBe('STALE');
    expect(renderAgentInput(frozen)).not.toBe(renderAgentInput(later));
    expect(readFileSync(join(root, 'brief.md'), 'utf8')).toBe('later file');
  });
});
