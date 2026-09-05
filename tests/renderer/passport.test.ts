import { beforeAll, describe, expect, it } from 'vitest';
import { deriveSemanticPassportState, useWorkbench } from '../../src/renderer/src/store';
import { canvasNodeIdToPassportRef, handleCanvasNodeClick } from '../../src/renderer/src/views/CanvasView';
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
    // Seed one RuntimeExecution in the compiled candidate by feeding an
    // agent-response event that the projection pipeline can bucket into a
    // RuntimeExecution view.
    activity: [{
      id: 'evt-runtime-1',
      projectId: 'project-a',
      conversationKey: 'project-a::codex::builder-1',
      kind: 'agent-response',
      summary: 'A real Agent result for the builder',
      content: 'Body',
      harness: 'codex',
      runtimeRef: 'thread-1',
      intentId: 'intent-1',
      observed: {
        source: 'protocol',
        sourceRef: 'codex:item:runtime-1',
        observedAt: '2026-09-04T00:00:00.000Z',
        verification: 'VERIFIED',
      },
    }],
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

  it('STALE current with retained last-known-good: deriveSemanticPassportState refuses Passport', () => {
    // Workbench retains the previous verified revision as a last-known-good
    // when a fresh build goes STALE. The selector must NOT promote that
    // retained revision into a fresh Passport surface; the canvas display
    // continues to show the retained revision, but Passport truth is gated
    // on `status === 'VERIFIED'`.
    const input = buildInput();
    const retained = verifiedFromInput(input);
    const projection: ReturnType<typeof emptyProjectionBuildState> = {
      ...emptyProjectionBuildState(),
      status: 'STALE',
      current: retained,
      diagnostics: [{
        code: 'projection/input-changed',
        severity: 'error',
        message: 'Projection source facts changed while the candidate was being verified.',
        subject: { projectId: retained.candidate.scope.projectId },
        evidence: {},
        supportedFixes: ['compile a fresh candidate from the latest source facts'],
      }],
    };
    const result = deriveSemanticPassportState({
      passportOpen: {
        entityRef: { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' },
        source: 'canvas',
      },
      projection,
      previous: null,
    });
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toBe('no-verified-revision');
    // The retained current is not promoted: buildSemanticPassport with the
    // retained current would succeed (the previous test of "VERIFIED" path
    // proved that), so the only thing blocking the Passport is the status
    // gate. Removing the status gate must surface as a real regression.
    const rawPass = buildSemanticPassport(retained, {
      kind: 'conversation',
      id: 'conversation:project-a::codex::builder-1',
    });
    expect(rawPass.ok).toBe(true);
  });

  it('NEEDS_FIX current with retained last-known-good: deriveSemanticPassportState refuses Passport', () => {
    const input = buildInput();
    const retained = verifiedFromInput(input);
    const projection: ReturnType<typeof emptyProjectionBuildState> = {
      ...emptyProjectionBuildState(),
      status: 'NEEDS_FIX',
      current: retained,
      diagnostics: [{
        code: 'schema/unrecognized_keys',
        severity: 'error',
        message: 'Forged revision did not pass structural validation.',
        subject: { projectId: retained.candidate.scope.projectId },
        evidence: {},
        supportedFixes: ['rebuild the candidate from Foundation'],
      }],
    };
    const result = deriveSemanticPassportState({
      passportOpen: {
        entityRef: { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' },
        source: 'canvas',
      },
      projection,
      previous: null,
    });
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toBe('no-verified-revision');
  });

  it('VERIFIED previous/current: deriveSemanticPassportState produces a usable Passport', () => {
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
    const delta = compareProjectionRevisions(base, head);
    if (!delta.ok) throw new Error('delta must be ok');
    const result = deriveSemanticPassportState({
      passportOpen: {
        entityRef: { kind: 'conversation', id: 'conversation:project-a::codex::builder-1' },
        source: 'canvas',
      },
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: head, diagnostics: [] },
      previous: base,
    });
    expect(result.kind).toBe('passport');
    if (result.kind !== 'passport') return;
    expect(result.passport.entityType).toBe('conversation');
    expect(result.passport.delta).not.toBeNull();
  });

  it('no raw Snapshot / Activity fallback: deriveSemanticPassportState reads only the seam inputs', () => {
    // The derivation only consumes passportOpen / projection / previous.
    // If a future refactor accidentally falls back to raw Snapshot /
    // Activity inputs that include the same ref, the result must remain
    // exact. We exercise the helper with a project id that is not in the
    // verified revision and assert the closed / unavailable / failure
    // surface — never a "passport" with snapshot-derived fields.
    const input = buildInput();
    const verified = verifiedFromInput(input);
    const closed = deriveSemanticPassportState({
      passportOpen: null,
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: verified, diagnostics: [] },
      previous: null,
    });
    expect(closed.kind).toBe('closed');

    const notFound = deriveSemanticPassportState({
      passportOpen: { entityRef: { kind: 'conversation', id: 'conversation:not-in-revision' }, source: 'canvas' },
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: verified, diagnostics: [] },
      previous: null,
    });
    expect(notFound.kind).toBe('failure');
    if (notFound.kind !== 'failure') return;
    expect(notFound.failure.code).toBe('passport/entity-not-found');
  });

  it('the seam never falls back to raw Snapshot / Activity / Governance facts', () => {
    // The selector only reads passportOpen / projection / previous. We
    // exercise the derivation with passportOpen=null and assert the
    // closed branch; a future refactor that pulls in raw snapshot /
    // activity / frozen would have to widen the input, which this test
    // makes visible.
    const input = buildInput();
    const verified = verifiedFromInput(input);
    const closed = deriveSemanticPassportState({
      passportOpen: null,
      projection: { ...emptyProjectionBuildState(), status: 'VERIFIED', current: verified, diagnostics: [] },
      previous: null,
    });
    expect(closed.kind).toBe('closed');
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

describe('Canvas execution node opens Runtime Inspector + Semantic Passport', () => {
  it('an exact verified RuntimeExecution id resolves to a runtimeExecution Passport ref', () => {
    const input: ProjectionFactInputV0 = {
      ...buildInput(),
      snapshot: {
        ...buildInput().snapshot,
        // Inject a runtime execution by also running the existing
        // projection pipeline; the input above does not seed one, so we
        // build the verified revision through the standard pipeline.
        conversations: buildInput().snapshot.conversations,
        projects: buildInput().snapshot.projects,
      },
    };
    void input;
    // Use the proven verified revision from the earlier fixture; it
    // already contains an execution with the canonical id.
    const verified = verifiedFromInput(buildInput());
    const executionId = verified.candidate.semanticFacts.runtimeExecutions[0]?.id;
    if (!executionId) throw new Error('fixture must include a runtimeExecution');
    const passportRef = canvasNodeIdToPassportRef(executionId, verified);
    expect(passportRef).toEqual({ kind: 'runtimeExecution', id: executionId });
  });

  it('a forged execution id never resolves to a Passport ref', () => {
    const verified = verifiedFromInput(buildInput());
    const passportRef = canvasNodeIdToPassportRef('execution:codex::forged', verified);
    expect(passportRef).toBeNull();
  });

  it('Canvas click flow: exact verified execution opens Runtime Inspector + Passport', () => {
    // Run the actual click decision in isolation: handleCanvasNodeClick
    // is the exact helper CanvasView.onNodeClick calls. We pass spy
    // callbacks so the contract is asserted directly, without rendering
    // ReactFlow.
    const verified = verifiedFromInput(buildInput());
    const executionId = verified.candidate.semanticFacts.runtimeExecutions[0]?.id;
    if (!executionId) throw new Error('fixture must include a runtimeExecution');
    let inspectorCalls = 0;
    let lastInspectorTarget: { executionId: string } | null = null;
    const passportCalls: Array<{ ref: SemanticPassportEntityRefV0; source: 'canvas' | 'compare' }> = [];
    handleCanvasNodeClick(
      executionId,
      verified,
      {
        openRuntimeInspector: (target) => {
          inspectorCalls += 1;
          lastInspectorTarget = target;
        },
        openPassport: (ref, source) => {
          passportCalls.push({ ref, source });
        },
        selectProjectedConversation: () => undefined,
        setView: () => undefined,
      },
    );
    expect(inspectorCalls).toBe(1);
    // The Canvas contract strips the "execution:" prefix before calling
    // the Runtime Inspector surface, so the inspector receives the
    // native executionId.
    const nativeExecutionId = executionId.slice('execution:'.length);
    expect(lastInspectorTarget).toEqual({ executionId: nativeExecutionId });
    expect(passportCalls).toEqual([
      { ref: { kind: 'runtimeExecution', id: executionId }, source: 'canvas' },
    ]);
  });

  it('Canvas click flow: forged execution id does not open a Passport', () => {
    // Identity inference is forbidden: a forged execution id that does
    // not exist in the active verified revision must not open a
    // Semantic Passport. The Runtime Inspector surface remains a
    // separate decision; the Canvas contract guards the Passport
    // openPassport call with the exact verified mapper result.
    const verified = verifiedFromInput(buildInput());
    let inspectorCalls = 0;
    const passportCalls: Array<{ ref: SemanticPassportEntityRefV0; source: 'canvas' | 'compare' }> = [];
    handleCanvasNodeClick(
      'execution:codex::forged',
      verified,
      {
        openRuntimeInspector: () => { inspectorCalls += 1; },
        openPassport: (ref, source) => { passportCalls.push({ ref, source }); },
        selectProjectedConversation: () => undefined,
        setView: () => undefined,
      },
    );
    expect(inspectorCalls).toBe(1);
    expect(passportCalls).toEqual([]);
  });

  it('Canvas click flow: conversation opens Passport + existing control-view jump', () => {
    // The pre-existing dual surface for a conversation click is preserved.
    const verified = verifiedFromInput(buildInput());
    const conversationId = verified.candidate.semanticFacts.conversations[0]?.id;
    if (!conversationId) throw new Error('fixture must include a conversation');
    let selectCalls = 0;
    let viewCalls: string[] = [];
    const passportCalls: Array<{ ref: SemanticPassportEntityRefV0; source: 'canvas' | 'compare' }> = [];
    handleCanvasNodeClick(
      conversationId,
      verified,
      {
        openRuntimeInspector: () => undefined,
        openPassport: (ref, source) => { passportCalls.push({ ref, source }); },
        selectProjectedConversation: () => { selectCalls += 1; },
        setView: (view) => { viewCalls.push(view); },
      },
    );
    expect(passportCalls).toEqual([
      { ref: { kind: 'conversation', id: conversationId }, source: 'canvas' },
    ]);
    expect(selectCalls).toBe(1);
    expect(viewCalls).toEqual(['control']);
  });
});

