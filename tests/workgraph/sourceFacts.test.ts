import { describe, expect, it } from 'vitest';
import { buildCanonicalWorkGraphFacts } from '../../src/core/workgraph/sourceFacts';
import type { ActivityEvent, OverlaySnapshot } from '../../src/core/types';

const NOW = '2026-09-09T00:00:00.000Z';

function snapshot(): OverlaySnapshot {
  return {
    overlayRoot: '/governance', foundAt: NOW,
    conversations: [{
      key: 'p1::codex::main', role: 'main', project: 'p1', platform: 'codex',
      status: 'ACTIVE', taskState: 'unknown', runtimeState: 'unknown', attention: 'none',
      verification: 'VERIFIED', observed: { source: 'canonical-file', sourceRef: 'overlay:dialogues.yaml', observedAt: NOW, verification: 'VERIFIED' },
    }],
    projects: [{
      projectId: 'p1', displayName: 'P1', status: 'ACTIVE',
      canonicalSource: { path: 'CLAUDE.md', remote: 'https://example.test/p1.git', commit: 'abc', verification: 'VERIFIED' },
      roles: [], gates: { commit_owner: 'main' }, trust: 'VERIFIED',
      observed: { source: 'canonical-file', sourceRef: 'overlay:projects/p1.yaml', observedAt: NOW, verification: 'VERIFIED' },
    }],
    inbox: [], memoryIndex: [{ id: 'm1', title: 'Memory one', hook: 'hook', category: 'rule', sourceRef: 'overlay:memory/MEMORY.md' }],
    harness: [], sourceFingerprints: [], problems: [],
  };
}

function event(partial: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'evt-1', projectId: 'p1', conversationKey: 'p1::codex::main', kind: 'session-started', summary: 'started',
    harness: 'codex', runtimeRef: 'thread-1', intentId: 'intent-1', runtimeState: 'working',
    observed: { source: 'protocol', sourceRef: 'codex-app-server:thread-1', observedAt: NOW, verification: 'OBSERVED' },
    ...partial,
  };
}

describe('canonical WorkGraph source facts', () => {
  it('keeps explicit ContextSource entities but omits metadata aggregates and derived observations', () => {
    const facts = buildCanonicalWorkGraphFacts({ projectId: 'p1', snapshot: snapshot(), activity: [] });
    expect(facts.governanceBindings).toEqual([]);
    expect(facts.tasks).toEqual([]);
    expect(facts.memoryEntries).toEqual([]);
    expect(facts.contextItems.map((item) => item.contextId).sort()).toEqual(['canon:p1', 'gate:p1:commit_owner']);
    expect(facts.contextItems.every((item) => item.sourceRef)).toBe(true);
    expect(facts.artifacts).toEqual([]);
    expect(facts.evidenceItems).toEqual([]);
  });

  it('maps native identity, result, evidence and accepted handoff without inference', () => {
    const sourceResult = event({ id: 'result-1', kind: 'agent-response', content: 'real result' });
    const usedResultRef = 'harness-result:codex::execution:intent-1:result-1';
    const targetStarted = event({ id: 'start-2', runtimeRef: 'thread-2', intentId: 'intent-2', parentSourceRef: usedResultRef });
    const accepted = event({ id: 'accept-2', kind: 'handoff-accepted', runtimeRef: 'thread-2', intentId: 'intent-2', parentSourceRef: usedResultRef, runtimeState: 'idle' });
    const tool = event({ id: 'tool-2', kind: 'tool-completed', runtimeRef: 'thread-2', intentId: 'intent-2', evidenceRef: 'artifact:file.txt', summary: 'wrote file' });
    const facts = buildCanonicalWorkGraphFacts({ projectId: 'p1', snapshot: snapshot(), activity: [sourceResult, targetStarted, accepted, tool] });

    expect(facts.adapterExecutions.map((item) => item.executionId).sort()).toEqual([
      'codex::execution:intent-1', 'codex::execution:intent-2',
    ]);
    expect(facts.artifacts.some((item) => item.artifactId === usedResultRef && item.executionId === 'codex::execution:intent-1')).toBe(true);
    expect(facts.artifacts.map((item) => item.kind)).toEqual(['agent-result']);
    expect(facts.evidenceItems).toEqual([expect.objectContaining({
      evidenceId: 'artifact:file.txt', sourceRef: 'artifact:file.txt',
      evidenceType: 'tool-evidence', executionId: 'codex::execution:intent-2',
    })]);
    expect(facts.handoffs).toEqual([expect.objectContaining({
      intentId: 'intent-2', sourceExecutionRef: 'codex::execution:intent-1',
      targetExecutionRef: 'codex::execution:intent-2', usedResultRef, status: 'ACCEPTED',
    })]);
  });

  it('does not promote draft-like task text or a non-accepted trajectory', () => {
    const sourceResult = event({ id: 'result-1', kind: 'agent-response', content: 'real result' });
    const usedResultRef = 'harness-result:codex::execution:intent-1:result-1';
    const targetStarted = event({ id: 'start-2', runtimeRef: 'thread-2', intentId: 'intent-2', parentSourceRef: usedResultRef });
    const facts = buildCanonicalWorkGraphFacts({ projectId: 'p1', snapshot: snapshot(), activity: [sourceResult, targetStarted] });
    expect(facts.tasks).toEqual([]);
    expect(facts.handoffs).toEqual([]);
  });
});
