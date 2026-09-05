import { useMemo } from 'react';
import { useWorkbench, useSemanticPassport } from '../store';
import { computeProjectionReach } from '../../../core/projection/reach';
import type {
  ProjectionReachDirectionV0,
  SemanticPassportCurrentV0,
  SemanticPassportDeltaChangeV0,
  SemanticPassportEntityRefV0,
  SemanticPassportEvidenceEntryV0,
  SemanticPassportIdentityV0,
  SemanticPassportV0,
} from '../../../core/projection/types';

function currentnessTone(
  currentness: 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN',
): string {
  if (currentness === 'STALE' || currentness === 'INVALID') return 'is-strong';
  if (currentness === 'UNKNOWN') return 'is-quiet';
  return '';
}

function verificationTone(verification: string): string {
  if (verification === 'VERIFIED') return '';
  if (verification === 'UNVERIFIED' || verification === 'INFERRED' || verification === 'UNKNOWN') return 'is-quiet';
  return 'is-quiet';
}

function classifyTone(name: string): string {
  if (name === 'content' || name === 'runtimeState' || name === 'live' || name === 'binding'
    || name === 'intentState' || name === 'receipt' || name === 'conversationRef'
    || name === 'lifecycle' || name === 'task' || name === 'runtime' || name === 'attention'
    || name === 'identity-metadata' || name === 'topology' || name === 'semantic') {
    return 'is-content';
  }
  return 'is-evidence';
}

function renderIdentity(identity: SemanticPassportIdentityV0): JSX.Element {
  switch (identity.kind) {
    case 'conversation':
      return (
        <dl>
          <div><dt>id</dt><dd><code>{identity.id}</code></dd></div>
          <div><dt>conversationKey</dt><dd><code>{identity.conversationKey}</code></dd></div>
          {identity.canonicalConversationId ? (
            <div><dt>canonicalConversationId</dt><dd><code>{identity.canonicalConversationId}</code></dd></div>
          ) : null}
          <div><dt>role</dt><dd>{identity.role}</dd></div>
          <div><dt>platform</dt><dd><code>{identity.platform}</code></dd></div>
        </dl>
      );
    case 'runtimeExecution':
      return (
        <dl>
          <div><dt>id</dt><dd><code>{identity.id}</code></dd></div>
          <div><dt>executionId</dt><dd><code>{identity.executionId}</code></dd></div>
          <div><dt>nativeRef</dt><dd><code>{identity.nativeRef}</code></dd></div>
          <div><dt>harness</dt><dd><code>{identity.harness}</code></dd></div>
          <div><dt>conversationRef</dt><dd><code>{identity.conversationRef ?? 'null'}</code></dd></div>
        </dl>
      );
    case 'collaborationRelation':
      return (
        <dl>
          <div><dt>id</dt><dd><code>{identity.id}</code></dd></div>
          <div><dt>relationKind</dt><dd><code>{identity.relationKind}</code></dd></div>
        </dl>
      );
    case 'artifactOrEvidence':
      return (
        <dl>
          <div><dt>id</dt><dd><code>{identity.id}</code></dd></div>
          <div><dt>artifactKind</dt><dd><code>{identity.artifactKind}</code></dd></div>
          {identity.executionRef ? (
            <div><dt>executionRef</dt><dd><code>{identity.executionRef}</code></dd></div>
          ) : null}
          {identity.eventRef ? (
            <div><dt>eventRef</dt><dd><code>{identity.eventRef}</code></dd></div>
          ) : null}
        </dl>
      );
    case 'evidence':
      return (
        <dl>
          <div><dt>id</dt><dd><code>{identity.id}</code></dd></div>
          <div><dt>source</dt><dd><code>{identity.source}</code></dd></div>
          <div><dt>sourceRef</dt><dd><code>{identity.sourceRef}</code></dd></div>
        </dl>
      );
  }
}

function renderCurrent(current: SemanticPassportCurrentV0): JSX.Element {
  switch (current.kind) {
    case 'conversation':
      return (
        <dl>
          <div><dt>lifecycle</dt><dd><code>{current.lifecycleState}</code></dd></div>
          <div><dt>task</dt><dd><code>{current.taskState}</code></dd></div>
          <div><dt>runtime</dt><dd><code>{current.runtimeState}</code></dd></div>
          <div><dt>attention</dt><dd><code>{current.attentionState}</code></dd></div>
          <div><dt>verification</dt><dd className={verificationTone(current.verification)}>{current.verification}</dd></div>
        </dl>
      );
    case 'runtimeExecution':
      return (
        <dl>
          <div><dt>runtimeState</dt><dd><code>{current.runtimeState}</code></dd></div>
          <div><dt>live</dt><dd><code>{String(current.live)}</code></dd></div>
          <div><dt>intentState</dt><dd><code>{current.intentState}</code></dd></div>
          <div><dt>binding</dt><dd><code>{current.binding ? JSON.stringify(current.binding) : 'null'}</code></dd></div>
          <div><dt>receipt</dt><dd><code>{current.receipt ? JSON.stringify(current.receipt) : 'null'}</code></dd></div>
        </dl>
      );
    case 'collaborationRelation':
      if (current.relationKind === 'parallel') {
        return (
          <dl>
            <div><dt>relationKind</dt><dd><code>parallel</code></dd></div>
            <div><dt>executionRefs</dt><dd><code>{(current.executionRefs ?? []).join(', ')}</code></dd></div>
          </dl>
        );
      }
      return (
        <dl>
          <div><dt>relationKind</dt><dd><code>handoff</code></dd></div>
          <div><dt>sourceExecutionRef</dt><dd><code>{current.sourceExecutionRef}</code></dd></div>
          <div><dt>targetExecutionRef</dt><dd><code>{current.targetExecutionRef}</code></dd></div>
          <div><dt>usedResultRef</dt><dd><code>{current.usedResultRef}</code></dd></div>
        </dl>
      );
    case 'artifactOrEvidence':
      return (
        <dl>
          <div><dt>title</dt><dd>{current.title}</dd></div>
          {current.content !== undefined ? (
            <div><dt>content</dt><dd><code>{current.content}</code></dd></div>
          ) : null}
          {current.executionRef ? (
            <div><dt>executionRef</dt><dd><code>{current.executionRef}</code></dd></div>
          ) : null}
          {current.eventRef ? (
            <div><dt>eventRef</dt><dd><code>{current.eventRef}</code></dd></div>
          ) : null}
        </dl>
      );
    case 'evidence':
      return (
        <dl>
          <div><dt>verification</dt><dd className={verificationTone(current.verification)}>{current.verification}</dd></div>
          <div><dt>currentness</dt><dd className={currentnessTone(current.currentness)}>{current.currentness}</dd></div>
          <div><dt>source</dt><dd><code>{current.source}</code></dd></div>
          <div><dt>sourceRef</dt><dd><code>{current.sourceRef}</code></dd></div>
          {current.revision ? (
            <div><dt>revision</dt><dd><code>{current.revision.kind}={current.revision.value.slice(0, 12)}…</code></dd></div>
          ) : null}
        </dl>
      );
  }
}

function renderEvidence(evidence: SemanticPassportEvidenceEntryV0[]): JSX.Element {
  if (evidence.length === 0) return <p className="passport-empty">No evidence on this entity.</p>;
  return (
    <ol className="passport-evidence">
      {evidence.map((entry) => (
        <li key={entry.id}>
          <header>
            <code>{entry.id}</code>
            <span className={currentnessTone(entry.currentness)}>{entry.currentness}</span>
            <span className={verificationTone(entry.verification)}>{entry.verification}</span>
          </header>
          <p>
            <code>{entry.source}</code> · <code>{entry.sourceRef}</code>
          </p>
          {entry.revision ? (
            <p>
              revision <code>{entry.revision.kind}={entry.revision.value.slice(0, 12)}…</code>
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function renderDelta(delta: SemanticPassportDeltaChangeV0): JSX.Element {
  if (!delta) {
    return <p className="passport-empty">unchanged</p>;
  }
  return (
    <div className="passport-delta">
      <p>
        status <code>{delta.status}</code>
      </p>
      {delta.classifications.length > 0 ? (
        <p>
          classifications: {delta.classifications.map((c) => <code key={c} className={classifyTone(c)}>{c}</code>).reduce<JSX.Element[]>((acc, el, i) => {
            if (i === 0) return [el];
            return [...acc, <span key={`sep-${i}`}> · </span>, el];
          }, [])}
        </p>
      ) : null}
      {delta.changedFields.length > 0 ? (
        <table>
          <thead>
            <tr><th>path</th><th>kind</th><th>before</th><th>after</th></tr>
          </thead>
          <tbody>
            {delta.changedFields.map((field, index) => (
              <tr key={`${field.path}-${index}`}>
                <td><code>{field.path}</code></td>
                <td><code className={classifyTone(field.kind)}>{field.kind}</code></td>
                <td><code>{JSON.stringify(field.before)}</code></td>
                <td><code>{JSON.stringify(field.after)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function renderPassport(passport: SemanticPassportV0, reachSection?: JSX.Element | null): JSX.Element {
  return (
    <div className="passport-content">
      <header>
        <span className="passport-kind">{passport.entityType}</span>
        <code className="passport-id">{passport.entityRef.id}</code>
      </header>
      <section>
        <h4>Identity</h4>
        {renderIdentity(passport.identity)}
      </section>
      <section>
        <h4>Current (verified)</h4>
        {renderCurrent(passport.current)}
      </section>
      <section>
        <h4>Evidence</h4>
        {renderEvidence(passport.evidence)}
      </section>
      <section>
        <h4>Changes</h4>
        {renderDelta(passport.delta)}
        <p className="passport-meta">
          delta revision <code>{passport.deltaRevisionId ?? 'none'}</code>
        </p>
      </section>
      {reachSection ? (
        <section>
          <h4>Reach</h4>
          {reachSection}
          <p className="passport-meta">Navigation over exact verified relations only; never impact or risk.</p>
        </section>
      ) : null}
      <section>
        <h4>Limitations</h4>
        <ul className="passport-limitations">
          {passport.limitations.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SemanticPassportDrawer() {
  const passportOpen = useWorkbench((state) => state.passportOpen);
  const closePassport = useWorkbench((state) => state.closePassport);
  const openReach = useWorkbench((state) => state.openReach);
  const projection = useWorkbench((state) => state.projection);
  const result = useSemanticPassport();

  // Deterministic reachable counts for the on-demand Reach actions. Only
  // navigable entity kinds get the section; the counts come straight from
  // the Reach core over the active verified revision (origin excluded).
  const reachCounts = useMemo((): {
    entityRef: SemanticPassportEntityRefV0;
    upstream: number | null;
    downstream: number | null;
  } | null => {
    if (result.kind !== 'passport' || !projection.current) return null;
    const kind = result.passport.entityType;
    if (kind !== 'conversation' && kind !== 'runtimeExecution' && kind !== 'artifactOrEvidence') {
      return null;
    }
    const count = (direction: ProjectionReachDirectionV0): number | null => {
      const reach = computeProjectionReach(projection.current!, result.passport.entityRef, direction);
      return reach.ok ? reach.nodes.length - 1 : null;
    };
    return { entityRef: result.passport.entityRef, upstream: count('upstream'), downstream: count('downstream') };
  }, [result, projection.current]);

  const reachSection = reachCounts ? (
    <div className="reach-actions">
      <button type="button" onClick={() => openReach(reachCounts.entityRef, 'upstream')}>
        Upstream ({reachCounts.upstream ?? '—'})
      </button>
      <button type="button" onClick={() => openReach(reachCounts.entityRef, 'downstream')}>
        Downstream ({reachCounts.downstream ?? '—'})
      </button>
    </div>
  ) : null;

  if (!passportOpen) return null;
  if (projection.status !== 'VERIFIED' || !projection.current) {
    return (
      <aside className="passport-drawer" role="dialog" aria-label="Semantic Passport">
        <header>
          <h3>Semantic Passport</h3>
          <button type="button" onClick={closePassport} aria-label="Close passport">×</button>
        </header>
        <p className="passport-empty">
          Current verified projection is not available (status: {projection.status}). The Passport cannot be opened against a STALE or NEEDS_FIX build.
        </p>
      </aside>
    );
  }
  if (result.kind === 'closed') return null;
  return (
    <aside className="passport-drawer" role="dialog" aria-label={`Semantic Passport for ${passportOpen.entityRef.id}`}>
      <header>
        <h3>Semantic Passport</h3>
        <span className="passport-source">via {passportOpen.source}</span>
        <button type="button" onClick={closePassport} aria-label="Close passport">×</button>
      </header>
      {result.kind === 'unavailable' ? (
        <p className="passport-empty">
          {result.reason === 'no-bounded-delta'
            ? 'No previous verified revision in this session yet.'
            : 'Current verified projection is no longer available.'}
        </p>
      ) : null}
      {result.kind === 'failure' ? (
        <div className="passport-failure">
          <p>
            <code>{result.failure.code}</code>: {result.failure.message}
          </p>
        </div>
      ) : null}
      {result.kind === 'passport' ? renderPassport(result.passport, reachSection) : null}
    </aside>
  );
}