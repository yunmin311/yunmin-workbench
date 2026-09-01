/* Prompt-shelf organization adapted from DeepSeek-Reasonix ApprovalModal.tsx (MIT). */
import { executionIdForEvent } from '../../../core/project/runtimeInspector';
import type { ActivityEvent } from '../../../core/types';
import { useWorkbench } from '../store';

export function ApprovalModal({ event, onClose }: { event: ActivityEvent; onClose: () => void }) {
  const openRuntimeInspector = useWorkbench((state) => state.openRuntimeInspector);
  const executionId = executionIdForEvent(event);
  const needsInput = event.kind === 'needs-user-input';
  return (
    <div className="approval-layer" role="presentation" onMouseDown={onClose}>
      <section className="approval-shelf" role="dialog" aria-modal="true" aria-label={needsInput ? 'Agent needs input' : 'Approval required'} onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
        <div className="approval-accent" />
        <header>
          <span>{needsInput ? 'INPUT' : 'APPROVAL'}</span>
          <h2>{needsInput ? 'The Agent is waiting for you' : 'The Agent needs a decision'}</h2>
          <p>{event.summary}</p>
        </header>
        <dl>
          <div><dt>Agent</dt><dd>{event.harness ?? 'Unknown'}</dd></div>
          <div><dt>Execution</dt><dd>{executionId ?? 'Native identity unavailable'}</dd></div>
          <div><dt>Evidence</dt><dd>{event.observed.sourceRef}</dd></div>
        </dl>
        <p className="approval-honesty">This Workbench build can surface the real request, but this adapter has not exposed a safe response channel. Continue in the native Agent session.</p>
        <footer>
          <button onClick={onClose}>Not now</button>
          <button className="primary" disabled={!executionId} onClick={() => { if (executionId) openRuntimeInspector({ executionId }); onClose(); }}>Open native Runtime</button>
        </footer>
      </section>
    </div>
  );
}
