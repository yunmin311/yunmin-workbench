import { useState } from 'react';
import { useWorkbench } from '../store';

/**
 * Collaboration surface — projects an explicit, user-chosen Collaboration Run as
 * agent execution cards + handoff relations. It is a Workbench-owned projection
 * of a UI/interaction object, NOT a Runtime/Task SOT, and never orchestrates:
 * relations only appear when the user explicitly confirms a result transfer.
 */
export function CollaborationPanel({ onClose }: { onClose: () => void }) {
  const runs = useWorkbench((s) => s.collaborationRuns);
  const activeRunId = useWorkbench((s) => s.activeRunId);
  const setActiveRunId = useWorkbench((s) => s.setActiveRunId);
  const createRun = useWorkbench((s) => s.createCollaborationRun);
  const setAgentStatus = useWorkbench((s) => s.setCollaborationAgentStatus);
  const addRelation = useWorkbench((s) => s.addCollaborationRelation);
  const reset = useWorkbench((s) => s.resetCollaboration);
  const projectId = useWorkbench((s) => s.projectId);
  const conversation = useWorkbench((s) => s.conversation);
  const harnessCapabilities = useWorkbench((s) => s.harnessCapabilities);
  const demoMode = useWorkbench((s) => s.demoMode);

  const run = runs.find((item) => item.id === activeRunId) ?? runs[0] ?? null;
  const availableAgents = Object.entries(harnessCapabilities)
    .filter(([, caps]) => caps.canDispatch)
    .map(([name]) => name);
  const [compareOpen, setCompareOpen] = useState(false);

  const startParallel = () => {
    if (!projectId || !conversation || availableAgents.length < 2) return;
    createRun({
      projectId,
      conversationKey: conversation.key,
      mode: 'parallel',
      agents: availableAgents.slice(0, 2).map((harness, index) => ({
        agentId: `${harness}-${index}`,
        harness,
        role: index === 0 ? 'primary' : 'secondary',
        goal: 'Independently solve the same task from the shared context.',
      })),
    });
  };

  const startHandoff = () => {
    if (!projectId || !conversation || availableAgents.length < 2) return;
    createRun({
      projectId,
      conversationKey: conversation.key,
      mode: 'handoff',
      agents: availableAgents.slice(0, 2).map((harness, index) => ({
        agentId: `${harness}-${index}`,
        harness,
        role: index === 0 ? 'primary' : 'reviewer',
        goal: index === 0 ? 'Produce the work' : 'Review and continue from the previous result.',
      })),
    });
  };

  // Demo-only helpers so a first-run user can feel the Collaboration projection
  // without configuring a real harness. These mutate only the demo/in-memory run.
  const simulateRun = () => {
    if (!demoMode || !run) return;
    setAgentStatus(run.id, run.agents[0]?.agentId ?? '', 'completed', `exec-${run.agents[0]?.agentId ?? ''}-1`);
    if (run.mode === 'handoff' && run.agents[1]) {
      try {
        addRelation(run.id, {
          id: `${run.id}-rel-1`,
          source: run.agents[0].agentId,
          target: run.agents[1].agentId,
          usedResultRef: `exec-${run.agents[0].agentId}-1:result`,
        });
      } catch {
        // relation already present (e.g. after compare) — ignore
      }
    }
  };

  return (
    <div className="portability-layer" role="presentation" onMouseDown={onClose}>
      <section className="portability-panel collaboration-panel" role="dialog" aria-label="Multi-agent Collaboration" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>Explicit collaboration · projection only</small><h2>Multi-Agent Collaboration</h2></div>
          <button aria-label="Close Collaboration" onClick={onClose}>×</button>
        </header>

        {!run && (
          <div className="collaboration-empty">
            <p>Choose how to run a multi-agent collaboration. The Workbench only organizes an explicit run — it never auto-chains or picks the next agent.</p>
            <div className="collaboration-actions">
              <button onClick={startParallel} disabled={availableAgents.length < 2}>Parallel · two agents</button>
              <button onClick={startHandoff} disabled={availableAgents.length < 2}>Handoff · A → B</button>
            </div>
            {demoMode && <p className="collaboration-hint">Demo mode: running and relations are simulated locally; nothing touches a real harness.</p>}
          </div>
        )}

        {run && (
          <>
            <div className="collaboration-runs">
              {runs.map((item) => (
                <button key={item.id} className={`collaboration-run-tab ${item.id === run.id ? 'active' : ''}`} onClick={() => setActiveRunId(item.id)}>
                  {item.mode === 'parallel' ? 'Parallel' : 'Handoff'} · {item.agents.length} agents
                </button>
              ))}
              <button className="collaboration-new" onClick={() => { reset(); }}>New run</button>
            </div>
            <div className="collaboration-agents">
              {run.agents.map((agent) => {
                const inbound = run.relations.filter((rel) => rel.target === agent.agentId);
                const outbound = run.relations.filter((rel) => rel.source === agent.agentId);
                return (
                  <article key={agent.agentId} className={`collaboration-agent collaboration-agent-${agent.status}`} data-testid={`collaboration-agent-${agent.agentId}`}>
                    <header>
                      <strong>{agent.role}</strong>
                      <span className="harness-badge">{agent.harness}</span>
                      <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
                    </header>
                    <p>{agent.goal}</p>
                    {agent.executionId && <small className="agent-execution">execution {agent.executionId}</small>}
                    {inbound.length > 0 && (
                      <div className="agent-inbound">
                        <small>Received from:</small>
                        {inbound.map((rel) => <span key={rel.id}>{rel.source} · {rel.usedResultRef}</span>)}
                      </div>
                    )}
                    {outbound.length > 0 && (
                      <div className="agent-outbound">
                        <small>Result handed to:</small>
                        {outbound.map((rel) => <span key={rel.id}>{rel.target} · {rel.usedResultRef}</span>)}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="collaboration-empty-actions">
              {demoMode && <button onClick={simulateRun}>Simulate a completion in Demo</button>}
              <button onClick={() => setCompareOpen((o) => !o)}>{compareOpen ? 'Hide compare' : 'Compare results'}</button>
            </div>
            {compareOpen && (
              <div className="collaboration-compare" aria-label="Compare agent results">
                {run.agents.map((agent) => (
                  <article key={agent.agentId} className="collaboration-compare-card">
                    <header><strong>{agent.role}</strong><span className="harness-badge">{agent.harness}</span></header>
                    <p className={`compare-result compare-result-${agent.status}`}>
                      {agent.status === 'completed'
                        ? `Result from ${agent.harness} (${agent.executionId ?? 'no execution id'}): produced an outcome.`
                        : agent.status === 'failed'
                          ? `${agent.harness} failed — this does not affect the other agents.`
                          : agent.status === 'awaiting-input'
                            ? `${agent.harness} is waiting for your input.`
                            : `${agent.harness} is ${agent.status}.`}
                    </p>
                    <small className="agent-execution">execution {agent.executionId ?? 'not started'}</small>
                  </article>
                ))}
                <p className="compare-hint">Side-by-side only; the Workbench does not judge which is correct unless you run a judge execution.</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
