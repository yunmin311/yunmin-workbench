import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getMaterialTokens,
  materialTokensToCssVars,
  resolveMaterial,
} from '../../../core/material/tokens';
import type { MaterialCapability, MaterialMode, MaterialTokens, MaterialUserPreference } from '../../../core/material/tokens';

interface MaterialContextValue {
  preference: MaterialUserPreference;
  effective: MaterialMode;
  tokens: MaterialTokens;
  capability: MaterialCapability | null;
  fallbackReason: string | null;
  reducedTransparency: boolean;
  setPreference: (pref: MaterialUserPreference) => Promise<void>;
}

const MaterialContext = createContext<MaterialContextValue | null>(null);

function getReducedTransparency(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    // Standard query; some engines use prefers-reduced-transparency, fallback to reduced-motion as accessibility proxy
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return true;
    // Also consider high-contrast + reduced motion as signals that heavy translucency hurts readability
    // We do not force pure on motion alone, only transparency.
    return false;
  } catch {
    return false;
  }
}

export function MaterialProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<MaterialUserPreference>('system');
  const [capability, setCapability] = useState<MaterialCapability | null>(null);
  const [reduced, setReduced] = useState<boolean>(() => getReducedTransparency());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pref = await (window as unknown as { wb: { loadMaterialPreference: () => Promise<{ material: string }> } }).wb.loadMaterialPreference();
        if (!cancelled && pref?.material) setPreferenceState(pref.material as MaterialUserPreference);
      } catch {}
      try {
        const cap = await (window as unknown as { wb: { getMaterialCapability: () => Promise<MaterialCapability> } }).wb.getMaterialCapability();
        if (!cancelled) setCapability(cap);
      } catch {}
    })();
    const off = (window as unknown as { wb: { onMaterialChanged: (cb: (p: { material: string }) => void) => () => void } }).wb?.onMaterialChanged?.((p) => {
      setPreferenceState(p.material as MaterialUserPreference);
    });
    const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-transparency: reduce)') : null;
    const handler = () => setReduced(getReducedTransparency());
    // Safari <14 fallback
    if (mql) {
      if (mql.addEventListener) mql.addEventListener('change', handler);
      else (mql as unknown as { addListener: (cb: () => void) => void }).addListener(handler);
    }
    return () => {
      cancelled = true;
      off?.();
      if (mql) {
        if (mql.removeEventListener) mql.removeEventListener('change', handler);
        else (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(handler);
      }
    };
  }, []);

  const resolved = useMemo(() => {
    if (!capability) return null;
    // Merge renderer reduced flag into capability for resolution
    const capWithReduced: MaterialCapability = { ...capability, reducedTransparency: reduced };
    return resolveMaterial(preference, capWithReduced, reduced);
  }, [preference, capability, reduced]);

  const effective: MaterialMode = resolved?.effective ?? 'pure';
  const tokens = useMemo(() => getMaterialTokens(effective), [effective]);

  useEffect(() => {
    const vars = materialTokensToCssVars(tokens);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.dataset.material = effective;
    root.dataset.materialRequested = preference;
    if (resolved?.fallbackReason) root.dataset.materialFallback = resolved.fallbackReason;
    else delete root.dataset.materialFallback;
    // For accessibility: ensure no GPU crash — never set fully transparent without fallback
    // Pure guarantees opaque; Frost/Glass keep at least 0.48 alpha (see tokens)
  }, [tokens, effective, preference, resolved]);

  const setPreference = async (pref: MaterialUserPreference) => {
    setPreferenceState(pref);
    try {
      await (window as unknown as { wb: { saveMaterialPreference: (m: string) => Promise<void> } }).wb.saveMaterialPreference(pref);
    } catch (e) {
      console.warn('[Material] save failed', e);
    }
  };

  const value: MaterialContextValue = {
    preference,
    effective,
    tokens,
    capability,
    fallbackReason: resolved?.fallbackReason ?? null,
    reducedTransparency: reduced,
    setPreference,
  };

  return <MaterialContext.Provider value={value}>{children}</MaterialContext.Provider>;
}

export function useMaterial(): MaterialContextValue {
  const ctx = useContext(MaterialContext);
  if (!ctx) throw new Error('useMaterial must be used within MaterialProvider');
  return ctx;
}

// Shared source check: Island imports same tokens file — ensure Main + Island share single token source
export { getMaterialTokens as getSharedMaterialTokens };
