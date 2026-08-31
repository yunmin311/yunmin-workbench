import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkbenchDraftV1 } from '../../src/core/project/draft';
import type { WorkspaceSessionV1 } from '../../src/core/project/workspaceSession';
import {
  buildProfileBundle,
  parseProfileBundle,
  previewProfileImport,
  profileBundleDigest,
} from '../../src/core/portability/bundle';
import {
  applyProfileImportAtomic,
  exportProfileBundle,
  readPortableState,
} from '../../src/main/portabilityPersistence';
import {
  readProjectRootBindings,
  rebindProjectRoot,
} from '../../src/main/projectRootBindings';
import { createProjectFileContext } from '../../src/main/adapters/projectFiles';

const session: WorkspaceSessionV1 = { schemaVersion: 1, last: null, recent: [] };
const draft: WorkbenchDraftV1 = {
  schemaVersion: 1,
  scope: { kind: 'migration-conversation-key', projectId: 'demo', conversationKey: 'local-key' },
  taskSummary: 'portable summary',
  manualContexts: [{
    id: 'manual:one', title: 'Decision', body: 'safe user text', provenance: 'USER PROVIDED',
    state: 'included', pinned: false, order: 0,
  }],
  projectFiles: [{
    projectId: 'demo', relativePath: 'docs/brief.md', asReference: false,
    lastKnownSha256: 'a'.repeat(64), state: 'included', pinned: false, order: 1,
  }],
  projectedDecisions: [],
};

describe('Workbench Profile Bundle', () => {
  it('round-trips versioned Workbench-owned state with a locked digest and explicit exclusions', () => {
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z',
      workspaceSession: session,
      drafts: [draft],
      projectRoots: { demo: 'D:\\retired\\demo' },
    });
    const parsed = parseProfileBundle(JSON.stringify(bundle));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.profile.drafts[0].manualContexts[0].body).toBe('safe user text');
    expect(parsed.profile.drafts[0].projectFiles[0]).not.toHaveProperty('body');
    expect(parsed.manifest.excluded).toEqual(expect.arrayContaining([
      'external-runtime', 'git-truth', 'governance', 'history-raw', 'history-index', 'attention-projection', 'secrets',
    ]));
  });

  it('rejects malformed, unknown-version, digest-tampered, and secret-bearing bundles', () => {
    expect(() => parseProfileBundle('{bad')).toThrow(/malformed/i);
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [], projectRoots: {},
    });
    expect(() => parseProfileBundle(JSON.stringify({ ...bundle, schemaVersion: 99 }))).toThrow(/version/i);
    expect(() => parseProfileBundle(JSON.stringify({ ...bundle, profile: { ...bundle.profile, drafts: [draft] } }))).toThrow(/digest/i);
    expect(() => buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session,
      drafts: [{ ...draft, manualContexts: [{ ...draft.manualContexts[0], body: ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-') }] }],
      projectRoots: {},
    })).toThrow(/secret/i);
    expect(() => buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session,
      drafts: [{ ...draft, manualContexts: [{ ...draft.manualContexts[0], body: 'API_KEY=short-but-secret' }] }],
      projectRoots: {},
    })).toThrow(/secret/i);
    expect(() => buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session,
      drafts: [{ ...draft, projectFiles: [{ ...draft.projectFiles[0], relativePath: '../outside.md' }] }],
      projectRoots: {},
    })).toThrow(/contained/i);
    for (const secret of [
      `AK${'IAIOSFODNN7EXAMPLE'}`,
      ['xoxb', '123456789012', 'abcdefghijklmnopqrstuv'].join('-'),
      `AI${'zaSyD1234567890abcdefghijklmnop'}`,
      ['glpat', 'abcdefghijklmnopqrstuvwx'].join('-'),
      ['npm', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
      ['pypi', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
      ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join('_'),
      ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
      ['eyJabcdefghijk', 'abcdefghijklmnop', 'abcdefghijklmnop'].join('.'),
    ]) {
      expect(() => buildProfileBundle({
        createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session,
        drafts: [{ ...draft, taskSummary: secret }], projectRoots: {},
      })).toThrow(/secret/i);
    }
  });

  it('rejects duplicate draft and project-binding logical identities', () => {
    const valid = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [draft], projectRoots: { demo: 'C:\\demo' },
    });
    const duplicateDrafts = { ...valid, profile: { ...valid.profile, drafts: [draft, draft] } };
    const { digest: _draftDigest, ...draftUnsigned } = duplicateDrafts;
    expect(() => parseProfileBundle(JSON.stringify({ ...duplicateDrafts, digest: profileBundleDigest(draftUnsigned) }))).toThrow(/duplicate draft/i);
    const duplicateBindings = {
      ...valid,
      profile: { ...valid.profile, projectBindings: [valid.profile.projectBindings[0], valid.profile.projectBindings[0]] },
    };
    const { digest: _bindingDigest, ...bindingUnsigned } = duplicateBindings;
    expect(() => parseProfileBundle(JSON.stringify({ ...duplicateBindings, digest: profileBundleDigest(bindingUnsigned) }))).toThrow(/duplicate project binding/i);
  });

  it('previews SAME, REBIND REQUIRED, CONFLICT and UNKNOWN without guessing candidates', () => {
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [],
      projectRoots: { same: 'C:\\work\\same', missing: 'D:\\gone', conflict: 'C:\\old', unknown: 'C:\\unknown' },
    });
    const preview = previewProfileImport(bundle, {
      knownProjectIds: ['same', 'missing', 'conflict'],
      currentBindings: { same: 'C:\\work\\same', conflict: 'E:\\new' },
      existingLocators: new Set(['C:\\work\\same']),
    });
    expect(Object.fromEntries(preview.bindings.map((item) => [item.projectId, item.status]))).toEqual({
      conflict: 'CONFLICT', missing: 'REBIND REQUIRED', same: 'SAME', unknown: 'UNKNOWN',
    });
    expect(preview.bindings.find((item) => item.projectId === 'missing')).not.toHaveProperty('candidate');
  });
});

describe('Portability persistence and explicit rebind', () => {
  it('dry-run writes nothing and committed import round-trips atomically', async () => {
    const source = mkdtempSync(join(tmpdir(), 'wb-portable-source-'));
    const target = mkdtempSync(join(tmpdir(), 'wb-portable-target-'));
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [draft], projectRoots: {},
    });
    const before = JSON.stringify(await readPortableState(target));
    await applyProfileImportAtomic(target, bundle, { dryRun: true });
    expect(JSON.stringify(await readPortableState(target))).toBe(before);
    await applyProfileImportAtomic(target, bundle, { dryRun: false });
    expect((await readPortableState(target)).drafts).toEqual([draft]);
    expect((await readPortableState(target)).workspaceSession).toEqual(session);

    const exported = await exportProfileBundle(source, { createdAt: '2026-08-31T00:00:00.000Z', projectRoots: {} });
    expect(parseProfileBundle(exported).schemaVersion).toBe(1);
  });

  it('persists missing imported roots only as unresolved historical locators', async () => {
    const target = mkdtempSync(join(tmpdir(), 'wb-portable-unresolved-'));
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: null, drafts: [],
      projectRoots: { demo: 'D:\\retired\\demo' },
    });
    await applyProfileImportAtomic(target, bundle, {
      dryRun: false,
      bindingStatuses: [{ projectId: 'demo', status: 'REBIND REQUIRED', historicalLocator: 'D:\\retired\\demo' }],
    });
    const roots = await readProjectRootBindings(target);
    expect(roots.bindings).toEqual({});
    expect(roots.unresolved.demo).toMatchObject({
      historicalLocator: 'D:\\retired\\demo', status: 'REBIND REQUIRED',
    });
  });

  it('rolls back every Workbench-owned target when a transaction fails', async () => {
    const target = mkdtempSync(join(tmpdir(), 'wb-portable-rollback-'));
    const original = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [], projectRoots: {},
    });
    await applyProfileImportAtomic(target, original, { dryRun: false });
    const replacement = buildProfileBundle({
      createdAt: '2026-08-31T00:01:00.000Z', workspaceSession: session, drafts: [draft], projectRoots: {},
    });
    await expect(applyProfileImportAtomic(target, replacement, { dryRun: false, failAfterWrites: 1 })).rejects.toThrow(/injected/);
    expect((await readPortableState(target)).drafts).toEqual([]);
  });

  it('does not modify excluded Workbench caches or any external source', async () => {
    const target = mkdtempSync(join(tmpdir(), 'wb-portable-nowrite-'));
    const external = mkdtempSync(join(tmpdir(), 'wb-portable-external-'));
    const sentinels = [
      join(target, 'history', 'index-v1.json'),
      join(target, 'attention', 'local-v1.json'),
      join(target, 'frozen-packets', 'packet.json'),
      join(external, 'governance.yaml'),
      join(external, '.git', 'HEAD'),
    ];
    for (const file of sentinels) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `sentinel:${file}`, 'utf8'); }
    const before = sentinels.map((file) => readFileSync(file, 'utf8'));
    const bundle = buildProfileBundle({
      createdAt: '2026-08-31T00:00:00.000Z', workspaceSession: session, drafts: [draft], projectRoots: {},
    });
    await applyProfileImportAtomic(target, bundle, { dryRun: false });
    expect(sentinels.map((file) => readFileSync(file, 'utf8'))).toEqual(before);
  });

  it('fails export closed when a draft file does not match its storage key', async () => {
    const target = mkdtempSync(join(tmpdir(), 'wb-portable-bad-storage-'));
    const rogue = join(target, 'drafts', 'v1', 'wrong-project', 'wrong-conversation.json');
    mkdirSync(join(rogue, '..'), { recursive: true });
    writeFileSync(rogue, JSON.stringify(draft), 'utf8');
    await expect(exportProfileBundle(target, {
      createdAt: '2026-08-31T00:00:00.000Z', projectRoots: {},
    })).rejects.toThrow(/storage key mismatch/i);
  });

  it('requires an explicit, identity-verifiable root and rereads File Context after rebind', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'wb-rebind-state-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'wb-rebind-project-'));
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'PROJECT.yaml'), 'project_id: demo\n', 'utf8');
    writeFileSync(join(projectRoot, 'docs', 'brief.md'), 'new machine content', 'utf8');
    await rebindProjectRoot(stateRoot, {
      projectId: 'demo', selectedRoot: projectRoot, canonicalPath: 'PROJECT.yaml', expectedProjectId: 'demo',
    });
    expect((await readProjectRootBindings(stateRoot)).bindings.demo.root).toBe(projectRoot);
    const current = await createProjectFileContext('demo', projectRoot, draft.projectFiles[0].relativePath, false);
    expect(current.item.body).toBe('new machine content');
    expect(current.fingerprint.sha256).not.toBe(draft.projectFiles[0].lastKnownSha256);
  });

  it('fails closed on wrong identity, traversal, and symlink escape without writing a binding', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'wb-rebind-deny-'));
    const root = mkdtempSync(join(tmpdir(), 'wb-rebind-root-'));
    writeFileSync(join(root, 'PROJECT.yaml'), 'project_id: another\n', 'utf8');
    await expect(rebindProjectRoot(stateRoot, {
      projectId: 'demo', selectedRoot: root, canonicalPath: 'PROJECT.yaml', expectedProjectId: 'demo',
    })).rejects.toThrow(/identity/i);
    await expect(rebindProjectRoot(stateRoot, {
      projectId: 'demo', selectedRoot: root, canonicalPath: '../outside.yaml', expectedProjectId: 'demo',
    })).rejects.toThrow(/project root|relative/i);
    const outside = mkdtempSync(join(tmpdir(), 'wb-rebind-outside-'));
    writeFileSync(join(outside, 'PROJECT.yaml'), 'project_id: demo\n', 'utf8');
    symlinkSync(outside, join(root, 'linked-outside'), 'junction');
    await expect(rebindProjectRoot(stateRoot, {
      projectId: 'demo', selectedRoot: root, canonicalPath: 'linked-outside/PROJECT.yaml', expectedProjectId: 'demo',
    })).rejects.toThrow(/outside the project root/i);
    expect((await readProjectRootBindings(stateRoot)).bindings).toEqual({});
    expect(readFileSync(join(root, 'PROJECT.yaml'), 'utf8')).toBe('project_id: another\n');
  });
});
