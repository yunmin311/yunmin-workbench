export interface WorkGraphNode {
  id: string;
  kind: string;
  label: string;
  projectId: string;
  source: string;
  sourceRef: string;
  observedAt: string;
  verification: string;
  [key: string]: unknown;
}

export interface WorkGraphEdge {
  id: string;
  kind: string;
  projectId: string;
  source: string;
  target: string;
  structuralSource: { entityId: string; fieldPath: string };
  evidenceRefs: string[];
  verification: string;
  [key: string]: unknown;
}

export interface WorkGraphRevision {
  revisionId: string;
  candidate: {
    scope: { projectId: string };
    semanticFacts: {
      nodes: WorkGraphNode[];
      edges: WorkGraphEdge[];
    };
  };
}