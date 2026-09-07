/**
 * Workbench Read Model — a read-only, transport-neutral aggregation seam.
 *
 * Scope:
 * - Aggregate read-only facts from Overlay / Git / History / Memory /
 *   Project-file sources into a typed read model that vNext renderer and
 *   legacy code paths can consume.
 * - Pure query surface. No durable state, no new SOT, no cache, no lock,
 *   no runtime registry, no chokidar watcher, no IPC handler.
 *
 * What this is NOT:
 * - Not a second source of truth. It never owns state; every method
 *   either returns a value computed from caller-provided sources or
 *   forwards to a caller-provided source. The Overlay snapshot cache,
 *   the profile-state lock, the RuntimeContextRegistry, the
 *   LiveExecutionRegistry, and HandoffDispatchRegistry all keep their
 *   existing lifecycles in `src/main/index.ts`.
 * - Not an IPC façade. The 50 legacy channels and the legacy
 *   `registerIpc()` topology stay byte-identical; this seam only gives a
 *   second consumer (vNext renderer) a typed entry point.
 *
 * Invariant: the signature and return shape of every method here is the
 * same one the legacy IPC handler already used. Callers may pass the
 * real instances or test fakes; behavior does not change either way.
 */
import type {
  ContextItem,
  GitFacts,
  OverlaySnapshot,
  SourceFingerprint,
} from '../../core/types';
import type { MemoryEvidenceExpansion, MemorySearchQuery, MemorySearchResult, MemoryUseStateV1 } from '../../core/memory/types';
import type { HistoryCatalogResult, HistoryQuery, HistorySearchResult, HistorySessionDetail } from '../../core/history/types';
import type { ProjectRootBindingsV1 } from '../projectRootBindings';
import { effectiveProjectRoot, readProjectRootBindings } from '../projectRootBindings';
import { readMemoryBody } from '../adapters/overlaySource';
import { readGitFacts } from '../adapters/gitFacts';
import {
  createProjectFileContext,
} from '../adapters/projectFiles';

/**
 * History read surface. The real `HistoryService` satisfies it; tests
 * may pass a fake. The seam never owns the catalog or the index.
 */
export interface HistoryReader {
  list(): Promise<HistoryCatalogResult>;
  search(query: HistoryQuery): Promise<HistorySearchResult>;
  detail(sessionId: string): Promise<HistorySessionDetail | null>;
  fingerprint(sourceRef: string): Promise<SourceFingerprint | null>;
}

/**
 * Memory read surface. Read-only; `recordMemoryUse` is intentionally
 * NOT part of the seam — recording use is a write, and writes belong
 * to the main-process command path, not the read model.
 */
export interface MemoryReader {
  search(query: MemorySearchQuery): Promise<MemorySearchResult>;
  expand(id: string): Promise<MemoryEvidenceExpansion | null>;
}

export interface ProjectFileCreateResult {
  item: ContextItem;
  fingerprint: SourceFingerprint;
}

export interface ProjectFileContextSource {
  create(
    projectId: string,
    boundRoot: string,
    relativePath: string,
    asReference: boolean,
  ): Promise<ProjectFileCreateResult>;
  fingerprintProject(
    projectId: string,
    boundRoot: string,
    relativePath: string,
  ): Promise<SourceFingerprint>;
  fingerprintOverlayFile(
    overlayRoot: string,
    relativePath: string,
    sourceRef: string,
  ): Promise<SourceFingerprint>;
}

export interface SourceRecheckOneError {
  sourceRef: string;
  message: string;
}

export interface SourceRecheckResult {
  checkedSourceRefs: string[];
  fingerprints: SourceFingerprint[];
  errors: SourceRecheckOneError[];
}

export interface WorkbenchReadModelDeps {
  stateDir: string;
  /**
   * The current Overlay snapshot. May be undefined if no discovery has
   * happened yet — read-model methods that need it surface UNKNOWN rather
   * than fabricate one.
   */
  overlaySnapshot: OverlaySnapshot | undefined;
  history: HistoryReader;
  memory: MemoryReader;
  projectFiles: ProjectFileContextSource;
}

export interface WorkbenchReadModel {
  /** Returns the most recent Overlay snapshot the caller holds, without mutation. */
  getOverlaySnapshot(): OverlaySnapshot | undefined;

  /** Resolve the local project root using machine truth + Workbench local bindings. */
  getEffectiveProjectRoot(
    projectId: string,
    externalRoots?: Record<string, string>,
  ): Promise<string | undefined>;

  /** Read the persisted Workbench-local binding table. No mutation. */
  loadLocalProjectRootBindings(): Promise<ProjectRootBindingsV1>;

  // History
  listHistory(): Promise<HistoryCatalogResult>;
  searchHistory(query: HistoryQuery): Promise<HistorySearchResult>;
  detailHistory(sessionId: string): Promise<HistorySessionDetail | null>;
  fingerprintHistory(sourceRef: string): Promise<SourceFingerprint | null>;

  // Memory
  searchMemory(query: MemorySearchQuery): Promise<MemorySearchResult>;
  expandMemory(id: string): Promise<MemoryEvidenceExpansion | null>;
  readMemoryBody(memoryId: string): Promise<string | null>;

  // Git
  loadGitFacts(projectId: string, boundRoot: string): Promise<GitFacts>;

  // Project file context
  createProjectFileContext(
    projectId: string,
    boundRoot: string,
    relativePath: string,
    asReference: boolean,
  ): Promise<ProjectFileCreateResult>;
  fingerprintProjectFile(
    projectId: string,
    boundRoot: string,
    relativePath: string,
  ): Promise<SourceFingerprint>;
  fingerprintOverlayFile(
    overlayRoot: string,
    relativePath: string,
    sourceRef: string,
  ): Promise<SourceFingerprint>;

  /**
   * Recheck the given source refs and return a structured result. Mirrors
   * the existing `sources:recheck` IPC handler byte-for-byte in shape; the
   * caller's concurrency / caching policy is up to them.
   */
  recheckSources(
    projectId: string,
    sourceRefs: string[],
  ): Promise<SourceRecheckResult>;
}

export function createWorkbenchReadModel(deps: WorkbenchReadModelDeps): WorkbenchReadModel {
  const { stateDir, overlaySnapshot, history, memory, projectFiles } = deps;

  return {
    getOverlaySnapshot() {
      return overlaySnapshot;
    },

    getEffectiveProjectRoot(projectId, externalRoots = {}) {
      return effectiveProjectRoot(stateDir, projectId, externalRoots);
    },

    loadLocalProjectRootBindings() {
      return readProjectRootBindings(stateDir);
    },

    listHistory() {
      return history.list();
    },
    searchHistory(query) {
      return history.search(query);
    },
    detailHistory(sessionId) {
      return history.detail(sessionId);
    },
    fingerprintHistory(sourceRef) {
      return history.fingerprint(sourceRef);
    },

    searchMemory(query) {
      return memory.search(query);
    },
    expandMemory(id) {
      return memory.expand(id);
    },
    readMemoryBody(memoryId) {
      const root = overlaySnapshot?.overlayRoot;
      return root ? readMemoryBody(root, memoryId) : Promise.resolve(null);
    },

    loadGitFacts(projectId, boundRoot) {
      return readGitFacts(projectId, boundRoot);
    },

    createProjectFileContext(projectId, boundRoot, relativePath, asReference) {
      return projectFiles.create(projectId, boundRoot, relativePath, asReference);
    },
    fingerprintProjectFile(projectId, boundRoot, relativePath) {
      return projectFiles.fingerprintProject(projectId, boundRoot, relativePath);
    },
    fingerprintOverlayFile(overlayRoot, relativePath, sourceRef) {
      return projectFiles.fingerprintOverlayFile(overlayRoot, relativePath, sourceRef);
    },

    async recheckSources(projectId, sourceRefs) {
      const uniqueRefs = [...new Set(sourceRefs)];
      const boundRoot = await effectiveProjectRoot(
        stateDir,
        projectId,
        overlaySnapshot?.machine?.projectRoots,
      );
      const overlayRoot = overlaySnapshot?.overlayRoot;
      const fingerprints: SourceFingerprint[] = [];
      const errors: SourceRecheckOneError[] = [];

      const recheckOne = async (sourceRef: string): Promise<void> => {
        try {
          const projectPrefix = `project-file:${projectId}:`;
          if (sourceRef.startsWith(projectPrefix)) {
            if (!boundRoot) throw new Error(`no local root binding for project ${projectId}`);
            fingerprints.push(await projectFiles.fingerprintProject(
              projectId,
              boundRoot,
              sourceRef.slice(projectPrefix.length),
            ));
          } else if (sourceRef.startsWith('overlay:')) {
            if (!overlayRoot) throw new Error('overlay root is unavailable');
            fingerprints.push(await projectFiles.fingerprintOverlayFile(
              overlayRoot,
              sourceRef.slice('overlay:'.length),
              sourceRef,
            ));
          } else if (sourceRef.startsWith('history:')) {
            const fingerprint = await history.fingerprint(sourceRef);
            if (!fingerprint) throw new Error('History source is unavailable');
            fingerprints.push(fingerprint);
          } else {
            throw new Error('unsupported source identity');
          }
        } catch (error) {
          errors.push({ sourceRef, message: String(error) });
        }
      };

      const CONCURRENCY = 8;
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, uniqueRefs.length) },
        async () => {
          while (cursor < uniqueRefs.length) {
            const index = cursor;
            cursor += 1;
            await recheckOne(uniqueRefs[index]);
          }
        },
      );
      await Promise.all(workers);
      return { checkedSourceRefs: [...new Set(sourceRefs)], fingerprints, errors };
    },
  };
}