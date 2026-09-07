import { describe, expect, it } from 'vitest';
import { createWorkbenchReadModel } from '../../../src/main/services/workbenchReadModel';
import type {
  OverlaySnapshot,
  SourceFingerprint,
} from '../../../src/core/types';
import type {
  HistoryReader,
  MemoryReader,
  ProjectFileContextSource,
  WorkbenchReadModel,
} from '../../../src/main/services/workbenchReadModel';
import type { HistoryCatalogResult, HistorySearchResult, HistorySessionDetail } from '../../../src/core/history/types';
import type { MemoryEvidenceExpansion, MemorySearchResult } from '../../../src/core/memory/types';

const snapshot: OverlaySnapshot = {
  overlayRoot: '/tmp/overlay',
  foundAt: '2026-01-01T00:00:00.000Z',
  conversations: [],
  projects: [],
  inbox: [],
  memoryIndex: [],
  harness: [],
  sourceFingerprints: [],
  problems: [],
  machine: {
    deviceId: 'machine-a',
    displayName: 'A',
    availableTools: {},
    projectRoots: { 'proj-1': '/machine/root/proj-1' },
    observed: {
      source: 'canonical-file',
      sourceRef: '/machine/profile',
      observedAt: '2026-01-01T00:00:00.000Z',
      verification: 'VERIFIED',
    },
  },
};

const fingerprint: SourceFingerprint = { sourceRef: 'history:abc', sha256: 'deadbeef'.repeat(8) };

function makeHistory(overrides: Partial<HistoryReader> = {}): HistoryReader {
  return {
    list: async () => ({ sessions: [], problems: [], stats: { sessions: 0, messages: 0, filesSkipped: 0, filesIndexed: 0 } }) as HistoryCatalogResult,
    search: async () => ({ hits: [], problems: [], stats: { sessions: 0, messages: 0, filesSkipped: 0, filesIndexed: 0 } }) as HistorySearchResult,
    detail: async () => null as HistorySessionDetail | null,
    fingerprint: async () => fingerprint,
    ...overrides,
  };
}

function makeMemory(overrides: Partial<MemoryReader> = {}): MemoryReader {
  return {
    search: async () => ({ hits: [], problems: [] }) as MemorySearchResult,
    expand: async () => null as MemoryEvidenceExpansion | null,
    ...overrides,
  };
}

function makeProjectFiles(overrides: Partial<ProjectFileContextSource> = {}): ProjectFileContextSource {
  return {
    create: async () => ({ item: {} as never, fingerprint }),
    fingerprintProject: async () => fingerprint,
    fingerprintOverlayFile: async () => fingerprint,
    ...overrides,
  };
}

function makeModel(overrides: Partial<Parameters<typeof createWorkbenchReadModel>[0]> = {}): WorkbenchReadModel {
  return createWorkbenchReadModel({
    stateDir: '/tmp/state',
    overlaySnapshot: snapshot,
    history: makeHistory(),
    memory: makeMemory(),
    projectFiles: makeProjectFiles(),
    ...overrides,
  });
}

describe('workbenchReadModel', () => {
  it('returns the supplied Overlay snapshot without mutation', () => {
    const rm = makeModel();
    expect(rm.getOverlaySnapshot()).toBe(snapshot);
  });

  it('forwards history.list / search / detail / fingerprint to the HistoryReader', async () => {
    const history = makeHistory({
      list: async () => ({ sessions: [{} as never], problems: [], stats: { sessions: 1, messages: 0, filesSkipped: 0, filesIndexed: 1 } }) as HistoryCatalogResult,
      search: async () => ({ hits: [{} as never], problems: [], stats: { sessions: 1, messages: 1, filesSkipped: 0, filesIndexed: 1 } }) as HistorySearchResult,
      detail: async () => ({ session: {} as never, messages: [], problems: [] }) as HistorySessionDetail,
      fingerprint: async (ref) => ({ sourceRef: ref, sha256: 'cafe'.repeat(8) }),
    });
    const rm = makeModel({ history });

    expect((await rm.listHistory()).sessions.length).toBe(1);
    expect((await rm.searchHistory({ text: 'q' })).hits.length).toBe(1);
    expect(await rm.detailHistory('s1')).not.toBeNull();
    expect((await rm.fingerprintHistory('history:s1'))?.sha256).toBe('cafe'.repeat(8));
  });

  it('forwards memory.search / expand to the MemoryReader', async () => {
    const memory = makeMemory({
      search: async () => ({ hits: [{} as never], problems: [] }) as MemorySearchResult,
      expand: async () => ({ record: {} as never, messages: [], missingSourceRefs: [], evidence: { verdict: 'SUFFICIENT' as const, evidenceRefs: [], missing: [], nextStrategy: 'NONE' as const } }) as MemoryEvidenceExpansion,
    });
    const rm = makeModel({ memory });

    expect((await rm.searchMemory({ text: 'q' })).hits.length).toBe(1);
    expect(await rm.expandMemory('m1')).not.toBeNull();
  });

  it('returns null for readMemoryBody when no Overlay snapshot is provided', async () => {
    const rm = makeModel({ overlaySnapshot: undefined });
    expect(await rm.readMemoryBody('memory:abc')).toBeNull();
  });

  it('delegates project-file creation, project fingerprint, and overlay fingerprint', async () => {
    const projectFiles = makeProjectFiles({
      create: async (projectId, _boundRoot, relativePath, asReference) => ({
        item: { id: `x:${projectId}:${relativePath}:${asReference ? 'ref' : 'ctx'}` } as never,
        fingerprint: { sourceRef: `project-file:${projectId}:${relativePath}`, sha256: 'aa'.repeat(32) },
      }),
      fingerprintProject: async (projectId, _boundRoot, relativePath) => ({
        sourceRef: `project-file:${projectId}:${relativePath}`,
        sha256: 'bb'.repeat(32),
      }),
      fingerprintOverlayFile: async (_root, _rel, sourceRef) => ({ sourceRef, sha256: 'cc'.repeat(32) }),
    });
    const rm = makeModel({ projectFiles });

    const created = await rm.createProjectFileContext('p1', '/r', 'README.md', true);
    expect(created.item.id).toBe('x:p1:README.md:ref');
    expect(created.fingerprint.sha256).toBe('aa'.repeat(32));

    const fp = await rm.fingerprintProjectFile('p1', '/r', 'README.md');
    expect(fp.sourceRef).toBe('project-file:p1:README.md');

    const of = await rm.fingerprintOverlayFile('/o', 'a.md', 'overlay:a.md');
    expect(of.sourceRef).toBe('overlay:a.md');
  });

  it('recheckSources routes by source-ref prefix and returns structured errors', async () => {
    const projectFiles = makeProjectFiles({
      fingerprintProject: async (projectId, _boundRoot, relativePath) => ({
        sourceRef: `project-file:${projectId}:${relativePath}`,
        sha256: '11'.repeat(32),
      }),
      fingerprintOverlayFile: async (_root, _rel, sourceRef) => ({ sourceRef, sha256: '22'.repeat(32) }),
    });
    const history = makeHistory({
      fingerprint: async () => ({ sourceRef: 'history:s1', sha256: '33'.repeat(32) }),
    });
    const rm = makeModel({ projectFiles, history });

    const result = await rm.recheckSources('proj-1', [
      'project-file:proj-1:src/index.ts',
      'overlay:notes.md',
      'history:s1',
      'unknown:scheme',
      'project-file:proj-1:src/index.ts', // duplicate
    ]);

    expect(result.checkedSourceRefs).toEqual([
      'project-file:proj-1:src/index.ts',
      'overlay:notes.md',
      'history:s1',
      'unknown:scheme',
    ]);
    expect(result.fingerprints.length).toBe(3);
    expect(result.fingerprints.map((fp) => fp.sourceRef).sort()).toEqual([
      'history:s1',
      'overlay:notes.md',
      'project-file:proj-1:src/index.ts',
    ]);
    expect(result.errors).toEqual([
      { sourceRef: 'unknown:scheme', message: 'Error: unsupported source identity' },
    ]);
  });

  it('recheckSources records an error when project-file has no bound root', async () => {
    const rm = makeModel({ overlaySnapshot: { ...snapshot, machine: undefined } });
    const result = await rm.recheckSources('proj-1', ['project-file:proj-1:x.ts']);
    expect(result.fingerprints).toEqual([]);
    expect(result.errors[0].sourceRef).toBe('project-file:proj-1:x.ts');
    expect(result.errors[0].message).toMatch(/^Error: no local root binding/);
  });

  it('does not mutate the supplied overlay snapshot', async () => {
    const rm = makeModel();
    await rm.recheckSources('proj-1', ['overlay:nope']);
    expect(rm.getOverlaySnapshot()).toBe(snapshot);
    expect(snapshot.machine?.projectRoots['proj-1']).toBe('/machine/root/proj-1');
  });
});