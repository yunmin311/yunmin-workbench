import { describe, expect, it } from 'vitest';
import type { ProjectionCandidateV0 } from '../../src/core/projection/types';
import {
  emptyProjectionBuildState,
  verifyProjectionCandidate,
} from '../../src/core/projection/revision';

const sourceDigest = 'a'.repeat(64);

function candidate(): ProjectionCandidateV0 {
  return {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest },
    semanticFacts: {
      conversations: [{
        id: 'conversation:conversation-1',
        conversationKey: 'conversation-1',
        projectId: 'project-1',
        role: 'builder',
        platform: 'codex',
        lifecycleState: 'ACTIVE',
        taskState: 'unknown',
        runtimeState: 'unknown',
        attentionState: 'none',
        verification: 'VERIFIED',
        evidenceRefs: ['evidence:conversation-1'],
      }],
      runtimeExecutions: [],
      collaborationRelations: [],
      artifactsOrEvidence: [],
      evidenceRefs: [{
        id: 'evidence:conversation-1',
        source: 'canonical-file',
        sourceRef: 'dialogues/project-1.yaml',
        observedAt: '2026-09-04T00:00:00.000Z',
        verification: 'VERIFIED',
        currentness: 'CURRENT',
        revision: { kind: 'sha256', value: '1'.repeat(64) },
      }],
    },
    layoutState: { schemaVersion: 0, nodePositions: {} },
  };
}

const at = (value: string) => () => value;

describe('verified projection revision state machine', () => {
  it('promotes a valid candidate with separate semantic, layout, and revision hashes', () => {
    const result = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    expect(result.status).toBe('VERIFIED');
    expect(result.current).toMatchObject({
      revisionId: expect.stringMatching(/^projection:[a-f0-9]{64}$/),
      revisionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      semanticHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      layoutHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceDigest,
      verifiedAt: '2026-09-04T02:00:00.000Z',
    });
    expect(result.receipt).toMatchObject({
      outcome: 'VERIFIED',
      sourceDigest,
      recheckedSourceDigest: sourceDigest,
      revisionId: result.current?.revisionId,
      retainedRevisionId: null,
      diagnostics: [],
    });
  });

  it('preserves last-known-good when the next candidate is invalid', () => {
    const first = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    const invalid = { ...candidate(), hiddenRawFallback: true };
    const result = verifyProjectionCandidate(invalid, first.current, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:01:00.000Z'),
    });
    expect(result.status).toBe('NEEDS_FIX');
    expect(result.current).toBe(first.current);
    expect(result.receipt).toMatchObject({
      outcome: 'NEEDS_FIX',
      revisionId: null,
      retainedRevisionId: first.current?.revisionId,
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema/unrecognized_keys' }),
    ]));
  });

  it('rejects a candidate as STALE when facts change during the build', () => {
    const first = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    const result = verifyProjectionCandidate(candidate(), first.current, {
      recheckSourceDigest: () => 'b'.repeat(64),
      now: at('2026-09-04T02:01:00.000Z'),
    });
    expect(result.status).toBe('STALE');
    expect(result.current).toBe(first.current);
    expect(result.receipt).toMatchObject({
      outcome: 'STALE',
      sourceDigest,
      recheckedSourceDigest: 'b'.repeat(64),
      revisionId: null,
      retainedRevisionId: first.current?.revisionId,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'projection/input-changed', severity: 'error' }),
    ]);
  });

  it('shows invalid/stale state with no raw fallback when no last-good exists', () => {
    const invalid = { ...candidate(), hiddenRawFallback: true };
    const needsFix = verifyProjectionCandidate(invalid, null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    const stale = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => 'b'.repeat(64),
      now: at('2026-09-04T02:00:00.000Z'),
    });
    expect(needsFix.current).toBeNull();
    expect(stale.current).toBeNull();
    expect(emptyProjectionBuildState().current).toBeNull();
  });

  it('does not advance the verified revision when revisionHash is unchanged', () => {
    const first = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    const second = verifyProjectionCandidate(candidate(), first.current, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T03:00:00.000Z'),
    });
    expect(second.current).toBe(first.current);
    expect(second.current?.verifiedAt).toBe('2026-09-04T02:00:00.000Z');
    expect(second.receipt?.revisionId).toBe(first.current?.revisionId);
  });

  it('changes layout/revision hashes without changing semanticHash or lineage', () => {
    const first = verifyProjectionCandidate(candidate(), null, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T02:00:00.000Z'),
    });
    const moved = candidate();
    moved.layoutState.nodePositions['conversation:conversation-1'] = { x: 40, y: 80 };
    const second = verifyProjectionCandidate(moved, first.current, {
      recheckSourceDigest: () => sourceDigest,
      now: at('2026-09-04T03:00:00.000Z'),
    });
    expect(second.current?.semanticHash).toBe(first.current?.semanticHash);
    expect(second.current?.layoutHash).not.toBe(first.current?.layoutHash);
    expect(second.current?.revisionHash).not.toBe(first.current?.revisionHash);
    expect(second.current?.previousRevisionId).toBe(first.current?.revisionId);
    expect(second.current?.candidate.semanticFacts).toEqual(first.current?.candidate.semanticFacts);
  });
});
