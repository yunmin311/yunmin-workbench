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

interface CompactPresence {
  id: string;
  label: string;
  platform: string;
  runtimeState: string;
}

export function CompactApp() {
  const [snapshot, setSnapshot] = useState<CompactSnapshot | null>(null);
  const [presence, setPresence] = useState<CompactPresence[]>([]);
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
      const nativeSessions = selection ? await window.wb.listHarnessSessions(selection.projectId) : [];
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
      setPresence([...(revision?.candidate.semanticFacts.nodes ?? [])
        .filter((node) => node.kind === 'conversation')
        .map((node) => ({
          id: node.id,
          label: node.label,
          platform: node.platform,
          runtimeState: node.runtimeState,
        })), ...nativeSessions.map((session) => ({
          id: `${session.harness}:${session.nativeRef}`,
          label: session.label,
          platform: session.harness,
          runtimeState: session.runtimeState,
        }))]);
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
    <div className="compact approved-compact-window" data-expanded={expanded ? 'true' : 'false'}>
      <div
        className="compact-drag approved-compact-head"
        onDoubleClick={toggleExpand}
        role="heading"
        aria-level={1}
        aria-label="Workbench Compact"
      >
        <span className="approved-compact-brand" aria-hidden="true">Y</span>
        <span className="compact-title"><small>CURRENT WORK</small><b>{snapshot?.work?.label ?? snapshot?.project?.projectId ?? 'Yunmin Workbench'}</b></span>
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
        <div className="compact-body approved-compact-body">
          <button type="button" className="compact-scope approved-compact-task" onClick={() => openWorkbench('continue')} title="Continue in the full Workbench">
            <span className="compact-fact-label">{snapshot.task ? `TASK · ${snapshot.task.taskId}` : snapshot.work ? `WORK · ${snapshot.work.workId}` : 'CURRENT SELECTION'}</span>
            <strong>{snapshot.task?.label ?? snapshot.work?.label ?? snapshot.project.projectId}</strong>
            <span className="compact-task-meta">
              <span className="compact-project">{snapshot.project.projectId}</span>
              {snapshot.task && snapshot.task.taskState !== 'unknown' && <em className={`compact-currentness is-${snapshot.task.taskState}`}>{snapshot.task.taskState}</em>}
              {!snapshot.task && snapshot.work && <em className={`compact-currentness is-${snapshot.work.currentness.toLowerCase()}`}>{snapshot.work.currentness}</em>}
            </span>
          </button>

          <section className={`compact-attention attention-strip${snapshot.attention.length === 0 ? ' is-idle' : ''}`} role="status" aria-label="Attention">
            <i className={snapshot.attention.length > 0 ? 'attention-dot' : 'idle-dot'} aria-hidden="true" />
            <span>
              <small>{snapshot.attention.length > 0 ? 'NEEDS YOU' : 'ATTENTION'}</small>
              <b>{snapshot.attention[0]?.title ?? 'Nothing needs review'}</b>
            </span>
            {snapshot.attention.length > 0 && <button type="button" onClick={() => openWorkbench('continue')}>Review{snapshot.attention.length > 1 ? ` +${snapshot.attention.length - 1}` : ''}</button>}
          </section>

          <section className="compact-running runtime-strip" role="status" aria-label="Runtime and session presence">
            <span className="runtime-avatars" aria-label={`${presence.length} sessions present`}>
              {presence.slice(0, 3).map((session) => <i key={session.id} title={`${session.label} · ${session.runtimeState}`}>{session.platform.slice(0, 2).toUpperCase()}</i>)}
              {presence.length === 0 && <i className="is-empty">—</i>}
            </span>
            <span className="runtime-copy">
              <b>{snapshot.running.length > 0 ? `${snapshot.running.length} working` : presence.length > 0 ? `${presence.length} sessions here` : 'No sessions here'}</b>
              <small>{snapshot.running.length > 0 ? snapshot.running.map((execution) => execution.harness).join(' · ') : 'No live execution fact.'}</small>
            </span>
            <em className={snapshot.running.length > 0 ? 'is-live' : ''}>{snapshot.running.length > 0 ? 'LIVE' : 'IDLE'}</em>
          </section>

          <div className="compact-actions approved-compact-actions">
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
            <p className="compact-footnote">Continue returns to this exact identity. Prepare opens its Context action surface.</p>
          )}
        </div>
      )}
    </div>
    );
}
