import { useMemo } from 'react';
import { Background, Controls, MarkerType, Panel, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { projectionStateToCanvas } from '../../../core/projection/canvasProjection';
import type { WbEdgeKind } from '../../../core/types';
import { useWorkbench } from '../store';
import { layoutProjection } from './reasonixProjectionLayout';
import type { SemanticPassportEntityRefV0 } from '../../../core/projection/types';

const EDGE_LABEL: Record<WbEdgeKind, string> = {
  membership: 'membership',
  mount: 'mount',
  execution: 'observed execution',
  handoff: 'observed handoff',
  'data-context': 'observed context',
};

/**
 * Map a Canvas node id (which is the same as the underlying Projection
 * semantic id) to a Semantic Passport entity ref. Returns `null` when the
 * id does not belong to one of the five supported Passport entity kinds.
 */
export function canvasNodeIdToPassportRef(
  nodeId: string,
  revision: { candidate: import('../../../core/projection/types').VerifiedProjectionRevisionV0['candidate'] } | null,
): SemanticPassportEntityRefV0 | null {
  if (!revision) return null;
  const facts = revision.candidate.semanticFacts;
  if (facts.conversations.some((item) => item.id === nodeId)) {
    return { kind: 'conversation', id: nodeId };
  }
  if (facts.runtimeExecutions.some((item) => item.id === nodeId)) {
    return { kind: 'runtimeExecution', id: nodeId };
  }
  if (facts.collaborationRelations.some((item) => item.id === nodeId)) {
    return { kind: 'collaborationRelation', id: nodeId };
  }
  if (facts.artifactsOrEvidence.some((item) => item.id === nodeId)) {
    return { kind: 'artifactOrEvidence', id: nodeId };
  }
  if (facts.evidenceRefs.some((item) => item.id === nodeId)) {
    return { kind: 'evidence', id: nodeId };
  }
  return null;
}

export interface CanvasNodeClickCallbacksV0 {
  openRuntimeInspector: (target: { executionId: string }) => void;
  openPassport: (
    entityRef: SemanticPassportEntityRefV0,
    source: 'canvas' | 'compare',
  ) => void;
  /** Existing conversation navigation behaviour, preserved. */
  selectProjectedConversation: (conversationRef: string) => void;
  setView: (view: 'projects' | 'control' | 'canvas' | 'compare' | 'context' | 'packet') => void;
}

/**
 * Pure decision behind CanvasView.onNodeClick. Exported so the dual-surface
 * contract (Runtime Inspector + Semantic Passport for an exact verified
 * RuntimeExecution; Passport only when the canvas id maps to a verified
 * entity ref) is directly testable without rendering ReactFlow.
 * The production onNodeClick handler must call this exact helper.
 */
export function handleCanvasNodeClick(
  nodeId: string,
  activeRevision: { candidate: import('../../../core/projection/types').VerifiedProjectionRevisionV0['candidate'] } | null,
  callbacks: CanvasNodeClickCallbacksV0,
): void {
  if (nodeId.startsWith('execution:')) {
    // Runtime Inspector remains the surface for live execution
    // interaction; the Semantic Passport covers verified entity
    // details, so the same canvas click opens both. The Passport
    // is only opened for execution ids that exist verbatim in the
    // active verified revision; identity inference is forbidden.
    callbacks.openRuntimeInspector({ executionId: nodeId.slice('execution:'.length) });
    const passportRef = canvasNodeIdToPassportRef(nodeId, activeRevision);
    if (passportRef && passportRef.kind === 'runtimeExecution') {
      callbacks.openPassport(passportRef, 'canvas');
    }
    return;
  }
  if (!nodeId.startsWith('conversation:')) {
    const passportRef = canvasNodeIdToPassportRef(nodeId, activeRevision);
    if (passportRef) {
      callbacks.openPassport(passportRef, 'canvas');
    }
    return;
  }
  // Conversation click: open a Semantic Passport focused on this
  // conversation, and let the existing control-view jump continue to
  // work via the Session composer.
  callbacks.openPassport({ kind: 'conversation', id: nodeId }, 'canvas');
  callbacks.selectProjectedConversation(nodeId);
  callbacks.setView('control');
}

export function CanvasView() {
  const projectId = useWorkbench((state) => state.projectId);
  const projection = useWorkbench((state) => state.projection);
  const selectProjectedConversation = useWorkbench((state) => state.selectProjectedConversation);
  const setView = useWorkbench((state) => state.setView);
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);
  const openPassport = useWorkbench((state) => state.openPassport);

  const { nodes, edges, kinds } = useMemo(() => {
    const canvas = projectionStateToCanvas(projection);
    if (!canvas.graph || !projection.current) {
      return { nodes: [] as Node[], edges: [] as Edge[], kinds: [] as WbEdgeKind[] };
    }
    const semanticEdges = canvas.graph.edges;
    const generated = layoutProjection(canvas.graph.nodes, semanticEdges);
    const positions = projection.current.candidate.layoutState.nodePositions;
    const memoryLayoutId = projection.current.candidate.semanticFacts.artifactsOrEvidence
      .find((item) => item.kind === 'memory-index')?.id;
    const positioned = generated.map((node) => {
      const layoutId = node.id === 'memory:vault' ? memoryLayoutId : node.id;
      const stored = layoutId ? positions[layoutId] : undefined;
      return stored ? { ...node, ...stored } : node;
    });
    const nodes: Node[] = positioned.map((node) => ({
      id: node.id,
      position: { x: node.x, y: node.y },
      data: {
        label: (
          <span className="canvas-node-copy">
            <strong>{node.label}</strong>
            <small>{node.kind}{node.status ? ` · ${node.status}` : ''}</small>
          </span>
        ),
        kind: node.kind,
        status: node.status,
      },
      className: `wb-node wb-${node.kind} status-${(node.status ?? '').toLowerCase()}`,
    }));
    const edges: Edge[] = semanticEdges.map((edge) => {
      const evidenced = edge.kind === 'execution' || edge.kind === 'handoff' || edge.kind === 'data-context';
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Structural availability (membership/mount) reads as a fan from its
        // anchor; observed runtime edges keep routed arrows.
        type: evidenced ? 'smoothstep' : 'default',
        className: `wb-edge-${edge.kind}`,
        markerEnd: { type: evidenced ? MarkerType.ArrowClosed : MarkerType.Arrow, width: 10, height: 10 },
        style: {
          strokeWidth: evidenced ? 1.7 : 1.1,
          strokeDasharray: edge.kind === 'mount' ? '3 5' : undefined,
        },
      };
    });
    return { nodes, edges, kinds: [...new Set(semanticEdges.map((edge) => edge.kind))] };
  }, [projection]);

  if (!projectId) return null;

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.55, maxZoom: 1.15 }}
        minZoom={0.35}
        maxZoom={1.8}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_event, node) => handleCanvasNodeClick(node.id, projection.current, {
          openRuntimeInspector,
          openPassport,
          selectProjectedConversation,
          setView,
        })}
      >
        <Background color="var(--prototype-grid)" gap={22} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="canvas-title">
          <p>Session trajectory</p>
          <span>
            {projection.status === 'VERIFIED'
              ? `Verified projection · ${projection.current?.revisionId.slice(0, 28) ?? 'no revision'}`
              : projection.current
                ? `${projection.status} · showing last verified revision`
                : `${projection.status} · no verified projection available`}
          </span>
          {projection.diagnostics[0]
            ? <span>{projection.diagnostics[0].code}: {projection.diagnostics[0].message}</span>
            : null}
          <span>Native executions and explicit handoffs. Card position never defines lineage.</span>
        </Panel>
        <Panel position="top-right" className="canvas-legend">
          {kinds.map((kind) => <span key={kind}><i className={`legend-line legend-${kind}`} />{EDGE_LABEL[kind]}</span>)}
        </Panel>
      </ReactFlow>
    </div>
  );
}
