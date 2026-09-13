import { useCallback, useEffect, useState } from 'react';
import {
  buildCompactSnapshot,
  compactNavigationFromSnapshot,
  normalizeCurrentSelection,
  type CompactSnapshot,
} from '../core/compact/snapshot';
import { reduceAttention, applyAttentionLocalState } from '../core/attention/reducer';
import type { AttentionLocalState } from '../core/types';

/**
 * Workbench Compact (PHASE 4A) — the compressed state of the same product.
 *
 * Read-mostly control surface over the SAME read model the Full Workbench
 * uses (shared preload contract). It answers four questions: what am I
 * working on, is anything running, does anything need me, do I want the
 * full Canvas. It owns no product semantics: editing, staging, compiling
 * and dispatching stay in the Full Workbench.
 */

const REFRESH_MS = 4_000;

export function CompactApp() {
  const [snapshot, setSnapshot] = useState<CompactSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rawSelection = await window.wb.getCurrentSelection();
      const selection = normalizeCurrentSelection(rawSelection);
      const revision = selection
        ? (await window.wb.getWorkGraphRevision(selection.projectId)).revision
        : null;
      const live = await window.wb.loadLiveExecutions();
      const [activity, local] = await Promise.all([
        window.wb.loadActivity({ limit: 400 }),
        window.wb.loadAttentionLocal(),
      ]);
      const attention = applyAttentionLocalState(
        reduceAttention({ activity: activity.events, limit: 200 }),
        local as AttentionLocalState,
      );
      setSnapshot(buildCompactSnapshot({
        selection,
        revision,
        liveExecutions: live,
        attentionItems: attention,
      }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onChanged = () => void load();
    const offActivity = window.wb.onActivityChanged(() => void load());
    const offOverlay = window.wb.onOverlayChanged(onChanged);
    return () => {
      clearInterval(timer);
      offActivity();
      offOverlay();
    };
  }, [load]);

  const openWorkbench = useCallback((action: 'continue' | 'prepare') => {
    if (!snapshot?.project) return;
    const intent = compactNavigationFromSnapshot(snapshot, action);
    if (intent) void window.wb.openWorkbenchFromCompact(intent);
  }, [snapshot]);

  const toggleExpand = useCallback(() => {
    setExpanded((current) => {
      void window.wb.setCompactExpanded(!current);
      return !current;
    });
  }, []);

  return (
    <div className="compact" data-expanded={expanded ? 'true' : 'false'}>
      <div
        className="compact-drag"
        onDoubleClick={toggleExpand}
        role="heading"
        aria-level={1}
        aria-label="Workbench Compact"
      >
        <span className="compact-title">Yunmin Workbench</span>
        <span className="compact-drag-spacer" />
        <button
          type="button"
          className="compact-btn"
          onClick={toggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse Compact panel' : 'Expand Compact panel'}
        >
          {expanded ? '▾' : '▴'}
        </button>
        <button
          type="button"
          className="compact-btn"
          onClick={() => void window.wb.toggleCompactWindow()}
          aria-label="Hide Compact panel"
        >
          ×
        </button>
      </div>
      {error && <p className="compact-error">{error}</p>}
      {!snapshot && !error && <p className="compact-empty">Loading…</p>}
      {snapshot && !snapshot.project && (
        <p className="compact-empty">Open the Workbench and select a Work or Task to pin it here.</p>
      )}
      {snapshot?.project && (
        <div className="compact-body">
          <button type="button" className="compact-scope" onClick={() => openWorkbench('continue')} title="Continue in the full Workbench">
            <span className="compact-project">{snapshot.project.projectId}</span>
            {snapshot.work && (
              <span className="compact-work">
                {snapshot.work.label}
                <em className={`compact-currentness is-${snapshot.work.currentness.toLowerCase()}`}>{snapshot.work.currentness}</em>
              </span>
            )}
            {snapshot.task && (
              <span className="compact-task">
                {snapshot.task.taskId} · {snapshot.task.label}
                {snapshot.task.taskState !== 'unknown' && (
                  <em className={`compact-currentness is-${snapshot.task.taskState}`}>
                    {snapshot.task.taskState}
                  </em>
                )}
              </span>
            )}
          </button>

          {(snapshot.running.length > 0 || snapshot.attention.length > 0) && (
            <div className="compact-facts">
              {snapshot.running.length > 0 && (
                <div className="compact-running" role="status" aria-label="Running executions">
                  <span className="compact-fact-label">Running</span>
                  {snapshot.running.map((execution) => (
                    <span key={execution.executionId} className="compact-run-row">
                      <span className="run-dot" aria-hidden="true" /> {execution.harness} · {execution.executionId.slice(0, 12)}…
                    </span>
                  ))}
                </div>
              )}
              {snapshot.attention.length > 0 && (
                <div className="compact-attention" role="alert" aria-label="Attention">
                  <span className="compact-fact-label">Attention</span>
                  {snapshot.attention.map((item) => (
                    <span key={item.id} className={`compact-attention-row is-${item.level}`}>{item.title}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="compact-actions">
            <button
              type="button"
              className="compact-expand-btn"
              onClick={() => openWorkbench('continue')}
              aria-label="Continue current work"
              title="Jump back to this exact work in the main view"
            >
              Continue
            </button>
            <button
              type="button"
              className="compact-expand-btn is-prepare"
              onClick={() => openWorkbench('prepare')}
              aria-label="Prepare current work"
              title="Choose what this work can use, then send it"
            >
              Prepare
            </button>
          </div>
          {expanded && (
            <>
              <p className="compact-footnote">
                Continue jumps back to this exact work. Prepare chooses what it can use, then sends it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
    );
}
