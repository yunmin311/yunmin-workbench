import { describe, expect, it } from 'vitest';
import {
  normalizeProjectionDiagnostic,
  normalizeProjectionDiagnostics,
} from '../../src/core/projection/diagnostics';
import { validateProjectionCandidate } from '../../src/core/projection/schema';

function minimalCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 0,
    projectionKind: 'workbench',
    scope: { projectId: 'project-1' },
    sourceBinding: { sourceDigest: 'a'.repeat(64) },
    semanticFacts: {
      conversations: [{
        id: 'conversation:conversation-1',
        conversationKey: 'conversation-1',
        projectId: 'project-1',
        role: 'builder',
        platform: 'codex',
        lifecycleState: 'ACTIVE',
        taskState: 'blocked',
        runtimeState: 'idle',
        attentionState: 'approval',
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
        currentness: 'UNKNOWN',
      }],
    },
    layoutState: {
      schemaVersion: 0,
      nodePositions: {
        'conversation:conversation-1': { x: 12, y: 24 },
      },
    },
  };
}

describe('ProjectionCandidateV0 strict schema', () => {
  it('preserves lifecycle, task, runtime, and attention as independent states', () => {
    const result = validateProjectionCandidate(minimalCandidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.semanticFacts.conversations[0]).toMatchObject({
      lifecycleState: 'ACTIVE',
      taskState: 'blocked',
      runtimeState: 'idle',
      attentionState: 'approval',
    });
  });

  it('rejects unknown fields instead of silently accepting a second contract', () => {
    const input = { ...minimalCandidate(), hiddenControllerState: true };
    const result = validateProjectionCandidate(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema/unrecognized_keys',
        severity: 'error',
        subject: expect.objectContaining({ path: [] }),
      }),
    ]));
  });

  it('rejects non-finite layout positions', () => {
    const input = minimalCandidate();
    const layout = input.layoutState as { nodePositions: Record<string, { x: number; y: number }> };
    layout.nodePositions['conversation:conversation-1'].x = Number.POSITIVE_INFINITY;
    const result = validateProjectionCandidate(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith('schema/'))).toBe(true);
  });
});

describe('projection diagnostic normalization', () => {
  it('normalizes plain data and deduplicates fixes without global recording', () => {
    const normalized = normalizeProjectionDiagnostic({
      code: ' semantic/missing-ref ',
      severity: 'warning',
      message: '  Missing reference  ',
      subject: { id: 'relation-1', absent: undefined },
      evidence: ['not', 'a', 'plain', 'object'],
      supportedFixes: [' repair the reference ', 'repair the reference', '', 42],
    });
    expect(normalized).toEqual({
      code: 'semantic/missing-ref',
      severity: 'warning',
      message: 'Missing reference',
      subject: { id: 'relation-1' },
      evidence: {},
      supportedFixes: ['repair the reference', '42'],
    });
  });

  it('deduplicates within one call and keeps no process-global recorder', () => {
    const input = [
      { code: 'semantic/a', message: 'Same failure' },
      { code: 'semantic/b', message: 'Same failure' },
    ];
    expect(normalizeProjectionDiagnostics(input)).toHaveLength(1);
    expect(normalizeProjectionDiagnostics(input)).toHaveLength(1);
  });
});
