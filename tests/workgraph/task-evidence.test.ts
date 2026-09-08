/**
 * PHASE 3A.1 tests: Task / Evidence first-class nodes + Workflow freeze.
 *
 * - explicit Task fact -> Task node (project + work membership)
 * - no Task source -> no guessed Task (even with executions running)
 * - TaskState orthogonal to RuntimeState
 * - explicit Evidence fact -> Evidence node
 * - event without evidence identity -> no Evidence node
 * - Evidence -> Gate evidences edge requires exact ref
 * - Work -> Task membership requires explicit workId + existing Work
 * - Workflow never becomes a canonical node
 * - semanticHash stable over Task/Evidence content
 */

import { describe, expect, it } from 'vitest';
import { buildWorkGraphCandidate, compileWorkGraph } from '../../src/core/workgraph/compiler';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';

const NOW = '2026-09-07T00:00:00.000Z';

function baseFacts(overrides: Partial<WorkGraphSourceFacts> = {}): WorkGraphSourceFacts {
  return {
    governanceBindings: [
      { projectId: 'p1', workId: 'w1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
    ],
    historySessions: [],
    memoryEntries: [],
    packets: [],
    handoffs: [],
    adapterExecutions: [],
    contextItems: [],
    attentionItems: [],
    artifacts: [],
    tasks: [],
    evidenceItems: [],
    ...overrides,
  };
}

function options(projectId: string, facts: WorkGraphSourceFacts): WorkGraphCompileOptions {
  return { projectId, sourceDigest: `digest-${projectId}`, facts, now: NOW };
}

describe('Task first-class node', () => {
  it('explicit Task fact creates Task node with project + work membership', async () => {
    const facts = baseFacts({
      tasks: [
        { taskId: 't1', projectId: 'p1', label: 'Write tests', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', taskState: 'active', workId: 'w1', evidenceRefs: [] },
      ],
    });
    const { revision, receipt } = await compileWorkGraph(options('p1', facts));
    expect(receipt.outcome).toBe('VERIFIED');
    const tasks = revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'task');
    expect(tasks).toHaveLength(1);
    expect((tasks[0] as { taskState: string }).taskState).toBe('active');
    const memberships = revision!.candidate.semanticFacts.edges.filter(
      (e) => e.kind === 'membership' && e.target === 'task:p1:t1',
    );
    expect(memberships.map((e) => e.source).sort()).toEqual(['project:p1', 'work:p1:w1']);
  });

  it('no Task source means no Task node, even with executions running', async () => {
    const facts = baseFacts({
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      overlaySnapshot: {
        conversations: [
          { conversationKey: 'c1', projectId: 'p1', role: 'dev', platform: 'codex', lifecycleState: 'ACTIVE', taskState: 'active', runtimeState: 'working', attentionState: 'none', verification: 'VERIFIED', evidenceRefs: [] },
        ],
        projects: [{ projectId: 'p1', label: 'P1' }],
        memoryIndex: [],
        inbox: [],
        sourceFingerprints: [],
        problems: [],
      },
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
  });

  it('TaskState is orthogonal to RuntimeState (no inference from execution)', async () => {
    const facts = baseFacts({
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      tasks: [
        { taskId: 't1', projectId: 'p1', label: 'Blocked upstream', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', taskState: 'blocked', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const task = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'task');
    // Execution is working; task stays blocked. No inference crossed the boundary.
    expect((task as { taskState: string }).taskState).toBe('blocked');
    const exec = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'execution');
    expect((exec as { runtimeState: string }).runtimeState).toBe('working');
  });

  it('Task naming unknown work records a problem, never invents the Work', async () => {
    const facts = baseFacts({
      tasks: [
        { taskId: 't1', projectId: 'p1', label: 'Orphan', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', workId: 'ghost-work', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'work')).toHaveLength(1);
    expect(revision!.candidate.semanticFacts.nodes.some((n) => n.id === 'work:p1:ghost-work')).toBe(false);
    expect(revision!.candidate.semanticFacts.problems.some((p) => p.message.includes('ghost-work'))).toBe(true);
  });

  it('Task gateIds create blocked-by only for existing gates', async () => {
    const facts = baseFacts({
      attentionItems: [
        { id: 'g1', kind: 'gate-attention', level: 'review', title: 'G', summary: 'g', projectId: 'p1', sourceRef: 'attention:g1', evidenceRefs: [], observedAt: NOW, verification: 'OBSERVED' },
      ],
      tasks: [
        { taskId: 't1', projectId: 'p1', label: 'T', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', gateIds: ['g1', 'ghost-gate'], evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const blocked = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'blocked-by');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].source).toBe('task:p1:t1');
    expect(blocked[0].target).toBe('gate:p1:g1');
  });
});

describe('Evidence first-class node', () => {
  it('explicit Evidence fact creates an Evidence node', async () => {
    const facts = baseFacts({
      evidenceItems: [
        { evidenceId: 'ev1', projectId: 'p1', label: 'Build log', evidenceType: 'test-result', source: 'adapter', sourceRef: 'build:run-42', observedAt: NOW, verification: 'OBSERVED', evidenceRefs: [] },
      ],
    });
    const { revision, receipt } = await compileWorkGraph(options('p1', facts));
    expect(receipt.outcome).toBe('VERIFIED');
    const nodes = revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'evidence');
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as { sourceRef: string }).sourceRef).toBe('build:run-42');
  });

  it('events without evidence identity never become Evidence nodes', async () => {
    const facts = baseFacts({
      adapterExecutions: [
        { executionId: 'e1', backend: 'paseo', provider: 'codex', runtimeRef: 'a1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: ['timeline:item-1', 'timeline:item-2'], sourceRef: 'paseo:a1' },
      ],
      artifacts: [
        { artifactId: 'art1', projectId: 'p1', kind: 'agent-result', executionId: 'e1', title: 'R', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    // Timeline items and artifact evidenceRefs are strings, not nodes.
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'evidence')).toHaveLength(0);
  });

  it('Evidence -> Gate evidences edge requires the exact backed node', async () => {
    const facts = baseFacts({
      attentionItems: [
        { id: 'g1', kind: 'packet-stale', level: 'review', title: 'G', summary: 'g', projectId: 'p1', sourceRef: 'attention:g1', evidenceRefs: [], observedAt: NOW, verification: 'OBSERVED' },
      ],
      evidenceItems: [
        { evidenceId: 'ev1', projectId: 'p1', label: 'Stale proof', evidenceType: 'packet-check', source: 'packet', sourceRef: 'packet:check-1', observedAt: NOW, verification: 'VERIFIED', backsNodeId: 'gate:p1:g1', evidenceRefs: [] },
        { evidenceId: 'ev2', projectId: 'p1', label: 'Dangling', evidenceType: 'packet-check', source: 'packet', sourceRef: 'packet:check-2', observedAt: NOW, verification: 'VERIFIED', backsNodeId: 'gate:p1:ghost', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const evidences = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'evidences');
    expect(evidences).toHaveLength(1);
    expect(evidences[0].source).toBe('evidence:p1:ev1');
    expect(evidences[0].target).toBe('gate:p1:g1');
    expect(revision!.candidate.semanticFacts.problems.some((p) => p.message.includes('ghost'))).toBe(true);
  });

  it('Evidence backing an execution or artifact is expressible', async () => {
    const facts = baseFacts({
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      artifacts: [
        { artifactId: 'art1', projectId: 'p1', kind: 'tool-evidence', executionId: 'e1', title: 'R', evidenceRefs: [] },
      ],
      evidenceItems: [
        { evidenceId: 'ev1', projectId: 'p1', label: 'Receipt', evidenceType: 'runtime-receipt', source: 'adapter', sourceRef: 'receipt:e1', observedAt: NOW, verification: 'OBSERVED', backsNodeId: 'artifact:p1:art1', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const evidences = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'evidences');
    expect(evidences).toHaveLength(1);
    expect(evidences[0].source).toBe('evidence:p1:ev1');
    expect(evidences[0].target).toBe('artifact:p1:art1');
  });
});

describe('Workflow freeze', () => {
  it('no input shape produces a workflow node; the kind does not exist', async () => {
    const facts = baseFacts({
      adapterExecutions: [
        { executionId: 'e1', backend: 'paseo', provider: 'codex', runtimeRef: 'a1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'paseo:a1' },
      ],
      tasks: [
        { taskId: 't1', projectId: 'p1', label: 'T', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', workId: 'w1', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const kinds = new Set(revision!.candidate.semanticFacts.nodes.map((n) => n.kind));
    expect(kinds.has('workflow' as never)).toBe(false);
    expect(kinds.has('task')).toBe(true);
    expect(kinds.has('work')).toBe(true);
    expect(kinds.has('execution')).toBe(true);
  });

  it('candidate with an invented workflow node fails validation', async () => {
    const candidate = buildWorkGraphCandidate(options('p1', baseFacts()));
    (candidate.semanticFacts.nodes as unknown[]).push({
      kind: 'workflow',
      id: 'workflow:p1:wf1',
      projectId: 'p1',
      label: 'Grouped in UI',
      source: 'ui-grouping',
      sourceRef: 'ui:group-1',
      observedAt: NOW,
      verification: 'UNKNOWN',
    });
    const { validateWorkGraphCandidate } = await import('../../src/core/workgraph/schema');
    const result = validateWorkGraphCandidate(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'workgraph/unknown-node-kind')).toBe(true);
    }
  });
});

describe('semanticHash over Task/Evidence', () => {
  it('identical Task/Evidence input in different order hashes identically', async () => {
    const t1 = { taskId: 't1', projectId: 'p1', label: 'A', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED' as const, evidenceRefs: [] as string[] };
    const t2 = { taskId: 't2', projectId: 'p1', label: 'B', source: 'governance-tasks', sourceRef: 'gov:tasks:t2', observedAt: NOW, verification: 'VERIFIED' as const, evidenceRefs: [] as string[] };
    const e1 = { evidenceId: 'ev1', projectId: 'p1', label: 'E1', evidenceType: 'git-fact', source: 'adapter', sourceRef: 'git:abc', observedAt: NOW, verification: 'OBSERVED' as const, evidenceRefs: [] as string[] };
    const a = await compileWorkGraph(options('p1', baseFacts({ tasks: [t1, t2], evidenceItems: [e1] })));
    const b = await compileWorkGraph(options('p1', baseFacts({ tasks: [t2, t1], evidenceItems: [e1] })));
    expect(a.revision!.semanticHash).toBe(b.revision!.semanticHash);
  });

  it('adding a Task changes the semantic hash', async () => {
    const a = await compileWorkGraph(options('p1', baseFacts()));
    const b = await compileWorkGraph(
      options('p1', baseFacts({ tasks: [{ taskId: 't1', projectId: 'p1', label: 'T', source: 'governance-tasks', sourceRef: 'gov:tasks:t1', observedAt: NOW, verification: 'VERIFIED', evidenceRefs: [] }] })),
    );
    expect(a.revision!.semanticHash).not.toBe(b.revision!.semanticHash);
  });
});
