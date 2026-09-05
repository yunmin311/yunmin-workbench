import { useWorkbench, useProjectionReach, useProjectionRoute } from '../store';
import type {
  ProjectionReachEdgeV0,
  SemanticPassportEntityRefV0,
} from '../../../core/projection/types';

/**
 * Temporary, viewer-only focused surface for Projection Reach v0. Opens on
 * demand from a Semantic Passport action; never mutates the projection,
 * never invents an impact reading, and routes node clicks back through the
 * existing Semantic Passport seam.
 */
export function ProjectionReachSurface() {
  const reachOpen = useWorkbench((state) => state.reachOpen);
  const closeReach = useWorkbench((state) => state.closeReach);
  const openPassport = useWorkbench((state) => state.openPassport);
  const openRoute = useWorkbench((state) => state.openRoute);
  const result = useProjectionReach();

  if (!reachOpen) return null;

  const nodePassportRef = (id: string, kind: 'conversation' | 'runtimeExecution' | 'artifactOrEvidence'): SemanticPassportEntityRefV0 => ({ kind, id });

  return (
    <aside className="passport-drawer" role="dialog" aria-label="Projection Reach">
      <header>
        <h3>Projection Reach</h3>
        <span className="passport-source">{reachOpen.direction}</span>
        <button type="button" onClick={closeReach} aria-label="Close reach">×</button>
      </header>
      {result.kind === 'unavailable' ? (
        <p className="passport-empty">
          Current verified projection is not available (STALE / NEEDS_FIX). Reach cannot be computed against a retained last-known-good build.
        </p>
      ) : null}
      {result.kind === 'failure' ? (
        <div className="passport-failure">
          <p><code>{result.failure.code}</code>: {result.failure.message}</p>
        </div>
      ) : null}
      {result.kind === 'reach' ? (
        <div className="passport-content">
          <header>
            <span className="passport-kind">{result.reach.origin.kind}</span>
            <code className="passport-id">{result.reach.origin.id}</code>
            <p className="passport-meta">
              {result.reach.nodes.length} reachable entities · max {result.reach.maximumHops} {result.reach.maximumHops === 1 ? 'hop' : 'hops'} · revision <code>{result.reach.revisionId}</code>
            </p>
          </header>
          <section>
            <h4>Reachable entities</h4>
            {result.reach.nodes.length === 1 ? (
              <p className="passport-empty">Only the origin is reachable; no exact edges leave it in this direction.</p>
            ) : (
              <ol className="reach-list">
                {result.reach.nodes.map((node) => {
                  const isOrigin = node.minimumDepth === 0;
                  const routeFrom: SemanticPassportEntityRefV0 = reachOpen.direction === 'downstream'
                    ? { kind: result.reach.origin.kind, id: result.reach.origin.id }
                    : nodePassportRef(node.id, node.kind);
                  const routeTo: SemanticPassportEntityRefV0 = reachOpen.direction === 'downstream'
                    ? nodePassportRef(node.id, node.kind)
                    : { kind: result.reach.origin.kind, id: result.reach.origin.id };
                  return (
                    <li key={node.id} className="reach-row">
                      <span className="reach-depth">d{node.minimumDepth}</span>
                      <span className="reach-kind">{node.kind}</span>
                      <button
                        type="button"
                        className="reach-id"
                        onClick={() => openPassport(nodePassportRef(node.id, node.kind), 'reach')}
                        title="Open Semantic Passport"
                      >
                        {node.id}
                      </button>
                      {!isOrigin ? (
                        <button
                          type="button"
                          className="reach-action"
                          onClick={() => openRoute(routeFrom, routeTo)}
                          title="Show shortest exact route"
                        >
                          Show Route
                        </button>
                      ) : (
                        <span className="reach-origin-chip">origin</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section>
            <h4>Traversed edges</h4>
            {result.reach.edges.length === 0 ? (
              <p className="passport-empty">No exact edges in the reachable set.</p>
            ) : (
              <ol className="reach-list">
                {result.reach.edges.map((edge) => (
                  <li key={edge.stableEdgeKey} className="reach-row">
                    <span className="reach-kind">{edge.edgeKind}</span>
                    <code className="reach-edge">{edge.source} → {edge.target}</code>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <h4>Limitations</h4>
            <ul className="passport-limitations">
              {result.reach.limitations.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function routeEdgeDetail(edge: ProjectionReachEdgeV0): string[] {
  const lines: string[] = [];
  if (edge.structuralSource) {
    lines.push(`exact structural source: ${edge.structuralSource.entityId} · ${edge.structuralSource.fieldPath}`);
  }
  if (edge.edgeKind === 'handoff') {
    lines.push(`relationId: ${edge.relationId ?? ''}`);
    lines.push(`usedResultRef: ${edge.usedResultRef ?? ''}`);
    lines.push(`evidenceRefs: ${(edge.evidenceRefs ?? []).join(', ') || 'none'}`);
  }
  return lines;
}

/**
 * Temporary, viewer-only focused surface for Projection Route v0. Shows the
 * deterministic minimum-hop path (or an explicit not-found answer).
 */
export function ProjectionRouteSurface() {
  const routeOpen = useWorkbench((state) => state.routeOpen);
  const closeRoute = useWorkbench((state) => state.closeRoute);
  const result = useProjectionRoute();

  if (!routeOpen) return null;

  return (
    <aside className="passport-drawer" role="dialog" aria-label="Projection Route">
      <header>
        <h3>Projection Route</h3>
        <button type="button" onClick={closeRoute} aria-label="Close route">×</button>
      </header>
      {result.kind === 'unavailable' ? (
        <p className="passport-empty">
          Current verified projection is not available. Route cannot be computed against a retained last-known-good build.
        </p>
      ) : null}
      {result.kind === 'failure' ? (
        <div className="passport-failure">
          <p><code>{result.failure.code}</code>: {result.failure.message}</p>
        </div>
      ) : null}
      {result.kind === 'route' ? (
        <div className="passport-content">
          <header>
            <span className="passport-kind">route</span>
            <code className="passport-id">{result.route.from.id} → {result.route.to.id}</code>
            <p className="passport-meta">
              {result.route.found
                ? `${result.route.hops} ${result.route.hops === 1 ? 'hop' : 'hops'} · revision ${result.route.revisionId}`
                : `no directed path · revision ${result.route.revisionId}`}
            </p>
          </header>
          <section>
            <h4>Steps</h4>
            {!result.route.found ? (
              <p className="passport-empty">
                No directed path of exact relations exists in this direction. Unreachable is a normal answer, not a failure.
              </p>
            ) : result.route.steps.length === 0 ? (
              <p className="passport-empty">from and to are the same entity; zero hops.</p>
            ) : (
              <ol className="route-steps">
                {result.route.steps.map((step, index) => (
                  <li key={step.edge.stableEdgeKey} className="route-step">
                    <header>
                      <span className="reach-depth">hop {index + 1}</span>
                      <span className="reach-kind">{step.edge.edgeKind}</span>
                    </header>
                    <code className="reach-edge">{step.from} → {step.to}</code>
                    {routeEdgeDetail(step.edge).map((line) => (
                      <p key={line} className="passport-meta">{line}</p>
                    ))}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <h4>Limitations</h4>
            <ul className="passport-limitations">
              {result.route.limitations.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
