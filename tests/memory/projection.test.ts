import { describe, expect, it } from 'vitest';
import type { HistoryMessage, HistorySessionDetail } from '../../src/core/history/types';
import { assessMemoryEvidence, projectMemory } from '../../src/core/memory/projection';
import { createMemoryProjectionContext } from '../../src/core/project/staging';

const sourceRef = 'history:codex:sessions/example.jsonl';

function detail(messages: Array<Pick<HistoryMessage, 'id' | 'text'> & Partial<HistoryMessage>>): HistorySessionDetail {
  return {
    session: {
      sessionId: 'codex::session-1', harness: 'codex', nativeId: 'session-1', messageCount: messages.length,
      sourceFiles: ['codex::sessions/example.jsonl'], compacted: false, preview: '',
      observed: { source: 'canonical-file', sourceRef, observedAt: '2026-08-31T08:00:00.000Z', verification: 'OBSERVED' },
    },
    messages: messages.map((message, seq) => ({
      sessionId: 'codex::session-1', seq, role: 'assistant', truncated: false,
      observed: { source: 'canonical-file', sourceRef, observedAt: '2026-08-31T08:00:00.000Z', verification: 'OBSERVED' },
      ...message,
    })),
    problems: [],
  };
}

describe('Memory projection', () => {
  it('extracts only explicit candidates with source provenance and separates mentioned from happened time', () => {
    const projection = projectMemory([detail([
      { id: 'm1', at: '2026-08-31T08:01:00.000Z', text: '[memory event] Release approved | happened=2026-08-30T12:00:00.000Z | participants=Yunmin | tags=release' },
      { id: 'm2', text: 'ordinary conversation is not automatically a memory fact' },
      { id: 'm3', text: '[memory fact] Production deploy requires an explicit gate' },
    ])]);

    expect(projection.events).toHaveLength(2);
    expect(projection.events[0]).toMatchObject({
      summary: 'Release approved', mentionedAt: '2026-08-31T08:01:00.000Z',
      happenedStart: '2026-08-30T12:00:00.000Z', happenedEnd: '2026-08-30T12:00:00.000Z',
      participants: ['Yunmin'], tags: ['release'], status: 'CURRENT', verification: 'OBSERVED',
      sourceRefs: [sourceRef], sourceMessageIds: ['m1'],
    });
    expect(projection.events[1]).toMatchObject({ mentionedAt: undefined, happenedStart: undefined, happenedEnd: undefined });
    expect(projection.facts[0]).toMatchObject({ statement: 'Production deploy requires an explicit gate', currentness: 'CURRENT' });
  });

  it('deduplicates repeated facts without merging explicit conflicts or corrections away', () => {
    const projection = projectMemory([detail([
      { id: 'm1', text: '[memory fact] Release channel is stable' },
      { id: 'm2', text: '[memory fact] Release channel is stable' },
      { id: 'm3', text: '[memory correction supersedes="Release channel is stable"] Release channel is canary' },
      { id: 'm4', text: '[memory conflict conflicts="Release channel is canary"] Release channel is disabled' },
    ])]);

    expect(projection.facts).toHaveLength(3);
    const stable = projection.facts.find((fact) => fact.statement.endsWith('stable'))!;
    const canary = projection.facts.find((fact) => fact.statement.endsWith('canary'))!;
    const disabled = projection.facts.find((fact) => fact.statement.endsWith('disabled'))!;
    expect(stable.sourceEventIds).toHaveLength(2);
    expect(stable.status).toBe('SUPERSEDED');
    expect(canary.supersedes).toContain(stable.id);
    expect(canary.conflicts).toContain(disabled.id);
    expect(disabled.conflicts).toContain(canary.id);
    expect(assessMemoryEvidence(stable, stable.sourceRefs)).toMatchObject({ verdict: 'WRONG', nextStrategy: 'SEARCH_AGAIN' });
    expect(assessMemoryEvidence(canary, canary.sourceRefs)).toMatchObject({ verdict: 'PARTIAL', nextStrategy: 'EXPAND_SOURCE' });
  });

  it('never treats a truncated History excerpt as sufficient evidence', () => {
    const projection = projectMemory([detail([{ id: 'cut', truncated: true, text: '[memory fact] A cut-off assertion' }])]);
    expect(projection.events[0].status).toBe('INVALID');
    expect(projection.facts[0].currentness).toBe('INVALID');
    expect(assessMemoryEvidence(projection.facts[0], projection.facts[0].sourceRefs)).toMatchObject({ verdict: 'PARTIAL', nextStrategy: 'REFRESH_SOURCE' });
  });

  it('fails closed when evidence exceeds the fixed 50-reference gate', () => {
    const projection = projectMemory([detail([{ id: 'm1', text: '[memory fact] Bounded evidence' }])]);
    const refs = Array.from({ length: 51 }, (_, index) => `history:codex:${index}.jsonl`);
    const result = assessMemoryEvidence({ ...projection.facts[0], sourceRefs: refs }, refs);
    expect(result).toMatchObject({ verdict: 'PARTIAL', nextStrategy: 'SEARCH_AGAIN' });
    expect(result.evidenceRefs).toHaveLength(50);
    expect(result.missing).toEqual(['evidence set exceeds the 50-reference gate']);
  });

  it('marks disappeared evidence INVALID and replaced evidence STALE while retaining old records', () => {
    const first = projectMemory([detail([{ id: 'same-message', text: '[memory fact] Old statement' }])]);
    const replaced = projectMemory([detail([{ id: 'same-message', text: '[memory fact] New statement' }])], first);
    expect(replaced.facts.find((fact) => fact.statement === 'Old statement')?.currentness).toBe('STALE');
    expect(replaced.facts.find((fact) => fact.statement === 'New statement')?.currentness).toBe('CURRENT');

    const missing = projectMemory([], replaced);
    expect(missing.events.every((event) => event.status === 'INVALID')).toBe(true);
    expect(missing.facts.every((fact) => fact.currentness === 'INVALID')).toBe(true);
  });

  it('returns bounded evidence verdicts without upgrading missing, stale, or unrelated evidence', () => {
    const projection = projectMemory([detail([{ id: 'm1', text: '[memory fact] Gate must pass' }])]);
    const fact = projection.facts[0];
    expect(assessMemoryEvidence(fact, fact.sourceRefs)).toEqual({
      verdict: 'SUFFICIENT', evidenceRefs: [sourceRef], missing: [], nextStrategy: 'NONE',
    });
    expect(assessMemoryEvidence(fact, [])).toMatchObject({ verdict: 'PARTIAL', missing: [sourceRef], nextStrategy: 'EXPAND_SOURCE' });
    expect(assessMemoryEvidence(fact, ['history:codex:unrelated.jsonl'])).toMatchObject({ verdict: 'WRONG', nextStrategy: 'SEARCH_AGAIN' });
    expect(assessMemoryEvidence({ ...fact, currentness: 'STALE' }, fact.sourceRefs)).toMatchObject({ verdict: 'PARTIAL', nextStrategy: 'REFRESH_SOURCE' });
  });

  it('adds only a current source-backed result through the existing Context Staging shape', () => {
    const projection = projectMemory([detail([{ id: 'm1', text: '[memory fact] Gate must pass' }])]);
    const fact = projection.facts[0];
    const item = createMemoryProjectionContext({
      id: fact.id, recordType: 'fact', summary: fact.statement, sourceRefs: fact.sourceRefs,
      sourceSessionIds: ['codex::session-1'], currentness: fact.currentness,
      verification: fact.verification, score: 1, useCount: 0,
    }, true);
    expect(item).toMatchObject({ state: 'included', pinned: true, isReference: true, provenance: 'EXTERNAL', sourceRef, sourceRefs: [sourceRef] });
    expect(() => createMemoryProjectionContext({
      id: 'bad', recordType: 'fact', summary: 'No source', sourceRefs: [], sourceSessionIds: [],
      currentness: 'UNKNOWN', verification: 'UNKNOWN', score: 0, useCount: 0,
    })).toThrow('source provenance');
  });
});
