import { useMaterial } from '../material/MaterialProvider';
import type { MaterialUserPreference } from '../../../core/material/tokens';

export function MaterialSettings({ onClose }: { onClose: () => void }) {
  const { preference, effective, fallbackReason, capability, reducedTransparency, setPreference } = useMaterial();

  const options: { value: MaterialUserPreference; label: string }[] = [
    { value: 'system', label: 'System/Auto' },
    { value: 'pure', label: 'Pure' },
    { value: 'frost', label: 'Frost' },
    { value: 'glass', label: 'Glass' },
  ];

  return (
    <div className="material-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="material-panel"
        role="dialog"
        aria-label="Material preference"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 52,
          right: 12,
          zIndex: 75,
          width: 320,
          background: 'var(--wb-surface-overlay)',
          backdropFilter: 'blur(var(--wb-backdrop-blur))',
          WebkitBackdropFilter: 'blur(var(--wb-backdrop-blur))',
          border: '1px solid var(--wb-border-color)',
          borderRadius: 'var(--wb-radius)',
          boxShadow: 'var(--wb-elevation)',
          padding: 14,
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <p className="eyebrow">Material</p>
            <h2 style={{ margin: 0, fontSize: 14 }}>Material Layer</h2>
          </div>
          <button className="icon-action" aria-label="Close Material" onClick={onClose}>×</button>
        </header>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          System follows capability; Glass requires native backdrop. Fallback is observable, never silent.
        </p>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--wb-text-contrast)', marginBottom: 6 }}>
          Preference
          <select
            value={preference}
            onChange={(e) => void setPreference(e.target.value as MaterialUserPreference)}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--wb-border-color)',
              background: 'var(--wb-surface-raised)',
              color: 'var(--wb-text-contrast)',
            }}
            aria-label="Select material preference"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--wb-text-contrast)', background: 'var(--wb-surface-raised)', border: '1px solid var(--wb-border-color)', borderRadius: 6, padding: '8px 10px' }}>
          <div><strong>Requested:</strong> {preference}</div>
          <div><strong>Effective:</strong> {effective} {fallbackReason ? <span style={{ color: '#e0af68' }}> (fallback)</span> : null}</div>
          {fallbackReason && <div style={{ color: '#e0af68', fontSize: 10 }}>{fallbackReason}</div>}
          <div style={{ marginTop: 6, color: 'var(--wb-text-contrast)', opacity: 0.8 }}>
            <div>Capability: {capability ? `${capability.supportsGlass ? 'glass' : capability.supportsFrost ? 'frost' : 'pure'}${capability.reason ? ` — ${capability.reason}` : ''}` : 'loading…'}</div>
            <div>Reduced transparency: {reducedTransparency ? 'reduce — forced pure' : 'no'}</div>
            <div>Windows: {capability?.isWindows ? 'yes' : 'no'}</div>
          </div>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          Preference stored in <code>Workbench userData/state/material/material-v1.json</code> only. No overlay/history write.
        </p>
      </aside>
    </div>
  );
}
