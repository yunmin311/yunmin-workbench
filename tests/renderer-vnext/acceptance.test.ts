import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWorkGraph } from '../../src/core/workgraph/compiler';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';
import {
  buildExecutionStory,
  buildFocusDetail,
  buildGraphElements,
  buildRegionNavigation,
  currentSelectionForNode,
  moveGraphNode,
  projectRegionVisibility,
  projectIdsFromOverlay,
  relationWord,
  resolveCompactNavigate,
  workRegionFitIds,
} from '../../src/renderer-vnext/src/workGraphView';

const NOW = '2026-09-08T00:00:00.000Z';

function facts(): WorkGraphSourceFacts {
  return {
    governanceBindings: [{
      projectId: 'p1', workId: 'w1', workLabel: 'Workbench acceptance',
      binding: { projectId: 'p1', root: '/repo', canonicalPath: '/repo', observedAt: NOW, verification: 'VERIFIED' },
    }],
    historySessions: [], memoryEntries: [], packets: [], handoffs: [],
    adapterExecutions: [{
      executionId: 'paseo-agent-1', backend: 'paseo', provider: 'codex', runtimeRef: 'agent-1',
      projectId: 'p1', workId: 'w1', taskId: 'task-1', runtimeState: 'working', live: true,
      evidenceRefs: [], sourceRef: 'paseo:agent-1',
    }],
    contextItems: [
      { contextId: 'available', projectId: 'p1', title: 'Available only', source: 'manual', body: '', state: 'available', pinned: false, isReference: false, evidenceRefs: [] },
      { contextId: 'included', projectId: 'p1', title: 'Included', source: 'manual', body: '', state: 'included', pinned: false, isReference: false, evidenceRefs: [], consumedBy: { executionId: 'paseo-agent-1', action: 'included' } },
    ],
    attentionItems: [], artifacts: [{
      artifactId: 'result-1', projectId: 'p1', kind: 'agent-result', executionId: 'paseo-agent-1',
      eventRef: 'event-final', title: 'Agent response completed', content: 'No contract mismatch; no files changed.',
      observedAt: NOW, verification: 'OBSERVED', evidenceRefs: [],
    }],
    tasks: [{
      taskId: 'task-1', projectId: 'p1', label: 'Close Phase 3B', source: 'governance-tasks',
      sourceRef: 'governance:task-1', observedAt: NOW, verification: 'UNKNOWN', taskState: 'active',
      workId: 'w1', evidenceRefs: [],
    }],
    evidenceItems: [{
      evidenceId: 'evidence-1', projectId: 'p1', label: 'Typecheck receipt', evidenceType: 'test-result',
      source: 'adapter', sourceRef: 'test:typecheck', observedAt: NOW, verification: 'OBSERVED', evidenceRefs: [],
    }],
  };
}

async function revision() {
  const options: WorkGraphCompileOptions = { projectId: 'p1', sourceDigest: 'fixture', facts: facts(), now: NOW };
  const result = await compileWorkGraph(options);
  if (!result.revision) throw new Error('fixture must compile');
  return result.revision;
}

describe('vNext renderer acceptance', () => {
  it('renders compiler nodes without changing their semantic kinds or UNKNOWN verification', async () => {
    const rev = await revision();
    const graph = buildGraphElements(rev);
    expect(graph.nodes.find((node) => node.id === 'task:p1:task-1')?.data).toMatchObject({ kind: 'task', label: 'Close Phase 3B', verification: 'UNKNOWN' });
    expect(graph.nodes.find((node) => node.id === 'evidence:p1:evidence-1')?.data).toMatchObject({ kind: 'evidence', label: 'Typecheck receipt' });
    expect(graph.nodes.find((node) => node.id === 'execution:p1:paseo-agent-1')?.data.kind).toBe('execution');
    expect(graph.nodes.some((node) => node.data.kind === 'work' && node.id.includes('paseo-agent-1'))).toBe(false);
  });

  it('renders uses-context only for explicitly included context', async () => {
    const graph = buildGraphElements(await revision());
    expect(graph.edges.some((edge) => edge.data?.kind === 'uses-context' && edge.target === 'context:p1:available')).toBe(false);
    expect(graph.edges.some((edge) => edge.data?.kind === 'uses-context' && edge.target === 'context:p1:included')).toBe(true);
  });

  it('keeps renderer drag state outside semantic and layout hashes', async () => {
    const rev = await revision();
    const graph = buildGraphElements(rev);
    const moved = moveGraphNode(graph.nodes, 'task:p1:task-1', { x: 900, y: 700 });
    expect(moved.find((node) => node.id === 'task:p1:task-1')?.position).toEqual({ x: 900, y: 700 });
    expect(rev.semanticHash).toHaveLength(64);
    expect(rev.layoutHash).toBe('');
  });

  it('builds Focus Detail from the selected node and direct relations only', async () => {
    const rev = await revision();
    const detail = buildFocusDetail(rev, 'task:p1:task-1');
    expect(detail).toMatchObject({
      label: 'Close Phase 3B', kind: 'task', source: 'governance-tasks', sourceRef: 'governance:task-1',
      verification: 'UNKNOWN', taskState: 'active',
    });
    expect(detail?.relations.every((relation) => relation.source === 'task:p1:task-1' || relation.target === 'task:p1:task-1')).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('semanticHash');
    expect(JSON.stringify(detail)).not.toContain('candidate');
  });

  it('projects region navigation and collapses presentation without changing semantic nodes', async () => {
    const rev = await revision();
    const graph = buildGraphElements(rev);
    const navigation = buildRegionNavigation(graph.nodes, 'task:p1:task-1');
    expect(navigation).toEqual([
      expect.objectContaining({ workId: 'w1', label: 'Workbench acceptance', active: true }),
    ]);

    const projected = projectRegionVisibility(graph.nodes, graph.edges, new Set([navigation[0]!.regionId]));
    expect(projected.nodes.find((node) => node.id === navigation[0]!.regionId)).toMatchObject({ hidden: false });
    expect(projected.nodes.find((node) => node.id === 'task:p1:task-1')).toMatchObject({ hidden: true });
    expect(projected.edges.some((edge) => edge.hidden)).toBe(true);
    expect(rev.candidate.semanticFacts.nodes.find((node) => node.id === 'task:p1:task-1')).toBeTruthy();
  });

  it('frames Work regions and the project anchor, never the knowledge wall', async () => {
    const graph = buildGraphElements(await revision());
    const framed = workRegionFitIds(graph.nodes);
    // The project anchor stays in frame; every Work region stays in frame.
    expect(framed).toContain('project:p1');
    const regionIds = graph.nodes.filter((node) => node.type === 'wb-region').map((node) => node.id);
    expect(regionIds.length).toBeGreaterThan(0);
    expect(framed).toEqual(expect.arrayContaining(regionIds));
    // Project-scoped knowledge renders in full but never defines the viewport.
    const peripheral = graph.nodes.filter((node) => node.className === 'is-peripheral');
    expect(peripheral.length).toBeGreaterThan(0);
    for (const node of peripheral) expect(framed).not.toContain(node.id);
    expect(peripheral.every((node) => node.type !== 'wb-region')).toBe(true);
  });

  it('speaks product words for edge kinds without changing their semantic identity', async () => {
    expect(relationWord('membership')).toBe('Part of');
    expect(relationWord('blocked-by')).toBe('Blocked by');
    expect(relationWord('uses-context')).toBe('Uses');
    const rev = await revision();
    const kinds = new Set(rev.candidate.semanticFacts.edges.map((edge) => edge.kind));
    for (const kind of kinds) expect(relationWord(kind)).toBeTruthy();
    expect(rev.candidate.semanticFacts.edges.every((edge) => edge.kind === 'membership' || typeof edge.kind === 'string')).toBe(true);
  });

  it('offers exact declared project ids without inventing a recent project', () => {
    expect(projectIdsFromOverlay({ projects: [{ projectId: 'p2' }, { projectId: 'p1' }, { projectId: 'p2' }] }))
      .toEqual(['p1', 'p2']);
  });

  it('explains a running execution only from exact graph relations and fields', async () => {
    const rev = await revision();
    const story = buildExecutionStory(rev, 'execution:p1:paseo-agent-1');
    expect(story).toMatchObject({
      doing: 'Close Phase 3B',
      context: ['Included'],
      outputs: ['No contract mismatch; no files changed.'],
      next: 'No next-step fact yet',
    });
    expect(JSON.stringify(story)).not.toContain('Available only');
  });

  it('resolves a canonical Task result through its exact execution relation', async () => {
    const story = buildExecutionStory(await revision(), 'task:p1:task-1');
    expect(story).toMatchObject({
      doing: 'Close Phase 3B',
      context: ['Included'],
      outputs: ['No contract mismatch; no files changed.'],
      next: 'No next-step fact yet',
    });
  });

  it('shows the latest observed response first while retaining exact chronology', async () => {
    const ordered = facts();
    ordered.adapterExecutions.push({
      executionId: 'paseo-agent-2', backend: 'paseo', provider: 'codex', runtimeRef: 'agent-2',
      projectId: 'p1', workId: 'w1', taskId: 'task-1', runtimeState: 'idle', live: false,
      evidenceRefs: [], sourceRef: 'paseo:agent-2',
    });
    ordered.artifacts.push({
      artifactId: 'result-2', projectId: 'p1', kind: 'agent-result', executionId: 'paseo-agent-2',
      eventRef: 'event-final-2', title: 'Agent response completed', content: 'Final verified conclusion.',
      observedAt: '2026-09-08T00:00:02.000Z', verification: 'OBSERVED', evidenceRefs: [],
    });
    const result = await compileWorkGraph({ projectId: 'p1', sourceDigest: 'ordered', facts: ordered, now: NOW });
    const story = buildExecutionStory(result.revision!, 'task:p1:task-1');
    expect(story?.latestOutput).toBe('Final verified conclusion.');
    expect(story?.outputs).toEqual(['No contract mismatch; no files changed.', 'Final verified conclusion.']);
  });

  it('bookmarks an explicit selection only inside its own project', async () => {
    const rev = await revision();
    const nodes = rev.candidate.semanticFacts.nodes;
    const task = nodes.find((node) => node.kind === 'task');
    const work = nodes.find((node) => node.kind === 'work');
    expect(task && work).toBeTruthy();
    expect(currentSelectionForNode(task!, 'p1')).toEqual({ projectId: 'p1', workId: 'w1', taskId: 'task-1' });
    expect(currentSelectionForNode(work!, 'p1')).toEqual({ projectId: 'p1', workId: 'w1' });
    // A stale node from another project must never be re-scoped (dual-project
    // regression: switching projects used to mint a cross-project chimera).
    expect(currentSelectionForNode({ ...task!, projectId: 'p2' }, 'p1')).toBeNull();
    expect(currentSelectionForNode({ ...work!, projectId: 'p2' }, 'p1')).toBeNull();
    const conversation = nodes.find((node) => node.kind === 'conversation');
    if (conversation) expect(currentSelectionForNode(conversation, 'p1')).toBeNull();
  });

  it('resolves compact navigation across projects without guessing', async () => {
    const rev = await revision();
    const nodeIds = new Set(buildGraphElements(rev).nodes.map((node) => node.id));
    expect(resolveCompactNavigate(
      { projectId: 'p1', workId: 'w1', taskId: 'task-1', action: 'prepare' }, 'p1', ['p1', 'p2'], nodeIds,
    )).toEqual({ resolution: 'apply', nodeId: 'task:p1:task-1' });
    // Another known project switches first instead of being dropped.
    expect(resolveCompactNavigate(
      { projectId: 'p2', workId: 'w1', taskId: 'task-1', action: 'continue' }, 'p1', ['p1', 'p2'], nodeIds,
    )).toEqual({ resolution: 'switch-project', projectId: 'p2' });
    // Unknown projects and unknown nodes stay ignored, never guessed.
    expect(resolveCompactNavigate({ projectId: 'p9' }, 'p1', ['p1', 'p2'], nodeIds))
      .toEqual({ resolution: 'ignore' });
    expect(resolveCompactNavigate(
      { projectId: 'p1', workId: 'w9', taskId: 'missing', action: 'continue' }, 'p1', ['p1', 'p2'], nodeIds,
    )).toEqual({ resolution: 'apply', nodeId: 'project:p1' });
  });
});

describe('vNext renderer import boundary', () => {
  it('does not import the main process', async () => {
    const root = resolve('src/renderer-vnext/src');
    const pending = [join(root, 'main.tsx')];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) continue;
        const base = resolve(dirname(file), specifier);
        const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
        const next = candidates.find((candidate) => candidate.startsWith(root) && existsSync(candidate));
        if (next) pending.push(next);
        expect(relative(resolve('src/main'), base).startsWith('..'), `renderer import ${specifier} from ${file}`).toBe(true);
      }
    }
  });
});
