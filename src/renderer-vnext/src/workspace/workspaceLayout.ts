import type { WorkGraphRevision } from '../../../core/workgraph/revision';
import type { WorkGraphNode } from '../../../core/workgraph/types';

/**
 * Semantic spatial model for the Work Graph workspace (GOAL MODE rebuild).
 *
 * Not an auto-layout dump: nodes are grouped into visual REGIONS by their
 * real relations, then placed into semantic LANES inside each region —
 *
 *   [Project anchor]  [ knowledge input ]  [ TASK core ]  [ activity ]  [ output ]
 *    project            context/memory       tasks           conversations  artifacts
 *                                        (per Work)      executions
 *                                                        gates/evidence strip along
 *                                                        the bottom (verification)
 *
 * Deterministic: same revision → same geometry. Layout owns ONLY presentation
 * coordinates; it never mutates semantic facts.
 */

export type NodeFamily =
  | 'project' | 'work' | 'task' | 'conversation' | 'execution'
  | 'context' | 'gate' | 'evidence' | 'artifact' | 'memory' | 'handoff';

export interface WorkspaceNode {
  id: string;
  family: NodeFamily;
  label: string;
  node: WorkGraphNode;
  /** Absolute canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Region (Work) this node lives in, when it has one. */
  regionId: string | null;
  /** Row within its lane — used for focus ordering and region height. */
  lane: string | null;
}

export interface WorkspaceLaneDescriptor {
  key: string;
  label: string;
  width: number;
}

export interface WorkspaceRegion {
  id: string;
  workId: string | null;
  label: string;
  currentness: string;
  x: number;
  y: number;
  width: number;
  height: number;
  taskCount: number;
  verificationCount: number;
}

export interface WorkspaceLayout {
  nodes: WorkspaceNode[];
  regions: WorkspaceRegion[];
  projectAnchor: { x: number; y: number; width: number; height: number } | null;
  bounds: { width: number; height: number };
}

// ---- tier sizing (dense but readable) ----
const SIZE: Record<NodeFamily, { w: number; h: number }> = {
  project: { w: 190, h: 58 },
  work: { w: 0, h: 0 },          // work renders as its region header, not a card
  task: { w: 200, h: 52 },
  conversation: { w: 178, h: 40 },
  execution: { w: 178, h: 44 },
  context: { w: 174, h: 38 },
  gate: { w: 174, h: 38 },
  evidence: { w: 174, h: 34 },
  artifact: { w: 174, h: 38 },
  memory: { w: 174, h: 38 },
  handoff: { w: 178, h: 44 },
};

const REGION_PAD_X = 18;
const REGION_HEADER_H = 44;
const VERIFY_STRIP_H = 8;
const COL_GAP = 32;
const ROW_GAP = 12;
const REGION_GAP = 56;

export function familyOf(node: WorkGraphNode): NodeFamily {
  switch (node.kind) {
    case 'project': return 'project';
    case 'work': return 'work';
    case 'task': return 'task';
    case 'conversation': return 'conversation';
    case 'execution': return 'execution';
    case 'artifact': return 'artifact';
    case 'evidence': return 'evidence';
    case 'handoff': return 'handoff';
    case 'memory-source': return 'memory';
    case 'gate': return 'gate';
    case 'context':
      // Staging-family refinements: governance gates and canonical pointers
      // read differently from ordinary knowledge context.
      if (node.id.startsWith('gate:')) return 'gate';
      return 'context';
    default: return 'context';
  }
}

interface Assigned {
  node: WorkGraphNode;
  family: NodeFamily;
  regionId: string | null;
}

/**
 * Partition nodes into Work regions via EXACT declared relations only:
 * task.workId, execution.workId, artifact.taskId→task.workId, or a
 * membership edge from the Work node. Never by proximity heuristics.
 */
function assignRegions(nodes: WorkGraphNode[], edges: { kind: string; source: string; target: string }[]): Map<string, Assigned[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const taskIdToWork = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === 'task' && node.workId) taskIdToWork.set(node.taskId ?? node.id, node.workId);
  }
  const regionOf = new Map<string, string>();
  const workNodes = nodes.filter((node) => node.kind === 'work');
  const workById = new Map(workNodes.map((node) => [node.id, node]));

  const resolveWorkId = (node: WorkGraphNode): string | null => {
    if (node.kind === 'work') return node.workId;
    if (node.kind === 'task' && node.workId) return node.workId;
    const declared = regionOf.get(node.id);
    if (declared) return declared;
    // membership from a Work node — exact structural edge
    const membership = edges.find((edge) =>
      (edge.target === node.id && edge.kind === 'membership')
      && workById.has(edge.source));
    if (membership) return workById.get(membership.source)!.workId;
    // artifact via its exact task relation
    if (node.kind === 'artifact' && node.taskId) {
      const workId = taskIdToWork.get(node.taskId);
      if (workId) return workId;
    }
    // execution via exact task lineage
    if (node.kind === 'execution' && node.taskId) {
      const workId = taskIdToWork.get(node.taskId);
      if (workId) return workId;
    }
    return null;
  };

  // Work nodes first, then everyone that resolves through them.
  for (const node of nodes) {
    if (node.kind === 'project') continue;
    const workId = resolveWorkId(node);
    if (workId) regionOf.set(node.id, workId);
  }
  const regions = new Map<string, Assigned[]>();
  for (const node of nodes) {
    if (node.kind === 'project') continue;
    const family = familyOf(node);
    if (family === 'work') continue;
    const workId = regionOf.get(node.id);
    if (!workId) continue;
    const regionId = `region:${node.projectId}:${workId}`;
    const list = regions.get(regionId) ?? [];
    list.push({ node, family, regionId });
    regions.set(regionId, list);
  }
  return regions;
}

const LANE_ORDER: NodeFamily[][] = [
  ['context', 'memory'],
  ['task'],
  ['conversation', 'execution', 'handoff'],
  ['artifact'],
];

function laneIndexFor(family: NodeFamily): number {
  const index = LANE_ORDER.findIndex((lanes) => lanes.includes(family));
  return index === -1 ? 2 : index;
}

export function buildWorkspaceLayout(revision: WorkGraphRevision): WorkspaceLayout {
  const facts = revision.candidate.semanticFacts;
  const edges = facts.edges.map((edge) => ({ kind: edge.kind, source: edge.source, target: edge.target }));
  const project = facts.nodes.find((node) => node.kind === 'project');
  const regionsMap = assignRegions(facts.nodes, edges);
  /** Node ids claimed by a Work region (placed below). */
  const regionedIds = new Set<string>();
  for (const assigned of regionsMap.values()) {
    for (const item of assigned) regionedIds.add(item.node.id);
  }
  for (const node of facts.nodes) {
    if (node.kind === 'work') regionedIds.add(node.id);
  }

  const nodes: WorkspaceNode[] = [];
  const regions: WorkspaceRegion[] = [];

  // ---- Project anchor column ----
  const anchorX = 24;
  let projectAnchor: WorkspaceLayout['projectAnchor'] = null;
  let knowledgeTop = 24;
  if (project) {
    const size = SIZE.project;
    const anchorY = 120;
    nodes.push({
      id: project.id, family: 'project', label: project.label, node: project,
      x: anchorX, y: anchorY, width: size.w, height: size.h, regionId: null, lane: 'project',
    });
    projectAnchor = { x: anchorX, y: anchorY, width: size.w, height: size.h };
    // Project-scoped knowledge (context/gates/memory not inside any Work)
    // becomes the intelligence column beside the anchor.
    knowledgeTop = anchorY + size.h + 28;
  }

  // ---- Work regions ----
  // Horizontal flow: [project+knowledge] -> [Work regions]. The knowledge
  // strip reserves up to two 174px columns beside the anchor, so regions
  // start clear of it.
  const scopedCount = project
    ? facts.nodes.filter((node) => node.kind !== 'project' && node.kind !== 'work' && !regionedIds.has(node.id)).length
    : 0;
  const knowledgeColumns = Math.min(2, Math.ceil(scopedCount / 2));
  const knowledgeWidth = knowledgeColumns === 0 ? 0 : knowledgeColumns * 174 + (knowledgeColumns - 1) * 12;
  const flowX = anchorX + Math.max(SIZE.project.w, knowledgeWidth) + 48;

  const workByWorkId = new Map<string, Extract<WorkGraphNode, { kind: 'work' }>>();
  for (const node of facts.nodes) {
    if (node.kind === 'work') workByWorkId.set(node.workId, node);
  }
  let regionY = 24;
  const regionEntries = [...regionsMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [regionId, assigned] of regionEntries) {
    const workId = regionId.slice(regionId.lastIndexOf(':') + 1);
    const workNode = workByWorkId.get(workId);
    const label = workNode?.label ?? workId;
    const currentness = workNode?.currentness ?? 'UNKNOWN';

    // verification strip = gates + evidence inside this region
    const verify = assigned.filter((item) => item.family === 'gate' || item.family === 'evidence');
    const laned = assigned.filter((item) => item.family !== 'gate' && item.family !== 'evidence');

    // bucket into lanes, then rows
    const lanes: Assigned[][] = LANE_ORDER.map(() => []);
    for (const item of laned) lanes[laneIndexFor(item.family)].push(item);

    const occupied = LANE_ORDER
      .map((laneKeys, index) => ({ keys: laneKeys, index, items: lanes[index] }))
      .filter((lane) => lane.items.length > 0);
    const laneDescriptors: WorkspaceLaneDescriptor[] = occupied.map((lane) => ({
      key: lane.keys[0],
      label: lane.keys[0],
      width: SIZE[lane.items[0]!.family].w,
    }));
    const columnWidths = LANE_ORDER.map((_, index) => {
      const family = lanes[index][0]?.family;
      return family ? SIZE[family].w : 0;
    });
    let offsetWithinRegion = REGION_PAD_X;
    const columnX: number[] = [];
    for (let index = 0; index < LANE_ORDER.length; index += 1) {
      columnX.push(offsetWithinRegion);
      const laneWidth = columnWidths[index];
      offsetWithinRegion += laneWidth + (lanes[index].length > 0 ? COL_GAP : 0);
    }

    // Region node positions (absolute; region node is a parent group).
    const maxRows = Math.max(1, ...lanes.map((lane) => lane.length));
    const contentHeight = maxRows === 1 && lanes.every((lane) => lane.length <= 1)
      ? Math.max(...lanes.map((lane) => (lane[0] ? SIZE[lane[0].family].h : 0)), 44)
      : LANE_ORDER.reduce((tallest, _, index) => {
        const laneHeight = lanes[index].reduce((sum, item) => sum + SIZE[item.family].h + ROW_GAP, -ROW_GAP);
        return Math.max(tallest, laneHeight);
      }, 44);
    const verifyHeight = verify.length > 0
      ? verify.reduce((sum, item) => sum + SIZE[item.family].h + ROW_GAP, -ROW_GAP) + 26
      : 0;
    const height = REGION_HEADER_H + contentHeight + (verify.length > 0 ? verifyHeight : 0) + 16;
    const innerWidth = laneDescriptors.reduce((sum, lane) => sum + lane.width, 0)
      + Math.max(0, laneDescriptors.length - 1) * COL_GAP;
    const width = innerWidth + REGION_PAD_X * 2;

    regions.push({
      id: regionId,
      workId: workNode?.workId ?? null,
      label,
      currentness,
      x: flowX,
      y: regionY,
      width,
      height,
      taskCount: lanes[1].length,
      verificationCount: verify.length,
    });

    // place lane nodes (positions relative to region — React Flow parent coords)
    for (let index = 0; index < LANE_ORDER.length; index += 1) {
      let rowY = REGION_HEADER_H;
      for (const item of lanes[index]) {
        const size = SIZE[item.family];
        nodes.push({
          id: item.node.id, family: item.family, label: item.node.label, node: item.node,
          x: columnX[index], y: rowY, width: size.w, height: size.h, regionId, lane: `lane${index}`,
        });
        rowY += size.h + ROW_GAP;
      }
    }
    // verification strip below the lanes
    if (verify.length > 0) {
      let verifyY = REGION_HEADER_H + contentHeight + 18;
      for (const item of verify) {
        const size = SIZE[item.family];
        nodes.push({
          id: item.node.id, family: item.family, label: item.node.label, node: item.node,
          x: REGION_PAD_X, y: verifyY, width: size.w, height: size.h, regionId, lane: 'verify',
        });
        verifyY += size.h + ROW_GAP;
      }
    }

    regionY += height + REGION_GAP;
  }

  // ---- Project-scoped knowledge column (outside every Work region) ----
  // Gates / conversations / unbound knowledge that no Work declares. Arranged
  // in two narrow sub-columns so the strip never becomes a tall wall.
  if (project) {
    const scoped = facts.nodes.filter((node) => {
      if (node.kind === 'project' || node.kind === 'work') return false;
      return !regionedIds.has(node.id);
    });
    // Two semantic groups, never interleaved: governance constraints left,
    // durable activity carriers right, everything else joins governance.
    const governance = scoped.filter((node) => familyOf(node) !== 'conversation');
    const activity = scoped.filter((node) => familyOf(node) === 'conversation');
    const colWidth = 174;
    const colGap = 12;
    let leftY = knowledgeTop;
    let rightY = knowledgeTop;
    for (const [column, group] of [[false, governance], [true, activity]] as const) {
      for (const node of group) {
        const family = familyOf(node);
        const size = SIZE[family];
        const x = anchorX + (column ? colWidth + colGap : 0);
        let y = column ? rightY : leftY;
        nodes.push({
          id: node.id, family, label: node.label, node,
          x, y, width: size.w, height: size.h, regionId: null, lane: 'knowledge',
        });
        y += size.h + 10;
        if (column) rightY = y; else leftY = y;
      }
    }
  }

  const maxX = Math.max(
    ...nodes.map((node) => node.x + node.width),
    ...regions.map((region) => region.x + region.width),
    800,
  );
  const maxY = Math.max(
    ...nodes.map((node) => node.y + node.height),
    ...regions.map((region) => region.y + region.height),
    600,
  );
  return {
    nodes,
    regions,
    projectAnchor,
    bounds: { width: maxX + 60, height: maxY + 60 },
  };
}
