import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(path, 'utf8');

describe('approved blue donor-transplant production contract', () => {
  it('mounts the approved Full composition around the existing read model', async () => {
    const source = await read('src/renderer-vnext/src/components/canvas/WorkGraphCanvas.tsx');
    const ordered = [
      'approved-presence-rail',
      'approved-work-rail',
      'approved-main-surface',
      'approved-team-dock',
    ];
    let cursor = -1;
    for (const marker of ordered) {
      const next = source.indexOf(marker);
      expect(next, `${marker} must exist`).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(source).toContain('approved-bounded-plane');
    expect(source).toContain('approved-composer');
    expect(source).toContain('<ContextCabinet');
    expect(source).toContain('<DispatchSurface');
  });

  it('transplants the approved geometry and blue translation tokens without redefining core semantics', async () => {
    const css = await read('src/renderer-vnext/src/styles/approved-blue.css');
    expect(css).toContain('grid-template-columns: 64px 248px minmax(0, 1fr) 320px');
    expect(css).toContain('grid-template-rows: 106px minmax(0, 1fr)');
    expect(css).toContain('--approved-accent: #7892f2');
    expect(css).toContain('--approved-paper: #e9edf4');
    expect(css).toContain('@media (max-width: 1099px)');
    expect(css).not.toMatch(/--semantic-|canonical|sourceOfTruth|dispatchPipeline/);
  });

  it('keeps Context available distinct from used and UNKNOWN out of invented status copy', async () => {
    const source = await read('src/renderer-vnext/src/components/canvas/WorkGraphCanvas.tsx');
    const cabinet = await read('src/renderer-vnext/src/components/cabinet/ContextCabinet.tsx');
    expect(cabinet).toContain('Available is not used');
    expect(source).not.toMatch(/UNKNOWN\s*[=:]\s*['"](?:ready|active|running)/i);
    expect(source).toContain('revision.candidate.semanticFacts');
  });

  it('uses the approved Compact shell while retaining current-selection navigation', async () => {
    const source = await read('src/renderer-compact/CompactApp.tsx');
    const css = await read('src/renderer-compact/approved-compact.css');
    expect(source).toContain('approved-compact-window');
    expect(source).toContain('compactNavigationFromSnapshot');
    expect(source).toContain("openWorkbench('prepare')");
    expect(css).toContain('border-radius: 14px');
    expect(css).toContain('--approved-accent: #7892f2');
  });
});
