/**
 * Spatial camera and connector mechanics transplanted from dsh-synapse.
 *
 * Upstream: liangmianya/dsh-synapse app.js
 * Revision: 56935dc1862e7791b212f6eb2dd26404def5a575
 * License: MIT
 * Relevant upstream functions: connectorPath, cacheCardConnectors,
 * refreshCardConnectors, visibleCardIds, zoomCanvas, focusActiveCard.
 *
 * Workbench adaptations are deliberately narrow: object sizes are carried by
 * data instead of donor constants, and camera functions are pure so React can
 * own lifecycle without replacing the donor math.
 */

import type { WorkGraphEdge, WorkGraphNode } from '../../../core/workgraph/types';

export interface SpatialPoint { x: number; y: number }
export interface SpatialSize { width: number; height: number }
export interface SpatialViewport extends SpatialSize {}

export type SpatialObjectFamily =
  | 'project' | 'work' | 'task' | 'conversation' | 'execution'
  | 'context' | 'memory' | 'artifact' | 'gate' | 'evidence' | 'handoff';

export interface SpatialObject {
  id: string;
  family: SpatialObjectFamily;
  label: string;
  position: SpatialPoint;
  size: SpatialSize;
  groupId: string | null;
  semantic: WorkGraphNode | null;
  peripheral?: boolean;
}

export type SpatialRelationCategory = 'structural' | 'observed' | 'runtime';

export interface SpatialRelation {
  id: string;
  source: string;
  target: string;
  kind: WorkGraphEdge['kind'];
  category: SpatialRelationCategory;
  semantic?: WorkGraphEdge;
}

export interface SpatialCameraResult {
  camera: SpatialPoint;
  zoom: number;
}

export const MIN_SPATIAL_ZOOM = 0.6;
export const MAX_SPATIAL_ZOOM = 4;
export const DEFAULT_VIEWPORT_MARGIN = 320;

export function clampSpatialZoom(value: number): number {
  return Math.min(MAX_SPATIAL_ZOOM, Math.max(MIN_SPATIAL_ZOOM, Math.round(value * 100) / 100));
}

/** Donor formula: preserve the world coordinate below the pointer. */
export function zoomCameraAtPoint(
  camera: SpatialPoint,
  currentZoom: number,
  nextZoom: number,
  localPointer: SpatialPoint,
): SpatialCameraResult {
  const zoom = clampSpatialZoom(nextZoom);
  if (zoom === currentZoom) return { camera, zoom };
  const worldX = (localPointer.x - camera.x) / currentZoom;
  const worldY = (localPointer.y - camera.y) / currentZoom;
  return {
    zoom,
    camera: {
      x: localPointer.x - worldX * zoom,
      y: localPointer.y - worldY * zoom,
    },
  };
}

export function panCamera(camera: SpatialPoint, delta: SpatialPoint): SpatialPoint {
  return { x: camera.x + delta.x, y: camera.y + delta.y };
}

function overlapsObject(
  position: SpatialPoint,
  size: SpatialSize,
  other: Pick<SpatialObject, 'position' | 'size'>,
): boolean {
  return position.x < other.position.x + other.size.width
    && position.x + size.width > other.position.x
    && position.y < other.position.y + other.size.height
    && position.y + size.height > other.position.y;
}

/** Donor firstAvailableCardPosition generalized to explicit object sizes. */
export function firstAvailableObjectPosition(
  position: SpatialPoint,
  size: SpatialSize,
  occupied: Array<Pick<SpatialObject, 'position' | 'size'>>,
  verticalGap = 18,
): SpatialPoint {
  const candidate = { x: Math.round(position.x), y: Math.round(position.y) };
  while (true) {
    const collisions = occupied.filter((other) => overlapsObject(candidate, size, other));
    if (collisions.length === 0) return candidate;
    candidate.y = Math.max(...collisions.map((other) => other.position.y + other.size.height + verticalGap));
  }
}

/** Donor behavior: focus from authoritative data, never mounted DOM. */
export function focusCameraOnObject(
  object: Pick<SpatialObject, 'position' | 'size'>,
  viewport: SpatialViewport,
  zoom: number,
): SpatialPoint {
  return {
    x: viewport.width / 2 - (object.position.x + object.size.width / 2) * zoom,
    y: viewport.height / 2 - (object.position.y + object.size.height / 2) * zoom,
  };
}

export function fitCameraToObjects(
  objects: Array<Pick<SpatialObject, 'position' | 'size'>>,
  viewport: SpatialViewport,
  padding = 48,
): SpatialCameraResult & { worldBounds: { x: number; y: number; width: number; height: number } } {
  if (objects.length === 0) {
    return { camera: { x: 0, y: 0 }, zoom: 1, worldBounds: { x: 0, y: 0, width: 0, height: 0 } };
  }
  const left = Math.min(...objects.map((item) => item.position.x));
  const top = Math.min(...objects.map((item) => item.position.y));
  const right = Math.max(...objects.map((item) => item.position.x + item.size.width));
  const bottom = Math.max(...objects.map((item) => item.position.y + item.size.height));
  const width = right - left;
  const height = bottom - top;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampSpatialZoom(Math.min(1, availableWidth / Math.max(1, width), availableHeight / Math.max(1, height)));
  return {
    zoom,
    camera: {
      x: viewport.width / 2 - (left + width / 2) * zoom,
      y: viewport.height / 2 - (top + height / 2) * zoom,
    },
    worldBounds: { x: left, y: top, width, height },
  };
}

/** Donor world-coordinate culling: screen = world * zoom + camera. */
export function visibleObjectIds(
  objects: SpatialObject[],
  camera: SpatialPoint,
  zoom: number,
  viewport: SpatialViewport,
  margin = DEFAULT_VIEWPORT_MARGIN,
): Set<string> {
  const left = (-camera.x - margin) / zoom;
  const right = (viewport.width - camera.x + margin) / zoom;
  const top = (-camera.y - margin) / zoom;
  const bottom = (viewport.height - camera.y + margin) / zoom;
  const visible = new Set<string>();
  for (const object of objects) {
    const { x, y } = object.position;
    if (x + object.size.width < left || x > right || y + object.size.height < top || y > bottom) continue;
    visible.add(object.id);
  }
  return visible;
}

/** Donor cubic route, adapted from constant card size to data-owned ports. */
export function connectorPath(from: Pick<SpatialObject, 'position' | 'size'>, to: Pick<SpatialObject, 'position' | 'size'>): string {
  const fromX = from.position.x + from.size.width;
  const fromY = from.position.y + from.size.height / 2;
  const toX = to.position.x;
  const toY = to.position.y + to.size.height / 2;
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * 0.2));
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
}

/** Donor connector cache: dragging never scans the complete relation layer. */
export function buildIncidentRelationIndex(relations: SpatialRelation[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const relation of relations) {
    for (const id of [relation.source, relation.target]) {
      const incident = index.get(id);
      if (incident) incident.add(relation.id);
      else index.set(id, new Set([relation.id]));
    }
  }
  return index;
}

export function refreshIncidentRelationPaths(
  objectId: string,
  objectsById: ReadonlyMap<string, SpatialObject>,
  relationsById: ReadonlyMap<string, SpatialRelation>,
  incidentIndex: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const changed = new Map<string, string>();
  for (const relationId of incidentIndex.get(objectId) ?? []) {
    const relation = relationsById.get(relationId);
    if (!relation) continue;
    const from = objectsById.get(relation.source);
    const to = objectsById.get(relation.target);
    if (!from || !to) continue;
    changed.set(relation.id, connectorPath(from, to));
  }
  return changed;
}
