import { describe, expect, it } from 'vitest';
import {
  computeReachHighlight,
  reachCanvasEdgeClass,
  reachCanvasNodeClass,
} from '../../src/renderer/src/reachHighlight';
import {
  followUpDraftFromSelection,
  selectionToFollowUpCue,
} from '../../src/renderer/src/sessionFollowUp';
import type { ProjectionReachV0 } from '../../src/core/projection/types';

function fakeReach(): ProjectionReachV0 {
  return {
    ok: true,
    schemaVersion: 0,
    projectId: 'p',
    revisionId: 'r',
    origin: { kind: 'conversation', id: 'conversation:a' },
    direction: 'downstream',
    nodes: [
      { kind: 'conversation', id: 'conversation:a', minimumDepth: 0 },
      { kind: 'runtimeExecution', id: 'execution:b', minimumDepth: 1 },
    ],
    edges: [{
      edgeKind: 'conversation-execution',
      source: 'conversation:a',
      target: 'execution:b',
      stableEdgeKey: '15:conversation:a10:execution:b20:conversation-execution10:execution:b',
    }],
    minimumDepthByNode: { 'conversation:a': 0, 'execution:b': 1 },
    maximumHops: 1,
    limitations: [],
  };
}

describe('Archify-style canvas reach highlight (viewer-only)', () => {
  it('maps the reach result to origin / reachable / edge pairs', () => {
    const highlight = computeReachHighlight(fakeReach());
    expect(highlight.originId).toBe('conversation:a');
    expect(highlight.reachableIds.has('execution:b')).toBe(true);
    expect(highlight.direction).toBe('downstream');
    expect(highlight.edgePairs.size).toBe(1);
  });

  it('origin strong, reachable hit, unrelated topology dims; null highlight clears all', () => {
    const highlight = computeReachHighlight(fakeReach());
    expect(reachCanvasNodeClass('conversation:a', highlight)).toBe(' reach-origin');
    expect(reachCanvasNodeClass('execution:b', highlight)).toBe(' reach-hit');
    expect(reachCanvasNodeClass('conversation:other', highlight)).toBe(' reach-dim');
    expect(reachCanvasEdgeClass('conversation:a', 'execution:b', highlight)).toBe(' reach-edge-hit');
    expect(reachCanvasEdgeClass('execution:b', 'artifact:x', highlight)).toBe(' reach-edge-dim');
    expect(reachCanvasNodeClass('conversation:a', null)).toBe('');
    expect(reachCanvasEdgeClass('conversation:a', 'execution:b', null)).toBe('');
  });
});

describe('dsh-synapse style selected-text follow-up', () => {
  it('ignores trivial selections', () => {
    expect(selectionToFollowUpCue(null)).toBeNull();
    expect(selectionToFollowUpCue('  ')).toBeNull();
    expect(selectionToFollowUpCue('ab')).toBeNull();
  });

  it('collapses whitespace and caps the quote length', () => {
    const cue = selectionToFollowUpCue('  a\n\n  b '.repeat(50));
    expect(cue).toBe('a b '.repeat(50).trim().replace(/\s+/g, ' ').slice(0, 400));
    expect(cue!.length).toBeLessThanOrEqual(400);
  });

  it('prepends the quote and preserves an existing draft', () => {
    expect(followUpDraftFromSelection('', 'selected answer text')).toBe('> selected answer text\n\n');
    expect(followUpDraftFromSelection('Now review it.', 'selected answer text'))
      .toBe('> selected answer text\n\nNow review it.');
    // Trivial selection never rewrites the draft.
    expect(followUpDraftFromSelection('draft', '  ')).toBe('draft');
  });
});
