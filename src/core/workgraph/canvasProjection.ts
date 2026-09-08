/**
 * Canvas-ready projection — pure data view over a verified WorkGraphRevision.
 *
 * Output: nodes[] / edges[] / problems[] / sourceFingerprints[] /
 * revision / hash. No x/y, no zoom, no viewport, no color, no panel
 * state. Layout is the Canvas renderer's job (later phase); node
 * coordinates must never decide lineage.
 */

import type {
  WorkGraphRevision,
  WorkGraphSourceFingerprint,
} from './revision';
import type { WorkGraphEdge, WorkGraphNode } from './types';

export interface WorkGraphCanvasProjection {
  revisionId: string;
  semanticHash: string;
  projectId: string;
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  problems: { source: string; message: string }[];
  sourceFingerprints: WorkGraphSourceFingerprint[];
}

export function toCanvasProjection(revision: WorkGraphRevision): WorkGraphCanvasProjection {
  const facts = revision.candidate.semanticFacts;
  return {
    revisionId: revision.revisionId,
    semanticHash: revision.semanticHash,
    projectId: revision.candidate.scope.projectId,
    nodes: [...facts.nodes],
    edges: [...facts.edges],
    problems: [...facts.problems],
    sourceFingerprints: [...facts.sourceFingerprints],
  };
}
