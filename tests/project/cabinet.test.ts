import { describe, expect, it } from 'vitest';
import {
  applyCabinetPin,
  applyCabinetState,
  buildCabinetItems,
  cabinetItemCurrentness,
  cabinetScopeKey,
  cabinetStaging,
  cabinetSummary,
} from '../../src/core/project/cabinet';
import { buildWorkbenchDraft, restoreWorkbenchDraft } from '../../src/core/project/draft';
import { compilePacket } from '../../src/core/project/packet';
import { buildCanonicalWorkGraphFacts } from '../../src/core/workgraph/sourceFacts';
import { compileWorkGraph } from '../../src/core/workgraph/compiler';
import type { ContextItem, OverlaySnapshot } from '../../src/core/types';

const NOW = '2026-09-12T00:00:00.000Z';

/** Shaped like the real Overlay projection (adapter gates, canonical source, scoped INBOX, global memory). */
function snapshotFixture(): OverlaySnapshot {
  const observation = {
    source: 'canonical-file' as const,
    sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml',
    observedAt: NOW,
    verification: 'OBSERVED' as const,
  };
  return {
    overlayRoot: '/overlay',
    foundAt: NOW,
    conversations: [],
    projects: [{
      projectId: 'creative-os',
      displayName: 'Creative OS',
      status: 'active',
      canonicalSource: { path: 'CLAUDE.md', remote: 'https://github.com/yunmin311/creative-os.git', commit: 'abc1234' },
      roles: [],
      gates: { visual: 'gallery-first', verify: 'fail-closed' },
      trust: 'VERIFIED',
      observed: observation,
    }],
    inbox: [
      { id: 'inbox:2', scope: 'project', projectId: 'creative-os', raw: '- [ ] ship gallery', done: false, attention: true, line: 2, sourceRef: 'overlay:INBOX.md#L2' },
      { id: 'inbox:5', scope: 'project', projectId: 'other-project', raw: '- [ ] other project line', done: false, attention: true, line: 5, sourceRef: 'overlay:INBOX.md#L5' },
    ],
    memoryIndex: [
      { id: 'token-budget-and-optimization', title: 'Token budget and optimization', hook: 'keep prompts small', category: 'workflow', sourceRef: 'overlay:memory/MEMORY.md' },
    ],
    harness: [],
    sourceFingerprints: [
      { sourceRef: 'overlay:memory/MEMORY.md', sha256: 'a'.repeat(64) },
      { sourceRef: 'overlay:INBOX.md', sha256: 'b'.repeat(64) },
      { sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml', sha256: 'c'.repeat(64) },
    ],
    problems: [],
  };
}

describe('Context Cabinet staging domain (PHASE 3C.1)', () => {
  it('builds source-first items from the real staging candidates', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    const byId = new Map(items.map((item) => [item.id, item]));

    // Governance: adapter gates + canonical source, source-declared included.
    expect(byId.get('gate:creative-os:visual')).toMatchObject({ group: 'governance', binding: 'project', state: 'included', fingerprintAvailable: true });
    expect(byId.get('canon:creative-os')).toMatchObject({ group: 'governance', isReference: true, sourceRef: 'project-file:creative-os:CLAUDE.md', fingerprintAvailable: false });
    // Exact project scope only: the other-project INBOX line never appears.
    expect(byId.get('inbox:2')).toMatchObject({ group: 'inbox', binding: 'project', state: 'available' });
    expect(items.some((item) => item.sourceRef?.includes('L5') || item.id === 'inbox:5')).toBe(false);
    // Global memory stays available and unbound.
    expect(byId.get('memory:token-budget-and-optimization')).toMatchObject({
      group: 'memory', binding: 'unbound', state: 'available', pinned: false,
      sourceRef: 'overlay:memory/MEMORY.md', provenance: 'EXTERNAL',
    });
  });

  it('keeps available != included: defaults come from the source, memory never starts included', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    const memory = items.find((item) => item.group === 'memory')!;
    expect(memory.state).toBe('available');
    expect(memory.pinned).toBe(false);
    const summary = cabinetSummary(items);
    expect(summary).toMatchObject({ included: 3, available: 2, excluded: 0, pinned: 0 });
  });

  it('include / exclude decisions are deterministic and idempotent', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    const included = applyCabinetState(items, memoryId, 'included');
    expect(cabinetStaging(included).find((item) => item.id === memoryId)).toMatchObject({ state: 'included', pinned: false });
    // Same decision twice -> same result (identity stays, order stays).
    expect(cabinetStaging(applyCabinetState(included, memoryId, 'included'))).toEqual(cabinetStaging(included));
    const excluded = applyCabinetState(included, memoryId, 'excluded');
    expect(cabinetStaging(excluded).find((item) => item.id === memoryId)).toMatchObject({ state: 'excluded', pinned: false });
    // Exclude is also idempotent.
    expect(cabinetStaging(applyCabinetState(excluded, memoryId, 'excluded'))).toEqual(cabinetStaging(excluded));
  });

  it('pin / unpin is deterministic; pin requires included and exclude drops the pin', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    expect(() => applyCabinetPin(items, memoryId, true)).toThrow(/not included/);
    const included = applyCabinetState(items, memoryId, 'included');
    const pinned = applyCabinetPin(included, memoryId, true);
    expect(pinned.find((item) => item.id === memoryId)).toMatchObject({ state: 'included', pinned: true });
    expect(cabinetSummary(pinned)).toMatchObject({ pinned: 1 });
    const unpinned = applyCabinetPin(pinned, memoryId, false);
    expect(unpinned.find((item) => item.id === memoryId)?.pinned).toBe(false);
    const excludedAfterPin = applyCabinetState(pinned, memoryId, 'excluded');
    expect(excludedAfterPin.find((item) => item.id === memoryId)).toMatchObject({ state: 'excluded', pinned: false });
  });

  it('never binds global Memory to the project or invents a coffee/context-source item', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    for (const item of items) {
      if (item.group === 'memory') expect(item.binding).toBe('unbound');
    }
    // Every item identity traces to the Overlay staging sources; the Coffee
    // placeholder (UNKNOWN/UNAVAILABLE) can never surface as an available item.
    for (const item of items) {
      expect(['adapter:creative-os', 'inbox:2', 'memory:token-budget-and-optimization'].some((source) => item.source === source || item.source.startsWith('adapter:creative-os'))).toBe(true);
    }
    expect(items.some((item) => item.source.startsWith('coffee'))).toBe(false);
  });

  it('staging decisions persist identity/provenance through the draft seam and never mutate the snapshot', () => {
    const snapshot = snapshotFixture();
    const frozen = structuredClone(snapshot);
    const items = buildCabinetItems(snapshot, 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    const staged = applyCabinetPin(applyCabinetState(items, memoryId, 'included'), memoryId, true);

    const draft = buildWorkbenchDraft('creative-os', cabinetScopeKey('creative-os'), undefined, '', cabinetStaging(staged), snapshot.sourceFingerprints);
    expect(draft.scope).toMatchObject({ projectId: 'creative-os', conversationKey: 'cabinet:v1:creative-os' });
    expect(draft.manualContexts).toEqual([]);
    expect(draft.projectFiles).toEqual([]);
    const memoryDecision = draft.projectedDecisions.find((decision) => decision.itemId === memoryId);
    expect(memoryDecision).toMatchObject({ state: 'included', pinned: true });

    // Restore onto fresh truth: the decision reapplies, identity/provenance preserved.
    const fresh = buildCabinetItems(snapshot, 'creative-os');
    const restored = restoreWorkbenchDraft(cabinetStaging(fresh), draft, []);
    const restoredMemory = restored.staging.find((item) => item.id === memoryId) as ContextItem;
    expect(restoredMemory).toMatchObject({
      state: 'included', pinned: true, sourceRef: 'overlay:memory/MEMORY.md', provenance: 'EXTERNAL',
    });
    expect(restored.orphanedDecisionIds).toEqual([]);

    // Staging is Workbench-owned: the external snapshot is never written.
    expect(snapshot).toEqual(frozen);
  });

  it('staging decisions do not change WorkGraph semantic facts (semanticHash stable)', async () => {
    const snapshot = snapshotFixture();
    const facts = () => buildCanonicalWorkGraphFacts({ projectId: 'creative-os', snapshot, activity: [] });
    const before = await compileWorkGraph({ projectId: 'creative-os', sourceDigest: 'test', facts: facts(), now: NOW });
    const after = await compileWorkGraph({ projectId: 'creative-os', sourceDigest: 'test', facts: facts(), now: NOW });
    expect(before.revision?.semanticHash).toBe(after.revision?.semanticHash);
    // Includes/excludes recorded in a cabinet draft are staging decisions,
    // not WorkGraph facts: the compiled facts ignore the draft entirely.
    const items = buildCabinetItems(snapshot, 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    void applyCabinetPin(applyCabinetState(items, memoryId, 'included'), memoryId, true);
    const afterDecisions = await compileWorkGraph({ projectId: 'creative-os', sourceDigest: 'test', facts: facts(), now: NOW });
    expect(afterDecisions.revision?.semanticHash).toBe(after.revision?.semanticHash);
    // And an available/never-dispatched context never yields uses-context.
    const edges = after.revision!.candidate.semanticFacts.edges;
    expect(edges.some((edge) => edge.kind === 'uses-context')).toBe(false);
  });

  it('item currentness fails closed: STALE on change, INVALID on missing, UNVERIFIED without sourceRef', () => {
    const baseline = [{ sourceRef: 'overlay:memory/MEMORY.md', sha256: 'a'.repeat(64) }];
    const item = { sourceRef: 'overlay:memory/MEMORY.md', sourceRefs: undefined };
    expect(cabinetItemCurrentness(item, baseline, [{ sourceRef: 'overlay:memory/MEMORY.md', sha256: 'a'.repeat(64) }])).toBe('CURRENT');
    expect(cabinetItemCurrentness(item, baseline, [{ sourceRef: 'overlay:memory/MEMORY.md', sha256: 'd'.repeat(64) }])).toBe('STALE');
    // A ref that no longer resolves is INVALID, never silently CURRENT.
    expect(cabinetItemCurrentness(item, baseline, [])).toBe('INVALID');
    expect(cabinetItemCurrentness({ sourceRef: undefined, sourceRefs: undefined }, baseline, [])).toBe('UNVERIFIED');
  });

  it('same staging + same sources compile a deterministic packet that never dispatches', () => {
    const snapshot = snapshotFixture();
    const items = buildCabinetItems(snapshot, 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    const staged = cabinetStaging(applyCabinetState(items, memoryId, 'included'));

    const compile = () => compilePacket({
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::builder',
      taskSummary: '',
      governanceRefs: ['overlay:projects/instances/creative-os.adapter.yaml'],
      staging: staged,
      fingerprints: snapshot.sourceFingerprints,
      now: NOW,
      packetId: 'packet-fixed',
    });
    const a = compile();
    const b = compile();
    expect(b).toEqual(a);
    // Memory (unbound, reference) stays a reference; gates stay context.
    expect(a.included.map((item) => item.id)).toEqual(['gate:creative-os:visual', 'gate:creative-os:verify']);
    expect(a.references.map((item) => item.id)).toEqual(['canon:creative-os', 'memory:token-budget-and-optimization']);
    // Compile is pure: no Execution, no dispatch, no uses-context side product.
    expect(Object.keys(a)).not.toContain('executionId');
    expect(Number.isInteger(a.roughTokens) && a.roughTokens > 0).toBe(true);
  });
});
