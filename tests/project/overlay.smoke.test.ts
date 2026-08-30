import { describe, expect, it } from 'vitest';
import { discoverOverlayRoot, loadOverlay } from '../../src/main/adapters/overlaySource';
import { buildControlRoom } from '../../src/core/project/controlRoom';
import { discoverProjects } from '../../src/core/project/discovery';
import { buildCanvasGraph } from '../../src/core/project/canvas';
import { buildStaging } from '../../src/core/project/staging';
import { projectFileSourceRef } from '../../src/core/project/sourceIdentity';
import { FIXTURE_CANONICAL_PATH, FIXTURE_PROJECT_ID, resolveOverlayTarget } from '../fixtures/overlayFixture';

/**
 * Read-only slice over a real Overlay tree. There is no drive-specific path
 * here: either the operator exported `GOV_OVERLAY`, or the portable fixture in
 * `tests/fixtures/overlay` is materialized into a temp dir. Both run the same
 * assertions, so this spec never silently skips on a fresh machine.
 */
const { root: ROOT, searchRoot, fromEnv } = resolveOverlayTarget();

describe(`overlay slice (read-only · ${fromEnv ? 'GOV_OVERLAY' : 'portable fixture'})`, () => {
  it('prefers the GOV_OVERLAY env seam over filesystem scanning', async () => {
    const { root, candidates } = await discoverOverlayRoot(
      searchRoot,
      { GOV_OVERLAY: ROOT } as NodeJS.ProcessEnv,
    );
    expect(root).toBe(ROOT);
    expect(candidates).toEqual([ROOT]);
  });

  it('discovers the overlay under the search root and refuses to guess between candidates', async () => {
    const { root, candidates } = await discoverOverlayRoot(searchRoot, {} as NodeJS.ProcessEnv);
    expect(candidates).toContain(ROOT);
    if (candidates.length === 1) {
      expect(root).toBe(ROOT);
    } else {
      // Governance rule: several candidates means UNKNOWN, never pick one.
      expect(root).toBeUndefined();
    }
  });

  it('loads conversations, adapters, inbox and memory index', async () => {
    const snap = await loadOverlay(ROOT);
    expect(snap.problems).toEqual([]);
    expect(snap.conversations.length).toBeGreaterThan(5);
    expect(snap.projects.some((p) => p.projectId === FIXTURE_PROJECT_ID)).toBe(true);
    expect(snap.inbox.length).toBeGreaterThan(0);
    expect(snap.memoryIndex.length).toBeGreaterThan(10);
    expect(snap.sourceFingerprints.some(
      (fingerprint) => fingerprint.sourceRef === projectFileSourceRef(FIXTURE_PROJECT_ID, FIXTURE_CANONICAL_PATH),
    )).toBe(true);
  });

  it('full slice: control room -> canvas -> staging', async () => {
    const snap = await loadOverlay(ROOT);
    const projects = discoverProjects(snap);
    expect(projects.length).toBeGreaterThan(2);

    const room = buildControlRoom(snap, FIXTURE_PROJECT_ID)!;
    expect(Object.values(room.conversationLifecycle).flat().length).toBeGreaterThan(0);
    expect(room.needsAttention).toEqual([]); // root INBOX is global, not project-scoped
    expect(Object.keys(room.gates).length).toBeGreaterThan(0);

    const g = buildCanvasGraph(snap, FIXTURE_PROJECT_ID);
    expect(g.nodes.length).toBeGreaterThan(2);
    expect(g.edges.filter((e) => e.kind === 'membership').length).toBeGreaterThan(0);
    expect(g.edges.filter((e) => e.kind === 'mount').length).toBe(1);
    expect(g.edges.filter((e) => e.kind === 'execution').length).toBe(0);
    expect(g.edges.filter((e) => e.kind === 'data-context').length).toBe(0);

    const staging = buildStaging(snap, FIXTURE_PROJECT_ID);
    expect(staging.length).toBeGreaterThan(10);
    expect(staging.filter((c) => c.source.startsWith('memory:')).length).toBeGreaterThan(10);
    expect(staging.filter((c) => c.source.startsWith('inbox:'))).toHaveLength(0);
  });
});
