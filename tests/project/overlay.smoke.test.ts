import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { discoverOverlayRoot, loadOverlay } from '../../src/main/adapters/overlaySource';
import { buildControlRoom } from '../../src/core/project/controlRoom';
import { discoverProjects } from '../../src/core/project/discovery';
import { buildCanvasGraph } from '../../src/core/project/canvas';
import { buildStaging } from '../../src/core/project/staging';
import { projectFileSourceRef } from '../../src/core/project/sourceIdentity';

const REAL_ROOT = 'D:\\ai-governance-system';
const hasReal = existsSync(`${REAL_ROOT}\\overlay.yaml`);

describe.runIf(hasReal)('real overlay smoke (read-only)', () => {
  it('discovers exactly one overlay on D:\\', async () => {
    const { root, candidates } = await discoverOverlayRoot('D:\\');
    expect(root).toBe(REAL_ROOT);
    expect(candidates).toEqual([REAL_ROOT]);
  });

  it('loads conversations, adapters, inbox and memory index from real data', async () => {
    const snap = await loadOverlay(REAL_ROOT);
    expect(snap.problems).toEqual([]);
    expect(snap.conversations.length).toBeGreaterThan(5);
    expect(snap.projects.some((p) => p.projectId === 'creative-os')).toBe(true);
    expect(snap.inbox.length).toBeGreaterThan(0);
    expect(snap.memoryIndex.length).toBeGreaterThan(10);
    expect(snap.sourceFingerprints.some(
      (fingerprint) => fingerprint.sourceRef === projectFileSourceRef('creative-os', 'CLAUDE.md'),
    )).toBe(true);
  });

  it('full slice: control room -> canvas -> staging over real data', async () => {
    const snap = await loadOverlay(REAL_ROOT);
    const projects = discoverProjects(snap);
    expect(projects.length).toBeGreaterThan(2);

    const room = buildControlRoom(snap, 'creative-os')!;
    expect(Object.values(room.conversationLifecycle).flat().length).toBeGreaterThan(0);
    expect(room.needsAttention).toEqual([]); // root INBOX is global, not project-scoped
    expect(Object.keys(room.gates).length).toBeGreaterThan(0);

    const g = buildCanvasGraph(snap, 'creative-os');
    expect(g.nodes.length).toBeGreaterThan(2);
    expect(g.edges.filter((e) => e.kind === 'membership').length).toBeGreaterThan(0);
    expect(g.edges.filter((e) => e.kind === 'mount').length).toBe(1);
    expect(g.edges.filter((e) => e.kind === 'execution').length).toBe(0);
    expect(g.edges.filter((e) => e.kind === 'data-context').length).toBe(0);

    const staging = buildStaging(snap, 'creative-os');
    expect(staging.length).toBeGreaterThan(10);
    expect(staging.filter((c) => c.source.startsWith('memory:')).length).toBeGreaterThan(10);
    expect(staging.filter((c) => c.source.startsWith('inbox:'))).toHaveLength(0);
  });
});
