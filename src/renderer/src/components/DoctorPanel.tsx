import { useEffect, useState } from 'react';
import type { DoctorReport } from '../../../main/doctor';

export function DoctorPanel({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = async () => {
    setLoading(true);
    setProblem(null);
    try { setReport(await window.wb.runDoctor()); }
    catch (error) { setProblem(`Doctor unavailable: ${String(error)}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { void run(); }, []);

  return (
    <div className="portability-layer" role="presentation" onMouseDown={onClose}>
      <section className="portability-panel doctor-panel" role="dialog" aria-label="Workbench Doctor diagnostics" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>Read-only · bounded · on demand</small><h2>Workbench Doctor</h2></div>
          <button aria-label="Close Doctor" onClick={onClose}>×</button>
        </header>
        <p className="portability-note">Checks launch, local state, project bindings, harnesses, portability and Material. It never edits Harness configuration, secrets, system environment, external History, or the Overlay.</p>
        <div className="portability-actions">
          <button disabled={loading} onClick={() => void run()}>{loading ? 'Checking…' : 'Run again'}</button>
          {report && <button onClick={() => void window.wb.copyText(report.checks.map((item) => `${item.status}\t${item.label}\t${item.reason}\t${item.provenance}`).join('\n'))}>Copy report</button>}
        </div>
        {problem && <p className="error" role="alert">{problem}</p>}
        {report && (
          <div className="doctor-checks" aria-live="polite">
            {report.checks.map((item) => (
              <article key={item.id} className={`doctor-check doctor-${item.status.toLowerCase()}`} data-testid={`doctor-${item.id}`}>
                <span className="doctor-status">{item.status}</span>
                <div><strong>{item.label}</strong><p>{item.reason}</p><small>{item.provenance}</small></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
