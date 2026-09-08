/** Work Graph schema + selector tests (PHASE 3A). */

import { describe, expect, it } from 'vitest';
import { validateWorkGraphCandidate } from '../../src/core/workgraph/schema';
import { buildWorkGraphCandidate } from '../../src/core/workgraph/compiler';
import { attentionSubset, edgesByProject, filterByProject, focusNode, neighbors } from '../../src/core/workgraph/selectors';
import { toCanvasProjection } from '../../src/core/workgraph/canvasProjection';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';

const NOW = '2026-09-07T00:00:00.000Z';

function facts(): WorkGraphSourceFacts {
  return {
    governanceBindings: [
      { projectId: 'p1', binding: { projectId: 'p1', root: '/r', canonicalPath: '/r', observedAt: NOW, verification: 'VERIFIED' } },
    ],
    historySessions: [],
    memoryEntries: [],
    packets: [],
    handoffs: [],
    adapterExecutions: [
      { executionId: 'e1', backend: 'native', provider: 'codex', runtimeRef: 't1', projectId: 'p1', conversationKey: 'c1', runtimeState: 'working', live: true, evidenceRefs: [], sourceRef: 'native:t1' },
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
    contextItems: [
      { contextId: 'ctx1', projectId: 'p1', title: 'N', source: 'manual', body: 'x', state: 'included', pinned: false, isReference: false, evidenceRefs: [], consumedBy: { executionId: 'e1', action: 'attached' } },
    ],
    attentionItems: [
      { id: 'g1', kind: 'needs-user-input', level: 'action', title: 'Q', summary: 'q', projectId: 'p1', sourceId: 'e1', sourceRef: 'attention:g1', evidenceRefs: [], observedAt: NOW, verification: 'OBSERVED' },
    ],
    artifacts: [
      { artifactId: 'art1', projectId: 'p1', kind: 'agent-result', executionId: 'e1', title: 'R', evidenceRefs: [] },
    ],
  };
}

function opts(): WorkGraphCompileOptions {
  return { projectId: 'p1', sourceDigest: 'd1', facts: facts(), now: NOW };
}

describe('schema validation', () => {
  it('accepts a well-formed candidate', () => {
    const candidate = buildWorkGraphCandidate(opts());
    expect(validateWorkGraphCandidate(candidate).ok).toBe(true);
  });

  it('rejects wrong schema version', () => {
    const candidate = buildWorkGraphCandidate(opts());
    const bad = { ...candidate, schemaVersion: 99 as never };
    const result = validateWorkGraphCandidate(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects handoff edge without usedResultRef', () => {
    const candidate = buildWorkGraphCandidate(opts());
    candidate.semanticFacts.edges.push({
      kind: 'handoff',
      id: 'edge:handoff:bad',
      projectId: 'p1',
      source: 'execution:p1:e1',
      target: 'execution:p1:e1',
      structuralSource: { entityId: 'execution:p1:e1', fieldPath: 'x' },
      evidenceRefs: [],
      observedAt: NOW,
      verification: 'UNKNOWN',
      usedResultRef: '',
    } as never);
    expect(validateWorkGraphCandidate(candidate).ok).toBe(false);
  });

  it('rejects uses-context edge without inclusion action', () => {
    const candidate = buildWorkGraphCandidate(opts());
    candidate.semanticFacts.edges.push({
      kind: 'uses-context',
      id: 'edge:uses:bad',
      projectId: 'p1',
      source: 'execution:p1:e1',
      target: 'context:p1:ctx1',
      structuralSource: { entityId: 'context:p1:ctx1', fieldPath: 'x' },
      evidenceRefs: [],
      observedAt: NOW,
      verification: 'UNKNOWN',
    } as never);
    expect(validateWorkGraphCandidate(candidate).ok).toBe(false);
  });
});

describe('selectors', () => {
  it('filterByProject / edgesByProject guard scope', async () => {
    const { compileWorkGraph } = await import('../../src/core/workgraph/compiler');
    const { revision } = await compileWorkGraph(opts());
    expect(filterByProject(revision!, 'p1').length).toBeGreaterThan(0);
    expect(filterByProject(revision!, 'other')).toHaveLength(0);
    expect(edgesByProject(revision!, 'p1').length).toBeGreaterThan(0);
  });

  it('focusNode returns node + direct edges; unknown id returns null', async () => {
    const { compileWorkGraph } = await import('../../src/core/workgraph/compiler');
    const { revision } = await compileWorkGraph(opts());
    const hit = focusNode(revision!, 'execution:p1:e1');
    expect(hit.node).not.toBeNull();
    expect(hit.inbound.length + hit.outbound.length).toBeGreaterThan(0);
    expect(focusNode(revision!, 'nope').node).toBeNull();
  });

  it('neighbors expands one hop deterministically', async () => {
    const { compileWorkGraph } = await import('../../src/core/workgraph/compiler');
    const { revision } = await compileWorkGraph(opts());
    const ring = neighbors(revision!, 'execution:p1:e1', 1);
    expect(ring.nodes.some((n) => n.id === 'execution:p1:e1')).toBe(true);
    expect(ring.nodes.some((n) => n.id === 'context:p1:ctx1')).toBe(true);
    const ids = ring.nodes.map((n) => n.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('attentionSubset returns gates + touching edges only', async () => {
    const { compileWorkGraph } = await import('../../src/core/workgraph/compiler');
    const { revision } = await compileWorkGraph(opts());
    const subset = attentionSubset(revision!);
    expect(subset.gates).toHaveLength(1);
    expect(subset.edges.some((e) => e.kind === 'blocked-by')).toBe(true);
  });
});

describe('canvas projection', () => {
  it('projects pure data with no layout fields', async () => {
    const { compileWorkGraph } = await import('../../src/core/workgraph/compiler');
    const { revision } = await compileWorkGraph(opts());
    const view = toCanvasProjection(revision!);
    expect(view.revisionId).toBe(revision!.revisionId);
    expect(view.semanticHash).toBe(revision!.semanticHash);
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.edges.length).toBeGreaterThan(0);
    const leaked = JSON.stringify(view);
    expect(leaked).not.toContain('"x":');
    expect(leaked).not.toContain('viewport');
    expect(leaked).not.toContain('zoom');
  });
});
