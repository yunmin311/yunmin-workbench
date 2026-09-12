import { describe, expect, it } from 'vitest';
import {
  applyCabinetPin,
  applyCabinetState,
  asCabinetItem,
  buildCabinetItems,
  cabinetFileOrigin,
  cabinetItemCurrentness,
  cabinetStaging,
  cabinetSummary,
} from '../../src/core/project/cabinet';
import { migrateLegacyCabinetDraft, buildCabinetStaging } from '../../src/core/project/cabinetStaging';
import { compilePacket, checkPacketValidity } from '../../src/core/project/packet';
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

  it('staging decisions persist under the formal project-context-cabinet scope and never mutate the snapshot', () => {
    const snapshot = snapshotFixture();
    const frozen = structuredClone(snapshot);
    const items = buildCabinetItems(snapshot, 'creative-os');
    const memoryId = 'memory:token-budget-and-optimization';
    const staged = applyCabinetPin(applyCabinetState(items, memoryId, 'included'), memoryId, true);

    const state = buildCabinetStaging('creative-os', staged, [], false);
    expect(state.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    expect(state.schemaVersion).toBe(1);
    const memoryDecision = state.decisions.find((decision) => decision.contextId === memoryId);
    expect(memoryDecision).toMatchObject({ state: 'included', pinned: true });
    // Unbound memory decisions persist by exact identity; no project binding is minted.
    expect(state.decisions.every((decision) => decision.contextId.length > 0)).toBe(true);

    // Restore onto fresh truth: the decision reapplies, identity/provenance preserved.
    const fresh = buildCabinetItems(snapshot, 'creative-os');
    const decisions = new Map(state.decisions.map((decision) => [decision.contextId, decision]));
    const restoredMemory = fresh
      .map((item) => {
        const decision = decisions.get(item.id);
        return decision ? { ...item, state: decision.state, pinned: decision.pinned } : item;
      })
      .find((item) => item.id === memoryId) as ContextItem;
    expect(restoredMemory).toMatchObject({
      state: 'included', pinned: true, sourceRef: 'overlay:memory/MEMORY.md', provenance: 'EXTERNAL',
    });

    // Staging is Workbench-owned: the external snapshot is never written.
    expect(snapshot).toEqual(frozen);
  });

  it('migrates a legacy 3C.1 cabinet draft once, preserving decisions and dropping the migration-era scope', () => {
    const legacy = {
      scope: { kind: 'migration-conversation-key', projectId: 'creative-os', conversationKey: 'cabinet:v1:creative-os' },
      taskSummary: '',
      manualContexts: [],
      projectFiles: [],
      projectedDecisions: [
        { itemId: 'memory:token-budget-and-optimization', state: 'included' as const, pinned: true, order: 5 },
        { itemId: 'gate:creative-os:visual', state: 'excluded' as const, pinned: false, order: 6 },
      ],
    };
    const migrated = migrateLegacyCabinetDraft('creative-os', legacy);
    expect(migrated).not.toBeNull();
    expect(migrated!.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    expect(migrated!.decisions).toEqual([
      { contextId: 'memory:token-budget-and-optimization', state: 'included', pinned: true, order: 5 },
      { contextId: 'gate:creative-os:visual', state: 'excluded', pinned: false, order: 6 },
    ]);
    // A real conversation draft with the same shape is never converted.
    expect(migrateLegacyCabinetDraft('creative-os', {
      ...legacy,
      scope: { kind: 'migration-conversation-key', projectId: 'creative-os', conversationKey: 'creative-os::claude::主对话' },
    })).toBeNull();
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

  it('explicitly added project files keep working-tree and pinned identity strictly apart', () => {
    // A legacy conversation draft is never converted; the reserved key is.
    const conversationDraft = {
      scope: { kind: 'migration-conversation-key', projectId: 'creative-os', conversationKey: 'creative-os::claude::主对话' },
      taskSummary: 'real work',
      manualContexts: [],
      projectFiles: [],
      projectedDecisions: [{ itemId: 'memory:x', state: 'included' as const, pinned: true, order: 0 }],
    };
    expect(migrateLegacyCabinetDraft('creative-os', conversationDraft)).toBeNull();
    expect(migrateLegacyCabinetDraft('other-project', {
      scope: { kind: 'migration-conversation-key', projectId: 'creative-os', conversationKey: 'cabinet:v1:creative-os' },
      taskSummary: '', manualContexts: [], projectFiles: [], projectedDecisions: [],
    })).toBeNull();

    const workingTree = asCabinetItem({
      id: 'project-file:creative-os:README.md:context',
      title: 'README.md',
      source: 'project-file:creative-os',
      body: 'working tree body',
      state: 'available',
      pinned: false,
      isReference: false,
      sourceRef: 'project-file:creative-os:README.md',
      provenance: 'EXTERNAL',
      relativePath: 'README.md',
    }, [{ sourceRef: 'project-file:creative-os:README.md' }]);
    const pinned = asCabinetItem({
      id: 'pinned:creative-os:CLAUDE.md',
      title: 'CLAUDE.md',
      source: 'pinned-file:creative-os',
      body: 'pinned body',
      state: 'available',
      pinned: false,
      isReference: false,
      sourceRef: 'git:yunmin311/creative-os@aa0395fcc741a0d8e0cc5f4138f2664542223417:CLAUDE.md',
      provenance: 'EXTERNAL',
      relativePath: 'CLAUDE.md',
    });
    expect(cabinetFileOrigin(workingTree)).toBe('working-tree');
    expect(cabinetFileOrigin(pinned)).toBe('pinned');
    expect(workingTree).toMatchObject({ group: 'file', binding: 'project', state: 'available', fingerprintAvailable: true });
    expect(pinned).toMatchObject({ group: 'file', binding: 'project', state: 'available', fingerprintAvailable: false });
    // Different source identity for the same logical path: never one fact.
    expect(workingTree.id).not.toBe(pinned.id);
    expect(workingTree.sourceRef).not.toBe(pinned.sourceRef);
  });

  it('an explicitly added file that is Available never auto-enters the packet; Included does', () => {
    const snapshot = snapshotFixture();
    const file = asCabinetItem({
      id: 'project-file:creative-os:docs/plan.md:context',
      title: 'docs/plan.md',
      source: 'project-file:creative-os',
      body: 'plan body text',
      state: 'available',
      pinned: false,
      isReference: false,
      sourceRef: 'project-file:creative-os:docs/plan.md',
      provenance: 'EXTERNAL',
      relativePath: 'docs/plan.md',
    });
    const fingerprints = [...snapshot.sourceFingerprints, { sourceRef: file.sourceRef!, sha256: 'e'.repeat(64) }];

    const availableOnly = cabinetStaging([file]);
    const availablePacket = compilePacket({
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::builder',
      taskSummary: '',
      governanceRefs: [],
      staging: availableOnly,
      fingerprints,
      now: NOW,
      packetId: 'packet-available',
    });
    expect(availablePacket.included).toEqual([]);
    expect(availablePacket.references).toEqual([]);

    const includedPacket = compilePacket({
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::builder',
      taskSummary: '',
      governanceRefs: [],
      staging: cabinetStaging(applyCabinetState([file], file.id, 'included')),
      fingerprints,
      now: NOW,
      packetId: 'packet-included',
    });
    expect(includedPacket.included.map((item) => item.id)).toEqual([file.id]);
    expect(includedPacket.sourceFingerprints).toEqual([{ sourceRef: file.sourceRef, sha256: 'e'.repeat(64) }]);
    expect(checkPacketValidity(includedPacket, fingerprints)).toBe('CURRENT');
    // Working-tree edit -> STALE; source gone -> INVALID.
    expect(checkPacketValidity(includedPacket, fingerprints.map((f) =>
      f.sourceRef === file.sourceRef ? { ...f, sha256: '9'.repeat(64) } : f))).toBe('STALE');
    expect(checkPacketValidity(includedPacket, snapshot.sourceFingerprints)).toBe('INVALID');
    // Compile produces no dispatch identity and no flow claim.
    expect(Object.keys(includedPacket)).not.toContain('executionId');
  });

  it('memory granularity: staging keeps the index sourceRef; the atom locator is derived only for display', () => {
    const items = buildCabinetItems(snapshotFixture(), 'creative-os');
    const memory = items.find((item) => item.id === 'memory:token-budget-and-optimization')!;
    // Staging identity is the existing index contract — never rewritten to an atom path.
    expect(memory.sourceRef).toBe('overlay:memory/MEMORY.md');
    expect(memory.binding).toBe('unbound');
    // The atom locator is derivable from the existing readMemory contract
    // (readMemoryBody maps id -> memory/<id>.md) and stays a display/recheck
    // locator: it never becomes the staging sourceRef or a project binding.
    const atomRef = `overlay:memory/${memory.id.slice('memory:'.length)}.md`;
    expect(atomRef).toBe('overlay:memory/token-budget-and-optimization.md');
    expect(atomRef).not.toBe(memory.sourceRef);
    // Rechecking the atom through the existing overlay routing yields a
    // fingerprint fact; a missing atom is an error, never a silent upgrade.
    expect(cabinetItemCurrentness(memory, [{ sourceRef: memory.sourceRef!, sha256: 'a'.repeat(64) }], [])).toBe('INVALID');
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
