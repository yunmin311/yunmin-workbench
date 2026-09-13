import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';
import { lastGoodForCanonicalRead, readPinnedCanonicalFacts } from '../../src/main/adapters/canonicalFacts';
import type { WorkGraphRevision } from '../../src/core/workgraph/revision';

const NOW = '2026-09-10T00:00:00.000Z';
const REMOTE = 'https://github.com/example/creative-os.git';
const roots: string[] = [];

const validFacts = `
schema_version: "1.0"
record_type: canonical_fact_manifest
project_id: creative-os
works:
  - work_id: 001-inspiration-capture
    project_id: creative-os
    label: Pinned work
    source_ref: specs/001-inspiration-capture/spec.md
    observed_at: "2026-09-09T19:36:01+08:00"
    verification: VERIFIED
    currentness: CURRENT
    task_ids: [T006, T007, T008]
    conversation_ids: []
tasks:
  - { task_id: T006, project_id: creative-os, work_id: 001-inspiration-capture, label: Shared types, source_ref: tasks.md#T006, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, conversation_ids: [] }
  - { task_id: T007, project_id: creative-os, work_id: 001-inspiration-capture, label: Image domain, source_ref: tasks.md#T007, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, conversation_ids: [] }
  - { task_id: T008, project_id: creative-os, work_id: 001-inspiration-capture, label: Inspiration domain, source_ref: tasks.md#T008, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, conversation_ids: [] }
artifacts:
  - { artifact_id: "creative-os:T006:shared-types", project_id: creative-os, kind: source_file, source_ref: src/shared/types.ts, task_id: T006, produced_by_execution_ref: null, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, evidence_refs: [] }
  - { artifact_id: "creative-os:T007:image-domain", project_id: creative-os, kind: source_file, source_ref: src/main/domain/image.ts, task_id: T007, produced_by_execution_ref: null, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, evidence_refs: [] }
  - { artifact_id: "creative-os:T008:inspiration-domain", project_id: creative-os, kind: source_file, source_ref: src/main/domain/inspiration.ts, task_id: T008, produced_by_execution_ref: null, observed_at: "2026-09-09T19:36:01+08:00", verification: VERIFIED, currentness: CURRENT, evidence_refs: [] }
evidence: []
`;

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function createRepo(facts = validFacts): { root: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'wb-canonical-facts-'));
  roots.push(root);
  git(root, 'init');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'remote', 'add', 'origin', REMOTE);
  mkdirSync(join(root, 'specs/001-inspiration-capture'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# Rules\n', 'utf8');
  writeFileSync(join(root, 'specs/001-inspiration-capture/canonical-facts.yaml'), facts, 'utf8');
  git(root, 'add', 'CLAUDE.md', 'specs/001-inspiration-capture/canonical-facts.yaml');
  git(root, 'commit', '-m', 'fixture');
  return { root, commit: git(root, 'rev-parse', 'HEAD') };
}

function adapter(commit: string, sourceRef = 'specs/001-inspiration-capture/canonical-facts.yaml#works') {
  return parseProjectAdapter(`
schema_version: 2
project_id: creative-os
canonical_source:
  repository: example/creative-os
  remote: ${REMOTE}
  path: CLAUDE.md
  commit: ${commit}
  verification: VERIFIED
canonical_fact_sources:
  - { kind: WORK, source_ref: ${sourceRef}, format: YAML, verification: VERIFIED }
  - { kind: TASK, source_ref: specs/001-inspiration-capture/canonical-facts.yaml#tasks, format: YAML, verification: VERIFIED }
  - { kind: ARTIFACT, source_ref: specs/001-inspiration-capture/canonical-facts.yaml#artifacts, format: YAML, verification: VERIFIED }
`)!;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pinned canonical project facts', () => {
  it('reads exact facts from the pinned commit even when the working tree is dirty', async () => {
    const repo = createRepo();
    writeFileSync(
      join(repo.root, 'specs/001-inspiration-capture/canonical-facts.yaml'),
      validFacts.replace('Pinned work', 'Dirty working tree work'),
      'utf8',
    );

    const result = await readPinnedCanonicalFacts(adapter(repo.commit), repo.root, NOW);

    expect(result.ok).toBe(true);
    expect(result.governanceBindings).toEqual([
      expect.objectContaining({
        projectId: 'creative-os', workId: '001-inspiration-capture', workLabel: 'Pinned work',
        workSource: expect.objectContaining({
          source: 'canonical-project-fact',
          sourceRef: `git:example/creative-os@${repo.commit}:specs/001-inspiration-capture/spec.md`,
          verification: 'VERIFIED', currentness: 'CURRENT', conversationIds: [],
        }),
      }),
    ]);
    expect(result.tasks.map((task) => task.taskId)).toEqual(['T006', 'T007', 'T008']);
    expect(result.tasks.every((task) => task.conversationKeys?.length === 0)).toBe(true);
    expect(result.tasks[0]).toMatchObject({
      sourceRef: `git:example/creative-os@${repo.commit}:tasks.md#T006`,
      currentness: 'CURRENT',
    });
    expect(result.artifacts.map((artifact) => artifact.artifactId)).toEqual([
      'creative-os:T006:shared-types',
      'creative-os:T007:image-domain',
      'creative-os:T008:inspiration-domain',
    ]);
    expect(result.artifacts.every((artifact) => artifact.executionId === undefined && artifact.evidenceRefs.length === 0)).toBe(true);
    expect(result.artifacts[0]).toMatchObject({
      taskId: 'T006', source: 'canonical-project-fact',
      sourceRef: `git:example/creative-os@${repo.commit}:src/shared/types.ts`,
      verification: 'VERIFIED', currentness: 'CURRENT',
    });
    expect(result.sourceFingerprints).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Dirty working tree work');
  });

  it.each([
    ['missing commit', '0'.repeat(40), 'specs/001-inspiration-capture/canonical-facts.yaml#works'],
    ['missing path', null, 'specs/missing.yaml#works'],
    ['missing fragment', null, 'specs/001-inspiration-capture/canonical-facts.yaml#missing'],
  ])('fails closed for %s', async (_label, commitOverride, sourceRef) => {
    const repo = createRepo();
    const result = await readPinnedCanonicalFacts(adapter(commitOverride ?? repo.commit, sourceRef), repo.root, NOW);
    expect(result.ok).toBe(false);
    expect(result.governanceBindings).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it.each([
    ['malformed YAML', 'works: ['],
    ['duplicate identity', validFacts.replace('task_id: T007', 'task_id: T006')],
    ['project mismatch', validFacts.replace('project_id: creative-os\nworks:', 'project_id: another-project\nworks:')],
  ])('fails the whole canonical source for %s', async (_label, facts) => {
    const repo = createRepo(facts);
    const result = await readPinnedCanonicalFacts(adapter(repo.commit), repo.root, NOW);
    expect(result.ok).toBe(false);
    expect(result.governanceBindings).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });

  it('ignores unknown locator kinds with a diagnostic and preserves known facts', async () => {
    const repo = createRepo();
    const parsed = adapter(repo.commit);
    parsed.canonicalFactSources!.push({
      kind: 'FUTURE_KIND', sourceRef: 'future.yaml#facts', format: 'YAML', verification: 'VERIFIED',
    });
    const result = await readPinnedCanonicalFacts(parsed, repo.root, NOW);
    expect(result.ok).toBe(true);
    expect(result.governanceBindings).toHaveLength(1);
    expect(result.problems).toEqual([expect.objectContaining({ message: expect.stringContaining('FUTURE_KIND') })]);
  });

  it('fails closed when a known locator is not verified', async () => {
    const repo = createRepo();
    const parsed = adapter(repo.commit);
    parsed.canonicalFactSources![0].verification = 'UNVERIFIED';
    const result = await readPinnedCanonicalFacts(parsed, repo.root, NOW);
    expect(result).toMatchObject({ ok: false, governanceBindings: [], tasks: [], artifacts: [] });
  });

  it('keeps legacy adapters without canonical fact locators working', async () => {
    const repo = createRepo();
    const parsed = adapter(repo.commit);
    delete parsed.canonicalFactSources;
    await expect(readPinnedCanonicalFacts(parsed, repo.root, NOW)).resolves.toMatchObject({
      ok: true, governanceBindings: [], tasks: [], artifacts: [], problems: [],
    });
  });

  it('retains the last-good revision only when the canonical read fails', () => {
    const previous = { revisionId: 'workgraph-last-good' } as WorkGraphRevision;
    expect(lastGoodForCanonicalRead({ ok: false }, previous)).toBe(previous);
    expect(lastGoodForCanonicalRead({ ok: true }, previous)).toBeUndefined();
    expect(lastGoodForCanonicalRead({ ok: false }, undefined)).toBeUndefined();
  });
});
