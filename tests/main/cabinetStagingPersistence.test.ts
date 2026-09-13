import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabinetStagingPath,
  readCabinetStagingState,
  saveCabinetStagingState,
} from '../../src/main/cabinetStagingPersistence';
import {
  buildWorkbenchDraft,
  restoreWorkbenchDraft,
} from '../../src/core/project/draft';
import { draftPath, writeWorkbenchDraftAtomic, readWorkbenchDraft } from '../../src/main/draftPersistence';
import { cabinetScopeKey } from '../../src/core/project/cabinet';
import type { ContextItem } from '../../src/core/types';

const projected = (id: string): ContextItem => ({
  id,
  title: id,
  source: 'memory:test',
  body: '',
  state: 'available',
  pinned: false,
  isReference: true,
  sourceRef: 'overlay:memory/MEMORY.md',
  provenance: 'EXTERNAL',
});

const CABINET_KEY = cabinetScopeKey('creative-os');

describe('formal Cabinet staging persistence (project-context-cabinet)', () => {
  it('round-trips the formal scope and rejects a scope/storage-key mismatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-cabinet-'));
    const staging = {
      schemaVersion: 1 as const,
      scope: { kind: 'project-context-cabinet' as const, projectId: 'creative-os' },
      taskSummary: '',
      decisions: [{ contextId: 'memory:x', state: 'included' as const, pinned: true, order: 0 }],
      projectFiles: [],
      pinnedCanonicalFile: false,
    };
    await saveCabinetStagingState(root, staging);
    // A second atomic save safely replaces the first file on Windows too.
    await saveCabinetStagingState(root, staging);
    const loaded = await readCabinetStagingState(root, 'creative-os');
    expect(loaded.problem).toBeUndefined();
    expect(loaded.staging?.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    expect(loaded.staging?.decisions).toEqual(staging.decisions);
    expect(loaded.migrated).toBeUndefined();

    // A state file whose scope does not match its storage key fails closed.
    const mismatchPath = cabinetStagingPath(root, 'creative-os');
    writeFileSync(mismatchPath, JSON.stringify({
      schemaVersion: 1,
      scope: { kind: 'project-context-cabinet', projectId: 'other-project' },
      taskSummary: '',
      decisions: [],
      projectFiles: [],
      pinnedCanonicalFile: false,
    }), 'utf8');
    const mismatch = await readCabinetStagingState(root, 'creative-os');
    expect(mismatch.staging).toBeNull();
    expect(mismatch.problem).toContain('scope does not match');
  });

  it('migrates a legacy 3C.1 cabinet draft once and removes the migration-era file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-cabinet-legacy-'));
    const legacyStaging = [
      { ...projected('memory:a'), state: 'included' as const, pinned: true },
      { ...projected('memory:b'), state: 'excluded' as const, pinned: false },
    ];
    const legacyDraft = buildWorkbenchDraft('creative-os', CABINET_KEY, undefined, '', legacyStaging, []);
    await writeWorkbenchDraftAtomic(root, legacyDraft);

    const result = await readCabinetStagingState(root, 'creative-os');
    expect(result.migrated).toBe(true);
    expect(result.problem).toBeUndefined();
    expect(result.staging?.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    const byId = new Map(result.staging?.decisions.map((decision) => [decision.contextId, decision]));
    expect(byId.get('memory:a')).toMatchObject({ state: 'included', pinned: true });
    expect(byId.get('memory:b')).toMatchObject({ state: 'excluded', pinned: false });

    // The legacy draft file is gone; the new file is authoritative.
    expect(existsSync(draftPath(root, 'creative-os', CABINET_KEY))).toBe(false);
    // Migration is one-time: a second read loads the new file without migrating.
    const again = await readCabinetStagingState(root, 'creative-os');
    expect(again.migrated).toBeUndefined();
    expect(again.staging?.decisions.length).toBe(2);
  });

  it('never touches legacy conversation drafts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-cabinet-conv-'));
    const staging = [
      { ...projected('memory:a'), state: 'included' as const, pinned: true },
    ];
    const conversationDraft = buildWorkbenchDraft('creative-os', 'creative-os::claude::主对话', undefined, 'resume this', staging, []);
    await writeWorkbenchDraftAtomic(root, conversationDraft);

    // No cabinet state at all: nothing migrates, conversation draft untouched.
    const cabinet = await readCabinetStagingState(root, 'creative-os');
    expect(cabinet.staging).toBeNull();

    const conversation = await readWorkbenchDraft(root, 'creative-os', 'creative-os::claude::主对话');
    expect(conversation.problem).toBeUndefined();
    expect(conversation.draft?.taskSummary).toBe('resume this');
    const restored = restoreWorkbenchDraft([projected('memory:a')], conversation.draft!, []);
    expect(restored.staging[0]).toMatchObject({ state: 'included', pinned: true });
  });
});
