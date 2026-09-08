import React, { useMemo, useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
} from 'reactflow';
import 'reactflow/dist/style.css';

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

export interface WorkGraphCanvasProps {
  revision: WorkGraphRevisionProps['revision'];
}

interface WorkGraphRevisionProps {
  revision: {
    candidate: {
      scope: { projectId: string };
      semanticFacts: {
        nodes: Array<{
          id: string;
          kind: string;
          label: string;
          projectId: string;
          source: string;
          sourceRef: string;
          observedAt: string;
          verification: string;
          [key: string]: unknown;
        }>;
        edges: Array<{
          id: string;
          kind: string;
          source: string;
          target: string;
          structuralSource: { entityId: string; fieldPath: string };
          evidenceRefs: string[];
          verification: string;
        }>;
      };
    };
  };
}

const kindColorMap: Record<string, string> = {
  project: '#8b5cf6',
  work: '#6366f1',
  task: '#a855f7',
  conversation: '#06b6d4',
  execution: '#f59e0b',
  context: '#84cc16',
  'memory-source': '#ec4899',
  artifact: '#f97316',
  gate: '#ef4444',
  evidence: '#14b8a6',
  handoff: '#eab308',
};

const kindLabelMap: Record<string, string> = {
  project: 'Project',
  work: 'Work',
  task: 'Task',
  conversation: 'Conversation',
  execution: 'Execution',
  context: 'Context',
  'memory-source': 'Memory',
  artifact: 'Artifact',
  gate: 'Gate',
  evidence: 'Evidence',
  handoff: 'Handoff',
};

function nodeColor(kind: string): string {
  return kindColorMap[kind] || '#64748b';
}

function kindLabel(kind: string): string {
  return kindLabelMap[kind] || kind;
}

interface WorkGraphNodeData {
  id: string;
  kind: string;
  label: string;
  verification: string;
  sourceRef: string;
}

function WorkGraphNodeComponent({ data }: { data: { kind: string; label: string; verification: string; sourceRef: string; id: string } }) {
  const { kind, label, verification, sourceRef } = data;
  const color = kindColorMap[kind] || '#64748b';
  const label = kindLabelMap[kind] || kind;

  return (
    <div className="workgraph-node" style={{ borderColor: color }}>
      <div className="node-header">
        <span className="node-kind-badge" style={{ backgroundColor: color }}>
          {label}
        </span>
        <span className="verification-badge">{verification}</span>
      </div>
      <div className="node-label" title={label}>
        {label}
      </div>
      <div className="node-source-ref" title={sourceRef}>
        {sourceRef.length > 48 ? sourceRef.slice(0, 45) + '...' : sourceRef}
      </div>
    </div>
  );
}

interface WorkGraphEdgeData {
  kind: string;
  evidenceRefs: string[];
  verification: string;
}

function WorkGraphEdgeComponent({ data }: { data: { kind: string; evidenceRefs: string[]; verification: string } }) {
  const styleMap: Record<string, { color: string; dash?: string; width: number }> = {
    membership: { color: '#475569', dash: '4,4', width: 1 },
    'depends-on': { color: '#64748b', dash: '6,6', width: 1.5 },
    'uses-context': { color: '#84cc16', dash: '', width: 2 },
    produces: { color: '#f59e0b', dash: '', width: 2 },
    evidences: { color: '#14b8a6', dash: '2,4', width: 2 },
    'blocked-by': { color: '#ef4444', dash: '4,4', width: 2 },
    handoff: { color: '#eab308', dash: '', width: 2.5 },
    'execution-of': { color: '#f59e0b', dash: '', width: 2 },
    'derived-from': { color: '#6366f1', dash: '6,4', width: 1.5 },
    'user-drawn': { color: '#64748b', dash: '8,4', width: 1 },
  };

  const style = styleMap[data.kind] || { color: '#64748b', width: 1 };

  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <marker
          id={`arrowhead-${data.kind}`}
          markerWidth={10}
          markerHeight={10}
          refX={8}
          refY={3}
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={style.color} />
        </marker>
      </defs>
      <path
        stroke={style.color}
        strokeWidth={style.width}
        strokeDasharray={style.dash}
        fill="none"
        markerEnd={`url(#arrowhead-${data.kind})`}
        d="M0,0 L100,0"
      />
      {data.evidenceRefs.length > 0 && (
        <text
          x="50%"
          y="-8"
          textAnchor="middle"
          fontSize="9"
          fill={style.color}
          pointerEvents="none"
        >
          * {data.evidenceRefs.length}
        </text>
      )}
    </svg>
  );
}

const WorkGraphNodeRenderer = ({ data }: { data: { kind: string; label: string; verification: string; sourceRef: string; id: string } }) => {
  const color = kindColorMap[data.kind] || '#64748b';
  const label = kindLabelMap[data.kind] || data.kind;
  return (
    <div className="workgraph-node" style={{ borderColor: color }}>
      <div className="node-header">
        <span className="node-kind-badge" style={{ backgroundColor: color }}>
          {kindLabelMap[data.kind] || data.kind}
        </span>
        <span className="verification-badge">{data.verification}</span>
      </div>
      <div className="node-label" title={data.label}>
        {data.label}
      </div>
      <div className="node-source-ref" title={data.sourceRef}>
        {data.sourceRef.length > 48 ? data.sourceRef.slice(0, 45) + '…' : data.sourceRef}
      </div>
    </div>
  );
}

function WorkGraphEdgeRenderer({ data }: { data: { kind: string; evidenceRefs: string[]; verification: string } }) {
  const styleMap = {
    membership: { color: '#475569', dash: '4,4', width: 1 },
    'depends-on': { color: '#64748b', dash: '6,6', width: 1.5 },
    'uses-context': { color: '#84cc16', dash: '', width: 2 },
    produces: { color: '#f59e0b', dash: '', width: 2 },
    evidences: { color: '#14b8a6', dash: '2,4', width: 2 },
    'blocked-by': { color: '#ef4444', dash: '4,4', width: 2 },
    handoff: { color: '#eab308', dash: '', width: 2.5 },
    'execution-of': { color: '#f59e0b', dash: '', width: 2 },
    'derived-from': { color: '#6366f1', dash: '6,4', width: 1.5 },
    'user-drawn': { color: '#64748b', dash: '8,4', width: 1 },
  };
  const style = styleMap[data.kind] || { color: '#64748b', width: 1 };
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <marker
          id={`arrowhead-${data.kind}`}
          markerWidth={10}
          markerHeight={10}
          refX={8}
          refY={3}
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={style.color} />
        </marker>
      </defs>
      <path
        stroke={style.color}
        strokeWidth={style.width}
        strokeDasharray={style.dash}
        fill="none"
        markerEnd={`url(#arrowhead-${data.kind})`}
        d="M0,0 L100,0"
      />
      {data.evidenceRefs.length > 0 && (
        <text
          x="50%"
          y="-8"
          textAnchor="middle"
          fontSize="9"
          fill={style.color}
          pointerEvents="none"
        >
          * {data.evidenceRefs.length}
        </text>
      )}
    </svg>
  );
}

const nodeTypes = {
  workgraph: WorkGraphNodeComponent,
};

const edgeTypes = {
  workgraph: WorkGraphEdgeComponent,
};

interface WorkGraphRevisionData {
  revision: {
    candidate: {
      scope: { projectId: string };
      semanticFacts: {
        nodes: Array<{
          id: string;
          kind: string;
          label: string;
          projectId: string;
          source: string;
          sourceRef: string;
          observedAt: string;
          verification: string;
          [key: string]: unknown;
        }>;
        edges: Array<{
          id: string;
          kind: string;
          source: string;
          target: string;
          structuralSource: { entityId: string; fieldPath: string };
          evidenceRefs: string[];
          verification: string;
        }>;
      };
    };
  };
}

export function WorkGraphCanvas({ revision }: { revision: WorkGraphRevisionProps['revision'] }) {
const buildGraphData = (rev: typeof revision): { nodes: any[]; edges: any[] } => {
    const nodes = rev.candidate.semanticFacts.nodes.map((n) => ({
      id: n.id,
      type: 'workgraph',
      position: { x: 0, y: 0 },
      data: {
        id: n.id,
        kind: n.kind,
        label: n.label,
        verification: n.verification,
        sourceRef: n.sourceRef,
      },
    });

    const edges = rev.candidate.semanticFacts.edges.map((e) => ({
      id: e.id,
      type: 'workgraph',
      source: e.source,
      target: e.target,
      data: {
        kind: e.kind,
        evidenceRefs: e.evidenceRefs,
        verification: e.verification,
        structuralSource: e.structuralSource,
      },
    }));

    return { nodes, edges };
  };

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => buildGraphData(revision), [revision]);

  const [nodes, setNodes, onNodesChange] = useState([]);
  const [edges, setEdges, onEdgesChange] = useState([]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  const onConnect = (connection: any) => {
    setEdges((eds: any) => [...eds, { ...connection, type: 'workgraph', data: { kind: 'user-drawn' } }]);
  };

  return (
    <div className="workgraph-canvas-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={() => {}}
        onEdgesChange={onEdgesChange}
        onConnect={() => {}}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        attributionPosition="bottom-right"
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <div className="react-flow-background" style={{ position: 'absolute', inset: 0, background: '#0f172a', backgroundSize: '24px 24px', backgroundImage: 'linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)' }} />
      </ReactFlow>
    </div>
  );
}

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
      nodes: Array<{
        id: string;
        kind: string;
        label: string;
        projectId: string;
        source: string;
        sourceRef: string;
        observedAt: string;
        verification: string;
        [key: string]: unknown;
      }>;
      edges: Array<{
        id: string;
        kind: string;
        source: string;
        target: string;
        structuralSource: { entityId: string; fieldPath: string };
        evidenceRefs: string[];
        verification: string;
      }>;
    };
  };
}
