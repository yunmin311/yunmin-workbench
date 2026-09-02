/*
 * Interaction model adapted from DeepSeek-Reasonix Composer.tsx (MIT):
 * persistent draft, explicit reference chips, long-paste capture, IME-safe
 * Enter/Shift+Enter, running state, Context card, and multi-Agent selector.
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { HarnessCapabilities } from '../../../core/types';
import { useGovernanceView, useWorkbench } from '../store';

type Harness = HarnessCapabilities['harness'];

export function SessionComposer() {
  const taskSummary = useWorkbench((state) => state.taskSummary);
  const setTaskSummary = useWorkbench((state) => state.setTaskSummary);
  const staging = useWorkbench((state) => state.staging);
  const addManualContext = useWorkbench((state) => state.addManualContext);
  const addProjectFile = useWorkbench((state) => state.addProjectFile);
  const harnessCapabilities = useWorkbench((state) => state.harnessCapabilities);
  const sendTask = useWorkbench((state) => state.sendTask);
  const packetValidity = useWorkbench((state) => state.packetValidity);
  const draftSaveState = useWorkbench((state) => state.draftSaveState);
  const handoffSourceRef = useWorkbench((state) => state.handoffSourceRef);
  const clearHandoffSource = useWorkbench((state) => state.clearHandoffSource);
  const lastDispatchOutcomes = useWorkbench((state) => state.lastDispatchOutcomes);
  const governance = useGovernanceView();
  const [agents, setAgents] = useState<Harness[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  const available = useMemo(() => Object.values(harnessCapabilities)
    .filter((caps) => caps.canDispatch)
    .map((caps) => caps.harness), [harnessCapabilities]);

  useEffect(() => {
    setAgents((current) => {
      const retained = current.filter((agent) => available.includes(agent));
      return retained.length > 0 ? retained : available.slice(0, 1);
    });
  }, [available.join('|')]);

  const included = staging.filter((item) => item.state === 'included');
  const pinned = included.filter((item) => item.pinned);
  const toggleAgent = (agent: Harness) => setAgents((current) =>
    current.includes(agent)
      ? (current.length === 1 ? current : current.filter((item) => item !== agent))
      : [...current, agent]);

  const submit = async () => {
    const summary = taskSummary.trim();
    if (!summary) { setMessage('Write a task first.'); textarea.current?.focus(); return; }
    if (agents.length === 0) { setMessage('Choose an available Agent.'); return; }
    setRunning(true);
    setMessage('');
    try {
      const outcomes = await sendTask(summary, agents);
      const accepted = outcomes.filter((outcome) => outcome.status === 'accepted').length;
      const failed = outcomes.length - accepted;
      // Do not erase a new draft the user started while the previous runtime
      // was still settling. The response can arrive before the receipt does.
      if (accepted > 0 && useWorkbench.getState().taskSummary === summary) setTaskSummary('');
      setMessage(failed > 0
        ? `${accepted} Agent${accepted === 1 ? '' : 's'} started; ${failed} failed independently.`
        : `${accepted} Agent${accepted === 1 ? '' : 's'} started. Live Runtime is in the transcript.`);
    } catch (error) {
      setMessage(`Dispatch stopped: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!running) void submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (text.length < 1_200) return;
    event.preventDefault();
    addManualContext(`Pasted context · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, text);
    const cue = taskSummary.trim() ? `${taskSummary.trim()}\n\nUse the attached pasted context.` : 'Use the attached pasted context.';
    setTaskSummary(cue);
    setMessage(`Long paste moved into Context (${text.length.toLocaleString()} characters).`);
  };

  return (
    <section className={`rebuild-composer session-composer ${running ? 'is-running' : ''}`} aria-label="Session composer">
      {handoffSourceRef && (
        <div className="handoff-context-card">
          <span><strong>Continue from result</strong><small>{handoffSourceRef}</small></span>
          <button onClick={clearHandoffSource} aria-label="Remove handoff source">×</button>
        </div>
      )}

      {included.length > 0 && (
        <div className="composer-reference-strip" aria-label="Included Context references">
          {included.slice(0, 4).map((item) => (
            <button key={item.id} title={`${item.source}\n${item.body}`} onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' }))}>
              <span>{item.isReference ? '↗' : '＋'}</span>{item.title}
            </button>
          ))}
          {included.length > 4 && <button onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' }))}>+{included.length - 4}</button>}
        </div>
      )}

      <textarea
        ref={textarea}
        value={taskSummary}
        onChange={(event) => setTaskSummary(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={3}
        placeholder={handoffSourceRef ? 'Tell the next Agent what to do with this result…' : 'What should the Agent do next?'}
        aria-label="Task for Agent"
      />

      <div className="composer-toolbar">
        <div className="composer-additions">
          <div className="composer-popover-anchor">
            <button className="composer-tool" aria-expanded={contextOpen} onClick={() => setContextOpen((open) => !open)}>＋ Add</button>
            {contextOpen && (
              <div className="composer-menu" role="menu">
                <button role="menuitem" onClick={() => { setContextOpen(false); void addProjectFile(false); }}>Attach file contents</button>
                <button role="menuitem" onClick={() => { setContextOpen(false); void addProjectFile(true); }}>Reference workspace file</button>
                <button role="menuitem" onClick={() => { setContextOpen(false); window.dispatchEvent(new CustomEvent('workbench:open-history')); }}>Reference past session</button>
                <button role="menuitem" onClick={() => { setContextOpen(false); window.dispatchEvent(new CustomEvent('workbench:open-memory')); }}>Add from Memory</button>
                <button role="menuitem" onClick={() => { setContextOpen(false); window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' })); }}>Open Context editor</button>
              </div>
            )}
          </div>
          <button className="context-summary" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' }))}>
            {included.length} context{included.length === 1 ? '' : 's'}{pinned.length ? ` · ${pinned.length} pinned` : ''}
          </button>
          {(packetValidity === 'STALE' || packetValidity === 'INVALID') && (
            <button className={`packet-warning is-${packetValidity.toLowerCase()}`} onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' }))}>
              Packet {packetValidity}
            </button>
          )}
          <span className="draft-state">Draft {draftSaveState}</span>
        </div>

        <div className="composer-submit-group">
          <div className="composer-popover-anchor">
            <button className="agent-selector composer-agent" aria-expanded={selectorOpen} onClick={() => setSelectorOpen((open) => !open)}>
              {agents.length === 0 ? 'Choose Agent' : agents.length === 1 ? agents[0] : `${agents.length} Agents`} <span>⌄</span>
            </button>
            {selectorOpen && (
              <div className="composer-menu agent-menu" role="menu">
                {Object.values(harnessCapabilities).map((caps) => {
                  const hint = governance.agentHints.find((item) => item.harness === caps.harness);
                  const hintLabel = hint?.state === 'single' && hint.role
                    ? `dialogue role on this project: ${hint.role}`
                    : hint?.state === 'ambiguous'
                      ? `multiple dialogue roles on ${caps.harness}; not projecting a single hint`
                      : `no dialogue role declared for ${caps.harness} on this project`;
                  return (
                    <button
                      key={caps.harness}
                      role="menuitemcheckbox"
                      aria-checked={agents.includes(caps.harness)}
                      disabled={!caps.canDispatch}
                      title={hintLabel}
                      onClick={() => toggleAgent(caps.harness)}
                    >
                      <span className="agent-check">{agents.includes(caps.harness) ? '✓' : ''}</span>
                      <span><strong>{caps.harness}</strong><small>{caps.canDispatch ? caps.protocol : caps.evidence}</small></span>
                      {hint?.state === 'single' && hint.role && <span className="agent-role-hint">role: {hint.role}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button className="composer-send" disabled={running || agents.length === 0} onClick={() => void submit()} aria-label={agents.length > 1 ? `Run with ${agents.length} agents` : `Send to ${agents[0] ?? 'agent'}`}>
            {running ? <span className="send-spinner" /> : '↑'}
          </button>
        </div>
      </div>
      <div className="composer-foot">
        <span>{agents.length > 1 ? 'Parallel uses one validated Packet and separate executions.' : handoffSourceRef ? 'The selected result is explicit Context for this dispatch.' : 'Enter to send · Shift+Enter for a new line'}</span>
        {message && <strong role="status">{message}</strong>}
        {lastDispatchOutcomes.some((outcome) => outcome.status === 'failed') && <span>Failures stay isolated per Agent.</span>}
      </div>
    </section>
  );
}
