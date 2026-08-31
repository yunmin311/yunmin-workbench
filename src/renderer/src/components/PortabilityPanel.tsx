import { useEffect, useState } from 'react';
import type { ProfileImportPreview } from '../../../core/portability/bundle';
import type { ProjectRootBindingsV1 } from '../../../main/projectRootBindings';
import { useWorkbench } from '../store';

export function PortabilityPanel({ onClose }: { onClose: () => void }) {
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const refreshProjectFiles = useWorkbench((state) => state.refreshProjectFiles);
  const [preview, setPreview] = useState<ProfileImportPreview | null>(null);
  const [exportPreview, setExportPreview] = useState<{
    digest: string; drafts: number; manualContexts: number; projectBindings: number; workspaceSession: boolean;
    included: string[]; skipped: string[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bindings, setBindings] = useState<ProjectRootBindingsV1 | null>(null);
  const reloadBindings = async () => setBindings(await window.wb.loadProjectRootBindings());
  useEffect(() => { void reloadBindings().catch((error) => setMessage(String(error))); }, []);
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await task(); } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return (
    <div className="portability-layer" role="presentation" onMouseDown={onClose}>
      <section className="portability-panel" role="dialog" aria-label="Workbench profile portability" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Workbench-owned state only</small><h2>Profile Portability</h2></div><button aria-label="Close portability" onClick={onClose}>×</button></header>
        <p className="portability-note">Preview is mandatory. External Governance, Git, Runtime, History transcripts, caches, Attention and secrets are never imported.</p>
        <div className="portability-actions">
          <button disabled={busy} onClick={() => void run(async () => {
            const result = await window.wb.previewProfileExport();
            setExportPreview(result.preview);
          })}>Export Profile</button>
          <button disabled={busy} onClick={() => void run(async () => {
            const result = await window.wb.previewProfileImport();
            if (result.preview) setPreview(result.preview);
          })}>Import Profile…</button>
          <button disabled={busy || !projectId} onClick={() => void run(async () => {
            if (!projectId) return;
            const result = await window.wb.rebindProjectRoot(projectId);
            if (!result.canceled) { await reloadBindings(); await refreshProjectFiles(); setMessage(`Project root verified and rebound: ${projectId}`); }
          })}>Rebind Project Root{projectId ? ` · ${projectId}` : ''}</button>
        </div>
        {!projectId && <p className="portability-note">Select a project before rebinding a root.</p>}
        {exportPreview && <div className="portability-preview" aria-label="Profile export preview">
          <h3>Export preview</h3>
          <p>{exportPreview.drafts} drafts · {exportPreview.manualContexts} Manual Context items · {exportPreview.projectBindings} historical root locators · {exportPreview.workspaceSession ? 'workspace included' : 'no workspace session'}</p>
          <details open><summary>Included</summary><p>{exportPreview.included.join(', ')}</p></details>
          <details><summary>{exportPreview.skipped.length} explicitly skipped categories</summary><p>{exportPreview.skipped.join(', ')}</p></details>
          <button className="primary" disabled={busy} onClick={() => void run(async () => {
            const result = await window.wb.applyProfileExport(exportPreview.digest);
            if (!result.canceled) { setMessage(`Profile exported: ${result.path}`); setExportPreview(null); }
          })}>Save Export…</button>
        </div>}
        {bindings && Object.values(bindings.unresolved).length > 0 && <div className="portability-preview" aria-label="Unresolved project roots">
          <h3>Unresolved project roots</h3>
          {Object.values(bindings.unresolved).map((item) => <div className="binding-preview" key={item.projectId}>
            <strong>{item.projectId}</strong><span>{item.status}</span><small>{item.historicalLocator}</small>
          </div>)}
        </div>}
        {preview && <div className="portability-preview" aria-label="Profile import preview">
          <h3>Import preview</h3>
          <p>{preview.additions.length} additions · {preview.updates.length} updates · {preview.bindings.filter((item) => item.status === 'REBIND REQUIRED').length} need rebind</p>
          {preview.additions.length > 0 && <details open><summary>Will add</summary><p>{preview.additions.join(', ')}</p></details>}
          {preview.updates.length > 0 && <details open><summary>Would update (blocked)</summary><p>{preview.updates.join(', ')}</p></details>}
          {preview.bindings.map((item) => <div className="binding-preview" key={item.projectId}>
            <strong>{item.projectId}</strong><span>{item.status}</span><small>{item.historicalLocator}</small>
          </div>)}
          <details><summary>{preview.skipped.length} explicitly skipped categories</summary><p>{preview.skipped.join(', ')}</p></details>
          <button className="primary" disabled={busy || !preview.canImport} onClick={() => void run(async () => {
            await window.wb.applyProfileImport(preview.digest);
            await reloadBindings();
            setMessage('Workbench profile imported atomically. Reloading restored workspace…'); setPreview(null);
            window.location.reload();
          })}>Apply Import</button>
          {!preview.canImport && <p className="error">Conflicts must be resolved before import. Nothing has been written.</p>}
        </div>}
        {snapshot && <p className="portability-note">Machine: {snapshot.machine?.displayName ?? 'UNKNOWN'}</p>}
        {message && <p className={message.startsWith('Error') ? 'error' : 'ok'}>{message}</p>}
      </section>
    </div>
  );
}
