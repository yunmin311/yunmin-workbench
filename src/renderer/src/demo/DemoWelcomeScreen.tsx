import { } from 'react';
import { useWorkbench } from '../store';

/**
 * First-run choice: when no real workspace is open yet, offer a fully isolated
 * Demo Workspace so the product is never a blank shell. `Open real workspace`
 * loads the real Overlay through the normal initialize path; `Try Demo` swaps in
 * an explicitly scoped demo session. It uses the production renderer and
 * dispatch controller, while the adapter resolver selects a deterministic
 * Mock Harness and never writes real History / Memory / Governance state.
 */
export function DemoWelcomeScreen({ onOpenReal, note }: { onOpenReal: () => void; note?: string }) {
  const enterDemo = useWorkbench((state) => state.enterDemo);
  const loading = useWorkbench((state) => state.loading);

  return (
    <div className="demo-welcome-screen">
      <div className="demo-welcome-card">
        <span className="demo-badge">DEMO</span>
        <header>
          <span className="welcome-mark">YW</span>
          <h1>An Agent Workbench you can try without setup</h1>
          <p>
            Open a fully isolated Demo Workspace to see a real Session flow — Context, Packet,
            Runtime, Attention and multi-agent Collaboration — without configuring an Overlay or a Harness.
          </p>
        </header>
        <div className="demo-welcome-actions">
          <button className="primary" onClick={enterDemo}>Try Demo</button>
          <button onClick={() => void onOpenReal()} disabled={loading}>
            {loading ? 'Loading…' : 'Open real workspace'}
          </button>
        </div>
        {note && <p className="demo-welcome-error" role="alert">{note}</p>}
        <p className="demo-welcome-note">
          Demo data is Workbench-owned and sandboxed. Exiting returns to your real workspace untouched.
        </p>
      </div>
    </div>
  );
}
