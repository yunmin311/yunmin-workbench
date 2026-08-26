import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveWorkspaceTarget,
  updateWorkspaceSession,
  type WorkspaceSessionV1,
  type WorkspaceTargetV1,
} from '../../src/core/project/workspaceSession';
import { clearWorkbenchDraft, writeWorkbenchDraftAtomic } from '../../src/main/draftPersistence';
import { readWorkspaceSession, writeWorkspaceSessionAtomic } from '../../src/main/workspacePersistence';
import type { OverlaySnapshot } from '../../src/core/types';

const target: WorkspaceTargetV1 = {
  projectId: 'demo',
  conversationScope: {
    kind: 'migration-conversation-key',
    conversationKey: 'demo::codex::main',
  },
  view: 'packet',
  usedAt: '2026-08-26T00:00:00.000Z',
};

const snapshot = (includeConversation = true): OverlaySnapshot => ({
  overlayRoot: 'X:/overlay',
  foundAt: '2026-08-26T00:00:00.000Z',
  projects: [{
    projectId: 'demo',
    displayName: 'Demo',
    status: 'ACTIVE',
    roles: [],
    gates: {},
    trust: 'VERIFIED',
    observed: {
      source: 'canonical-file',
      sourceRef: 'overlay:demo.yaml',
      observedAt: '2026-08-26T00:00:00.000Z',
      verification: 'VERIFIED',
    },
  }],
  conversations: includeConversation ? [{
    key: 'demo::codex::main',
    role: 'main',
    project: 'demo',
    platform: 'codex',
    status: 'ACTIVE',
    taskState: 'unknown',
    runtimeState: 'unknown',
    attention: 'none',
    verification: 'VERIFIED',
    observed: {
      source: 'canonical-file',
      sourceRef: 'overlay:dialogues.yaml',
      observedAt: '2026-08-26T00:00:00.000Z',
      verification: 'VERIFIED',
    },
  }] : [],
  inbox: [],
  memoryIndex: [],
  harness: [],
  sourceFingerprints: [],
  problems: [],
});

describe('workspace continuity', () => {
  it('round-trips last workspace and bounded recents atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-workspace-'));
    const empty: WorkspaceSessionV1 = { schemaVersion: 1, last: null, recent: [] };
    const session = updateWorkspaceSession(empty, target);
    await writeWorkspaceSessionAtomic(root, session);
    await writeWorkspaceSessionAtomic(root, session);
    expect((await readWorkspaceSession(root)).session).toEqual(session);
    expect(resolveWorkspaceTarget(snapshot(), session.last).target).toEqual(target);
  }, 15_000);

  it('fails closed when the exact conversation no longer exists', () => {
    const result = resolveWorkspaceTarget(snapshot(false), target);
    expect(result.target).toBeNull();
    expect(result.problem).toMatch(/conversation no longer exists/);
  });

  it('Clear Draft does not delete workspace recents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-workspace-clear-'));
    const session = updateWorkspaceSession({ schemaVersion: 1, last: null, recent: [] }, target);
    await writeWorkspaceSessionAtomic(root, session);
    await writeWorkbenchDraftAtomic(root, {
      schemaVersion: 1,
      scope: { kind: 'migration-conversation-key', projectId: 'demo', conversationKey: 'demo::codex::main' },
      taskSummary: 'draft',
      manualContexts: [],
      projectFiles: [],
      projectedDecisions: [],
    });
    await clearWorkbenchDraft(root, 'demo', 'demo::codex::main');
    expect((await readWorkspaceSession(root)).session?.recent).toHaveLength(1);
  });
});
