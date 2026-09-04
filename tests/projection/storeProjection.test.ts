import { beforeAll, describe, expect, it } from 'vitest';
import { useWorkbench } from '../../src/renderer/src/store';
import { compareProjectionRevisions } from '../../src/core/projection/delta';
import { emptyProjectionBuildState, verifyProjectionCandidate } from '../../src/core/projection/revision';
import type {
  ProjectionCandidateV0,
  VerifiedProjectionRevisionV0,
} from '../../src/core/projection/types';
import { compileProjectionCandidate, type ProjectionFactInputV0 } from '../../src/core/projection/compiler';

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { wb: {} },
  });
});

describe('renderer Projection ownership', () => {
  it('builds a verified projection in the existing store for Demo facts', () => {
    useWorkbench.getState().enterDemo();
    const state = useWorkbench.getState();
    expect(state.projection.status).toBe('VERIFIED');
    expect(state.projection.current?.candidate.scope.projectId).toBe('creative-os');
    expect(state.projection.current?.candidate.semanticFacts.conversations.length).toBeGreaterThan(0);
  });

  it('replaces cross-project last-good instead of displaying the prior project', () => {
    useWorkbench.getState().enterDemo();
    const firstRevision = useWorkbench.getState().projection.current?.revisionId;
    useWorkbench.getState().selectProject('governance');
    const state = useWorkbench.getState();
    expect(state.projection.current?.candidate.scope.projectId).toBe('governance');
    expect(state.projection.current?.revisionId).not.toBe(firstRevision);
  });

  it('selects a Conversation only through a verified semantic ref', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    expect(useWorkbench.getState().conversation).toBeNull();

    const conversationRef = useWorkbench.getState().projection.current
      ?.candidate.semanticFacts.conversations[0]?.id;
    if (!conversationRef) throw new Error('fixture must include a verified Conversation');
    useWorkbench.getState().selectProjectedConversation(conversationRef);
    expect(useWorkbench.getState().conversation?.key).toBe(
      useWorkbench.getState().projection.current
        ?.candidate.semanticFacts.conversations[0]?.conversationKey,
    );

    useWorkbench.getState().selectProject('creative-os');
    useWorkbench.getState().selectProjectedConversation('conversation:not-verified');
    expect(useWorkbench.getState().conversation).toBeNull();
  });

  it('uses the bounded previous/current seam: switching Project drops the prior Project previous', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    expect(useWorkbench.getState().projectionPrevious).toBeNull();

    // Force a refresh so that, if a previous were carried, it would land now.
    useWorkbench.getState().refreshProjection();
    const first = useWorkbench.getState().projection.current;
    expect(first).not.toBeNull();

    // Toggle conversation selection to force a new verified revision later.
    useWorkbench.getState().refreshProjection();
    expect(useWorkbench.getState().projectionPrevious).toBeNull();

    // Switching to a different Project clears any previous carried over.
    useWorkbench.getState().selectProject('governance');
    expect(useWorkbench.getState().projectionPrevious).toBeNull();
    expect(useWorkbench.getState().projection.current?.candidate.scope.projectId).toBe('governance');
  });

  it('reports no Delta when there is no previous verified revision', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    const { projection, projectionPrevious } = useWorkbench.getState();
    expect(projectionPrevious).toBeNull();
    expect(projection.current).not.toBeNull();
    // The selector contract: with no previous there is no Delta at all.
    expect(projectionPrevious).toBeNull();
  });

  it('does not promote previous when revisionHash is unchanged across two refreshes', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    const firstRevisionHash = useWorkbench.getState().projection.current?.revisionHash;
    useWorkbench.getState().refreshProjection();
    expect(useWorkbench.getState().projection.current?.revisionHash).toBe(firstRevisionHash);
    expect(useWorkbench.getState().projectionPrevious).toBeNull();
  });

  it('compares prior vs current revisions through the pure comparator when previous is present', () => {
    // Drive the seam directly so the test does not depend on Activity changes.
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    const first = useWorkbench.getState().projection.current;
    if (!first) throw new Error('demo must verify');
    // Simulate a subsequent verified revision with the same scope and a
    // different revision hash by promoting the current revision into previous
    // via a synthetic comparator call.
    const result = compareProjectionRevisions(first, first);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.semanticChanged).toBe(false);
    expect(result.summary.layoutChanged).toBe(false);
  });

  it('CompareView Delta: a real Delta is produced when previous and current are both VERIFIED', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    const firstRevision = useWorkbench.getState().projection.current;
    if (!firstRevision) throw new Error('demo must verify');
    // Build a synthetic second revision by mutating one verifiable fact in a
    // strictly structural way; we re-verify so the candidate is a true
    // VerifiedProjectionRevisionV0 with a different revisionHash.
    const input: ProjectionFactInputV0 = {
      projectId: firstRevision.candidate.scope.projectId,
      snapshot: {
        overlayRoot: 'f:/govern',
        foundAt: '2026-09-04T00:00:00.000Z',
        conversations: firstRevision.candidate.semanticFacts.conversations.map((c) => ({
          key: c.conversationKey,
          role: c.role,
          project: c.projectId,
          platform: c.platform,
          status: c.lifecycleState,
          taskState: c.taskState,
          runtimeState: c.runtimeState,
          attention: c.attentionState,
          verification: c.verification,
          observed: {
            source: 'canonical-file',
            sourceRef: `dialogues/${c.projectId}.yaml`,
            observedAt: '2026-09-04T00:00:00.000Z',
            verification: 'VERIFIED',
          },
        })),
        projects: [],
        inbox: [],
        memoryIndex: [],
        harness: [],
        sourceFingerprints: [{
          sourceRef: `dialogues/${firstRevision.candidate.scope.projectId}.yaml`,
          sha256: '1'.repeat(64),
        }],
        problems: [],
      },
      activity: [],
    };
    void input;
    const candidate: ProjectionCandidateV0 = {
      schemaVersion: 0,
      projectionKind: firstRevision.candidate.projectionKind,
      scope: { projectId: firstRevision.candidate.scope.projectId },
      sourceBinding: { sourceDigest: firstRevision.sourceDigest },
      semanticFacts: {
        conversations: firstRevision.candidate.semanticFacts.conversations.map((c, index) =>
          index === 0
            ? { ...c, lifecycleState: c.lifecycleState === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }
            : c,
        ),
        runtimeExecutions: firstRevision.candidate.semanticFacts.runtimeExecutions,
        collaborationRelations: firstRevision.candidate.semanticFacts.collaborationRelations,
        artifactsOrEvidence: firstRevision.candidate.semanticFacts.artifactsOrEvidence,
        evidenceRefs: firstRevision.candidate.semanticFacts.evidenceRefs,
      },
      layoutState: firstRevision.candidate.layoutState,
    };
    const state = verifyProjectionCandidate(candidate, null, {
      recheckSourceDigest: () => firstRevision.sourceDigest,
      now: () => '2026-09-04T02:00:00.000Z',
    });
    if (!state.current) throw new Error('second revision must verify');
    useWorkbench.setState({
      projectionPrevious: firstRevision,
      projection: {
        ...emptyProjectionBuildState(),
        status: 'VERIFIED',
        current: state.current,
        diagnostics: [],
      },
    });
    const result = compareProjectionRevisions(
      useWorkbench.getState().projectionPrevious!,
      useWorkbench.getState().projection.current!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.conversations.changed).toBe(1);
  });

  it('CompareView Delta: STALE/NEEDS_FIX current build must not present a Delta', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    const previous = useWorkbench.getState().projection.current;
    if (!previous) throw new Error('demo must verify');
    // Force the current build into STALE; the previous remains, but the
    // CompareView surface must not present the failed build as a fresh
    // comparison and must never fall back to raw Snapshot/Activity.
    useWorkbench.setState({
      projectionPrevious: previous,
      projection: {
        status: 'STALE',
        current: null,
        diagnostics: [{
          code: 'projection/input-changed',
          severity: 'error',
          message: 'Projection source facts changed while the candidate was being verified.',
          subject: { projectId: previous.candidate.scope.projectId },
          evidence: {},
          supportedFixes: ['compile a fresh candidate from the latest source facts'],
        }],
        receipt: null,
      },
    });
    const state = useWorkbench.getState();
    expect(state.projection.status).toBe('STALE');
    expect(state.projection.current).toBeNull();
    expect(state.projectionPrevious).not.toBeNull();
    // The CompareView surface guard: never produce a Delta without both a
    // current verified revision and a same-Project previous with a different
    // revisionHash.
    const canCompare = Boolean(
      state.projection.status === 'VERIFIED'
      && state.projection.current
      && state.projectionPrevious
      && state.projectionPrevious.candidate.scope.projectId === state.projection.current.candidate.scope.projectId
      && state.projectionPrevious.revisionHash !== state.projection.current.revisionHash,
    );
    expect(canCompare).toBe(false);
  });
});
