import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { WorkGraphRevision } from '../../types';
import {
  buildIncidentRelationIndex,
  connectorPath,
  fitCameraToObjects,
  focusCameraOnObject,
  panCamera,
  refreshIncidentRelationPaths,
  visibleObjectIds,
  zoomCameraAtPoint,
  type SpatialObject,
  type SpatialPoint,
  type SpatialRelation,
  type SpatialViewport,
} from '../../spatial/dshSpatialMath';
import { loadSpatialPositions, saveSpatialPosition, type SpatialPositions } from '../../spatial/spatialPositionStore';
import { buildSpatialProjection } from '../../spatial/workGraphSpatialAdapter';
import './spatialWorld.css';

export interface SpatialWorldHandle {
  fit: () => void;
  focus: (objectId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoom: () => number;
}

export interface SpatialWorldProps {
  revision: WorkGraphRevision;
  selectedId: string | null;
  expandedWorkIds: ReadonlySet<string>;
  collapsedWorkIds: ReadonlySet<string>;
  onSelect: (objectId: string | null) => void;
  onToggleWork: (workId: string) => void;
}

const EMPTY_VIEWPORT: SpatialViewport = { width: 0, height: 0 };

function relationLabel(kind: SpatialRelation['kind']): string {
  switch (kind) {
    case 'membership': return 'Part of';
    case 'depends-on': return 'Depends on';
    case 'blocked-by': return 'Blocked by';
    case 'execution-of': return 'Run of';
    case 'uses-context': return 'Uses';
    case 'produces': return 'Produces';
    case 'evidences': return 'Evidences';
    case 'handoff': return 'Handoff';
    case 'derived-from': return 'Derived from';
    default: return kind;
  }
}

function semanticMeta(object: SpatialObject): string {
  const semantic = object.semantic;
  if (!semantic) return '';
  if (semantic.kind === 'task') return `${semantic.taskId} · ${semantic.taskState}`;
  if (semantic.kind === 'work') return `${semantic.workId} · ${semantic.currentness}`;
  if (semantic.kind === 'execution') return `${semantic.provider} · ${semantic.runtimeState}`;
  return `${semantic.kind} · ${semantic.verification}`;
}

export const SpatialWorld = forwardRef<SpatialWorldHandle, SpatialWorldProps>(function SpatialWorld({
  revision,
  selectedId,
  expandedWorkIds,
  collapsedWorkIds,
  onSelect,
  onToggleWork,
}, forwardedRef) {
  const projectId = revision.candidate.scope.projectId;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const objectElements = useRef(new Map<string, HTMLElement>());
  const objectsByIdRef = useRef(new Map<string, SpatialObject>());
  const initializedProjectRef = useRef<string | null>(null);
  const [viewport, setViewport] = useState<SpatialViewport>(EMPTY_VIEWPORT);
  const [camera, setCamera] = useState<SpatialPoint>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [savedPositions, setSavedPositions] = useState<SpatialPositions>(() => loadSpatialPositions(window.localStorage, projectId));

  useEffect(() => {
    setSavedPositions(loadSpatialPositions(window.localStorage, projectId));
    initializedProjectRef.current = null;
  }, [projectId]);

  const projection = useMemo(() => buildSpatialProjection(revision, {
    selectedId,
    expandedWorkIds,
    collapsedWorkIds,
    savedPositions,
  }), [collapsedWorkIds, expandedWorkIds, revision, savedPositions, selectedId]);

  const relationsById = useMemo(
    () => new Map(projection.relations.map((relation) => [relation.id, relation])),
    [projection.relations],
  );
  const incidentIndex = useMemo(() => buildIncidentRelationIndex(projection.relations), [projection.relations]);
  const relationPaths = useMemo(() => {
    const objects = new Map(projection.objects.map((object) => [object.id, object]));
    return new Map(projection.relations.flatMap((relation) => {
      const from = objects.get(relation.source);
      const to = objects.get(relation.target);
      return from && to ? [[relation.id, connectorPath(from, to)] as const] : [];
    }));
  }, [projection.objects, projection.relations]);

  useLayoutEffect(() => {
    objectsByIdRef.current = new Map(projection.objects.map((object) => [object.id, { ...object, position: { ...object.position } }]));
  }, [projection.objects]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;
    const fitted = fitCameraToObjects(projection.objects, viewport, 54);
    setCamera(fitted.camera);
    setZoom(fitted.zoom);
  }, [projection.objects, viewport]);

  const focus = useCallback((objectId: string) => {
    const object = objectsByIdRef.current.get(objectId);
    if (!object || viewport.width <= 0 || viewport.height <= 0) return;
    setCamera(focusCameraOnObject(object, viewport, zoom));
  }, [viewport, zoom]);

  const zoomAtCenter = useCallback((delta: number) => {
    const next = zoomCameraAtPoint(camera, zoom, zoom + delta, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
    setCamera(next.camera);
    setZoom(next.zoom);
  }, [camera, viewport, zoom]);

  useImperativeHandle(forwardedRef, () => ({
    fit,
    focus,
    zoomIn: () => zoomAtCenter(0.1),
    zoomOut: () => zoomAtCenter(-0.1),
    getZoom: () => zoom,
  }), [fit, focus, zoom, zoomAtCenter]);

  useEffect(() => {
    if (initializedProjectRef.current === projectId || viewport.width <= 0 || projection.objects.length === 0) return;
    initializedProjectRef.current = projectId;
    fit();
  }, [fit, projectId, projection.objects.length, viewport.width]);

  const visibleIds = useMemo(
    () => viewport.width <= 0 ? new Set(projection.objects.map((object) => object.id))
      : visibleObjectIds(projection.objects, camera, zoom, viewport),
    [camera, projection.objects, viewport, zoom],
  );
  const mountedObjects = projection.objects.filter((object) => visibleIds.has(object.id));

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const next = zoomCameraAtPoint(camera, zoom, zoom - event.deltaY * 0.002, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      setCamera(next.camera);
      setZoom(next.zoom);
      return;
    }
    setCamera((current) => panCamera(current, { x: -event.deltaX, y: -event.deltaY }));
  }, [camera, zoom]);

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('.spatial-object, .spatial-controls')) return;
    event.preventDefault();
    onSelect(null);
    const origin = { x: event.clientX, y: event.clientY, camera };
    let nextCamera = camera;
    let frame = 0;
    const content = event.currentTarget.querySelector<HTMLElement>('.spatial-world-content');
    event.currentTarget.classList.add('is-panning');
    const apply = () => {
      frame = 0;
      if (content) content.style.transform = `translate(${nextCamera.x}px, ${nextCamera.y}px) scale(${zoom})`;
    };
    const move = (moveEvent: PointerEvent) => {
      nextCamera = {
        x: origin.camera.x + moveEvent.clientX - origin.x,
        y: origin.camera.y + moveEvent.clientY - origin.y,
      };
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      apply();
      setCamera(nextCamera);
      viewportRef.current?.classList.remove('is-panning');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  }, [camera, onSelect, zoom]);

  const handleObjectPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, object: SpatialObject) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY, position: { ...object.position } };
    let position = origin.position;
    let moved = false;
    let frame = 0;
    element.classList.add('is-dragging');
    const apply = () => {
      frame = 0;
      const live = objectsByIdRef.current.get(object.id);
      if (live) live.position = { ...position };
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
      element.dataset.worldX = String(Math.round(position.x));
      element.dataset.worldY = String(Math.round(position.y));
      const changed = refreshIncidentRelationPaths(object.id, objectsByIdRef.current, relationsById, incidentIndex);
      for (const [relationId, path] of changed) {
        const relationElement = pathRefs.current.get(relationId);
        if (!relationElement) continue;
        relationElement.setAttribute('d', path);
        relationElement.dataset.refresh = String(Number(relationElement.dataset.refresh ?? '0') + 1);
      }
    };
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - origin.x;
      const dy = moveEvent.clientY - origin.y;
      if (Math.hypot(dx, dy) > 3) moved = true;
      position = { x: origin.position.x + dx / zoom, y: origin.position.y + dy / zoom };
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      apply();
      element.classList.remove('is-dragging');
      if (moved) {
        setSavedPositions(saveSpatialPosition(window.localStorage, projectId, object.id, position));
      } else {
        onSelect(object.id);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  }, [incidentIndex, onSelect, projectId, relationsById, zoom]);

  const handleObjectKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, objectId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(objectId);
  }, [onSelect]);

  const worldWidth = Math.max(1200, ...projection.groups.map((group) => group.position.x + group.size.width + 120), ...projection.objects.map((object) => object.position.x + object.size.width + 120));
  const worldHeight = Math.max(800, ...projection.groups.map((group) => group.position.y + group.size.height + 120), ...projection.objects.map((object) => object.position.y + object.size.height + 120));

  return (
    <div
      className="spatial-viewport"
      ref={viewportRef}
      data-camera-x={Math.round(camera.x * 100) / 100}
      data-camera-y={Math.round(camera.y * 100) / 100}
      data-zoom={zoom}
      data-total-objects={projection.objects.length}
      data-mounted-objects={mountedObjects.length}
      onWheel={handleWheel}
      onPointerDown={handleViewportPointerDown}
    >
      <div
        className="spatial-world-content"
        style={{ width: worldWidth, height: worldHeight, transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}
      >
        <div className="spatial-group-layer" aria-hidden="true">
          {projection.groups.map((group) => (
            <div
              className={`spatial-group${group.expanded ? ' is-expanded' : ''}${group.collapsed ? ' is-collapsed' : ''}`}
              data-group-id={group.id}
              key={group.id}
              style={{ left: group.position.x, top: group.position.y, width: group.size.width, height: group.size.height }}
            >
              <span>{group.label}</span><small>{group.taskCount} tasks</small>
            </div>
          ))}
        </div>
        <svg className="spatial-relation-layer" width={worldWidth} height={worldHeight} aria-label="Work relations">
          {projection.relations.map((relation) => (
            <path
              className={`spatial-relation is-${relation.category}`}
              data-relation-id={relation.id}
              data-source={relation.source}
              data-target={relation.target}
              data-kind={relation.kind}
              d={relationPaths.get(relation.id)}
              key={relation.id}
              ref={(element) => {
                if (element) pathRefs.current.set(relation.id, element);
                else pathRefs.current.delete(relation.id);
              }}
            >
              <title>{relationLabel(relation.kind)}</title>
            </path>
          ))}
        </svg>
        <div className="spatial-object-layer">
          {mountedObjects.map((object) => {
            const group = object.groupId ? projection.groups.find((candidate) => candidate.id === object.groupId) : undefined;
            return (
              <article
                className={`spatial-object is-${object.family}${selectedId === object.id ? ' is-selected' : ''}`}
                data-object-id={object.id}
                data-family={object.family}
                data-world-x={Math.round(object.position.x)}
                data-world-y={Math.round(object.position.y)}
                aria-label={`${object.family} ${object.label}`}
                aria-selected={selectedId === object.id}
                key={object.id}
                ref={(element) => {
                  if (element) objectElements.current.set(object.id, element);
                  else objectElements.current.delete(object.id);
                }}
                role="button"
                tabIndex={0}
                style={{
                  left: object.position.x,
                  top: object.position.y,
                  width: object.size.width,
                  height: object.size.height,
                }}
                onPointerDown={(event) => handleObjectPointerDown(event, object)}
                onKeyDown={(event) => handleObjectKeyDown(event, object.id)}
              >
                <span className="spatial-port is-input" aria-hidden="true" />
                <header><small>{object.family.toUpperCase()}</small><span aria-hidden="true">⠿</span></header>
                <strong>{object.label}</strong>
                <p>{semanticMeta(object)}</p>
                {object.family === 'work' && group && (group.hiddenTaskCount > 0 || group.expanded) && (
                  <button
                    type="button"
                    className="spatial-disclosure"
                    aria-label={group.expanded ? `Show fewer tasks in ${group.label}` : `Show ${group.hiddenTaskCount} more tasks in ${group.label}`}
                    onClick={(event) => { event.stopPropagation(); onToggleWork(group.workId); }}
                  >
                    {group.expanded ? 'Show fewer' : `+${group.hiddenTaskCount} more`}
                  </button>
                )}
                <span className="spatial-port is-output" aria-hidden="true" />
              </article>
            );
          })}
        </div>
      </div>
      <div className="spatial-controls" aria-label="Canvas controls">
        <button type="button" aria-label="Fit spatial world" onClick={fit}>Fit</button>
        <button type="button" aria-label="Locate selected object" disabled={!selectedId} onClick={() => selectedId && focus(selectedId)}>Locate</button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
});
