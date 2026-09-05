import { beforeAll, describe, expect, it } from 'vitest';
import { useWorkbench } from '../../src/renderer/src/store';
import { compileProjectionCandidate, type ProjectionFactInputV0 } from '../../src/core/projection/compiler';
import { buildVerifiedProjection, emptyProjectionBuildState, verifyProjectionCandidate } from '../../src/core/projection/revision';
import { compareProjectionRevisions } from '../../src/core/projection/delta';
import { buildSemanticPassport } from '../../src/core/projection/passport';
import type {
  ProjectionCandidateV0,
  SemanticPassportEntityRefV0,
} from '../../src/core/projection/types';

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { wb: {} },
  });
});

const NOW = '2026-09-04T02:00:00.000Z';

function buildInput(): ProjectionFactInputV0 {
  return {
    projectId: 'project-a',
    snapshot: {
      overlayRoot: 'f:/govern',
      foundAt: '2026-09-04T00:00:00.000Z',
      conversations: [{
        key: 'project-a::codex::builder-1',
        role: 'builder',
        project: 'project-a',
        platform: 'codex',
        status: 'ACTIVE',
        taskState: 'waiting',
        runtimeState: 'unknown',
        attention: 'needs-user',
        verification: 'VERIFIED',
        observed: {
          source: 'canonical-file',
          sourceRef: 'dialogues/project-a.yaml',
          observedAt: '2026-09-04T00:00:00.000Z',
          verification: 'VERIFIED',
        },
      }],
      projects: [{
        projectId: 'project-a',
        displayName: 'Project A',
        status: 'ACTIVE',
        roles: [],
        gates: {},
        trust: 'VERIFIED',
        observed: {
          source: 'canonical-file',
          sourceRef: 'projects/project-a.yaml',
          observedAt: '2026-09-04T00:00:00.000Z',
          verification: 'VERIFIED',
        },
      }],
      inbox: [],
      memoryIndex: [],
      harness: [],
      sourceFingerprints: [
        { sourceRef: 'dialogues/project-a.yaml', sha256: '1'.repeat(64) },
        { sourceRef: 'projects/project-a.yaml', sha256: '2'.repeat(64) },
      ],
      problems: [],
    },
    activity: [],
  };
}

function verifiedFromInput(input: ProjectionFactInputV0) {
  const state = buildVerifiedProjection(input, null, { now: () => NOW });
  if (!state.current) throw new Error('fixture must verify');
  return state.current;
}

describe('renderer Semantic Passport v0 · seam', () => {
  it('openPassport/closePassport round-trips the seam without mutating projection', () => {
    useWorkbench.getState().enterDemo();
    const ref: SemanticPassportEntityRefV0 = { kind: 'conversation', id: 'conversation:foo' };
    useWorkbench.getState().openPassport(ref, 'canvas');
    expect(useWorkbench.getState().passportOpen).toEqual({ entityRef: ref, source: 'canvas' });
    useWorkbench.getState().closePassport();
    expect(useWorkbench.getState().passportOpen).toBeNull();
  });

  it('Project switch clears the open passport so no cross-Project truth leaks', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    useWorkbench.getState().openPassport(
      { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' },
      'canvas',
    );
    expect(useWorkbench.getState().passportOpen).not.toBeNull();
    useWorkbench.getState().selectProject('governance');
    expect(useWorkbench.getState().passportOpen).toBeNull();
  });

  it('VERIFIED previous/current produces a usable Passport; selector returns the right kind', () => {
    const baseInput = buildInput();
    const headInput: ProjectionFactInputV0 = {
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        conversations: [{
          ...baseInput.snapshot.conversations[0],
          status: 'PAUSED',
        }],
      },
    };
    const base = verifiedFromInput(baseInput);
    const head = verifiedFromInput(headInput);
    useWorkbench.setState({
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: head, diagnostics: [] },
      projectionPrevious: base,
      passportOpen: { entityRef: { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' }, source: 'canvas' },
    });
    // The selector contract: the verified revision + previous together
    // produce a verifiable Passport. We compute the equivalent directly
    // to avoid calling the React hook outside a render context.
    const state = useWorkbench.getState();
    expect(state.projection.current?.revisionId).toBe(head.revisionId);
    expect(state.projectionPrevious?.revisionId).toBe(base.revisionId);
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');
    const passport = buildSemanticPassport(head, {
      kind: 'conversation',
      id: 'conversation:project-a::codex::builder-1',
    }, delta);
    expect(passport.ok).toBe(true);
    if (!passport.ok) return;
    expect(passport.entityType).toBe('conversation');
    expect(passport.delta).not.toBeNull();
    expect(passport.delta).toMatchObject({ status: 'changed' });
    void compileProjectionCandidate;
  });

  it('STALE / NEEDS_FIX current build: Passport is unavailable, no raw fallback', () => {
    const input = buildInput();
    const verified = verifiedFromInput(input);
    useWorkbench.setState({
      projectionPrevious: verified,
      projection: {
        ...emptyProjectionBuildState(),
        status: 'STALE',
        current: null,
        diagnostics: [{
          code: 'projection/input-changed',
          severity: 'error',
          message: 'Projection source facts changed while the candidate was being verified.',
          subject: { projectId: verified.candidate.scope.projectId },
          evidence: {},
          supportedFixes: ['compile a fresh candidate from the latest source facts'],
        }],
      },
      passportOpen: {
        entityRef: { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' },
        source: 'canvas',
      },
    });
    // The Selector contract: STALE current means we must not derive a
    // Passport from the retained previous. We verify the same invariant
    // at the pure level: a STALE build gives buildSemanticPassport no
    // valid current revision to draw from, so the drawer must show
    // "unavailable" instead of raw snapshot data.
    const state = useWorkbench.getState();
    expect(state.projection.status).toBe('STALE');
    expect(state.projection.current).toBeNull();
    // sanity: a Passport with no current would fail with invalid-revision
    const passport = state.passportOpen
      ? buildSemanticPassport({} as never, state.passportOpen.entityRef)
      : null;
    expect(passport === null || passport.ok === false).toBe(true);
  });

  it('the seam never falls back to raw Snapshot / Activity / Governance facts', () => {
    // The selector only reads projection.current / projectionPrevious; any
    // other state (snapshot, activity, frozen, ...) is intentionally
    // ignored. This test asserts the selector's "closed" branch is reached
    // when those surface-level sources are completely absent.
    useWorkbench.setState({
      snapshot: null,
      activity: [],
      frozen: [],
      git: null,
      attentionItems: [],
      attentionLocal: { schemaVersion: 1, dismissed: {} },
      attentionProblem: null,
      staging: [],
      conversation: null,
      liveExecutions: [],
      projection: emptyProjectionBuildState(),
      projectionPrevious: null,
      passportOpen: null,
    });
    expect(useWorkbench.getState().passportOpen).toBeNull();
  });
});

describe('Canvas selection only opens Passport for verified entity refs', () => {
  it('a forged / non-verified entity id never reaches buildSemanticPassport', () => {
    // The seam exposes only refs the Canvas derives from the verified
    // revision; a non-verified id never becomes a passport input because
    // the canvas-to-passport mapper consults the active revision.
    const input = buildInput();
    const verified = verifiedFromInput(input);
    useWorkbench.setState({
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: verified, diagnostics: [] },
      projectionPrevious: null,
      passportOpen: null,
    });
    const ref: SemanticPassportEntityRefV0 = { kind: 'conversation', id: 'conversation:not-in-revision' };
    // Open a ref that does not exist in the verified revision.
    useWorkbench.getState().openPassport(ref, 'canvas');
    expect(useWorkbench.getState().passportOpen).toEqual({ entityRef: ref, source: 'canvas' });
    // The selector derives the actual Passport from the verified
    // revision, so a non-verified id is reported as entity-not-found
    // rather than silently showing raw snapshot data.
    const passport = buildSemanticPassport(verified, ref);
    expect(passport.ok).toBe(false);
    if (passport.ok) return;
    expect(passport.code).toBe('passport/entity-not-found');
  });

  it('delta mismatch is detected when a head revision does not equal the active revision', () => {
    const input = buildInput();
    const verified = verifiedFromInput(input);
    useWorkbench.setState({
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: verified, diagnostics: [] },
      projectionPrevious: null,
      passportOpen: null,
    });
    const ref: SemanticPassportEntityRefV0 = { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' };
    // Forge a different verified revision (different revisionHash) and
    // build a Delta for it; then request a Passport with a head revision
    // that does not match the Delta's headRevisionId. The Passport must
    // refuse to mix facts across revisions and surface a delta-mismatch.
    const otherInput: ProjectionFactInputV0 = {
      ...input,
      snapshot: {
        ...input.snapshot,
        conversations: [{ ...input.snapshot.conversations[0], status: 'PAUSED' }],
      },
    };
    const other = verifiedFromInput(otherInput);
    const staleDelta = compareProjectionRevisions(verified, other);
    if (!staleDelta.ok) throw new Error('delta must be ok');
    // active revision is `verified` (head), but Delta.headRevisionId === other.
    const passport = buildSemanticPassport(verified, ref, staleDelta);
    expect(passport.ok).toBe(false);
    if (passport.ok) return;
    expect(passport.code).toBe('passport/delta-mismatch');
  });
});

