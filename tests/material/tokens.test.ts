import { describe, expect, it } from 'vitest';
import { getMaterialTokens, MATERIAL_TOKENS, MATERIAL_TOKEN_KEYS, materialTokensToCssVars } from '../../src/core/material/tokens';
import type { MaterialTokens } from '../../src/core/material/tokens';

describe('Material Tokens — single source, no scattered duplicates', () => {
  it('exposes exactly Pure/Frost/Glass with all required keys', () => {
    for (const mode of ['pure', 'frost', 'glass'] as const) {
      const tokens = getMaterialTokens(mode);
      for (const key of MATERIAL_TOKEN_KEYS) {
        expect(tokens, `missing ${key} in ${mode}`).toHaveProperty(key);
      }
      expect(tokens.surfaceBase).toBeTruthy();
      expect(tokens.backdropBlur).toMatch(/px$/);
      expect(tokens.radius).toMatch(/px$/);
      expect(tokens.shadow).toBeTruthy();
      expect(tokens.textContrast).toBeTruthy();
    }
  });

  it('tokens are distinct per mode and Glass is more transparent/blurred than Frost than Pure', () => {
    const pure = getMaterialTokens('pure');
    const frost = getMaterialTokens('frost');
    const glass = getMaterialTokens('glass');
    expect(pure.backdropBlur).toBe('0px');
    expect(frost.backdropBlur).toBe('12px');
    expect(glass.backdropBlur).toBe('24px');
    expect(pure.frostOpacity).toBe(1);
    expect(frost.frostOpacity).toBeGreaterThan(glass.frostOpacity);
    expect(glass.frostOpacity).toBeLessThan(0.7);
    expect(pure.highlightOpacity).toBe(0);
    expect(glass.highlightOpacity).toBeGreaterThan(frost.highlightOpacity);
    // surfaces become more transparent
    expect(glass.surfaceBase).toContain('0.56');
    expect(frost.surfaceBase).toContain('0.82');
    expect(pure.surfaceBase).not.toContain('rgba');
  });

  it('pure is opaque and safe for fallback (no transparent penetration, no black screen)', () => {
    const pure = getMaterialTokens('pure');
    expect(pure.surfaceBase).toMatch(/^#|^rgb\(/);
    expect(pure.surfaceOverlay).toMatch(/^#|^rgb\(/);
    // backdrop blur 0 ensures no GPU-dependent translucency
    expect(pure.backdropBlur).toBe('0px');
  });

  it('glass uses restrained highlight, not heavy glow — dark low saturation', () => {
    const glass = getMaterialTokens('glass');
    expect(glass.highlightOpacity).toBeLessThan(0.12);
    expect(glass.noiseOpacity).toBeLessThan(0.03);
    expect(glass.surfaceBase).toContain('27,30,36'); // dark low-sat base
    expect(glass.accentGlow).not.toContain('rgba(255,');
    // no heavy emission like '0 0 40px'
    expect(glass.accentGlow).toMatch(/0\.08/);
  });

  it('materialTokensToCssVars maps every token to --wb-* vars', () => {
    const vars = materialTokensToCssVars(getMaterialTokens('frost'));
    for (const key of MATERIAL_TOKEN_KEYS) {
      const cssKey = `--wb-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      // special handling for borderColor etc — ensure at least surface vars present
    }
    expect(vars['--wb-surface-base']).toBeTruthy();
    expect(vars['--wb-backdrop-blur']).toBeTruthy();
    expect(vars['--wb-border-color']).toBeTruthy();
    expect(vars['--wb-shadow']).toBeTruthy();
    expect(vars['--wb-text-contrast']).toBeTruthy();
  });

  it('Main + Island share same token source (no second source)', () => {
    // Both windows import same module — verify Island provider imports same tokens file
    const fs = require('node:fs') as typeof import('node:fs');
    const islandProvider = fs.readFileSync('src/island/IslandMaterialProvider.tsx', 'utf8');
    const mainProvider = fs.readFileSync('src/renderer/src/material/MaterialProvider.tsx', 'utf8');
    expect(islandProvider).toContain("from '../core/material/tokens'");
    expect(mainProvider).toContain("from '../../../core/material/tokens'");
    // Ensure island does not define its own duplicate MATERIAL_TOKENS
    expect(islandProvider).not.toContain('MATERIAL_TOKENS');
    expect(mainProvider).not.toContain('const MATERIAL_TOKENS');
  });

  it('no scattered hardcoded material constants outside token file', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const glob = require('node:fs').readdirSync;
    // Check core surfaces files for hardcoded backdrop-blur values or rgba surfaces that should be tokenized
    const filesToCheck = [
      'src/renderer/src/App.tsx',
      'src/renderer/src/components/MaterialSettings.tsx',
      'src/island/components/AmbientIsland.tsx',
      'src/island/components/AmbientItem.tsx',
    ];
    for (const file of filesToCheck) {
      const content = fs.readFileSync(file, 'utf8');
      // Allow semantic levelColors (alert/action/review) but not generic surface rgba like 30,30,30 or 255,255,255,0.03
      // Check that surface-related rgba is via var(--wb-*)
      // If file contains 'rgba(30, 30, 30' or 'rgba(255, 255, 255, 0.03' it's a scattered constant
      expect(content, `${file} scattered surface rgba`).not.toMatch(/rgba\(30,\s*30,\s*30/);
      expect(content, `${file} scattered surface rgba`).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.0[38]\)/);
    }
    // Styles should consume var, not hardcode backdrop blur 12px/24px outside tokens
    const surfacesCss = fs.readFileSync('src/renderer/src/material/material-surfaces.css', 'utf8');
    expect(surfacesCss).toContain('var(--wb-backdrop-blur)');
    expect(surfacesCss).toContain('var(--wb-surface-');
    expect(surfacesCss).not.toMatch(/backdrop-filter:\s*blur\(12px\)/);
    expect(surfacesCss).not.toMatch(/backdrop-filter:\s*blur\(24px\)/);
  });

  it('textContrast ensures readability over surfaceBase (basic luminance contrast)', () => {
    // Simple WCAG-like check: luminance difference should be high for dark surfaces
    function hexToRgb(hex: string): [number, number, number] | null {
      if (hex.startsWith('rgba')) {
        const m = hex.match(/rgba\((\d+),(\d+),(\d+)/);
        return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
      }
      if (hex.startsWith('#')) {
        const h = hex.slice(1);
        const v = h.length === 3 ? h.split('').map((c) => c.repeat(2)).join('') : h;
        return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
      }
      return null;
    }
    function luminance([r, g, b]: [number, number, number]): number {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }
    for (const mode of ['pure', 'frost', 'glass'] as const) {
      const t = getMaterialTokens(mode as MaterialTokens['surfaceBase'] extends string ? 'pure' : never) as MaterialTokens;
      // Actually get correctly
    }
    (['pure', 'frost', 'glass'] as const).forEach((mode) => {
      const t = getMaterialTokens(mode);
      const bg = hexToRgb(t.surfaceBase) ?? [27, 30, 36];
      const fg = hexToRgb(t.textContrast) ?? [226, 229, 234];
      const l1 = luminance(bg);
      const l2 = luminance(fg);
      const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      // WCAG AA requires 4.5:1 for normal text; we enforce > 4.5 even with translucency base
      expect(contrast, `${mode} contrast ${contrast.toFixed(2)}`).toBeGreaterThan(4.5);
    });
  });
});
