import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWorkGraph } from '../../src/core/workgraph/compiler';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';
import { buildFocusDetail, buildGraphElements, moveGraphNode } from '../../src/renderer-vnext/src/workGraphView';

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
      projectId: 'p1', workId: 'w1', runtimeState: 'working', live: true,
      evidenceRefs: [], sourceRef: 'paseo:agent-1',
    }],
    contextItems: [
      { contextId: 'available', projectId: 'p1', title: 'Available only', source: 'manual', body: '', state: 'available', pinned: false, isReference: false, evidenceRefs: [] },
      { contextId: 'included', projectId: 'p1', title: 'Included', source: 'manual', body: '', state: 'included', pinned: false, isReference: false, evidenceRefs: [], consumedBy: { executionId: 'paseo-agent-1', action: 'included' } },
    ],
    attentionItems: [], artifacts: [],
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
