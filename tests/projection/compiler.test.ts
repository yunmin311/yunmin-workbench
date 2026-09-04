import { describe, expect, it } from 'vitest';
import type { ActivityEvent, OverlaySnapshot } from '../../src/core/types';
import {
  compileProjectionCandidate,
  computeProjectionSourceDigest,
} from '../../src/core/projection/compiler';
import { validateProjectionSemantics } from '../../src/core/projection/schema';
import { resultSourceRef } from '../../src/core/project/executionRelations';

const observedAt = '2026-09-04T01:00:00.000Z';

function snapshot(): OverlaySnapshot {
  return {
    overlayRoot: 'E:/governance',
    foundAt: observedAt,
    conversations: [{
      key: 'project-1::codex::builder',
      conversationId: 'canonical-conversation-1',
      role: 'builder',
      project: 'project-1',
      platform: 'codex',
      status: 'ACTIVE',
      taskState: 'waiting',
      runtimeState: 'unknown',
      attention: 'needs-user',
      verification: 'VERIFIED',
      observed: {
        source: 'canonical-file',
        sourceRef: 'dialogues/project-1.yaml',
        observedAt,
        verification: 'VERIFIED',
      },
    }],
    projects: [{
      projectId: 'project-1',
      displayName: 'Project One',
      status: 'ACTIVE',
      roles: [],
      gates: {},
      trust: 'VERIFIED',
      observed: {
        source: 'canonical-file',
        sourceRef: 'projects/project-1.yaml',
        observedAt,
        verification: 'VERIFIED',
      },
    }],
    inbox: [],
    memoryIndex: [],
    harness: [],
    sourceFingerprints: [
      { sourceRef: 'dialogues/project-1.yaml', sha256: '1'.repeat(64) },
      { sourceRef: 'projects/project-1.yaml', sha256: '2'.repeat(64) },
    ],
    problems: [],
  };
}

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'source-result',
    projectId: 'project-1',
    conversationKey: 'project-1::codex::builder',
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

describe('Workbench facts to ProjectionCandidateV0', () => {
  it('keeps Conversation identity separate from RuntimeExecution identity', () => {
    const source = event({});
    const candidate = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: snapshot(),
      activity: [source],
    });

    expect(candidate.semanticFacts.conversations).toEqual([
      expect.objectContaining({
        id: 'conversation:project-1::codex::builder',
        conversationKey: 'project-1::codex::builder',
        canonicalConversationId: 'canonical-conversation-1',
        lifecycleState: 'ACTIVE',
        taskState: 'waiting',
        runtimeState: 'unknown',
        attentionState: 'needs-user',
      }),
    ]);
    expect(candidate.semanticFacts.runtimeExecutions).toEqual([
      expect.objectContaining({
        id: 'execution:codex::execution:intent-source',
        executionId: 'codex::execution:intent-source',
        nativeRef: 'thread-source',
        conversationRef: 'conversation:project-1::codex::builder',
        runtimeState: 'idle',
      }),
    ]);
    expect(candidate.semanticFacts.runtimeExecutions[0].id)
      .not.toBe(candidate.semanticFacts.conversations[0].id);
  });

  it('preserves evidence provenance and does not guess currentness', () => {
    const facts = snapshot();
    facts.sourceFingerprints.push({
      sourceRef: 'codex:item:source-result',
      sha256: '3'.repeat(64),
    });
    const candidate = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: facts,
      activity: [event({})],
    });
    const conversationEvidence = candidate.semanticFacts.evidenceRefs.find(
      (item) => item.sourceRef === 'dialogues/project-1.yaml',
    );
    const runtimeEvidence = candidate.semanticFacts.evidenceRefs.find(
      (item) => item.sourceRef === 'codex:item:source-result',
    );
    expect(conversationEvidence).toMatchObject({
      source: 'canonical-file',
      observedAt,
      verification: 'VERIFIED',
      currentness: 'CURRENT',
      revision: { kind: 'sha256', value: '1'.repeat(64) },
    });
    expect(runtimeEvidence).toMatchObject({
      source: 'protocol',
      observedAt,
      verification: 'VERIFIED',
      currentness: 'UNKNOWN',
      revision: { kind: 'activity-event', value: 'source-result' },
    });
  });

  it('does not promote a malformed source fingerprint into revision-pinned evidence', () => {
    const facts = snapshot();
    facts.sourceFingerprints[0].sha256 = 'demo-placeholder-not-a-sha256';
    const candidate = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: facts,
      activity: [],
    });
    const evidence = candidate.semanticFacts.evidenceRefs.find(
      (item) => item.sourceRef === 'dialogues/project-1.yaml',
    );
    expect(evidence).toMatchObject({ currentness: 'UNKNOWN' });
    expect(evidence).not.toHaveProperty('revision');
  });

  it('creates Parallel and Handoff only from explicit group and used-result facts', () => {
    const source = event({ groupId: 'comparison-1' });
    const usedResultRef = resultSourceRef(source);
    const target = event({
      id: 'target-result',
      harness: 'claude',
      runtimeRef: 'session-target',
      intentId: 'intent-target',
      groupId: 'comparison-1',
      parentSourceRef: usedResultRef,
      content: 'Target result',
      observed: {
        source: 'protocol',
        sourceRef: 'claude:item:target-result',
        observedAt: '2026-09-04T01:00:01.000Z',
        verification: 'VERIFIED',
      },
    });
    const candidate = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: snapshot(),
      activity: [source, target],
    });
    expect(candidate.semanticFacts.collaborationRelations).toEqual([
      {
        id: 'handoff:harness-result:codex::execution:intent-source:source-result->claude::execution:intent-target',
        kind: 'handoff',
        sourceExecutionRef: 'execution:codex::execution:intent-source',
        targetExecutionRef: 'execution:claude::execution:intent-target',
        usedResultRef,
        evidenceRefs: expect.any(Array),
      },
      {
        id: 'parallel:comparison-1',
        kind: 'parallel',
        groupId: 'comparison-1',
        executionRefs: [
          'execution:claude::execution:intent-target',
          'execution:codex::execution:intent-source',
        ],
        evidenceRefs: expect.any(Array),
      },
    ]);

    const withoutFacts = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: snapshot(),
      activity: [source, event({ id: 'unrelated', intentId: 'intent-other' })],
    });
    expect(withoutFacts.semanticFacts.collaborationRelations).toEqual([]);
  });

  it('excludes layout from the source digest', () => {
    const input = { projectId: 'project-1', snapshot: snapshot(), activity: [event({})] };
    const first = computeProjectionSourceDigest({
      ...input,
      layoutState: { schemaVersion: 0, nodePositions: {} },
    });
    const second = computeProjectionSourceDigest({
      ...input,
      layoutState: {
        schemaVersion: 0,
        nodePositions: { 'conversation:project-1::codex::builder': { x: 50, y: 60 } },
      },
    });
    expect(second).toBe(first);
  });

  it('reports duplicate IDs and broken references without repairing the candidate', () => {
    const source = event({ groupId: 'comparison-1' });
    const usedResultRef = resultSourceRef(source);
    const target = event({
      id: 'target-result',
      harness: 'claude',
      runtimeRef: 'session-target',
      intentId: 'intent-target',
      groupId: 'comparison-1',
      parentSourceRef: usedResultRef,
      content: 'Target result',
    });
    const candidate = compileProjectionCandidate({
      projectId: 'project-1',
      snapshot: snapshot(),
      activity: [source, target],
    });
    const broken = structuredClone(candidate);
    broken.semanticFacts.conversations.push(structuredClone(broken.semanticFacts.conversations[0]));
    broken.semanticFacts.conversations[0].evidenceRefs.push('evidence:missing');
    broken.semanticFacts.runtimeExecutions[0].conversationRef = 'conversation:missing';
    const parallel = broken.semanticFacts.collaborationRelations.find((item) => item.kind === 'parallel');
    if (!parallel) throw new Error('fixture must include parallel relation');
    parallel.executionRefs = [parallel.executionRefs[0], parallel.executionRefs[0]];
    const handoff = broken.semanticFacts.collaborationRelations.find((item) => item.kind === 'handoff');
    if (!handoff) throw new Error('fixture must include handoff relation');
    const artifact = broken.semanticFacts.artifactsOrEvidence.find((item) => item.id === handoff.usedResultRef);
    if (!artifact) throw new Error('fixture must include used result artifact');
    artifact.executionRef = handoff.targetExecutionRef;
    broken.layoutState.nodePositions['conversation:missing'] = { x: 1, y: 2 };
    broken.semanticFacts.collaborationRelations.push(structuredClone(handoff));

    const diagnostics = validateProjectionSemantics(broken);
    const codes = new Set(diagnostics.map((item) => item.code));
    expect(codes).toEqual(new Set([
      'semantic/duplicate-id',
      'semantic/handoff-source',
      'semantic/layout-target',
      'semantic/missing-evidence',
      'semantic/missing-reference',
      'semantic/relation-members',
    ]));
    expect(broken.semanticFacts.conversations).toHaveLength(2);
    expect(broken.semanticFacts.conversations[0].evidenceRefs).toContain('evidence:missing');
  });
});
