import { z } from 'zod';

/**
 * Material Layer Phase 1 — independent, switchable, degradable.
 * Material ≠ Product Structure. Tokens are the single source for Main + Island.
 * Donors studied as engineering reference only (no AGPL code copied):
 *  - hicccc77/electron-liquid-glass (native glass/refraction on Windows)
 *  - hwyuanzi/LiquidGlass-UI (tokens/fallback/reduced-transparency)
 *  - DSH Transparent UI Plugin/Aqua (Mica/compatibility visual reference, AGPL-3.0 — not copied)
 */

export type MaterialMode = 'pure' | 'frost' | 'glass';
export type MaterialUserPreference = 'system' | 'pure' | 'frost' | 'glass';

export interface MaterialTokens {
  // core surfaces — dark, low saturation, restrained
  surfaceBase: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  backdropBlur: string; // e.g. '0px' | '12px' | '24px'
  frostOpacity: number; // 0-1, effective alpha scalar for overlay surfaces
  borderOpacity: number;
  highlightOpacity: number;
  noiseOpacity: number;
  elevation: string; // shadow level token
  radius: string;
  shadow: string;
  textContrast: string; // primary text color ensuring readability over surfaceBase
  accentGlow: string; // subtle glow, not heavy emission
  // derived CSS helpers
  borderColor: string;
  highlightColor: string;
}

export const MaterialUserPreferenceSchema = z.enum(['system', 'pure', 'frost', 'glass']);
export const MaterialModeSchema = z.enum(['pure', 'frost', 'glass']);

export const MATERIAL_TOKENS: Record<MaterialMode, MaterialTokens> = {
  pure: {
    surfaceBase: '#1b1e24',
    surfaceRaised: '#20242b',
    surfaceOverlay: '#272c35',
    backdropBlur: '0px',
    frostOpacity: 1,
    borderOpacity: 1,
    highlightOpacity: 0,
    noiseOpacity: 0,
    elevation: '0 12px 40px rgba(0,0,0,0.34)',
    radius: '8px',
    shadow: '0 4px 20px rgba(0,0,0,0.32)',
    textContrast: '#e2e5ea',
    accentGlow: 'none',
    borderColor: 'rgba(48,54,64,1)',
    highlightColor: 'transparent',
  },
  frost: {
    surfaceBase: 'rgba(27,30,36,0.82)',
    surfaceRaised: 'rgba(32,36,43,0.76)',
    surfaceOverlay: 'rgba(39,44,53,0.68)',
    backdropBlur: '12px',
    frostOpacity: 0.82,
    borderOpacity: 0.14,
    highlightOpacity: 0.05,
    noiseOpacity: 0.015,
    elevation: '0 16px 48px rgba(0,0,0,0.38)',
    radius: '10px',
    shadow: '0 8px 32px rgba(0,0,0,0.38)',
    textContrast: '#e2e5ea',
    accentGlow: '0 0 0 1px rgba(255,255,255,0.04) inset',
    borderColor: 'rgba(255,255,255,0.08)',
    highlightColor: 'rgba(255,255,255,0.06)',
  },
  glass: {
    surfaceBase: 'rgba(27,30,36,0.56)',
    surfaceRaised: 'rgba(32,36,43,0.52)',
    surfaceOverlay: 'rgba(39,44,53,0.48)',
    backdropBlur: '24px',
    frostOpacity: 0.56,
    borderOpacity: 0.12,
    highlightOpacity: 0.09,
    noiseOpacity: 0.02,
    elevation: '0 20px 64px rgba(0,0,0,0.42)',
    radius: '12px',
    shadow: '0 12px 40px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.06) inset',
    textContrast: '#e9ecf1',
    accentGlow: '0 0 20px rgba(110,158,255,0.08)',
    borderColor: 'rgba(255,255,255,0.10)',
    highlightColor: 'rgba(255,255,255,0.09)',
  },
};

export function getMaterialTokens(mode: MaterialMode): MaterialTokens {
  return MATERIAL_TOKENS[mode];
}

/**
 * Capability detection result — runtime/effective glass determination.
 * Pure is always available; Frost requires basic backdrop support; Glass requires native/effective glass.
 * No black-screen / transparent-penetration / GPU crash: must degrade.
 */
export interface MaterialCapability {
  supportsGlass: boolean;
  supportsFrost: boolean;
  supportsPure: true;
  reason: string | null; // observable fallback reason when Glass unavailable
  isWindows: boolean;
  reducedTransparency: boolean; // accessibility signal, forced degraded path
}

export interface MaterialResolution {
  requested: MaterialUserPreference;
  effective: MaterialMode;
  fallbackReason: string | null;
  capability: MaterialCapability;
}

/**
 * Resolve effective mode from user preference + capability + accessibility.
 * Priority: native glass → Glass, partial backdrop → Frost, unsupported/reduced/GPU → Pure.
 * If user forces Glass but unavailable, fallback is observable (fallbackReason), never silently pretends Glass.
 */
export function resolveMaterial(
  userPreference: MaterialUserPreference,
  capability: MaterialCapability,
  reducedTransparencyOverride?: boolean,
): MaterialResolution {
  const reduced = reducedTransparencyOverride ?? capability.reducedTransparency;
  // Accessibility: reduced transparency forces Pure (or Frost if strictly needed — we choose Pure for max readability)
  if (reduced) {
    return {
      requested: userPreference,
      effective: 'pure',
      fallbackReason: userPreference !== 'pure' ? 'reduced-transparency: forced pure' : null,
      capability,
    };
  }

  const wants: MaterialMode | 'system' = userPreference === 'system' ? 'system' : userPreference;
  if (wants === 'system') {
    if (capability.supportsGlass) return { requested: userPreference, effective: 'glass', fallbackReason: null, capability };
    if (capability.supportsFrost) return { requested: userPreference, effective: 'frost', fallbackReason: null, capability };
    return { requested: userPreference, effective: 'pure', fallbackReason: capability.reason ? `system → pure (${capability.reason})` : 'system → pure', capability };
  }
  if (wants === 'glass') {
    if (capability.supportsGlass) return { requested: userPreference, effective: 'glass', fallbackReason: null, capability };
    if (capability.supportsFrost) return { requested: userPreference, effective: 'frost', fallbackReason: capability.reason ? `glass unavailable: ${capability.reason} → frost` : 'glass unavailable → frost', capability };
    return { requested: userPreference, effective: 'pure', fallbackReason: capability.reason ? `glass unavailable: ${capability.reason} → pure` : 'glass unavailable → pure', capability };
  }
  if (wants === 'frost') {
    if (capability.supportsFrost) return { requested: userPreference, effective: 'frost', fallbackReason: null, capability };
    return { requested: userPreference, effective: 'pure', fallbackReason: capability.reason ? `frost unavailable: ${capability.reason} → pure` : 'frost unavailable → pure', capability };
  }
  return { requested: userPreference, effective: 'pure', fallbackReason: null, capability };
}

export function materialTokensToCssVars(tokens: MaterialTokens): Record<string, string> {
  return {
    '--wb-surface-base': tokens.surfaceBase,
    '--wb-surface-raised': tokens.surfaceRaised,
    '--wb-surface-overlay': tokens.surfaceOverlay,
    '--wb-backdrop-blur': tokens.backdropBlur,
    '--wb-frost-opacity': String(tokens.frostOpacity),
    '--wb-border-opacity': String(tokens.borderOpacity),
    '--wb-highlight-opacity': String(tokens.highlightOpacity),
    '--wb-noise-opacity': String(tokens.noiseOpacity),
    '--wb-elevation': tokens.elevation,
    '--wb-radius': tokens.radius,
    '--wb-shadow': tokens.shadow,
    '--wb-text-contrast': tokens.textContrast,
    '--wb-accent-glow': tokens.accentGlow,
    '--wb-border-color': tokens.borderColor,
    '--wb-highlight-color': tokens.highlightColor,
  };
}

// Guard: ensure no scattered hardcoded rgba/blur outside token source — tested via grep in tests/material
export const MATERIAL_TOKEN_KEYS = [
  'surfaceBase',
  'surfaceRaised',
  'surfaceOverlay',
  'backdropBlur',
  'frostOpacity',
  'borderOpacity',
  'highlightOpacity',
  'noiseOpacity',
  'elevation',
  'radius',
  'shadow',
  'textContrast',
  'accentGlow',
] as const;
