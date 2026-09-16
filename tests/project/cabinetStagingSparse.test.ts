import { describe, expect, it } from 'vitest';
import {
  applyCabinetPin,
  applyCabinetState,
  buildCabinetItems,
  cabinetStaging,
} from '../../src/core/project/cabinet';
import {
  buildCabinetStaging,
  refreshExplicitDecision,
  type CabinetSourceDefault,
} from '../../src/core/project/cabinetStaging';
import { compilePacket } from '../../src/core/project/packet';
import type { ContextIncludeState, OverlaySnapshot } from '../../src/core/types';

const NOW = '2026-09-12T00:00:00.000Z';

/** Same shape as the cabinet domain fixture: broad candidates are Available. */
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
    ],
    memoryIndex: [
      { id: 'token-budget-and-optimization', title: 'Token budget and optimization', hook: 'keep prompts small', category: 'workflow', sourceRef: 'overlay:memory/MEMORY.md' },
    ],
    harness: [],
    sourceFingerprints: [],
    problems: [],
  };
}

function baseDefaultsOf(projectId = 'creative-os'): Map<string, CabinetSourceDefault> {
  const base = buildCabinetItems(snapshotFixture(), projectId);
  return new Map(base.map((item) => [item.id, { state: item.state, pinned: item.pinned }]));
}

/** Same hydration the Cabinet performs on reload: sparse decisions over fresh defaults. */
function applyStored(projectId: string, decisions: { contextId: string; state: ContextIncludeState; pinned: boolean }[]) {
  const base = buildCabinetItems(snapshotFixture(), projectId);
  const byId = new Map(decisions.map((decision) => [decision.contextId, decision]));
  return base.map((item) => {
    const decision = byId.get(item.id);
    return decision
      ? { ...item, state: decision.state, pinned: decision.state === 'included' ? decision.pinned : false }
      : item;
  });
}

describe('cabinet staging sparse overrides', () => {
  it('one Exclude persists exactly one explicit decision', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const defaults = baseDefaultsOf();
    const gateId = 'gate:creative-os:visual';
    const next = applyCabinetState(base, gateId, 'excluded');
    const changed = next.find((item) => item.id === gateId)!;
    const decided = refreshExplicitDecision({
      baseDefaults: defaults,
      decided: new Set(),
      item: { id: changed.id, state: changed.state, pinned: changed.pinned },
    });
    expect([...decided]).toEqual([gateId]);
    const stored = buildCabinetStaging('creative-os', next, [], false, '', decided);
    expect(stored.decisions).toEqual([
      { contextId: gateId, state: 'excluded', pinned: false, order: 0 },
    ]);
    expect(stored.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
  });

  it('reverting to the inherited default deletes the override instead of persisting it', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const defaults = baseDefaultsOf();
    const gateId = 'gate:creative-os:visual';
    const excluded = applyCabinetState(base, gateId, 'excluded');
    const changed = excluded.find((item) => item.id === gateId)!;
    let decided = refreshExplicitDecision({
      baseDefaults: defaults, decided: new Set(),
      item: { id: changed.id, state: changed.state, pinned: changed.pinned },
    });
    expect(decided.has(gateId)).toBe(true);
    // User reverts to the source default (available): the override must go.
    const reverted = applyCabinetState(excluded, gateId, 'available');
    const back = reverted.find((item) => item.id === gateId)!;
    decided = refreshExplicitDecision({
      baseDefaults: defaults, decided,
      item: { id: back.id, state: back.state, pinned: back.pinned },
    });
    expect(decided.has(gateId)).toBe(false);
    const stored = buildCabinetStaging('creative-os', reverted, [], false, '', decided);
    expect(stored.decisions).toEqual([]);
  });

  it('pin/unpin tracks the override set: pin adds, unpin-to-default removes', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const defaults = baseDefaultsOf();
    const memoryId = 'memory:token-budget-and-optimization';
    const included = applyCabinetState(base, memoryId, 'included');
    const pinned = applyCabinetPin(included, memoryId, true);
    const pinnedItem = pinned.find((item) => item.id === memoryId)!;
    let decided = refreshExplicitDecision({
      baseDefaults: defaults, decided: new Set(),
      item: { id: pinnedItem.id, state: pinnedItem.state, pinned: pinnedItem.pinned },
    });
    expect([...decided]).toEqual([memoryId]);
    const stored = buildCabinetStaging('creative-os', pinned, [], false, '', decided);
    expect(stored.decisions).toEqual([
      { contextId: memoryId, state: 'included', pinned: true, order: 0 },
    ]);
    // Revert to available (the memory default): override deleted.
    const reverted = applyCabinetState(pinned, memoryId, 'available');
    const back = reverted.find((item) => item.id === memoryId)!;
    decided = refreshExplicitDecision({
      baseDefaults: defaults, decided,
      item: { id: back.id, state: back.state, pinned: back.pinned },
    });
    expect(decided.has(memoryId)).toBe(false);
  });

  it('reload applies the sparse override only where it exists; untouched items keep source defaults', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const gateId = 'gate:creative-os:visual';
    const next = applyCabinetState(base, gateId, 'excluded');
    const stored = buildCabinetStaging(
      'creative-os', next, [], false, '',
      new Set([gateId]),
    );
    const reloaded = applyStored('creative-os', stored.decisions);
    const byId = new Map(reloaded.map((item) => [item.id, item]));
    // The explicit override survives the reload.
    expect(byId.get(gateId)).toMatchObject({ state: 'excluded' });
    // Everything else resolves to fresh source defaults — no override record.
    expect(byId.get('gate:creative-os:verify')).toMatchObject({ state: 'available' });
    expect(byId.get('canon:creative-os')).toMatchObject({ state: 'available' });
    expect(byId.get('inbox:2')).toMatchObject({ state: 'available' });
    expect(byId.get('memory:token-budget-and-optimization')).toMatchObject({ state: 'available', pinned: false });
    // The explicit-touch set after reload is exactly the stored override.
    expect(stored.decisions.map((decision) => decision.contextId)).toEqual([gateId]);
  });

  it('a source-default change flows to untouched items while explicit overrides hold', () => {
    // Stored: user excluded the visual gate long ago.
    const storedDecisions: { contextId: string; state: ContextIncludeState; pinned: boolean }[] = [
      { contextId: 'gate:creative-os:visual', state: 'excluded', pinned: false },
    ];
    // Source changes: the visual gate default flips to available (new default),
    // memory gets included by default upstream.
    const evolved = buildCabinetItems(snapshotFixture(), 'creative-os').map((item) =>
      item.id === 'gate:creative-os:visual'
        ? { ...item, state: 'available' as const }
        : item.id === 'memory:token-budget-and-optimization'
          ? { ...item, state: 'included' as const }
          : item,
    );
    const byId = new Map(storedDecisions.map((decision) => [decision.contextId, decision]));
    const resolved = evolved.map((item) => {
      const decision = byId.get(item.id);
      return decision
        ? { ...item, state: decision.state, pinned: decision.state === 'included' ? decision.pinned : false }
        : item;
    });
    const resolvedById = new Map(resolved.map((item) => [item.id, item]));
    // Explicit override wins over the changed default.
    expect(resolvedById.get('gate:creative-os:visual')).toMatchObject({ state: 'excluded' });
    // Untouched memory inherits the NEW upstream default without any record.
    expect(resolvedById.get('memory:token-budget-and-optimization')).toMatchObject({ state: 'included' });
    expect(byId.has('memory:token-budget-and-optimization')).toBe(false);
  });

  it('sparse persistence does not change the resolved Prepare/Packet used-set', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const gateId = 'gate:creative-os:visual';
    const memoryId = 'memory:token-budget-and-optimization';
    // Full-collection resolution, as the Cabinet holds it in memory.
    const resolved = applyCabinetState(applyCabinetState(base, gateId, 'excluded'), memoryId, 'included');
    // Sparse round-trip: persist only the two explicit overrides, reload onto fresh defaults.
    const sparse = buildCabinetStaging(
      'creative-os', resolved, [], false, '',
      new Set([gateId, memoryId]),
    );
    const reloaded = applyStored('creative-os', sparse.decisions);
    const packetInput = {
      projectId: 'creative-os',
      conversationKey: 'creative-os::claude::CO 主对话',
      taskSummary: 'sparse acceptance',
      governanceRefs: [] as string[],
      fingerprints: [] as { sourceRef: string; sha256: string }[],
    };
    const direct = compilePacket({ ...packetInput, staging: cabinetStaging(resolved) });
    const viaSparse = compilePacket({ ...packetInput, staging: cabinetStaging(reloaded) });
    const ids = (packet: { included: { id: string }[]; references: { id: string }[] }) =>
      [...packet.included.map((item) => item.id), ...packet.references.map((item) => item.id)].sort();
    expect(ids(viaSparse)).toEqual(ids(direct));
    expect(ids(direct)).toContain(memoryId);
    expect(ids(direct)).not.toContain(gateId);
  });

  it('sparse decisions cannot leak across projects', () => {
    const stored = buildCabinetStaging(
      'creative-os',
      applyCabinetState(buildCabinetItems(snapshotFixture(), 'creative-os'), 'gate:creative-os:visual', 'excluded'),
      [], false, '', new Set(['gate:creative-os:visual']),
    );
    expect(stored.scope).toEqual({ kind: 'project-context-cabinet', projectId: 'creative-os' });
    // Hydrating ANOTHER project's fresh base with these decisions changes
    // nothing: context identities embed their project, so nothing matches.
    const byId = new Map(stored.decisions.map((decision) => [decision.contextId, decision]));
    const otherBase = buildCabinetItems(snapshotFixture(), 'work-capsule');
    expect(otherBase.length).toBeGreaterThan(0);
    const resolved = otherBase.map((item) => {
      const decision = byId.get(item.id);
      return decision ? { ...item, state: decision.state } : item;
    });
    expect(resolved).toEqual(otherBase);
  });

  it('omitting the explicit set keeps the legacy whole-collection serialization', () => {
    const base = buildCabinetItems(snapshotFixture(), 'creative-os');
    const legacy = buildCabinetStaging('creative-os', base, [], false);
    expect(legacy.decisions.length).toBe(base.length);
  });
});
