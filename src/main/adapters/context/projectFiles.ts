/**
 * Project-files context source.
 *
 * Surfaces the canonical project-file context path: `createProjectFileContext`,
 * `fingerprintProjectFile`, `fingerprintFileAtRoot`, `recheckSources`. These
 * are the same primitives the legacy IPC handlers call; this adapter
 * describes them as a typed `ContextSource` capability declaration so the
 * registry sees one stable contract per source.
 *
 * Capability declaration:
 * - list: NO — there is no flat enumeration; users select files
 *   explicitly through the picker or by recheck.
 * - search: NO — file bodies are addressed by path, not by text query.
 * - read: YES — `createProjectFileContext` returns a typed
 *   `ContextItem`.
 * - fingerprint: YES — `fingerprintProjectFile` and
 *   `fingerprintFileAtRoot` produce canonical sha256 fingerprints.
 * - recheck: YES — `recheckSources` is the existing recheck entry
 *   point for any project-file / overlay / history locator.
 */
import type {
  ContextSource,
  ContextSourceAvailability,
  ContextSourceCapabilities,
  ContextSourceCurrentness,
  ContextSourceKind,
} from '../../../core/context-sources/types';

export interface ProjectFilesSourceOptions {
  hasProjectRootBinding: () => Promise<boolean>;
}

export function createProjectFilesSource(
  options: ProjectFilesSourceOptions,
): ContextSource {
  const kind: ContextSourceKind = 'project-files';
  return {
    id: 'project-files',
    kind,
    label: 'Project Files',
    provenance: 'WORKBENCH_BUILTIN',
    capabilities: {
      list: { answer: 'NO', evidence: 'no flat enumeration; files are picked or rechecked by locator' },
      search: { answer: 'NO', evidence: 'file bodies are addressed by path' },
      read: { answer: 'YES', evidence: 'createProjectFileContext returns a typed ContextItem' },
      fingerprint: { answer: 'YES', evidence: 'fingerprintProjectFile / fingerprintFileAtRoot produce canonical sha256 fingerprints' },
      recheck: { answer: 'YES', evidence: 'recheckSources reruns canonical fingerprints for project-file / overlay / history locators' },
    },
    async availability(): Promise<ContextSourceAvailability> {
      const bound = await options.hasProjectRootBinding();
      if (!bound) {
        return {
          state: 'UNAVAILABLE',
          reason: 'no project root is bound; bind one via portability:rebind before reading files',
        };
      }
      return { state: 'AVAILABLE', reason: 'a project root binding exists' };
    },
    async currentness(): Promise<ContextSourceCurrentness> {
      return {
        state: 'UNKNOWN',
        reason: 'project-files does not observe the watcher; recheckSources is the canonical freshness entry point',
      };
    },
  };
}