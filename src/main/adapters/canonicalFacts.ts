import { createHash } from 'node:crypto';
import { isAbsolute, posix, win32 } from 'node:path';
import { load } from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { ProjectAdapter, SourceFingerprint } from '../../core/types';
import type {
  WorkGraphArtifactFact,
  WorkGraphGovernanceFact,
  WorkGraphRevision,
  WorkGraphTaskFact,
} from '../../core/workgraph/revision';

export interface PinnedCanonicalFactRead {
  ok: boolean;
  governanceBindings: WorkGraphGovernanceFact[];
  tasks: WorkGraphTaskFact[];
  artifacts: WorkGraphArtifactFact[];
  sourceFingerprints: SourceFingerprint[];
  problems: { source: string; message: string }[];
}

type FactKind = 'WORK' | 'TASK' | 'ARTIFACT';
type PlainRecord = Record<string, unknown>;

const FACT_KEYS: Record<FactKind, 'works' | 'tasks' | 'artifacts'> = {
  WORK: 'works', TASK: 'tasks', ARTIFACT: 'artifacts',
};

function emptyRead(): PinnedCanonicalFactRead {
  return { ok: true, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [], problems: [] };
}

/** A failed canonical read may retain an already verified graph, never replace it with partial facts. */
export function lastGoodForCanonicalRead(
  read: Pick<PinnedCanonicalFactRead, 'ok'>,
  previous: WorkGraphRevision | undefined,
): WorkGraphRevision | undefined {
  return read.ok ? undefined : previous;
}

function record(value: unknown): PlainRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as PlainRecord : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

function verification(value: unknown): 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN' {
  return value === 'VERIFIED' || value === 'OBSERVED' || value === 'INFERRED' || value === 'UNKNOWN'
    ? value
    : 'UNKNOWN';
}

function currentness(value: unknown): 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN' {
  return value === 'CURRENT' || value === 'STALE' || value === 'INVALID' || value === 'UNKNOWN'
    ? value
    : 'UNKNOWN';
}

function normalizedRemote(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase();
}

/** Canonical pinned locator: exactly the identity packet validity can re-check. */
export function pinnedFileSourceRef(repository: string, commit: string, path: string): string {
  return `git:${repository}@${commit}:${path}`;
}

export { normalizedRemote };

function splitLocator(sourceRef: string): { path: string; fragment: string } | null {
  const hash = sourceRef.lastIndexOf('#');
  if (hash <= 0 || hash === sourceRef.length - 1) return null;
  const path = sourceRef.slice(0, hash);
  const fragment = sourceRef.slice(hash + 1);
  if (
    isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\') || path.includes('\0')
    || path.includes(':') || posix.normalize(path) !== path || path.split('/').includes('..')
  ) return null;
  return { path, fragment };
}

function safeProjectSourceRef(sourceRef: string): boolean {
  const path = sourceRef.split('#', 1)[0];
  return Boolean(path)
    && !isAbsolute(path) && !win32.isAbsolute(path) && !path.includes('\\') && !path.includes('\0')
    && !path.includes(':') && posix.normalize(path) === path && !path.split('/').includes('..');
}

function isVerification(value: unknown): boolean {
  return value === 'VERIFIED' || value === 'OBSERVED' || value === 'INFERRED' || value === 'UNKNOWN';
}

function isCurrentness(value: unknown): boolean {
  return value === 'CURRENT' || value === 'STALE' || value === 'INVALID' || value === 'UNKNOWN';
}

function pinnedSourceRef(adapter: ProjectAdapter, commit: string, path: string, suffix?: string): string {
  const repository = adapter.canonicalSource?.repository ?? adapter.projectId;
  return `git:${repository}@${commit}:${path}${suffix ?? ''}`;
}

function duplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function fail(result: PinnedCanonicalFactRead, source: string, message: string): void {
  result.ok = false;
  result.problems.push({ source, message });
}

export async function readPinnedCanonicalFacts(
  adapter: ProjectAdapter,
  projectRoot: string,
  observedAt = new Date().toISOString(),
): Promise<PinnedCanonicalFactRead> {
  const result = emptyRead();
  const locators = adapter.canonicalFactSources ?? [];
  if (locators.length === 0) return result;

  const known: Array<(typeof locators)[number] & { kind: FactKind; path: string; fragment: string }> = [];
  for (const locator of locators) {
    if (!(locator.kind in FACT_KEYS)) {
      result.problems.push({ source: locator.sourceRef, message: `unsupported canonical fact kind "${locator.kind}" ignored` });
      continue;
    }
    const split = splitLocator(locator.sourceRef);
    if (!split) {
      fail(result, locator.sourceRef, 'canonical fact source_ref must contain a safe path and exact fragment');
      continue;
    }
    if (locator.format !== 'YAML' || locator.verification !== 'VERIFIED') {
      fail(result, locator.sourceRef, 'canonical fact locator must be verified YAML');
      continue;
    }
    known.push({ ...locator, kind: locator.kind as FactKind, ...split });
  }

  const commit = adapter.canonicalSource?.commit;
  const remote = adapter.canonicalSource?.remote;
  if (!commit || !/^[0-9a-f]{40}$/.test(commit) || adapter.canonicalSource?.verification !== 'VERIFIED') {
    fail(result, `project-adapter:${adapter.projectId}`, 'canonical source requires a verified full Git commit');
  }
  if (!remote) fail(result, `project-adapter:${adapter.projectId}`, 'canonical source remote is missing');
  if (!result.ok) return { ...result, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [] };

  const git = simpleGit(projectRoot);
  try {
    const remotes = await git.getRemotes(true);
    const want = normalizedRemote(remote!);
    const matches = remotes.some((item) =>
      normalizedRemote(item.refs.fetch || item.refs.push || '') === want);
    if (!matches) throw new Error('bound repository remote does not match the project adapter');
    await git.raw(['cat-file', '-e', `${commit}^{commit}`]);
  } catch (error) {
    fail(result, `git:${adapter.projectId}@${commit}`, String(error));
    return { ...result, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [] };
  }

  const documents = new Map<string, PlainRecord>();
  for (const path of new Set(known.map((locator) => locator.path))) {
    try {
      const text = await git.show([`${commit}:${path}`]);
      const doc = record(load(text));
      if (!doc || doc.schema_version !== '1.0' || doc.record_type !== 'canonical_fact_manifest' || doc.project_id !== adapter.projectId) {
        throw new Error('canonical fact manifest identity or project_id mismatch');
      }
      documents.set(path, doc);
      result.sourceFingerprints.push({
        sourceRef: pinnedSourceRef(adapter, commit!, path),
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      });
    } catch (error) {
      fail(result, pinnedSourceRef(adapter, commit!, path), String(error));
    }
  }
  if (!result.ok) return { ...result, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [] };

  const selected = new Map<FactKind, PlainRecord[]>();
  for (const locator of known) {
    const expected = FACT_KEYS[locator.kind];
    if (locator.fragment !== expected) {
      fail(result, locator.sourceRef, `fragment "${locator.fragment}" does not identify ${locator.kind}`);
      continue;
    }
    const values = documents.get(locator.path)?.[expected];
    if (!Array.isArray(values) || !values.every((value) => record(value))) {
      fail(result, locator.sourceRef, `fragment "${locator.fragment}" is missing or malformed`);
      continue;
    }
    if (selected.has(locator.kind)) {
      fail(result, locator.sourceRef, `duplicate canonical fact locator for ${locator.kind}`);
      continue;
    }
    selected.set(locator.kind, values as PlainRecord[]);
  }
  if (!result.ok) return { ...result, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [] };

  const works = selected.get('WORK') ?? [];
  const tasks = selected.get('TASK') ?? [];
  const artifacts = selected.get('ARTIFACT') ?? [];
  const workIds = works.map((item) => string(item.work_id)).filter((id): id is string => !!id);
  const taskIds = tasks.map((item) => string(item.task_id)).filter((id): id is string => !!id);
  const artifactIds = artifacts.map((item) => string(item.artifact_id)).filter((id): id is string => !!id);
  if (workIds.length !== works.length || taskIds.length !== tasks.length || artifactIds.length !== artifacts.length
      || duplicate(workIds) || duplicate(taskIds) || duplicate(artifactIds)) {
    fail(result, `canonical-facts:${adapter.projectId}`, 'canonical fact identity is missing or duplicated');
  }
  const everyProjectMatches = [...works, ...tasks, ...artifacts]
    .every((item) => item.project_id === adapter.projectId);
  if (!everyProjectMatches) fail(result, `canonical-facts:${adapter.projectId}`, 'canonical fact project_id mismatch');

  const workTaskIds = new Map<string, string[]>();
  for (const item of works) {
    const id = string(item.work_id)!;
    const declaredTasks = strings(item.task_ids);
    const conversations = strings(item.conversation_ids);
    const sourceRef = string(item.source_ref);
    if (!string(item.label) || !sourceRef || !safeProjectSourceRef(sourceRef) || !string(item.observed_at)
        || !isVerification(item.verification) || !isCurrentness(item.currentness)
        || !declaredTasks || !conversations || duplicate(declaredTasks)) {
      fail(result, `canonical-work:${id}`, 'canonical Work fields are missing or malformed');
      continue;
    }
    workTaskIds.set(id, declaredTasks);
  }
  for (const item of tasks) {
    const id = string(item.task_id)!;
    const workId = string(item.work_id);
    const conversations = strings(item.conversation_ids);
    const sourceRef = string(item.source_ref);
    if (!workId || !workTaskIds.get(workId)?.includes(id) || !string(item.label) || !sourceRef
        || !safeProjectSourceRef(sourceRef) || !string(item.observed_at)
        || !isVerification(item.verification) || !isCurrentness(item.currentness) || !conversations) {
      fail(result, `canonical-task:${id}`, 'canonical Task fields or explicit Work relation are malformed');
    }
  }
  for (const item of artifacts) {
    const id = string(item.artifact_id)!;
    const evidenceRefs = strings(item.evidence_refs);
    const sourceRef = string(item.source_ref);
    if (item.kind !== 'source_file' || !sourceRef || !safeProjectSourceRef(sourceRef) || !string(item.observed_at)
        || !isVerification(item.verification) || !isCurrentness(item.currentness) || !string(item.task_id)
        || !taskIds.includes(String(item.task_id)) || !evidenceRefs) {
      fail(result, `canonical-artifact:${id}`, 'canonical Artifact fields or explicit Task relation are malformed');
    }
  }
  if ([...workTaskIds.values()].flat().some((taskId) => !taskIds.includes(taskId))) {
    fail(result, `canonical-facts:${adapter.projectId}`, 'canonical Work names a missing Task identity');
  }
  if (!result.ok) return { ...result, governanceBindings: [], tasks: [], artifacts: [], sourceFingerprints: [] };

  const manifestPath = known.find((locator) => locator.kind === 'WORK')?.path ?? 'canonical-facts.yaml';
  for (const item of works) {
    const workId = String(item.work_id);
    result.governanceBindings.push({
      projectId: adapter.projectId,
      workId,
      workLabel: String(item.label),
      workSource: {
        source: 'canonical-project-fact',
        sourceRef: pinnedSourceRef(adapter, commit!, String(item.source_ref)),
        observedAt: String(item.observed_at),
        verification: verification(item.verification),
        currentness: currentness(item.currentness),
        conversationIds: strings(item.conversation_ids)!,
      },
      binding: {
        projectId: adapter.projectId,
        root: projectRoot,
        canonicalPath: pinnedSourceRef(adapter, commit!, manifestPath, `#works/${workId}`),
        observedAt: String(item.observed_at),
        verification: verification(item.verification),
      },
    });
  }
  for (const item of tasks) {
    const taskId = String(item.task_id);
    result.tasks.push({
      taskId,
      projectId: adapter.projectId,
      label: String(item.label),
      source: 'canonical-project-fact',
      sourceRef: pinnedSourceRef(adapter, commit!, String(item.source_ref)),
      observedAt: String(item.observed_at),
      verification: verification(item.verification),
      currentness: currentness(item.currentness),
      workId: String(item.work_id),
      conversationKeys: strings(item.conversation_ids)!,
      evidenceRefs: [],
    });
  }
  for (const item of artifacts) {
    const artifactId = String(item.artifact_id);
    const executionRef = string(item.produced_by_execution_ref);
    result.artifacts.push({
      artifactId,
      projectId: adapter.projectId,
      kind: 'file-evidence',
      ...(executionRef ? { executionId: executionRef } : {}),
      title: String(item.source_ref),
      source: 'canonical-project-fact',
      sourceRef: pinnedSourceRef(adapter, commit!, String(item.source_ref)),
      observedAt: String(item.observed_at),
      verification: verification(item.verification),
      currentness: currentness(item.currentness),
      taskId: String(item.task_id),
      evidenceRefs: strings(item.evidence_refs)!,
    });
  }
  result.governanceBindings.sort((a, b) => String(a.workId).localeCompare(String(b.workId)));
  result.tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
  result.artifacts.sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  result.sourceFingerprints.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
  void observedAt;
  return result;
}
