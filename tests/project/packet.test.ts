import { describe, expect, it } from 'vitest';
import {
  canonicalPacketJson,
  checkPacketValidity,
  compilePacket,
  freezePacket,
  packetDependencies,
  renderAgentInput,
  roughTokenEstimate,
} from '../../src/core/project/packet';
import type { ContextItem, SourceFingerprint, FrozenPacket } from '../../src/core/types';

const ctx = (id: string, state: ContextItem['state'], isReference = false, sourceRef?: string): ContextItem => ({
  id,
  title: `t-${id}`,
  source: `src:${id}`,
  body: `body of ${id}`,
  state,
  pinned: false,
  isReference,
  sourceRef,
});

const base = {
  projectId: 'creative-os',
  conversationKey: 'creative-os::claude::CO 主对话',
  taskSummary: '推进 001-inspiration-capture 收尾',
  governanceRefs: [] as string[],
  now: '2026-08-25T00:00:00.000Z',
  packetId: 'fixed-id',
};

const fps: SourceFingerprint[] = [
  { sourceRef: 'overlay:projects/instances/creative-os.adapter.yaml', sha256: 'aaa' },
  { sourceRef: 'overlay:memory/MEMORY.md', sha256: 'bbb' },
];

describe('compilePacket', () => {
  it('splits included bodies from references deterministically', () => {
    const p = compilePacket({
      ...base,
      staging: [ctx('a', 'included'), ctx('b', 'excluded'), ctx('c', 'included', true), ctx('d', 'available')],
    });
    expect(p.included.map((c) => c.id)).toEqual(['a']);
    expect(p.references.map((c) => c.id)).toEqual(['c']);
    expect(p.roughTokens).toBeGreaterThan(0);
    expect(roughTokenEstimate('abcd')).toBe(1);
  });

  it('records fingerprints of the canonical files the packet depends on', () => {
    const staging = [
      ctx('g', 'included', false, 'overlay:projects/instances/creative-os.adapter.yaml'),
      ctx('m', 'included', true, 'overlay:memory/MEMORY.md'),
      ctx('x', 'excluded', true, 'overlay:memory/MEMORY.md'), // excluded -> not a dependency
    ];
    const deps = packetDependencies(['overlay:memory/MEMORY.md'], staging, fps);
    // Governance refs are provenance, not content dependencies. They are
    // not added to either resolved or unresolved sets.
    expect(deps.resolved.map((d) => d.sourceRef).sort()).toEqual([
      'overlay:memory/MEMORY.md',
      'overlay:projects/instances/creative-os.adapter.yaml',
    ]);
    expect(deps.unresolved).toEqual([]);
    expect(deps.governanceRefs).toEqual(['overlay:memory/MEMORY.md']);
    const p = compilePacket({ ...base, governanceRefs: ['overlay:memory/MEMORY.md'], staging, fingerprints: fps });
    expect(p.sourceFingerprints.length).toBe(2);
    expect(p.unresolvedDependencies).toEqual([]);
    expect(p.governanceRefs).toEqual(['overlay:memory/MEMORY.md']);
  });

  it('keeps every evidence source declared by a derived Memory reference', () => {
    const refs = ['history:codex:first.jsonl', 'history:claude-code:second.jsonl'];
    const memory = { ...ctx('memory', 'included', true, refs[0]), sourceRefs: refs };
    const fingerprints = refs.map((sourceRef, index) => ({ sourceRef, sha256: `hash-${index}` }));
    const packet = compilePacket({ ...base, staging: [memory], fingerprints });
    expect(packet.sourceFingerprints.map((item) => item.sourceRef)).toEqual([...refs].sort());
    expect(packet.unresolvedDependencies).toEqual([]);
    expect(renderAgentInput(packet)).toContain(refs.join(', '));
  });
});

describe('Frozen Packet Validity (Integrity §4)', () => {
  const packet = compilePacket({
    ...base,
    staging: [ctx('g', 'included', false, 'overlay:projects/instances/creative-os.adapter.yaml')],
    fingerprints: fps,
  });

  it('CURRENT when all dependency fingerprints unchanged', () => {
    expect(checkPacketValidity(packet, fps)).toBe('CURRENT');
  });

  it('STALE when a dependency changed', () => {
    const changed = fps.map((f) =>
      f.sourceRef.includes('adapter') ? { ...f, sha256: 'zzz' } : f,
    );
    expect(checkPacketValidity(packet, changed)).toBe('STALE');
  });

  it('INVALID when a dependency no longer exists', () => {
    const removed = fps.filter((f) => !f.sourceRef.includes('adapter'));
    expect(checkPacketValidity(packet, removed)).toBe('INVALID');
  });

  it('truly zero-dependency packet is CURRENT', () => {
    const p = compilePacket({ ...base, staging: [], fingerprints: [] });
    expect(p.sourceFingerprints).toEqual([]);
    expect(p.unresolvedDependencies).toEqual([]);
    expect(checkPacketValidity(p, [])).toBe('CURRENT');
  });

  it('external project-constitution path without a fingerprint is INVALID only when it is a content dependency, not when it is a Governance ref', () => {
    // The ref appears in included staging (so it is a content dependency).
    // compilePacket must surface it as unresolved.
    const staging = [ctx('canon', 'included', false, 'project-file:creative-os:CLAUDE.md')];
    const p = compilePacket({
      ...base,
      governanceRefs: ['project-file:creative-os:CLAUDE.md'],
      staging,
      fingerprints: fps,
    });
    expect(p.unresolvedDependencies).toEqual(['project-file:creative-os:CLAUDE.md']);
    expect(checkPacketValidity(p, fps)).toBe('INVALID');
  });

  it('Governance refs that are not part of the included Context never block dispatch', () => {
    const p = compilePacket({
      ...base,
      governanceRefs: ['overlay:project-1.adapter', 'overlay:project-1.dialogue#main'],
      staging: [],
      fingerprints: fps,
    });
    expect(p.unresolvedDependencies).toEqual([]);
    expect(p.governanceRefs.sort()).toEqual(['overlay:project-1.adapter', 'overlay:project-1.dialogue#main']);
    expect(checkPacketValidity(p, fps)).toBe('CURRENT');
  });

  it('included canonical source with a missing compile-time fingerprint is INVALID', () => {
    const p = compilePacket({
      ...base,
      staging: [ctx('missing', 'included', false, 'project/.governance/INBOX.md')],
      fingerprints: fps,
    });
    expect(p.unresolvedDependencies).toEqual(['project/.governance/INBOX.md']);
    expect(checkPacketValidity(p, fps)).toBe('INVALID');
  });

  it('legacy packet without unresolved-dependency evidence fails closed', () => {
    const p = compilePacket({ ...base, staging: [], fingerprints: [] });
    const legacy = { ...p, unresolvedDependencies: undefined } as unknown as typeof p;
    expect(checkPacketValidity(legacy, [])).toBe('INVALID');
  });
});

describe('freezePacket', () => {
  const packet = compilePacket({ ...base, staging: [ctx('a', 'included')] });

  it('produces immutable versions with stable hash for identical content', () => {
    const v1 = freezePacket(packet, [], '2026-08-25T01:00:00.000Z');
    expect(v1.version).toBe(1);
    expect(v1.hash).toMatch(/^[0-9a-f]{64}$/);
    const v1again = freezePacket(packet, [v1], '2026-08-25T02:00:00.000Z');
    expect(v1again.version).toBe(2); // new freeze = new version, even unchanged
    expect(v1again.hash).toBe(v1.hash); // hash only depends on packet content
  });

  it('hash changes when content changes', () => {
    const changed = { ...packet, taskSummary: '别的事' };
    expect(canonicalPacketJson(changed)).not.toBe(canonicalPacketJson(packet));
  });
});

describe('deterministic Agent Input text', () => {
  it('renders fixed Governance -> Task -> Context -> References sections', () => {
    const packet = compilePacket({
      ...base,
      governanceRefs: ['overlay:memory/MEMORY.md'],
      staging: [
        { ...ctx('manual', 'included'), provenance: 'USER PROVIDED' as const, source: 'manual' },
        ctx('ref', 'included', true),
      ],
      fingerprints: [{ sourceRef: 'overlay:memory/MEMORY.md', sha256: 'abc' }],
    });
    const text = renderAgentInput(packet);
    expect(text.indexOf('# Governance')).toBeLessThan(text.indexOf('# Task Summary'));
    expect(text.indexOf('# Task Summary')).toBeLessThan(text.indexOf('# Context'));
    expect(text.indexOf('# Context')).toBeLessThan(text.indexOf('# References'));
    expect(text).toContain('## t-manual [USER PROVIDED]');
    expect(text).toContain('## t-ref');
  });

  it('is byte-identical for the same content and order regardless of packet id/time', () => {
    const first = compilePacket({ ...base, staging: [ctx('a', 'included')] });
    const second = compilePacket({
      ...base,
      packetId: 'another-id',
      now: '2030-01-01T00:00:00.000Z',
      staging: [ctx('a', 'included')],
    });
    expect(renderAgentInput(first)).toBe(renderAgentInput(second));
  });
});

describe('freezePacket version scope per (projectId, conversationKey)', () => {
  const makePacket = (overrides: Partial<{ projectId: string; conversationKey: string; taskSummary: string }> = {}) =>
    compilePacket({ ...base, staging: [ctx('a', 'included')], ...overrides });

  it('version increments per (projectId, conversationKey) pair', () => {
    const existing: Pick<FrozenPacket, 'projectId' | 'conversationKey' | 'version'>[] = [
      { projectId: 'proj-a', conversationKey: 'conv-1', version: 1 },
      { projectId: 'proj-a', conversationKey: 'conv-1', version: 2 },
      { projectId: 'proj-b', conversationKey: 'conv-1', version: 1 }, // different project
      { projectId: 'proj-a', conversationKey: 'conv-2', version: 5 }, // different conversation
    ];

    // conv-1 on proj-a: next version should be 3 (max of 1,2 + 1)
    const v1 = freezePacket(
      makePacket({ projectId: 'proj-a', conversationKey: 'conv-1' }),
      existing,
    );
    expect(v1.version).toBe(3);

    // conv-1 on proj-b: next version should be 2 (max of 1 + 1)
    const v2 = freezePacket(
      makePacket({ projectId: 'proj-b', conversationKey: 'conv-1' }),
      existing,
    );
    expect(v2.version).toBe(2);

    // conv-2 on proj-a: next version should be 6 (max of 5 + 1)
    const v3 = freezePacket(
      makePacket({ projectId: 'proj-a', conversationKey: 'conv-2' }),
      existing,
    );
    expect(v3.version).toBe(6);

    // proj-c, conv-3: no prior, should be 1
    const v4 = freezePacket(
      makePacket({ projectId: 'proj-c', conversationKey: 'conv-3' }),
      existing,
    );
    expect(v4.version).toBe(1);
  });

  it('hash changes when content changes', () => {
    const p1 = freezePacket(makePacket({ taskSummary: 'task 1' }), []);
    const p2 = freezePacket(makePacket({ taskSummary: 'task 2' }), []);
    expect(p1.hash).not.toBe(p2.hash);
  });

it('hash includes projectId and conversationKey in canonical JSON', () => {
    const p1 = freezePacket(makePacket({ projectId: 'proj-a', conversationKey: 'conv-1', taskSummary: 'same task' }), []);
    const p2 = freezePacket(makePacket({ projectId: 'proj-b', conversationKey: 'conv-2', taskSummary: 'same task' }), []);
    // Hash includes projectId/conversationKey so they differ
    expect(p1.hash).not.toBe(p2.hash);
  });
});
