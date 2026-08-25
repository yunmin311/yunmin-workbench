import { describe, expect, it } from 'vitest';
import {
  canonicalPacketJson,
  checkPacketValidity,
  compilePacket,
  freezePacket,
  packetDependencies,
  roughTokenEstimate,
} from '../../src/core/project/packet';
import type { ContextItem, SourceFingerprint } from '../../src/core/types';

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
  { sourceRef: 'projects/instances/creative-os.adapter.yaml', sha256: 'aaa' },
  { sourceRef: 'memory/MEMORY.md', sha256: 'bbb' },
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
      ctx('g', 'included', false, 'projects/instances/creative-os.adapter.yaml'),
      ctx('m', 'included', true, 'memory/MEMORY.md'),
      ctx('x', 'excluded', true, 'memory/MEMORY.md'), // excluded -> not a dependency
    ];
    const deps = packetDependencies(['overlay:MEMORY.md'], staging, fps);
    expect(deps.resolved.map((d) => d.sourceRef).sort()).toEqual([
      'memory/MEMORY.md',
      'projects/instances/creative-os.adapter.yaml',
    ]);
    expect(deps.unresolved).toEqual([]);
    const p = compilePacket({ ...base, governanceRefs: ['overlay:MEMORY.md'], staging, fingerprints: fps });
    expect(p.sourceFingerprints.length).toBe(2);
    expect(p.unresolvedDependencies).toEqual([]);
  });
});

describe('Frozen Packet Validity (Integrity §4)', () => {
  const packet = compilePacket({
    ...base,
    staging: [ctx('g', 'included', false, 'projects/instances/creative-os.adapter.yaml')],
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

  it('external project-constitution path without a fingerprint is INVALID', () => {
    const p = compilePacket({
      ...base,
      governanceRefs: ['project-constitution:D:\\project\\CLAUDE.md'],
      staging: [],
      fingerprints: fps,
    });
    expect(p.unresolvedDependencies).toEqual(['project-constitution:D:\\project\\CLAUDE.md']);
    expect(checkPacketValidity(p, fps)).toBe('INVALID');
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
