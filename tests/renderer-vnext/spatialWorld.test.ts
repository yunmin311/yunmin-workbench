import { describe, expect, it } from 'vitest';
import {
  buildIncidentRelationIndex,
  connectorPath,
  firstAvailableObjectPosition,
  fitCameraToObjects,
  focusCameraOnObject,
  panCamera,
  refreshIncidentRelationPaths,
  visibleObjectIds,
  zoomCameraAtPoint,
  type SpatialObject,
  type SpatialRelation,
} from '../../src/renderer-vnext/src/spatial/dshSpatialMath';
import {
  loadSpatialPositions,
  saveSpatialPosition,
  spatialPositionsKey,
  type SpatialStorage,
} from '../../src/renderer-vnext/src/spatial/spatialPositionStore';
import { buildSpatialProjection } from '../../src/renderer-vnext/src/spatial/workGraphSpatialAdapter';
import { compileWorkGraph } from '../../src/core/workgraph/compiler';
import type { WorkGraphCompileOptions, WorkGraphSourceFacts } from '../../src/core/workgraph/revision';

const object = (id: string, x: number, y: number, width = 200, height = 100): SpatialObject => ({
  id,
  family: 'task',
  label: id,
  position: { x, y },
  size: { width, height },
  groupId: null,
  semantic: null,
});

describe('DSH spatial camera transplant', () => {
  it('keeps the world point under the pointer fixed while clamping zoom to the readable donor range', () => {
    const camera = { x: -120, y: 80 };
    const pointer = { x: 460, y: 240 };
    const before = {
      x: (pointer.x - camera.x) / 1,
      y: (pointer.y - camera.y) / 1,
    };

    const zoomed = zoomCameraAtPoint(camera, 1, 0.1, pointer);
    expect(zoomed.zoom).toBe(0.6);
    expect((pointer.x - zoomed.camera.x) / zoomed.zoom).toBeCloseTo(before.x, 6);
    expect((pointer.y - zoomed.camera.y) / zoomed.zoom).toBeCloseTo(before.y, 6);

    expect(zoomCameraAtPoint(camera, 1, 8, pointer).zoom).toBe(4);
  });

  it('pans without changing zoom and focuses an unmounted data object by world position', () => {
    expect(panCamera({ x: 20, y: 30 }, { x: -12, y: 45 })).toEqual({ x: 8, y: 75 });
    expect(focusCameraOnObject(object('far', 1800, 1200), { width: 900, height: 700 }, 0.8))
      .toEqual({ x: -1070, y: -650 });
  });

  it('fits objects without shrinking below readable zoom and leaves overflow pannable', () => {
    const fitted = fitCameraToObjects([
      object('a', 0, 0),
      object('b', 2600, 1800),
    ], { width: 900, height: 700 }, 40);
    expect(fitted.zoom).toBe(0.6);
    expect(fitted.worldBounds.width).toBe(2800);
    expect(fitted.worldBounds.height).toBe(1900);
  });

  it('culls in world coordinates with a margin instead of using mounted DOM bounds', () => {
    const ids = visibleObjectIds([
      object('visible', 50, 40),
      object('margin', 1040, 50),
      object('far', 4000, 4000),
    ], { x: 0, y: 0 }, 1, { width: 900, height: 700 }, 200);
    expect([...ids]).toEqual(['visible', 'margin']);
  });
});

describe('DSH collision-free placement transplant', () => {
  it('moves a new object below collisions while preserving readable size', () => {
    const placed = firstAvailableObjectPosition(
      { x: 100, y: 80 },
      { width: 200, height: 100 },
      [object('occupied', 100, 80, 200, 100)],
      18,
    );
    expect(placed).toEqual({ x: 100, y: 198 });
  });
});

describe('DSH relation-layer transplant', () => {
  it('routes from explicit visual ports using data positions', () => {
    expect(connectorPath(object('from', 10, 20), object('to', 410, 220)))
      .toBe('M 210 70 C 250 70, 370 270, 410 270');
  });

  it('refreshes only relations incident to the dragged object even when the counterpart is unmounted', () => {
    const objects = new Map([
      ['a', object('a', 0, 0)],
      ['b', object('b', 400, 0)],
      ['c', object('c', 800, 0)],
    ]);
    const relations: SpatialRelation[] = [
      { id: 'ab', source: 'a', target: 'b', kind: 'membership', category: 'structural' },
      { id: 'bc', source: 'b', target: 'c', kind: 'depends-on', category: 'structural' },
      { id: 'ac', source: 'a', target: 'c', kind: 'handoff', category: 'observed' },
    ];
    const index = buildIncidentRelationIndex(relations);
    objects.set('b', object('b', 520, 100));
    const changed = refreshIncidentRelationPaths('b', objects, new Map(relations.map((item) => [item.id, item])), index);
    expect([...changed.keys()]).toEqual(['ab', 'bc']);
    expect(changed.has('ac')).toBe(false);
    expect(changed.get('ab')).toContain('M 200 50');
  });
});

describe('renderer-owned spatial position persistence', () => {
  it('stores positions per project and ignores malformed persisted values', () => {
    const values = new Map<string, string>();
    const storage: SpatialStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    saveSpatialPosition(storage, 'creative-os', 'task:creative-os:T006', { x: 333.4, y: 777.6 });
    saveSpatialPosition(storage, 'work-capsule', 'task:work-capsule:T006', { x: 10, y: 20 });
    expect(loadSpatialPositions(storage, 'creative-os')).toEqual({
      'task:creative-os:T006': { x: 333, y: 778 },
    });
    values.set(spatialPositionsKey('broken'), '{bad');
    expect(loadSpatialPositions(storage, 'broken')).toEqual({});
  });
});

function projectionFacts(): WorkGraphSourceFacts {
  return {
    governanceBindings: [{
      projectId: 'p', workId: 'w', workLabel: 'Current work',
      binding: { projectId: 'p', root: '/repo', canonicalPath: '/repo', observedAt: '2026-09-16T00:00:00.000Z', verification: 'VERIFIED' },
    }],
    historySessions: [], memoryEntries: [], packets: [], handoffs: [], adapterExecutions: [],
    contextItems: [], attentionItems: [], artifacts: [], evidenceItems: [],
    tasks: Array.from({ length: 6 }, (_, index) => ({
      taskId: `T00${index + 1}`,
      projectId: 'p',
      workId: 'w',
      label: `Task ${index + 1}`,
      source: 'canonical',
      sourceRef: `canonical:T00${index + 1}`,
      observedAt: '2026-09-16T00:00:00.000Z',
      verification: 'VERIFIED' as const,
      taskState: index === 4 ? 'active' as const : 'standby' as const,
      evidenceRefs: [],
    })),
  };
}

async function projectionRevision() {
  const options: WorkGraphCompileOptions = {
    projectId: 'p', sourceDigest: 'spatial', facts: projectionFacts(), now: '2026-09-16T00:00:00.000Z',
  };
  const result = await compileWorkGraph(options);
  if (!result.revision) throw new Error('fixture must compile');
  return result.revision;
}

describe('WorkGraph spatial projection adapter', () => {
  it('keeps three default task slots as first two plus the selected later task', async () => {
    const projection = buildSpatialProjection(await projectionRevision(), {
      selectedId: 'task:p:T005',
      expandedWorkIds: new Set(),
      collapsedWorkIds: new Set(),
      savedPositions: {},
    });
    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0]).toMatchObject({ workId: 'w', hiddenTaskCount: 3, expanded: false });
    expect(projection.objects.filter((item) => item.family === 'task').map((item) => item.id))
      .toEqual(['task:p:T001', 'task:p:T002', 'task:p:T005']);
  });

  it('expands every real task at readable object size and keeps containment projection-only', async () => {
    const revision = await projectionRevision();
    const projection = buildSpatialProjection(revision, {
      selectedId: 'task:p:T005',
      expandedWorkIds: new Set(['w']),
      collapsedWorkIds: new Set(),
      savedPositions: {},
    });
    const tasks = projection.objects.filter((item) => item.family === 'task');
    expect(tasks).toHaveLength(6);
    expect(tasks.every((item) => item.size.width >= 188 && item.size.height >= 118)).toBe(true);
    expect(tasks.every((item) => item.groupId === projection.groups[0]!.id)).toBe(true);
    expect(revision.candidate.semanticFacts.nodes.filter((item) => item.kind === 'task')).toHaveLength(6);
  });

  it('collapses only the presentation group and leaves every semantic task intact', async () => {
    const revision = await projectionRevision();
    const projection = buildSpatialProjection(revision, {
      selectedId: null,
      expandedWorkIds: new Set(),
      collapsedWorkIds: new Set(['w']),
      savedPositions: {},
    });
    expect(projection.groups[0]).toMatchObject({ workId: 'w', collapsed: true, hiddenTaskCount: 6 });
    expect(projection.objects.filter((item) => item.family === 'task')).toHaveLength(0);
    expect(projection.objects.filter((item) => item.family === 'work')).toHaveLength(1);
    expect(revision.candidate.semanticFacts.nodes.filter((item) => item.kind === 'task')).toHaveLength(6);
  });

  it('places focus-only neighbors without covering an existing Task object', async () => {
    const raw = projectionFacts();
    raw.adapterExecutions.push({
      executionId: 'run-1', backend: 'native', provider: 'opencode', runtimeRef: 'ses_1',
      projectId: 'p', workId: 'w', taskId: 'T001', runtimeState: 'working', live: true,
      evidenceRefs: [], sourceRef: 'opencode:ses_1',
    });
    const compiled = await compileWorkGraph({ projectId: 'p', sourceDigest: 'neighbors', facts: raw, now: '2026-09-16T00:00:00.000Z' });
    const projection = buildSpatialProjection(compiled.revision!, {
      selectedId: 'task:p:T001',
      expandedWorkIds: new Set(),
      collapsedWorkIds: new Set(),
      savedPositions: {},
    });
    const task = projection.objects.find((item) => item.id === 'task:p:T001')!;
    const execution = projection.objects.find((item) => item.family === 'execution')!;
    const overlaps = task.position.x < execution.position.x + execution.size.width
      && task.position.x + task.size.width > execution.position.x
      && task.position.y < execution.position.y + execution.size.height
      && task.position.y + task.size.height > execution.position.y;
    expect(overlaps).toBe(false);

    const movedProjection = buildSpatialProjection(compiled.revision!, {
      selectedId: 'task:p:T001',
      expandedWorkIds: new Set(),
      collapsedWorkIds: new Set(),
      savedPositions: { 'task:p:T001': { x: task.position.x + 420, y: task.position.y + 260 } },
    });
    expect(movedProjection.objects.find((item) => item.family === 'execution')?.position)
      .toEqual(execution.position);
  });

  it('places multiple Work containment groups without overlap', async () => {
    const raw = projectionFacts();
    raw.governanceBindings.push({
      projectId: 'p', workId: 'w2', workLabel: 'Second work',
      binding: { projectId: 'p', root: '/repo', canonicalPath: '/repo', observedAt: '2026-09-16T00:00:00.000Z', verification: 'VERIFIED' },
    });
    raw.tasks.push({
      taskId: 'T100', projectId: 'p', workId: 'w2', label: 'Second task', source: 'canonical',
      sourceRef: 'canonical:T100', observedAt: '2026-09-16T00:00:00.000Z', verification: 'VERIFIED',
      taskState: 'standby', evidenceRefs: [],
    });
    raw.adapterExecutions.push({
      executionId: 'run-groups', backend: 'native', provider: 'opencode', runtimeRef: 'ses_groups',
      projectId: 'p', workId: 'w', taskId: 'T001', runtimeState: 'working', live: true,
      evidenceRefs: [], sourceRef: 'opencode:ses_groups',
    });
    const compiled = await compileWorkGraph({ projectId: 'p', sourceDigest: 'groups', facts: raw, now: '2026-09-16T00:00:00.000Z' });
    const projection = buildSpatialProjection(compiled.revision!, {
      selectedId: 'task:p:T001',
      expandedWorkIds: new Set(),
      collapsedWorkIds: new Set(),
      savedPositions: {},
    });
    expect(projection.groups).toHaveLength(2);
    const [first, second] = projection.groups;
    expect(second!.position.y).toBeGreaterThanOrEqual(first!.position.y + first!.size.height + 48);
    for (const item of projection.objects.filter((object) => object.groupId === second!.id)) {
      expect(item.position.y).toBeGreaterThanOrEqual(second!.position.y);
      expect(item.position.y + item.size.height).toBeLessThanOrEqual(second!.position.y + second!.size.height);
    }
  });
});
