import type { MaterialCapability } from '../core/material/tokens';

/**
 * Runtime capability + fallback
 * References (engineering reference only, no code copied):
 *  - hicccc77/electron-liquid-glass : native glass/refraction via DWM/Windows composition
 *  - hwyuanzi/LiquidGlass-UI : tokens & reduced-transparency fallback
 *  - DSH Transparent UI Plugin/Aqua : Mica/compatibility visual reference (AGPL — not copied)
 */

export function detectMaterialCapability(opts?: {
  reducedTransparency?: boolean;
  envOverride?: NodeJS.ProcessEnv;
}): MaterialCapability {
  const env = opts?.envOverride ?? process.env;
  const reduced = opts?.reducedTransparency ?? false;

  // Allow test harness to force unsupported path without GPU
  if (env.WB_DISABLE_GLASS === '1') {
    return {
      supportsGlass: false,
      supportsFrost: env.WB_DISABLE_FROST === '1' ? false : true,
      supportsPure: true,
      reason: 'WB_DISABLE_GLASS=1 (test harness / unsupported GPU)',
      isWindows: process.platform === 'win32',
      reducedTransparency: reduced,
    };
  }
  if (env.WB_FORCE_MATERIAL_CAPABILITY === 'pure') {
    return { supportsGlass: false, supportsFrost: false, supportsPure: true, reason: 'forced pure via env', isWindows: process.platform === 'win32', reducedTransparency: reduced };
  }
  if (env.WB_FORCE_MATERIAL_CAPABILITY === 'frost') {
    return { supportsGlass: false, supportsFrost: true, supportsPure: true, reason: null, isWindows: process.platform === 'win32', reducedTransparency: reduced };
  }
  if (env.WB_FORCE_MATERIAL_CAPABILITY === 'glass') {
    return { supportsGlass: true, supportsFrost: true, supportsPure: true, reason: null, isWindows: process.platform === 'win32', reducedTransparency: reduced };
  }

  const isWindows = process.platform === 'win32';
  // Transparent windows require compositor; on non-Windows (macOS/Linux) Electron still supports backdrop-filter via CSS
  // but native glass (DWM blur) is Windows-specific. We treat non-Windows as frost-capable via CSS backdrop-filter.
  // Check GPU — if disable-gpu flag or app has no hardware acceleration, degrade to pure.
  let hasGpu = true;
  try {
    // Electron app may not be available in vitest/node; degrade gracefully
    const electron = (() => {
      try { return require('electron') as { app?: { getGPUFeatureStatus?: () => Record<string, string> } }; } catch { return null; }
    })();
    const app = electron?.app;
    if (app && typeof app.getGPUFeatureStatus === 'function') {
      const status = app.getGPUFeatureStatus();
      const val = (status as Record<string, string>).gpu_compositing;
      if (val && val.includes('disabled')) hasGpu = false;
    }
  } catch {
    hasGpu = true;
  }
  if (!hasGpu) {
    return {
      supportsGlass: false,
      supportsFrost: false,
      supportsPure: true,
      reason: 'GPU acceleration unavailable',
      isWindows,
      reducedTransparency: reduced,
    };
  }

  if (!isWindows) {
    // CSS backdrop-filter works cross-platform; treat as frost-capable, glass requires Windows native
    return {
      supportsGlass: false,
      supportsFrost: true,
      supportsPure: true,
      reason: 'native glass: Windows only — frost via CSS backdrop-filter',
      isWindows,
      reducedTransparency: reduced,
    };
  }

  // Windows: check version for DWM glass. Windows 10+ supports DWM blur; Windows 11 supports Mica-like.
  // We keep conservative: Windows 10+ → glass, older → frost.
  let winSupportsGlass = true;
  try {
    const release = require('node:os').release(); // e.g. '10.0.22631'
    const major = parseInt(release.split('.')[0] ?? '10', 10);
    if (major < 10) winSupportsGlass = false;
  } catch {
    winSupportsGlass = true;
  }

  if (winSupportsGlass) {
    return { supportsGlass: true, supportsFrost: true, supportsPure: true, reason: null, isWindows, reducedTransparency: reduced };
  }
  return { supportsGlass: false, supportsFrost: true, supportsPure: true, reason: 'legacy Windows without DWM glass', isWindows, reducedTransparency: reduced };
}
