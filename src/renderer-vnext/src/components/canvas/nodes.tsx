import { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { WorkGraphNodeData } from '../../workGraphView';


/**
 * Tiered node cards — every entity family has a distinct visual form, not
 * the same card with a different hue. Overview shows only what affects a
 * judgment; provenance stays in Focus Detail.
 */

const FAMILY_ICON: Record<string, string> = {
  project: '◎', work: '◫', task: '◈', conversation: '◌', execution: '▶',
  context: '◇', gate: '¬', evidence: '☰', artifact: '▣', memory: '❖', handoff: '⇥',
};

function VerificationDot({ verification }: { verification: string }) {
  const tone = verification === 'VERIFIED' ? 'is-green'
    : verification === 'OBSERVED' ? 'is-blue'
      : verification === 'INFERRED' ? 'is-amber' : '';
  return <span className={`wb-dot ${tone}`} title={`verification: ${verification}`} />;
}

function CurrentnessChip({ currentness }: { currentness: string }) {
  const tone = currentness === 'CURRENT' ? 'is-green' : currentness === 'STALE' ? 'is-amber' : currentness === 'INVALID' ? 'is-red' : '';
  return <span className={`wb-chip ${tone}`}>{currentness}</span>;
}

function useCommon(node: NodeProps) {
  const { data, selected } = node as NodeProps & { data: WorkGraphNodeData; selected?: boolean };
  return { data, selected: Boolean(selected) };
}

const ProjectNode = memo((props: NodeProps) => {
  const { data, selected } = useCommon(props);
  return (
    <div className={`wb-node wb-node-project${selected ? ' is-focused' : ''}`} data-id={data.semantic.id} data-family={data.family}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="wb-handle" />
      <div className="wb-project-sigil" aria-hidden="true">◎</div>
      <div className="wb-project-body">
        <div className="wb-project-name">{data.label}</div>
        <div className="wb-project-sub">Project workspace</div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="wb-handle" />
    </div>
  );
});
ProjectNode.displayName = 'ProjectNode';

const TaskNode = memo((props: NodeProps) => {
  const { data, selected } = useCommon(props);
  const semantic = data.semantic as Extract<WorkGraphNodeData['semantic'], { kind: 'task' }>;
  const stateTone = semantic.taskState === 'active' ? 'is-green' : 'is-muted';
  return (
    <div className={`wb-node wb-node-task${selected ? ' is-focused' : ''}`} data-id={data.semantic.id} data-family={data.family}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="wb-handle" />
      <div className="wb-task-head">
        <span className="wb-task-sigil" aria-hidden="true">◈</span>
        <span className="wb-node-label">{data.label}</span>
        <CurrentnessChip currentness={'currentness' in semantic ? semantic.currentness : 'UNKNOWN'} />
      </div>
      {semantic.taskState !== 'unknown' && (
        <div className="wb-task-sub">
          <span className={`wb-chip ${stateTone}`}>{semantic.taskState}</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className="wb-handle" />
    </div>
  );
});
TaskNode.displayName = 'TaskNode';

const WorkRegionNode = memo((props: NodeProps) => {
  const { data } = useCommon(props);
  const region = data.region as import('../../workspace/workspaceLayout').WorkspaceRegion | undefined;
  if (!region) return null;
  return (
    <div className="wb-region" data-region={region.id}>
      <div className="wb-region-header">
        <span className="wb-region-sigil" aria-hidden="true">◫</span>
        <span className="wb-region-label" title={region.label}>{region.label}</span>
        <CurrentnessChip currentness={region.currentness} />
        {region.taskCount > 0 && <span className="wb-chip is-violet">{region.taskCount} tasks</span>}
        {region.verificationCount > 0 && <span className="wb-chip">⌐ {region.verificationCount}</span>}
      </div>

    </div>
  );
});
WorkRegionNode.displayName = 'WorkRegionNode';

interface ChipNodeProps {
  extra?: (semantic: WorkGraphNodeData['semantic']) => ReactNode;
}

function makeChipNode(displayName: string, toneClass: string, sigil: string, extra?: ChipNodeProps['extra']) {
  const Component = memo((props: NodeProps) => {
    const { data, selected } = useCommon(props);
    return (
      <div className={`wb-node wb-chip-node ${toneClass}${selected ? ' is-focused' : ''}`} data-id={data.semantic.id} data-family={data.family}>
        <Handle type="target" position={Position.Left} isConnectable={false} className="wb-handle" />
        <span className="wb-chip-sigil" aria-hidden="true">{sigil}</span>
        <span className="wb-node-label" title={data.label}>{data.label}</span>
        <VerificationDot verification={data.verification} />
        {extra?.(data.semantic)}
        <Handle type="source" position={Position.Right} isConnectable={false} className="wb-handle" />
      </div>
    );
  });
  Component.displayName = displayName;
  return Component;
}

const ContextNode = makeChipNode('ContextNode', 'wb-tone-context', '◇');
const MemoryNode = makeChipNode('MemoryNode', 'wb-tone-memory', '❖');
const ArtifactNode = makeChipNode('ArtifactNode', 'wb-tone-artifact', '▣', (semantic) => {
  if (semantic.kind !== 'artifact' || !semantic.taskId) return null;
  return <span className="wb-origin-chip">{semantic.taskId}</span>;
});
const EvidenceNode = makeChipNode('EvidenceNode', 'wb-tone-evidence', '☰');
const GateNode = makeChipNode('GateNode', 'wb-tone-gate', '¬');
const HandoffNode = makeChipNode('HandoffNode', 'wb-tone-blue', '⇥');

const ConversationNode = memo((props: NodeProps) => {
  const { data, selected } = useCommon(props);
  const semantic = data.semantic as Extract<WorkGraphNodeData['semantic'], { kind: 'conversation' }>;
  // conversationKey reads `<project>::<platform>::<role>` — the trailing role
  // is the human-meaningful part; platform becomes the small prefix chip.
  const role = data.label.includes('::') ? data.label.split('::').pop()! : data.label;
  return (
    <div className={`wb-node wb-chip-node wb-tone-conversation${selected ? ' is-focused' : ''}`} data-id={data.semantic.id} data-family={data.family}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="wb-handle" />
      <span className="wb-chip-sigil" aria-hidden="true">◌</span>
      <span className="wb-node-label" title={data.label}>{role}</span>
      <span className="wb-origin-chip">{semantic.platform}</span>
      <span className={`wb-state-dot is-${semantic.runtimeState}`} title={`runtime ${semantic.runtimeState} · task ${semantic.taskState}`} />
      <Handle type="source" position={Position.Right} isConnectable={false} className="wb-handle" />
    </div>
  );
});
ConversationNode.displayName = 'ConversationNode';

const ExecutionNode = memo((props: NodeProps) => {
  const { data, selected } = useCommon(props);
  const semantic = data.semantic as Extract<WorkGraphNodeData['semantic'], { kind: 'execution' }>;
  return (
    <div className={`wb-node wb-node-execution${semantic.live ? ' is-live' : ''}${selected ? ' is-focused' : ''}`} data-id={data.semantic.id} data-family={data.family}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="wb-handle" />
      <span className="wb-chip-sigil" aria-hidden="true">▶</span>
      <span className="wb-node-label">{semantic.provider} · {semantic.runtimeState}</span>
      {semantic.live && <span className="wb-live-pulse" aria-hidden="true" />}
      <Handle type="source" position={Position.Right} isConnectable={false} className="wb-handle" />
    </div>
  );
});
ExecutionNode.displayName = 'ExecutionNode';

export const wbNodeTypes = {
  'wb-project': ProjectNode,
  'wb-task': TaskNode,
  'wb-region': WorkRegionNode,
  'wb-context': ContextNode,
  'wb-memory': MemoryNode,
  'wb-artifact': ArtifactNode,
  'wb-evidence': EvidenceNode,
  'wb-gate': GateNode,
  'wb-handoff': HandoffNode,
  'wb-conversation': ConversationNode,
  'wb-execution': ExecutionNode,
};

export { FAMILY_ICON, CurrentnessChip };
