import type { WorkGraphRevision } from '../../../core/workgraph/revision';
import type { WorkGraphEdge, WorkGraphNode } from '../../../core/workgraph/types';
import { buildWorkspaceLayout, familyOf } from '../workspace/workspaceLayout';
import type {
  SpatialObject,
  SpatialObjectFamily,
  SpatialPoint,
  SpatialRelation,
  SpatialRelationCategory,
} from './dshSpatialMath';
import { firstAvailableObjectPosition } from './dshSpatialMath';

export interface SpatialGroup {
  id: string;
  workId: string;
  label: string;
  position: SpatialPoint;
  size: { width: number; height: number };
  taskCount: number;
  hiddenTaskCount: number;
  expanded: boolean;
  collapsed: boolean;
}

export interface SpatialProjection {
  projectId: string;
  objects: SpatialObject[];
  groups: SpatialGroup[];
  relations: SpatialRelation[];
}

export interface BuildSpatialProjectionOptions {
  selectedId: string | null;
  expandedWorkIds: ReadonlySet<string>;
  collapsedWorkIds: ReadonlySet<string>;
  savedPositions: Readonly<Record<string, SpatialPoint>>;
}

const OBJECT_SIZE: Record<SpatialObjectFamily, { width: number; height: number }> = {
  project: { width: 190, height: 82 },
  work: { width: 208, height: 142 },
  task: { width: 200, height: 132 },
  conversation: { width: 184, height: 88 },
  execution: { width: 184, height: 88 },
  context: { width: 176, height: 74 },
  memory: { width: 176, height: 74 },
  artifact: { width: 176, height: 82 },
  gate: { width: 176, height: 82 },
  evidence: { width: 176, height: 74 },
  handoff: { width: 184, height: 88 },
};

function relationCategory(kind: WorkGraphEdge['kind']): SpatialRelationCategory {
  if (kind === 'membership' || kind === 'depends-on' || kind === 'blocked-by') return 'structural';
  if (kind === 'execution-of') return 'runtime';
  return 'observed';
}

function semanticFamily(node: WorkGraphNode): SpatialObjectFamily {
  return familyOf(node) as SpatialObjectFamily;
}

function objectFromSemantic(
  node: WorkGraphNode,
  position: SpatialPoint,
  groupId: string | null,
  savedPositions: Readonly<Record<string, SpatialPoint>>,
): SpatialObject {
  const family = semanticFamily(node);
  return {
    id: node.id,
    family,
    label: node.label,
    position: savedPositions[node.id] ?? position,
    size: OBJECT_SIZE[family],
    groupId,
    semantic: node,
  };
}

function chosenTasks(tasks: WorkGraphNode[], selectedId: string | null, expanded: boolean): WorkGraphNode[] {
  if (expanded) return tasks;
  const selectedIndex = selectedId ? tasks.findIndex((task) => task.id === selectedId) : -1;
  return selectedIndex >= 3 ? [...tasks.slice(0, 2), tasks[selectedIndex]!] : tasks.slice(0, 3);
}

/**
 * Workbench adapter around the DSH spatial substrate. It maps exact semantic
 * facts to presentation objects and groups; it never writes semantic state.
 */
export function buildSpatialProjection(
  revision: WorkGraphRevision,
  options: BuildSpatialProjectionOptions,
): SpatialProjection {
  const facts = revision.candidate.semanticFacts;
  const layout = buildWorkspaceLayout(revision);
  const objects: SpatialObject[] = [];
  const naturalOccupied: SpatialObject[] = [];
  const groups: SpatialGroup[] = [];
  const visibleIds = new Set<string>();
  const workById = new Map(
    facts.nodes.filter((node): node is Extract<WorkGraphNode, { kind: 'work' }> => node.kind === 'work')
      .map((node) => [node.workId, node]),
  );

  const project = facts.nodes.find((node) => node.kind === 'project');
  if (project && layout.projectAnchor) {
    const natural = { x: layout.projectAnchor.x, y: layout.projectAnchor.y };
    objects.push(objectFromSemantic(project, natural, null, options.savedPositions));
    naturalOccupied.push(objectFromSemantic(project, natural, null, {}));
    visibleIds.add(project.id);
  }

  for (const region of layout.regions) {
    if (!region.workId) continue;
    const work = workById.get(region.workId);
    if (!work) continue;
    const collapsed = options.collapsedWorkIds.has(region.workId);
    const expanded = options.expandedWorkIds.has(region.workId);
    const tasks = facts.nodes
      .filter((node): node is Extract<WorkGraphNode, { kind: 'task' }> => node.kind === 'task' && node.workId === region.workId)
      .sort((left, right) => left.taskId.localeCompare(right.taskId, undefined, { numeric: true }));
    const visibleTasks = collapsed ? [] : chosenTasks(tasks, options.selectedId, expanded);
    const columns = 3;
    const rowCount = Math.max(1, Math.ceil(visibleTasks.length / columns));
    const groupWidth = Math.max(860, region.width);
    const groupHeight = collapsed ? 190 : expanded ? Math.max(430, 68 + rowCount * 164) : 430;
    const group: SpatialGroup = {
      id: region.id,
      workId: region.workId,
      label: region.label,
      position: { x: region.x, y: region.y },
      size: { width: groupWidth, height: groupHeight },
      taskCount: tasks.length,
      hiddenTaskCount: tasks.length - visibleTasks.length,
      expanded,
      collapsed,
    };
    groups.push(group);

    const workPosition = { x: region.x + 28, y: region.y + (collapsed || expanded ? 34 : 154) };
    objects.push(objectFromSemantic(work, workPosition, group.id, options.savedPositions));
    naturalOccupied.push(objectFromSemantic(work, workPosition, group.id, {}));
    visibleIds.add(work.id);

    visibleTasks.forEach((task, index) => {
      const column = expanded ? index % columns : index;
      const row = expanded ? Math.floor(index / columns) : 0;
      const position = expanded
        ? { x: region.x + 270 + column * 220, y: region.y + 34 + row * 164 }
        : { x: region.x + 270 + column * 196, y: region.y + 76 + (index === 1 ? 102 : index === 2 ? 204 : 0) };
      objects.push(objectFromSemantic(task, position, group.id, options.savedPositions));
      naturalOccupied.push(objectFromSemantic(task, position, group.id, {}));
      visibleIds.add(task.id);
    });
  }

  // Progressive disclosure: a selected object's exact direct neighborhood is
  // projected around its Work. Gate/Artifact/Evidence are never permanent
  // dashboard cards and UNKNOWN relations never get invented.
  if (options.selectedId) {
    const neighborIds = new Set<string>([options.selectedId]);
    for (const edge of facts.edges) {
      if (edge.source === options.selectedId) neighborIds.add(edge.target);
      if (edge.target === options.selectedId) neighborIds.add(edge.source);
    }
    const placedById = new Map(layout.nodes.map((placed) => [placed.id, placed]));
    for (const node of facts.nodes) {
      if (!neighborIds.has(node.id) || visibleIds.has(node.id) || node.kind === 'work') continue;
      const placed = placedById.get(node.id);
      const region = placed?.regionId ? layout.regions.find((candidate) => candidate.id === placed.regionId) : undefined;
      const base = placed
        ? { x: (region?.x ?? 0) + placed.x, y: (region?.y ?? 0) + placed.y }
        : { x: 42, y: 260 + objects.length * 94 };
      const family = semanticFamily(node);
      const saved = options.savedPositions[node.id];
      const naturalPosition = firstAvailableObjectPosition(base, OBJECT_SIZE[family], naturalOccupied, 18);
      const position = saved ?? naturalPosition;
      const projected = objectFromSemantic(node, position, placed?.regionId ?? null, options.savedPositions);
      objects.push(projected);
      naturalOccupied.push(objectFromSemantic(node, naturalPosition, placed?.regionId ?? null, {}));
      if (placed?.regionId) {
        const owningGroup = groups.find((group) => group.id === placed.regionId);
        if (owningGroup) {
          owningGroup.size.height = Math.max(
            owningGroup.size.height,
            projected.position.y - owningGroup.position.y + projected.size.height + 28,
          );
        }
      }
      visibleIds.add(node.id);
    }
  }

  // A progressively disclosed neighbor can make a Work group taller after the
  // base workspace layout has positioned the following groups. Reflow only the
  // presentation containers once their final sizes are known. Renderer-owned
  // saved positions stay absolute so reloading cannot apply this offset twice.
  let nextGroupY = Number.NEGATIVE_INFINITY;
  for (const group of [...groups].sort((left, right) => left.position.y - right.position.y)) {
    const originalY = group.position.y;
    const reflowedY = Math.max(originalY, nextGroupY);
    const deltaY = reflowedY - originalY;
    if (deltaY > 0) {
      group.position = { ...group.position, y: reflowedY };
      for (const object of objects) {
        if (object.groupId !== group.id || options.savedPositions[object.id]) continue;
        object.position = { ...object.position, y: object.position.y + deltaY };
      }
    }
    nextGroupY = group.position.y + group.size.height + 48;
  }

  const relations: SpatialRelation[] = facts.edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      category: relationCategory(edge.kind),
      semantic: edge,
    }));

  return { projectId: revision.candidate.scope.projectId, objects, groups, relations };
}
