import { describe, expect, it } from 'vitest';
import type { ActivityEvent, OverlaySnapshot } from '../../src/core/types';
import {
  compileProjectionCandidate,
  computeProjectionSourceDigest,
  type ProjectionFactInputV0,
} from '../../src/core/projection/compiler';
import { validateProjectionCandidate } from '../../src/core/projection/schema';

const observedAt = '2026-09-04T01:00:00.000Z';

function conversation(projectId: string, key: string, sourceRef: string): OverlaySnapshot['conversations'][number] {
  return {
    key: `${projectId}::codex::builder-${key}`,
    role: 'builder',
    project: projectId,
    platform: 'codex',
    status: 'ACTIVE',
    taskState: 'waiting',
    runtimeState: 'unknown',
    attention: 'needs-user',
    verification: 'VERIFIED',
    observed: {
      source: 'canonical-file',
      sourceRef,
      observedAt,
      verification: 'VERIFIED',
    },
  };
}

function projectAdapter(projectId: string, sourceRef: string): OverlaySnapshot['projects'][number] {
  return {
    projectId,
    displayName: `Project ${projectId}`,
    status: 'ACTIVE',
    roles: [],
    gates: {},
    trust: 'VERIFIED',
    observed: {
      source: 'canonical-file',
      sourceRef,
      observedAt,
      verification: 'VERIFIED',
    },
  };
}

function memoryEntry(id: string, sourceRef: string): OverlaySnapshot['memoryIndex'][number] {
  return { id, title: id, hook: '', category: 'note', sourceRef };
}

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'source-result',
    projectId: 'project-a',
    conversationKey: 'project-a::codex::builder-source',
    kind: 'agent-response',
    summary: 'Source result',
    content: 'Exact source result',
    harness: 'codex',
    runtimeRef: 'thread-source',
    intentId: 'intent-source',
    runtimeState: 'idle',
    observed: {
      source: 'protocol',
      sourceRef: 'codex:item:source-result',
      observedAt,
      verification: 'VERIFIED',
    },
    ...overrides,
  };
}

/**
 * Two projects share the same OverlaySnapshot. Project B has its own
 * conversations and ProjectAdapter; their canonical files also appear in the
 * sourceFingerprints list. The fixture models the current product: Workbench
 * loads one snapshot that contains everything it can see.
 */
function snapshotB(opts: {
  projectBConversationSha?: string;
  projectBAdapterSha?: string;
  projectAConversationSha?: string;
  projectAAdapterSha?: string;
  memorySha?: string;
  memorySourceRef?: string;
}): OverlaySnapshot {
  const projectAConversationRef = 'dialogues/project-a.yaml';
  const projectAAdapterRef = 'projects/project-a.yaml';
  const projectBConversationRef = 'dialogues/project-b.yaml';
  const projectBAdapterRef = 'projects/project-b.yaml';
  const memoryRef = opts.memorySourceRef ?? 'memory/MEMORY.md';
  return {
    overlayRoot: 'E:/governance',
    foundAt: observedAt,
    conversations: [
      conversation('project-a', 'source', projectAConversationRef),
      conversation('project-b', 'source', projectBConversationRef),
    ],
    projects: [
      projectAdapter('project-a', projectAAdapterRef),
      projectAdapter('project-b', projectBAdapterRef),
    ],
    inbox: [],
    memoryIndex: [memoryEntry('memory-1', memoryRef)],
    harness: [],
    sourceFingerprints: [
      { sourceRef: projectAConversationRef, sha256: opts.projectAConversationSha ?? '1'.repeat(64) },
      { sourceRef: projectAAdapterRef, sha256: opts.projectAAdapterSha ?? '2'.repeat(64) },
      { sourceRef: projectBConversationRef, sha256: opts.projectBConversationSha ?? 'b'.repeat(64) },
      { sourceRef: projectBAdapterRef, sha256: opts.projectBAdapterSha ?? 'c'.repeat(64) },
      { sourceRef: memoryRef, sha256: opts.memorySha ?? 'd'.repeat(64) },
      { sourceRef: 'codex:item:source-result', sha256: '3'.repeat(64) },
    ],
    problems: [],
  };
}

function projectAInput(snapshot: OverlaySnapshot): ProjectionFactInputV0 {
  return {
    projectId: 'project-a',
    snapshot,
    activity: [event({})],
  };
}

describe('Verified Projection Foundation · trust fix', () => {
  it('A) does not accept a History session as a Projection fact input', () => {
    // ProjectionFactInputV0 must not declare a `historySessions` member; History
    // is read-only derived transcript evidence without a canonical Project
    // binding, and v0 must not be able to turn an unbound/global History
    // session into a Project-scoped fact.
    const input: ProjectionFactInputV0 = projectAInput(snapshotB({}));
    expect('historySessions' in input).toBe(false);
    // @ts-expect-error History input is intentionally absent from Projection IR v0.
    const illegal: ProjectionFactInputV0 = { ...input, historySessions: [] };
    void illegal;

    // v0 must not emit a project-scoped `history-fact` artifact.
    const candidate = compileProjectionCandidate(input);
    const historyArtifacts = candidate.semanticFacts.artifactsOrEvidence.filter(
      (item) => item.kind === 'history-fact',
    );
    expect(historyArtifacts).toEqual([]);

    // And the candidate must remain structurally valid (no extra fields).
    const validation = validateProjectionCandidate(candidate);
    expect(validation.ok).toBe(true);
  });

  it('B) does not change Project A sourceDigest when only Project B facts/fingerprints move', () => {
    const baseline = compileProjectionCandidate(projectAInput(snapshotB({})));
    const baselineDigest = baseline.sourceBinding.sourceDigest;

    // Mutate only Project B fingerprints.
    const drifted = snapshotB({
      projectBConversationSha: 'e'.repeat(64),
      projectBAdapterSha: 'f'.repeat(64),
    });
    const driftedDigest = compileProjectionCandidate(projectAInput(drifted))
      .sourceBinding.sourceDigest;

    expect(driftedDigest).toBe(baselineDigest);

    // And the same digest is produced via computeProjectionSourceDigest
    // (which re-derives it from the same dependency set).
    const recomputed = computeProjectionSourceDigest(
      projectAInput(drifted),
      compileProjectionCandidate(projectAInput(drifted)),
    );
    expect(recomputed).toBe(baselineDigest);
  });

  it('C1) changes Project A sourceDigest when a Project A dependency moves', () => {
    const baseline = compileProjectionCandidate(projectAInput(snapshotB({})));
    const baselineDigest = baseline.sourceBinding.sourceDigest;

    // Mutate only Project A conversation fingerprint.
    const drifted = snapshotB({ projectAConversationSha: '9'.repeat(64) });
    const driftedDigest = compileProjectionCandidate(projectAInput(drifted))
      .sourceBinding.sourceDigest;
    expect(driftedDigest).not.toBe(baselineDigest);

    // Reset and mutate only Project A ProjectAdapter fingerprint.
    const driftedAdapter = snapshotB({ projectAAdapterSha: '8'.repeat(64) });
    const driftedAdapterDigest = compileProjectionCandidate(projectAInput(driftedAdapter))
      .sourceBinding.sourceDigest;
    expect(driftedAdapterDigest).not.toBe(baselineDigest);
  });

  it('C2) changes Project A sourceDigest when a Memory Vault dependency moves', () => {
    const baseline = compileProjectionCandidate(projectAInput(snapshotB({})));
    const baselineDigest = baseline.sourceBinding.sourceDigest;

    // Mutate only the Memory Vault fingerprint. Memory Vault is a current
    // intentional product mount into every Project Canvas, so it is an
    // allowed dependency.
    const drifted = snapshotB({ memorySha: '7'.repeat(64) });
    const driftedDigest = compileProjectionCandidate(projectAInput(drifted))
      .sourceBinding.sourceDigest;
    expect(driftedDigest).not.toBe(baselineDigest);
  });

  it('D1) scopes liveExecutionIds to the projected candidate and ignores Project B live/stopped transitions', () => {
    const snapshot = snapshotB({});
    const baselineInput: ProjectionFactInputV0 = {
      ...projectAInput(snapshot),
      liveExecutionIds: [],
    };
    const baseline = compileProjectionCandidate(baselineInput);

    // Project A candidate contains exactly one execution; capture its id.
    expect(baseline.semanticFacts.runtimeExecutions).toHaveLength(1);
    const projectAExecutionId = baseline.semanticFacts.runtimeExecutions[0].executionId;
    expect(projectAExecutionId).toBe('codex::execution:intent-source');
    expect(baseline.semanticFacts.runtimeExecutions[0].live).toBe(false);

    const baselineDigest = baseline.sourceBinding.sourceDigest;

    // 1) Add an unrelated Project B live execution id: digest must not change.
    const withUnrelatedLive: ProjectionFactInputV0 = {
      ...baselineInput,
      liveExecutionIds: ['project-b::execution:intent-other', 'codex::execution:intent-unrelated-2'],
    };
    const candidateWithUnrelated = compileProjectionCandidate(withUnrelatedLive);
    expect(candidateWithUnrelated.sourceBinding.sourceDigest).toBe(baselineDigest);
    expect(candidateWithUnrelated.semanticFacts.runtimeExecutions[0].live).toBe(false);

    // 2) Add/remove only that unrelated id: digest stays the same.
    const onlyUnrelated = compileProjectionCandidate({
      ...baselineInput,
      liveExecutionIds: ['codex::execution:intent-unrelated-2'],
    });
    expect(onlyUnrelated.sourceBinding.sourceDigest).toBe(baselineDigest);

    // 3) Recompute via the public computeProjectionSourceDigest with a
    //    stale digest returned from a different input shape: must match too.
    const recomputed = computeProjectionSourceDigest(withUnrelatedLive, candidateWithUnrelated);
    expect(recomputed).toBe(baselineDigest);
  });

  it('D2) toggling the projected Project A execution live id changes Project A sourceDigest and live state', () => {
    const snapshot = snapshotB({});
    const baselineInput: ProjectionFactInputV0 = {
      ...projectAInput(snapshot),
      liveExecutionIds: [],
    };
    const baseline = compileProjectionCandidate(baselineInput);
    const projectAExecutionId = baseline.semanticFacts.runtimeExecutions[0].executionId;
    const baselineDigest = baseline.sourceBinding.sourceDigest;

    // The exact live id of Project A's projected execution enters the digest.
    const liveInput: ProjectionFactInputV0 = {
      ...baselineInput,
      liveExecutionIds: [projectAExecutionId],
    };
    const liveCandidate = compileProjectionCandidate(liveInput);
    expect(liveCandidate.sourceBinding.sourceDigest).not.toBe(baselineDigest);
    expect(liveCandidate.semanticFacts.runtimeExecutions[0].live).toBe(true);

    // Toggling the live id off again returns to the baseline digest and live=false.
    const restored = compileProjectionCandidate(baselineInput);
    expect(restored.sourceBinding.sourceDigest).toBe(baselineDigest);
    expect(restored.semanticFacts.runtimeExecutions[0].live).toBe(false);

    // Mixing the Project A live id with extra unrelated live ids does not
    // change the digest relative to the Project-A-only-live case: only the
    // projected execution set may enter the digest.
    const mixed = compileProjectionCandidate({
      ...baselineInput,
      liveExecutionIds: [projectAExecutionId, 'codex::execution:intent-unrelated-3'],
    });
    expect(mixed.sourceBinding.sourceDigest).toBe(liveCandidate.sourceBinding.sourceDigest);
  });
});