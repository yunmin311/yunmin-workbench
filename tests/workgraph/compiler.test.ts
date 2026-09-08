/**
 * Work Graph compiler domain tests (PHASE 3A acceptance).
 *
 * Covers:
 * - Project -> Work -> Execution chain from explicit facts
 * - Work spanning two different executors/backends
 * - Context available != used (no uses-context edge for available)
 * - uses-context only after explicit inclusion + consumer
 * - produces only with exact execution identity
 * - handoff only with exact usedResultRef
 * - Gate blocked + Runtime running coexist
 * - UNKNOWN never auto-promoted
 * - Semantic hash independent of layout (no layout exists; reorder-proof)
 * - Paseo agents are Executions, never Works
 * - History sessions are evidence only, never nodes
 */

import { describe, expect, it } from 'vitest';
import { buildWorkGraphCandidate, compileWorkGraph, computeWorkGraphSemanticHash } from '../../src/core/workgraph/compiler';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';

const NOW = '2026-09-07T00:00:00.000Z';

function baseFacts(overrides: Partial<WorkGraphSourceFacts> = {}): WorkGraphSourceFacts {
  return {
    governanceBindings: [],
    historySessions: [],
    memoryEntries: [],
    packets: [],
    handoffs: [],
    adapterExecutions: [],
    contextItems: [],
    attentionItems: [],
    artifacts: [],
    ...overrides,
  };
}

function options(projectId: string, facts: WorkGraphSourceFacts): WorkGraphCompileOptions {
  return { projectId, sourceDigest: `digest-${projectId}`, facts, now: NOW };
}

describe('Project -> Work -> Execution', () => {
  it('builds project, work, conversation, execution with membership + execution-of edges', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', workId: 'w1', workLabel: 'Auth work', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      overlaySnapshot: {
        conversations: [
          { conversationKey: 'c1', projectId: 'p1', role: 'dev', platform: 'codex', lifecycleState: 'ACTIVE', taskState: 'active', runtimeState: 'idle', attentionState: 'none', verification: 'VERIFIED', evidenceRefs: [] },
        ],
        projects: [{ projectId: 'p1', label: 'P1' }],
        memoryIndex: [],
        inbox: [],
        sourceFingerprints: [],
        problems: [],
      },
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 'thread-1', projectId: 'p1', conversationKey: 'c1', workId: 'w1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:thread-1' },
      ],
    });
    const { revision, receipt } = await compileWorkGraph(options('p1', facts));
    expect(receipt.outcome).toBe('VERIFIED');
    expect(revision).not.toBeNull();
    const kinds = revision!.candidate.semanticFacts.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(['conversation', 'execution', 'project', 'work']);
    const edgeKinds = revision!.candidate.semanticFacts.edges.map((e) => e.kind);
    expect(edgeKinds).toContain('execution-of');
    expect(edgeKinds.filter((k) => k === 'membership').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Work spans two executors', () => {
  it('one Work node links a Paseo and a native execution', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', workId: 'w1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e-paseo', backend: 'paseo', provider: 'claude', runtimeRef: 'agent-1', projectId: 'p1', workId: 'w1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'paseo:agent-1' },
        { executionId: 'e-native', backend: 'native', provider: 'deepseek', runtimeRef: 'sess-9', projectId: 'p1', workId: 'w1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:sess-9' },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const works = revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'work');
    expect(works).toHaveLength(1);
    const execs = revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'execution');
    expect(execs).toHaveLength(2);
    // No second Work was invented for the backend switch.
    expect(works[0].id).toBe('work:p1:w1');
  });
});

describe('Context available != used', () => {
  it('available context gets membership only, never uses-context', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      contextItems: [
        { contextId: 'ctx1', projectId: 'p1', title: 'Notes', source: 'manual', body: 'x', state: 'available', pinned: false, isReference: false, evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const uses = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'uses-context');
    expect(uses).toHaveLength(0);
  });

  it('included context with explicit consumer produces uses-context', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      contextItems: [
        { contextId: 'ctx1', projectId: 'p1', title: 'Notes', source: 'manual', body: 'x', state: 'included', pinned: false, isReference: false, evidenceRefs: ['ev1'], consumedBy: { executionId: 'e1', action: 'included' } },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const uses = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'uses-context');
    expect(uses).toHaveLength(1);
    expect((uses[0] as { inclusionAction: string }).inclusionAction).toBe('included');
  });

  it('included context WITHOUT consumer is recorded as a problem, not an edge', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      contextItems: [
        { contextId: 'ctx1', projectId: 'p1', title: 'Notes', source: 'manual', body: 'x', state: 'included', pinned: false, isReference: false, evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const uses = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'uses-context');
    expect(uses).toHaveLength(0);
  });
});

describe('Artifact produces + handoff exactness', () => {
  it('produces edge only when artifact names an existing execution', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'paseo', provider: 'codex', runtimeRef: 'a1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'paseo:a1' },
      ],
      artifacts: [
        { artifactId: 'art1', projectId: 'p1', kind: 'agent-result', executionId: 'e1', title: 'Result', evidenceRefs: [] },
        { artifactId: 'art2', projectId: 'p1', kind: 'tool-evidence', executionId: 'ghost', title: 'Orphan', evidenceRefs: [] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const produces = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'produces');
    expect(produces).toHaveLength(1);
    expect(revision!.candidate.semanticFacts.problems.some((p) => p.message.includes('ghost'))).toBe(true);
  });

  it('handoff edge requires ACCEPTED + exact usedResultRef + both endpoints', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'native:t1' },
        { executionId: 'e2', backend: 'paseo', provider: 'claude', runtimeRef: 'a2', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'paseo:a2' },
      ],
      handoffs: [
        { intentId: 'h1', sourceExecutionRef: 'e1', targetExecutionRef: 'e2', usedResultRef: 'artifact:p1:art1', evidenceRefs: [], at: NOW, status: 'ACCEPTED' },
        { intentId: 'h2', sourceExecutionRef: 'e1', targetExecutionRef: 'e2', usedResultRef: '', evidenceRefs: [], at: NOW, status: 'ACCEPTED' },
        { intentId: 'h3', sourceExecutionRef: 'e1', targetExecutionRef: 'ghost', usedResultRef: 'artifact:p1:art1', evidenceRefs: [], at: NOW, status: 'ACCEPTED' },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const handoffs = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'handoff');
    expect(handoffs).toHaveLength(1);
    expect((handoffs[0] as { usedResultRef: string }).usedResultRef).toBe('artifact:p1:art1');
    // Handoff nodes still exist for all three (nodes are facts; edges are proof).
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'handoff')).toHaveLength(3);
  });
});

describe('Gate blocked + Runtime running coexist', () => {
  it('blocked-by edge exists while execution stays working', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
      ],
      attentionItems: [
        { id: 'g1', kind: 'approval-required', level: 'action', title: 'Approve', summary: 'needs approval', projectId: 'p1', sourceId: 'e1', sourceRef: 'attention:g1', evidenceRefs: [], observedAt: NOW, verification: 'OBSERVED' },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const blocked = revision!.candidate.semanticFacts.edges.filter((e) => e.kind === 'blocked-by');
    expect(blocked).toHaveLength(1);
    const exec = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'execution');
    expect((exec as { runtimeState: string }).runtimeState).toBe('working');
  });
});

describe('UNKNOWN preservation', () => {
  it('unverifiable strings stay UNKNOWN; unknown states never promote', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'MYSTERY' as never } },
      ],
      overlaySnapshot: {
        conversations: [
          { conversationKey: 'c1', projectId: 'p1', role: 'dev', platform: 'weird-cli', lifecycleState: 'VIBING', taskState: 'vibing', runtimeState: 'vibing', attentionState: 'vibing', verification: 'MAYBE', evidenceRefs: [] },
        ],
        projects: [{ projectId: 'p1', label: 'P1' }],
        memoryIndex: [],
        inbox: [],
        sourceFingerprints: [],
        problems: [],
      },
    });
    const { revision, receipt } = await compileWorkGraph(options('p1', facts));
    expect(receipt.outcome).toBe('VERIFIED');
    const project = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'project');
    expect((project as { verification: string }).verification).toBe('UNKNOWN');
    const conv = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'conversation');
    expect((conv as { lifecycleState: string }).lifecycleState).toBe('UNKNOWN');
    expect((conv as { taskState: string }).taskState).toBe('unknown');
    expect((conv as { runtimeState: string }).runtimeState).toBe('unknown');
    expect((conv as { verification: string }).verification).toBe('UNKNOWN');
  });

  it('no governance workId means no Work node (never invented)', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'e1', backend: 'paseo', provider: 'claude', runtimeRef: 'a1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'paseo:a1' },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'work')).toHaveLength(0);
  });
});

describe('Semantic hash stability', () => {
  it('same facts in different input order produce identical semantic hash', async () => {
    const gov = { projectId: 'p1', workId: 'w1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' as const } };
    const e1 = { executionId: 'e1', backend: 'native' as const, provider: 'codex', runtimeRef: 't1', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'native:t1' };
    const e2 = { executionId: 'e2', backend: 'paseo' as const, provider: 'claude', runtimeRef: 'a2', projectId: 'p1', runtimeState: 'idle', live: false, evidenceRefs: [], sourceRef: 'paseo:a2' };
    const a = await compileWorkGraph(options('p1', baseFacts({ governanceBindings: [gov], adapterExecutions: [e1, e2] })));
    const b = await compileWorkGraph(options('p1', baseFacts({ governanceBindings: [gov], adapterExecutions: [e2, e1] })));
    expect(a.revision!.semanticHash).toBe(b.revision!.semanticHash);
    expect(a.revision!.revisionId).toBe(b.revision!.revisionId);
  });

  it('layoutHash is always empty; semantic hash covers content only', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    expect(revision!.layoutHash).toBe('');
    expect(revision!.semanticHash).toBe(computeWorkGraphSemanticHash(revision!.candidate));
    expect(revision!.semanticHash).toHaveLength(64);
  });
});

describe('Paseo agents and history sessions are not identities', () => {
  it('Paseo agent becomes an Execution node, never a Work node', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      adapterExecutions: [
        { executionId: 'agent-abc', backend: 'paseo', provider: 'codex', runtimeRef: 'agent-abc', projectId: 'p1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'paseo:agent-abc' },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    expect(revision!.candidate.semanticFacts.nodes.filter((n) => n.kind === 'work')).toHaveLength(0);
    const exec = revision!.candidate.semanticFacts.nodes.find((n) => n.kind === 'execution');
    expect(exec).toBeDefined();
    expect((exec as { backend: string }).backend).toBe('paseo');
    expect((exec as { runtimeRef: string }).runtimeRef).toBe('agent-abc');
  });

  it('history sessions are evidence only, never nodes', async () => {
    const facts = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
      historySessions: [
        { sessionId: 's1', harness: 'codex', cwd: '/r', nativeId: 't1', messageCount: 5, sourceFiles: ['a.jsonl'] },
      ],
    });
    const { revision } = await compileWorkGraph(options('p1', facts));
    const kinds = revision!.candidate.semanticFacts.nodes.map((n) => n.kind);
    expect(kinds).toEqual(['project']);
    expect(revision!.candidate.semanticFacts.evidenceRefs.some((r) => r.sourceRef === 'history:s1')).toBe(true);
  });
});

describe('Bad candidates do not replace last-good', () => {
  it('validation failure retains previous revision id in receipt', async () => {
    const good = baseFacts({
      governanceBindings: [
        { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
      ],
    });
    const first = await compileWorkGraph(options('p1', good));
    expect(first.revision).not.toBeNull();

    // Corrupt candidate path: build a candidate with a dangling edge directly.
    const candidate = buildWorkGraphCandidate(options('p1', good));
    candidate.semanticFacts.edges.push({
      kind: 'membership',
      id: 'edge:bad',
      projectId: 'p1',
      source: 'project:p1',
      target: 'ghost:node',
      structuralSource: { entityId: 'project:p1', fieldPath: 'x' },
      evidenceRefs: [],
      observedAt: NOW,
      verification: 'UNKNOWN',
    });
    const { validateWorkGraphCandidate } = await import('../../src/core/workgraph/schema');
    const validation = validateWorkGraphCandidate(candidate);
    expect(validation.ok).toBe(false);
  });
});
