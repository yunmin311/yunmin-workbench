import { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent, HarnessCapabilities, RuntimeState } from '../../../core/types';
import { projectRuntimeExecutions, type RuntimeExecutionView } from '../../../core/project/runtimeInspector';
import type { LiveExecutionInfo } from '../store';
import { resolveRuntimeInspectorScope, runtimeCancelAvailability } from '../runtimeInspectorModel';
import { useWorkbench } from '../store';

type CapabilityMatrix = Record<string, HarnessCapabilities>;

const STATE_LABEL: Record<RuntimeState, string> = {
  working: 'working',
  idle: 'idle',
  stopped: 'stopped',
  error: 'error',
  unknown: 'UNKNOWN',
};

const CHRONOLOGY_LABEL: Record<ActivityEvent['kind'], string> = {
  'handoff-dispatched': 'Intent dispatched',
  'handoff-accepted': 'Receipt accepted',
  'handoff-failed': 'Receipt failed',
  'session-started': 'Session started',
  'turn-started': 'Turn started',
  'agent-response': 'Assistant result',
  'tool-started': 'Tool invocation',
  'tool-completed': 'Tool result',
  'file-change': 'File change',
  'turn-completed': 'Turn completed',
  'turn-error': 'Turn error',
  'approval-required': 'Approval / input',
  'needs-user-input': 'Approval / input',
  'harness-error': 'Error / crash',
};

/** Kinds every inspector shows by default; provenance detail stays collapsed inside each row. */
const ALWAYS_VISIBLE = new Set<ActivityEvent['kind']>([
  'handoff-dispatched', 'handoff-accepted', 'handoff-failed',
  'session-started', 'turn-started', 'agent-response', 'file-change',
  'turn-completed', 'turn-error', 'approval-required', 'needs-user-input', 'harness-error',
]);

function Unknown({ children }: { children?: string }) {
  return <span className="runtime-unknown">{children ?? 'UNKNOWN'}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function StateBadge({ state, live }: { state: RuntimeState; live: boolean }) {
  return (
    <span className={`runtime-state-badge state-${state}`}>
      <i className={`runtime-pulse runtime-${live ? state : 'unknown'}`} />
      {live ? STATE_LABEL[state] : `${STATE_LABEL[state]} · historical`}
    </span>
  );
}

function ExecutionRow({
  execution,
  selected,
  onSelect,
}: {
  execution: RuntimeExecutionView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`runtime-execution-row ${selected ? 'selected' : ''} state-${execution.state}`}
      onClick={onSelect}
      data-execution-id={execution.executionId}
    >
      <span className="runtime-execution-title">
        <i className={`runtime-pulse runtime-${execution.live ? execution.state : 'unknown'}`} />
        <strong>{execution.harness ?? <Unknown />}</strong>
        <span className="runtime-execution-native" title={execution.nativeRef ?? undefined}>
          {execution.nativeRef ? `native ${execution.nativeRef}` : 'native UNKNOWN'}
        </span>
      </span>
      <span className="runtime-execution-meta">
        {STATE_LABEL[execution.state]} · {execution.live ? 'live' : 'no live process evidence'}
        {execution.receipt ? ` · receipt ${execution.receipt.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}` : ' · receipt UNKNOWN'}
      </span>
    </button>
  );
}

function CapabilityLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtime-capability-line">
      <span>{label}</span>
      <b className={value === 'YES' ? 'cap-yes' : value === 'NO' ? 'cap-no' : 'cap-unknown'}>{value}</b>
    </div>
  );
}

function ChronologyRow({ event }: { event: ActivityEvent }) {
  const visible = ALWAYS_VISIBLE.has(event.kind);
  return (
    <li className={`runtime-chronology-row kind-${event.kind} ${visible ? '' : 'runtime-chronology-minor'}`} data-event-ref={event.id}>
      <div className="runtime-chronology-main">
        <strong>{CHRONOLOGY_LABEL[event.kind]}</strong>
        <time>{new Date(event.observed.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
      </div>
      <p>{event.summary}</p>
      <details className="runtime-chronology-detail">
        <summary>provenance & raw detail</summary>
        <span title={event.observed.sourceRef}>{event.observed.source} · {event.observed.verification} · {event.observed.sourceRef}</span>
        {event.adapter && <span>adapter {event.adapter}</span>}
        {event.capability && <span>capability {event.capability}</span>}
        {event.runtimeRef && <span title={event.runtimeRef}>runtime {event.runtimeRef}</span>}
        {event.turnRef && <span title={event.turnRef}>turn {event.turnRef}</span>}
        {event.binding && <span>binding {JSON.stringify(event.binding)}</span>}
      </details>
    </li>
  );
}

function HarnessDiagnostics({ matrix, probedAt }: { matrix: CapabilityMatrix | null; probedAt: string | null }) {
  const snapshot = useWorkbench((s) => s.snapshot);
  const projectId = useWorkbench((s) => s.projectId);
  const [smokeState, setSmokeState] = useState<Record<string, { message: string; ok: boolean } | 'running'>>({});
  const runSmoke = async (harness: string) => {
    if (!projectId) return;
    setSmokeState((s) => ({ ...s, [harness]: 'running' }));
    try {
      const result = await window.wb.smokeHarness(projectId, harness as 'codex' | 'claude' | 'deepseek');
      const ok = !('status' in result) || result.status === 'ACCEPTED';
      const message = 'status' in result
        ? `receipt ${result.status}${result.message ? `: ${result.message}` : ''}`
        : `protocol smoke ok: ${'userAgent' in result ? result.userAgent : ''} thread ${'ephemeralThreadId' in result ? result.ephemeralThreadId : ''}`;
      setSmokeState((s) => ({ ...s, [harness]: { ok, message } }));
    } catch (error) {
      setSmokeState((s) => ({ ...s, [harness]: { ok: false, message: String(error) } }));
    }
  };

  const machineRoot = projectId ? snapshot?.machine?.projectRoots[projectId] : undefined;
  const workbenchRoot = projectId ? snapshot?.workbenchProjectRoots?.[projectId] : undefined;

  return (
    <section className="inspector-section runtime-diagnostics">
      <header><p className="eyebrow">On-demand inspect · read-only</p><h2>Harness & Machine</h2></header>
      <p className="inspector-muted">
        Probed {probedAt ? new Date(probedAt).toLocaleTimeString() : 'never'}. Diagnostics only read what the adapters already expose; nothing is scanned, written, or configured.
      </p>
      {!matrix && <p className="inspector-muted">Harness probe unavailable.</p>}
      {matrix && Object.entries(matrix).map(([harness, caps]) => (
        <div className="runtime-harness-card" key={harness} data-harness={harness}>
          <div className="runtime-harness-head">
            <strong>{harness}</strong>
            <span className={caps.canDispatch ? 'cap-yes' : 'cap-no'}>{caps.canDispatch ? 'available' : 'unavailable'}</span>
          </div>
          <dl className="evidence-list">
            <Field label="Interface"><span>{caps.protocol}</span></Field>
            <Field label="Observed">{caps.evidence}</Field>
            <Field label="Adapter">{harness === 'codex' ? 'codex-app-server' : harness === 'claude' ? 'claude-code-stream-json' : 'deepseek-adapter'}</Field>
            <Field label="Resume">{caps.support.resume}</Field>
          </dl>
          <div className="runtime-capability-matrix" aria-label={`${harness} capability matrix`}>
            {Object.entries(caps.support).map(([key, value]) => (
              <CapabilityLine key={key} label={key} value={value} />
            ))}
          </div>
          <div className="runtime-smoke-row">
            <button
              disabled={!caps.canDispatch || smokeState[harness] === 'running'}
              onClick={() => void runSmoke(harness)}
              title={caps.canDispatch ? 'Run the real adapter smoke against this harness' : `Dispatch unavailable: ${caps.evidence}`}
            >
              {smokeState[harness] === 'running' ? 'Smoke running…' : 'Run real smoke'}
            </button>
            {smokeState[harness] && smokeState[harness] !== 'running' && (
              <span className={smokeState[harness].ok ? 'ok' : 'packet-alert'}>{smokeState[harness].message}</span>
            )}
            {!smokeState[harness] && <span className="inspector-muted">not run in this session — capability probe only</span>}
          </div>
        </div>
      ))}
      <details className="runtime-machine">
        <summary>Machine profile</summary>
        {snapshot?.machine ? (
          <dl className="evidence-list">
            <Field label="Machine"><span>{snapshot.machine.displayName} ({snapshot.machine.deviceId})</span></Field>
            <Field label="Source"><span title={snapshot.machine.observed.sourceRef}>{snapshot.machine.observed.sourceRef}</span></Field>
            <Field label="Project root">
              {workbenchRoot?.root ?? machineRoot ?? <Unknown />}
            </Field>
            <Field label="Overlay">
              <span title={snapshot.overlayRoot}>{snapshot.overlayRoot || <Unknown />}</span>
            </Field>
            <Field label="Harnesses">
              <span>{matrix ? Object.entries(matrix).map(([name, caps]) => `${name}:${caps.canDispatch ? 'available' : 'unavailable'}`).join(' · ') : <Unknown />}</span>
            </Field>
          </dl>
        ) : (
          <p className="inspector-muted">No machine profile observed — nothing is inferred.</p>
        )}
      </details>
    </section>
  );
}

export function RuntimeInspector({ onClose }: { onClose: () => void }) {
  const activity = useWorkbench((s) => s.activity);
  const liveExecutions = useWorkbench((s) => s.liveExecutions);
  const runtimeTarget = useWorkbench((s) => s.runtimeTarget);
  const projectId = useWorkbench((s) => s.projectId);
  const conversation = useWorkbench((s) => s.conversation);
  const refreshLiveExecutions = useWorkbench((s) => s.refreshLiveExecutions);
  const setView = useWorkbench((s) => s.setView);

  const [matrix, setMatrix] = useState<CapabilityMatrix | null>(null);
  const [probedAt, setProbedAt] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.wb.loadAllHarnessCapabilities().then((all) => {
      if (cancelled) return;
      setMatrix(all as CapabilityMatrix);
      setProbedAt(new Date().toISOString());
    }).catch(() => setMatrix(null));
    return () => { cancelled = true; };
  }, []);

  const liveIds = useMemo(() => liveExecutions.map((entry: LiveExecutionInfo) => entry.executionId), [liveExecutions]);
  const executions = useMemo(
    () => projectRuntimeExecutions(activity, liveIds),
    [activity, liveIds],
  );

  useEffect(() => {
    setSelectedId(null);
    setCancelMessage(null);
  }, [runtimeTarget?.executionId]);

  const scoped = useMemo(() => {
    return resolveRuntimeInspectorScope({
      executions,
      targetExecutionId: runtimeTarget?.executionId ?? null,
      selectedExecutionId: selectedId,
      projectId,
      conversationKey: conversation?.key ?? null,
    });
  }, [executions, projectId, conversation, runtimeTarget, selectedId]);
  const selected = scoped.selected;
  const cancelAvailability = selected
    ? runtimeCancelAvailability(selected, liveExecutions)
    : { enabled: false, reason: 'not-live' as const };

  const cancel = async (execution: RuntimeExecutionView) => {
    setCancelMessage(null);
    try {
      const outcome = await window.wb.cancelExecution(execution.executionId);
      setCancelMessage(outcome.delivered
        ? 'Cancel delivered to the adapter; the dispatch will report the outcome.'
        : `Cancel not delivered${outcome.reason ? ` (${outcome.reason})` : ''}.`);
    } catch (error) {
      setCancelMessage(`Cancel failed: ${String(error)}`);
    }
    void refreshLiveExecutions();
  };

  if (!projectId) {
    return (
      <div className="inspector-empty">
        <strong>No workspace selected</strong>
        <span>Runtime Inspector is contextual: open a session first, then inspect its executions.</span>
      </div>
    );
  }

  return (
    <div className="runtime-inspector" data-testid="runtime-inspector">
      <section className="inspector-section">
        <header><p className="eyebrow">Runtime · contextual overlay</p><h2>Executions</h2></header>
        {scoped.list.length === 0 ? (
          <p className="inspector-muted" data-testid="runtime-empty">
            No runtime observed for this scope. Executions appear only from adapter protocol events; nothing is invented and History is not treated as live runtime.
          </p>
        ) : (
          <div className="runtime-execution-list">
            {scoped.list.map((item) => (
              <ExecutionRow
                key={item.executionId}
                execution={item}
                selected={selected?.executionId === item.executionId}
                onSelect={() => setSelectedId(item.executionId)}
              />
            ))}
          </div>
        )}
        {scoped.targetUnavailable && (
          <p className="runtime-target-unavailable" data-testid="runtime-target-unavailable">
            Requested execution unavailable. Its exact harness + native ref is not present in current Activity; no recent runtime was substituted.
          </p>
        )}
      </section>

      {selected && (
        <section className="inspector-section runtime-detail" data-testid="runtime-detail" data-execution-id={selected.executionId}>
          <header><p className="eyebrow">Workbench execution</p><h2>{selected.harness ?? 'UNKNOWN'} execution</h2></header>
          <dl className="evidence-list runtime-identity-fields">
            <Field label="Harness">{selected.harness ?? <Unknown />}</Field>
            <Field label="Workbench execution id"><span className="runtime-workbench-id" title={selected.executionId}>{selected.executionId}</span></Field>
            <Field label="Native externalSessionRef">
              {selected.nativeRef
                ? <span className="runtime-native-ref" title={selected.nativeRef}>{selected.nativeRef}</span>
                : <Unknown>UNKNOWN — no native externalSessionRef observed</Unknown>}
            </Field>
            <Field label="Project">{selected.projectId ?? <Unknown />}</Field>
            <Field label="Conversation">{selected.conversationKey ?? <Unknown />}</Field>
            <Field label="Runtime state"><StateBadge state={selected.state} live={selected.live} /></Field>
            <Field label="Intent → receipt">
              {selected.receipt
                ? <span>intent {selected.intentState.toUpperCase()} · receipt {selected.receipt.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'} · {selected.receipt.summary}</span>
                : <span>intent {selected.intentState === 'unknown' ? <Unknown /> : selected.intentState.toUpperCase()} · receipt <Unknown /></span>}
            </Field>
            <Field label="Started">{selected.startedAt ? new Date(selected.startedAt).toLocaleString() : <Unknown />}</Field>
            <Field label="Ended">{selected.endedAt ?? <Unknown>UNKNOWN — no session-end evidence</Unknown>}</Field>
            <Field label="Adapter">{selected.events.find((event) => event.adapter)?.adapter ?? <Unknown />}</Field>
            <Field label="Verification">{selected.observed?.verification ?? <Unknown />}</Field>
            <Field label="Source">{selected.observed?.source ?? <Unknown />}</Field>
            <Field label="Source ref">{selected.observed?.sourceRef ?? <Unknown />}</Field>
          </dl>
          <details className="runtime-binding">
            <summary>Execution binding (observed fields only)</summary>
            {selected.binding ? (
              <dl className="evidence-list">
                <Field label="machine">{selected.binding.machine}</Field>
                <Field label="cwd">{selected.binding.cwd ?? <Unknown />}</Field>
                <Field label="worktree">{selected.binding.worktree ?? <Unknown />}</Field>
                <Field label="branch">{selected.binding.branch ?? <Unknown />}</Field>
                <Field label="HEAD">{selected.binding.head ?? <Unknown />}</Field>
              </dl>
            ) : (
              <p className="inspector-muted">No binding was observed for this execution; fields stay UNKNOWN.</p>
            )}
          </details>
          {matrix && selected.harness && matrix[selected.harness] && (
            <div className="runtime-capability-matrix" aria-label="Execution harness capability truth">
              {Object.entries(matrix[selected.harness].support).map(([key, value]) => (
                <CapabilityLine key={key} label={key} value={value} />
              ))}
              <CapabilityLine label="cancel now" value={cancelAvailability.enabled ? 'YES' : 'NO'} />
            </div>
          )}

          <div className="runtime-controls" role="group" aria-label="Runtime controls">
            <button
              data-testid="runtime-cancel"
              disabled={!cancelAvailability.enabled}
              title={cancelAvailability.enabled
                ? 'Ask the live adapter to stop this exact execution'
                : cancelAvailability.reason === 'unsupported'
                  ? 'This live adapter exposes no reliable cancel path'
                  : 'No exact live process evidence for this execution'}
              onClick={() => void cancel(selected)}
            >
              Cancel execution
            </button>
            <button
              onClick={() => void window.wb.copyText([
                `execution ${selected.executionId}`,
                selected.nativeRef ? `native ${selected.nativeRef}` : 'native UNKNOWN',
                selected.observed ? `source ${selected.observed.sourceRef}` : '',
              ].filter(Boolean).join('\n'))}
            >
              Copy refs
            </button>
            <button
              data-testid="runtime-inspect-source"
              disabled={!selected.observed}
              onClick={() => {
                if (!selected.observed) return;
                const sourceEvent = selected.events.find((event) => event.observed.sourceRef === selected.observed?.sourceRef);
                onClose();
                setTimeout(() => window.dispatchEvent(new CustomEvent('workbench:focus-attention-source', {
                  detail: { eventRef: sourceEvent?.id, sourceRef: selected.observed?.sourceRef },
                })), 0);
              }}
            >
              Inspect source
            </button>
            <button onClick={() => { setView('control'); onClose(); }} title="Back to the Session Spine">
              Close to session
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' }))} title="Dispatch a NEW execution through the Packet review flow">
              New dispatch → Packet
            </button>
          </div>
          {cancelMessage && <p className="runtime-cancel-message">{cancelMessage}</p>}

          <h3 className="runtime-chronology-title">Execution chronology</h3>
          <ol className="runtime-chronology" aria-label="Execution chronology">
            {selected.events.map((event) => <ChronologyRow key={event.id} event={event} />)}
          </ol>
        </section>
      )}

      <HarnessDiagnostics matrix={matrix} probedAt={probedAt} />
    </div>
  );
}
