import { useEffect, useMemo, useState } from 'react';
import { getMaterialTokens, materialTokensToCssVars, resolveMaterial } from '../core/material/tokens';
import type { MaterialCapability, MaterialMode, MaterialUserPreference } from '../core/material/tokens';

function getReducedTransparency(): boolean {
  if (typeof window === 'undefined' || typeof (window as unknown as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia !== 'function') return false;
  try {
    return (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia('(prefers-reduced-transparency: reduce)').matches;
  } catch { return false; }
}

export function useIslandMaterial() {
  const [preference, setPreference] = useState<MaterialUserPreference>('system');
  const [capability, setCapability] = useState<MaterialCapability | null>(null);
  const [reduced, setReduced] = useState(() => getReducedTransparency());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pref = await (window as unknown as { island: { loadMaterialPreference: () => Promise<{ material: string }> } }).island.loadMaterialPreference();
        if (!cancelled && pref?.material) setPreference(pref.material as MaterialUserPreference);
      } catch {}
      try {
        const cap = await (window as unknown as { island: { getMaterialCapability: () => Promise<MaterialCapability> } }).island.getMaterialCapability();
        if (!cancelled) setCapability(cap);
      } catch {}
    })();
    const off = (window as unknown as { island: { onMaterialChanged: (cb: (p: { material: string }) => void) => () => void } }).island?.onMaterialChanged?.((p) => setPreference(p.material as MaterialUserPreference));
    const mql = typeof window !== 'undefined' && (window as unknown as { matchMedia?: (q: string) => MediaQueryList }).matchMedia ? (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia('(prefers-reduced-transparency: reduce)') : null;
    const handler = () => setReduced(getReducedTransparency());
    if (mql) {
      if (mql.addEventListener) mql.addEventListener('change', handler);
      else (mql as unknown as { addListener: (cb: () => void) => void }).addListener(handler);
    }
    return () => {
      cancelled = true;
      off?.();
      if (mql) {
        if ((mql as unknown as { removeEventListener?: (t: string, cb: () => void) => void }).removeEventListener) (mql as unknown as { removeEventListener: (t: string, cb: () => void) => void }).removeEventListener('change', handler);
        else (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(handler);
      }
    };
  }, []);

  const resolved = useMemo(() => {
    if (!capability) return null;
    const capWithReduced: MaterialCapability = { ...capability, reducedTransparency: reduced };
    return resolveMaterial(preference, capWithReduced, reduced);
  }, [preference, capability, reduced]);

  const effective: MaterialMode = resolved?.effective ?? 'pure';
  const tokens = useMemo(() => getMaterialTokens(effective), [effective]);

  useEffect(() => {
    const vars = materialTokensToCssVars(tokens);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
    root.dataset.material = effective;
    root.dataset.materialRequested = preference;
    if (resolved?.fallbackReason) root.dataset.materialFallback = resolved.fallbackReason;
    else delete root.dataset.materialFallback;
  }, [tokens, effective, preference, resolved]);

  return { preference, effective, tokens, capability, fallbackReason: resolved?.fallbackReason ?? null, reduced };
}
