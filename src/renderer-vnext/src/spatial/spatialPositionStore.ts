import type { SpatialPoint } from './dshSpatialMath';

export interface SpatialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SpatialPositions = Record<string, SpatialPoint>;

export function spatialPositionsKey(projectId: string): string {
  return `yunmin-workbench:spatial-world:v1:${projectId}`;
}

function isFinitePoint(value: unknown): value is SpatialPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<SpatialPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function loadSpatialPositions(storage: SpatialStorage, projectId: string): SpatialPositions {
  try {
    const raw = storage.getItem(spatialPositionsKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, SpatialPoint] => isFinitePoint(entry[1]))
      .map(([id, point]) => [id, { x: Math.round(point.x), y: Math.round(point.y) }]));
  } catch {
    return {};
  }
}

export function saveSpatialPosition(
  storage: SpatialStorage,
  projectId: string,
  objectId: string,
  position: SpatialPoint,
): SpatialPositions {
  const positions = loadSpatialPositions(storage, projectId);
  positions[objectId] = { x: Math.round(position.x), y: Math.round(position.y) };
  storage.setItem(spatialPositionsKey(projectId), JSON.stringify(positions));
  return positions;
}
