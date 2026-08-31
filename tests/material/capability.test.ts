import { describe, expect, it } from 'vitest';
import { resolveMaterial } from '../../src/core/material/tokens';
import type { MaterialCapability } from '../../src/core/material/tokens';

const baseCap = (overrides: Partial<MaterialCapability> = {}): MaterialCapability => ({
  supportsGlass: true,
  supportsFrost: true,
  supportsPure: true,
  reason: null,
  isWindows: true,
  reducedTransparency: false,
  ...overrides,
});

describe('Material capability fallback — priority glass → frost → pure', () => {
  it('system auto picks glass when native available', () => {
    const r = resolveMaterial('system', baseCap({ supportsGlass: true, supportsFrost: true }));
    expect(r.effective).toBe('glass');
    expect(r.fallbackReason).toBeNull();
  });
  it('system picks frost when glass unavailable but frost supported', () => {
    const r = resolveMaterial('system', baseCap({ supportsGlass: false, supportsFrost: true, reason: 'native glass: Windows only' }));
    expect(r.effective).toBe('frost');
    expect(r.fallbackReason).toBeNull(); // system fallback not considered user-visible fallback? Actually system→pure has reason, system→frost is still auto, not fallback
  });
  it('system falls back to pure when nothing supported', () => {
    const r = resolveMaterial('system', baseCap({ supportsGlass: false, supportsFrost: false, reason: 'GPU unavailable' }));
    expect(r.effective).toBe('pure');
    expect(r.fallbackReason).toContain('pure');
  });
  it('user forces frost and gets frost when supported', () => {
    const r = resolveMaterial('frost', baseCap({ supportsGlass: true, supportsFrost: true }));
    expect(r.effective).toBe('frost');
    expect(r.fallbackReason).toBeNull();
  });
  it('user forces frost falls back to pure when unsupported', () => {
    const r = resolveMaterial('frost', baseCap({ supportsGlass: false, supportsFrost: false, reason: 'test' }));
    expect(r.effective).toBe('pure');
    expect(r.fallbackReason).toMatch(/frost unavailable/);
  });
  it('user forces glass gets glass when native available', () => {
    const r = resolveMaterial('glass', baseCap({ supportsGlass: true }));
    expect(r.effective).toBe('glass');
    expect(r.fallbackReason).toBeNull();
  });
  it('user forces glass falls back to frost when glass unsupported but frost available (observable)', () => {
    const r = resolveMaterial('glass', baseCap({ supportsGlass: false, supportsFrost: true, reason: 'WB_DISABLE_GLASS=1' }));
    expect(r.effective).toBe('frost');
    expect(r.fallbackReason).toContain('glass unavailable');
    expect(r.fallbackReason).toContain('frost');
  });
  it('user forces glass falls back to pure when even frost unsupported and does not crash', () => {
    const r = resolveMaterial('glass', baseCap({ supportsGlass: false, supportsFrost: false, reason: 'GPU unavailable' }));
    expect(r.effective).toBe('pure');
    expect(r.fallbackReason).toContain('glass unavailable');
    expect(r.fallbackReason).toContain('pure');
  });
  it('pure always succeeds regardless of capability', () => {
    for (const cap of [
      baseCap({ supportsGlass: false, supportsFrost: false }),
      baseCap({ supportsGlass: false, supportsFrost: true }),
      baseCap({ supportsGlass: true }),
    ]) {
      const r = resolveMaterial('pure', cap);
      expect(r.effective).toBe('pure');
      expect(r.fallbackReason).toBeNull();
    }
  });
  it('glass unavailable does not cause black screen or transparent penetration — pure is opaque', async () => {
    const { getMaterialTokens } = await import('../../src/core/material/tokens');
    const pure = getMaterialTokens('pure');
    expect(pure.surfaceBase).not.toContain('rgba');
    expect(pure.backdropBlur).toBe('0px');
  });
});

describe('Material reduced-transparency accessibility', () => {
  it('forces pure regardless of preference when reducedTransparency true', () => {
    const cap = baseCap({ supportsGlass: true, supportsFrost: true, reducedTransparency: true });
    for (const pref of ['system', 'glass', 'frost', 'pure'] as const) {
      const r = resolveMaterial(pref, cap, true);
      expect(r.effective).toBe('pure');
    }
  });
  it('reports fallbackReason when forced pure due to reduced transparency', () => {
    const cap = baseCap({ supportsGlass: true, reducedTransparency: true });
    const r = resolveMaterial('glass', cap, true);
    expect(r.fallbackReason).toContain('reduced-transparency');
  });
  it('does not force pure when reducedTransparency false', () => {
    const cap = baseCap({ supportsGlass: true, reducedTransparency: false });
    const r = resolveMaterial('glass', cap, false);
    expect(r.effective).toBe('glass');
  });
});

describe('Material no AGPL code copied', () => {
  it('material files do not contain AGPL-licensed plugin code markers', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const files = [
      'src/core/material/tokens.ts',
      'src/main/materialCapability.ts',
      'src/main/materialPersistence.ts',
      'src/renderer/src/material/MaterialProvider.tsx',
    ];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      // Ensure we did not copy Mica implementation strings from donor (actual native calls)
      expect(content).not.toMatch(/SetWindowCompositionAttribute|ACCENT_ENABLE_BLURBEHIND/);
      // Ensure no AGPL license header was copied
      expect(content).not.toMatch(/GNU AFFERO GENERAL PUBLIC LICENSE/);
    }
  });
});
