import type { WorkGraphRevision } from './revision';
import { compileWorkGraph } from './compiler';
import type { WorkGraphSourceFacts } from '../../core/workgraph/revision';

/**
 * TEST FIXTURE scene — visual acceptance for entity families that current
 * real data has no instances of (Execution / Gate instance / Evidence /
 * Handoff / Memory source). Compiled through the REAL WorkGraph compiler so
 * everything on screen is semantically legal. Never mixes with real data:
 * it exists only under WB_GRAPH_FIXTURE=1 and is badged TEST FIXTURE in the UI.
 */

const NOW = '2026-09-12T00:00:00.000Z';

function fixtureFacts(): WorkGraphSourceFacts {
  return {
    governanceBindings: [
      {
        projectId: 'fixture-os', workId: '100-fixture-flow', workLabel: 'Fixture · cross-entity flow check',
        binding: {
          projectId: 'fixture-os', root: '/fixture', canonicalPath: '/fixture/manifest.yaml',
          observedAt: NOW, verification: 'VERIFIED',
        },
      },
      {
        projectId: 'fixture-os', workId: '200-fixture-review', workLabel: 'Fixture · release review',
        binding: {
          projectId: 'fixture-os', root: '/fixture', canonicalPath: '/fixture/review.yaml',
          observedAt: NOW, verification: 'VERIFIED',
        },
      },
    ],
    historySessions: [],
    memoryEntries: [{
      memoryId: 'fixture-memory-index', title: 'Fixture memory source', source: 'fixture:memory/MEMORY.md',
      sourceRef: 'overlay:memory/MEMORY.md', observedAt: NOW, verification: 'OBSERVED',
    }],
    packets: [],
    handoffs: [],
    adapterExecutions: [
      {
        executionId: 'fixture-agent-7', backend: 'native', provider: 'claude', runtimeRef: 'native-fixture-7',
        projectId: 'fixture-os', conversationKey: 'fixture-os::claude::builder', workId: '100-fixture-flow', taskId: 'T100',
        intentId: 'intent-fixture-1', runtimeState: 'working', live: true, evidenceRefs: ['evt-fixture-1'],
        sourceRef: 'native:claude:native-fixture-7',
      },
      {
        executionId: 'fixture-agent-6', backend: 'native', provider: 'codex', runtimeRef: 'native-fixture-6',
        projectId: 'fixture-os', conversationKey: 'fixture-os::codex::reviewer', workId: '100-fixture-flow',
        runtimeState: 'stopped', live: false, evidenceRefs: [], sourceRef: 'native:codex:native-fixture-6',
      },
    ],
    contextItems: [
      {
        contextId: 'fixture-context-brief', projectId: 'fixture-os', title: 'Fixture brief', source: 'adapter:fixture-os',
        body: 'fixture context body', state: 'included', pinned: false, isReference: false,
        sourceRef: 'overlay:fixture/brief.md', evidenceRefs: [],
        consumedBy: { executionId: 'fixture-agent-7', action: 'included' },
      },
      {
        contextId: 'fixture-context-staged', projectId: 'fixture-os', title: 'Fixture staged notes', source: 'adapter:fixture-os',
        body: '', state: 'available', pinned: false, isReference: false,
        sourceRef: 'overlay:fixture/notes.md', evidenceRefs: [],
      },
    ],
    attentionItems: [{
      id: 'fixture-attention-1', kind: 'approval-required', level: 'alert', title: 'Fixture approval required',
      summary: 'fixture execution needs user approval', projectId: 'fixture-os', sourceId: 'fixture-agent-7',
      sourceRef: 'native:claude:native-fixture-7', evidenceRefs: ['evt-fixture-1'], observedAt: NOW, verification: 'VERIFIED',
    }],
    artifacts: [{
      artifactId: 'fixture-artifact-1', projectId: 'fixture-os', kind: 'file-evidence', executionId: 'fixture-agent-7',
      eventRef: 'evt-fixture-2', title: 'src/fixture/output.ts', taskId: 'T100', evidenceRefs: [],
    }],
    tasks: [
      {
        taskId: 'T100', projectId: 'fixture-os', label: 'Fixture · implement flow', source: 'fixture-tasks',
        sourceRef: 'fixture:tasks.md#T100', observedAt: NOW, verification: 'VERIFIED', currentness: 'CURRENT',
        taskState: 'active', workId: '100-fixture-flow', evidenceRefs: [],
      },
      {
        taskId: 'T200', projectId: 'fixture-os', label: 'Fixture · verify release', source: 'fixture-tasks',
        sourceRef: 'fixture:tasks.md#T200', observedAt: NOW, verification: 'VERIFIED', currentness: 'CURRENT',
        taskState: 'standby', workId: '200-fixture-review', evidenceRefs: [],
      },
    ],
    evidenceItems: [{
      evidenceId: 'evt-fixture-1', projectId: 'fixture-os', label: 'Fixture tool receipt', evidenceType: 'tool-evidence',
      source: 'protocol', sourceRef: 'protocol:fixture:tool/1', observedAt: NOW, verification: 'OBSERVED',
      executionId: 'fixture-agent-7', backsNodeId: 'execution:fixture-os:fixture-agent-7', evidenceRefs: [],
    }],
    overlaySnapshot: {
      conversations: [
        {
          conversationKey: 'fixture-os::claude::builder', projectId: 'fixture-os', role: 'builder', platform: 'claude',
          lifecycleState: 'ACTIVE', taskState: 'active', runtimeState: 'working', attentionState: 'approval',
          verification: 'OBSERVED', evidenceRefs: [],
        },
        {
          conversationKey: 'fixture-os::codex::reviewer', projectId: 'fixture-os', role: 'reviewer', platform: 'codex',
          lifecycleState: 'FROZEN', taskState: 'standby', runtimeState: 'stopped', attentionState: 'none',
          verification: 'OBSERVED', evidenceRefs: [],
        },
      ],
      projects: [{ projectId: 'fixture-os', label: 'Fixture OS', canonicalSource: { path: 'manifest.yaml' } }],
      memoryIndex: [{ memoryId: 'fixture-memory', title: 'Fixture memory entry', source: 'overlay:memory/MEMORY.md' }],
      inbox: [],
      sourceFingerprints: [],
      problems: [],
    },
  };
}

export async function buildFixtureRevision(): Promise<WorkGraphRevision | null> {
  const result = await compileWorkGraph({
    projectId: 'fixture-os',
    sourceDigest: 'fixture-scene',
    facts: fixtureFacts(),
    now: NOW,
  });
  return result.revision ?? null;
}
