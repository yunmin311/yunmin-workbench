import { computePacketHash } from '../project/canonical';
import {
  compileProjectionCandidate,
  computeProjectionSourceDigest,
  type ProjectionFactInputV0,
} from './compiler';
import { normalizeProjectionDiagnostic } from './diagnostics';
import { validateProjectionCandidate, validateProjectionSemantics } from './schema';
import type {
  ProjectionBuildStateV0,
  ProjectionCandidateV0,
  ProjectionDiagnosticV0,
  ProjectionReceiptV0,
  VerifiedProjectionRevisionV0,
} from './types';

export interface ProjectionVerificationOptionsV0 {
  recheckSourceDigest: () => string;
  now?: () => string;
}

export interface ProjectionBuildOptionsV0 {
  recheckSourceDigest?: () => string;
  now?: () => string;
}

const UNKNOWN_DIGEST = '0'.repeat(64);

export function emptyProjectionBuildState(): ProjectionBuildStateV0 {
  return {
    status: 'NEEDS_FIX',
    current: null,
    receipt: null,
    diagnostics: [],
  };
}

function projectIdFromUnknown(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const scope = (input as Record<string, unknown>).scope;
  if (!scope || typeof scope !== 'object') return null;
  const projectId = (scope as Record<string, unknown>).projectId;
  return typeof projectId === 'string' && projectId ? projectId : null;
}

function sourceDigestFromUnknown(input: unknown): string {
  if (!input || typeof input !== 'object') return UNKNOWN_DIGEST;
  const binding = (input as Record<string, unknown>).sourceBinding;
  if (!binding || typeof binding !== 'object') return UNKNOWN_DIGEST;
  const digest = (binding as Record<string, unknown>).sourceDigest;
  return typeof digest === 'string' ? digest : UNKNOWN_DIGEST;
}

function eligiblePrevious(
  previous: VerifiedProjectionRevisionV0 | null,
  projectId: string | null,
): VerifiedProjectionRevisionV0 | null {
  if (!previous) return null;
  if (!projectId || previous.candidate.scope.projectId === projectId) return previous;
  return null;
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function semanticFactsForHash(candidate: ProjectionCandidateV0): unknown {
  return {
    conversations: sortById(candidate.semanticFacts.conversations).map((item) => ({
      ...item,
      evidenceRefs: [...item.evidenceRefs].sort(),
    })),
    runtimeExecutions: sortById(candidate.semanticFacts.runtimeExecutions).map((item) => ({
      ...item,
      evidenceRefs: [...item.evidenceRefs].sort(),
    })),
    collaborationRelations: sortById(candidate.semanticFacts.collaborationRelations).map((item) => ({
      ...item,
      ...(item.kind === 'parallel' ? { executionRefs: [...item.executionRefs].sort() } : {}),
      evidenceRefs: [...item.evidenceRefs].sort(),
    })),
    artifactsOrEvidence: sortById(candidate.semanticFacts.artifactsOrEvidence).map((item) => ({
      ...item,
      evidenceRefs: [...item.evidenceRefs].sort(),
    })),
    evidenceRefs: sortById(candidate.semanticFacts.evidenceRefs),
  };
}

function receipt(input: {
  outcome: ProjectionReceiptV0['outcome'];
  candidateHash: string;
  sourceDigest: string;
  recheckedSourceDigest: string;
  revisionId: string | null;
  retainedRevisionId: string | null;
  checkedAt: string;
  diagnostics: ProjectionDiagnosticV0[];
}): ProjectionReceiptV0 {
  return { schemaVersion: 0, ...input };
}

function rejectedState(
  status: 'NEEDS_FIX' | 'STALE',
  candidateHash: string,
  sourceDigest: string,
  recheckedSourceDigest: string,
  checkedAt: string,
  previous: VerifiedProjectionRevisionV0 | null,
  diagnostics: ProjectionDiagnosticV0[],
): ProjectionBuildStateV0 {
  return {
    status,
    current: previous,
    diagnostics,
    receipt: receipt({
      outcome: status,
      candidateHash,
      sourceDigest,
      recheckedSourceDigest,
      revisionId: null,
      retainedRevisionId: previous?.revisionId ?? null,
      checkedAt,
      diagnostics,
    }),
  };
}

export function verifyProjectionCandidate(
  input: unknown,
  previous: VerifiedProjectionRevisionV0 | null,
  options: ProjectionVerificationOptionsV0,
): ProjectionBuildStateV0 {
  const checkedAt = options.now?.() ?? new Date().toISOString();
  const candidateHash = computePacketHash(input);
  const sourceDigest = sourceDigestFromUnknown(input);
  const retained = eligiblePrevious(previous, projectIdFromUnknown(input));
  const structural = validateProjectionCandidate(input);
  if (!structural.ok) {
    return rejectedState(
      'NEEDS_FIX',
      candidateHash,
      sourceDigest,
      sourceDigest,
      checkedAt,
      retained,
      structural.diagnostics,
    );
  }

  const semanticDiagnostics = validateProjectionSemantics(structural.candidate);
  if (semanticDiagnostics.length > 0) {
    return rejectedState(
      'NEEDS_FIX',
      candidateHash,
      structural.candidate.sourceBinding.sourceDigest,
      structural.candidate.sourceBinding.sourceDigest,
      checkedAt,
      retained,
      semanticDiagnostics,
    );
  }

  const recheckedSourceDigest = options.recheckSourceDigest();
  if (recheckedSourceDigest !== structural.candidate.sourceBinding.sourceDigest) {
    const diagnostics = [normalizeProjectionDiagnostic({
      code: 'projection/input-changed',
      severity: 'error',
      message: 'Projection source facts changed while the candidate was being verified.',
      subject: { projectId: structural.candidate.scope.projectId },
      evidence: {
        candidateSourceDigest: structural.candidate.sourceBinding.sourceDigest,
        recheckedSourceDigest,
      },
      supportedFixes: ['compile a fresh candidate from the latest source facts'],
    })];
    return rejectedState(
      'STALE',
      candidateHash,
      structural.candidate.sourceBinding.sourceDigest,
      recheckedSourceDigest,
      checkedAt,
      retained,
      diagnostics,
    );
  }

  const semanticHash = computePacketHash(semanticFactsForHash(structural.candidate));
  const layoutHash = computePacketHash(structural.candidate.layoutState);
  const revisionHash = computePacketHash({
    schemaVersion: 0,
    scope: structural.candidate.scope,
    sourceDigest: structural.candidate.sourceBinding.sourceDigest,
    semanticHash,
    layoutHash,
  });
  const revisionId = `projection:${revisionHash}`;

  if (retained?.revisionHash === revisionHash) {
    return {
      status: 'VERIFIED',
      current: retained,
      diagnostics: [],
      receipt: receipt({
        outcome: 'VERIFIED',
        candidateHash,
        sourceDigest: structural.candidate.sourceBinding.sourceDigest,
        recheckedSourceDigest,
        revisionId: retained.revisionId,
        retainedRevisionId: retained.revisionId,
        checkedAt,
        diagnostics: [],
      }),
    };
  }

  const current: VerifiedProjectionRevisionV0 = {
    schemaVersion: 0,
    revisionId,
    revisionHash,
    semanticHash,
    layoutHash,
    sourceDigest: structural.candidate.sourceBinding.sourceDigest,
    verifiedAt: checkedAt,
    ...(retained ? { previousRevisionId: retained.revisionId } : {}),
    candidate: structural.candidate,
  };
  return {
    status: 'VERIFIED',
    current,
    diagnostics: [],
    receipt: receipt({
      outcome: 'VERIFIED',
      candidateHash,
      sourceDigest: structural.candidate.sourceBinding.sourceDigest,
      recheckedSourceDigest,
      revisionId,
      retainedRevisionId: null,
      checkedAt,
      diagnostics: [],
    }),
  };
}

export function buildVerifiedProjection(
  input: ProjectionFactInputV0,
  previous: VerifiedProjectionRevisionV0 | null,
  options: ProjectionBuildOptionsV0 = {},
): ProjectionBuildStateV0 {
  const candidate = compileProjectionCandidate(input);
  return verifyProjectionCandidate(candidate, previous, {
    recheckSourceDigest: options.recheckSourceDigest
      ?? (() => computeProjectionSourceDigest(input, candidate)),
    ...(options.now ? { now: options.now } : {}),
  });
}
