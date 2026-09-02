import { describe, expect, it } from 'vitest';
import { DEMO_SNAPSHOT, DEMO_PROJECTS, DEMO_CONVERSATIONS, DEMO_FROZEN, DEMO_CONTEXT } from '../../src/renderer/src/demo/demoData';

describe('Demo Workspace is isolated initial state, not a fake renderer runtime', () => {
  it('uses a non-filesystem demo root and namespaced source references', () => {
    expect(DEMO_SNAPSHOT.overlayRoot).toBe('demo://workbench');
    const refs = [
      ...DEMO_SNAPSHOT.conversations.map((item) => item.observed.sourceRef),
      ...DEMO_SNAPSHOT.projects.map((item) => item.observed.sourceRef),
      ...DEMO_CONTEXT.map((item) => item.sourceRef ?? item.id),
      ...DEMO_FROZEN.flatMap((item) => item.sourceFingerprints.map((fp) => fp.sourceRef)),
      ...DEMO_SNAPSHOT.sourceFingerprints.map((fp) => fp.sourceRef),
    ];
    expect(refs.every((ref) => ref.startsWith('demo:'))).toBe(true);
    expect(DEMO_SNAPSHOT.machine?.deviceId).toBe('demo-machine');
  });

  it('contains workspace, session and Context fixtures but no seeded live history', () => {
    expect(DEMO_PROJECTS.length).toBeGreaterThanOrEqual(2);
    // Creative OS mirrors a real multi-session setup: at least six role
    // conversations spanning platforms and non-ACTIVE lifecycle states.
    const creativeOs = DEMO_CONVERSATIONS.filter((item) => item.project === 'creative-os');
    expect(creativeOs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(creativeOs.map((item) => item.platform))).toEqual(new Set(['claude', 'codex', 'deepseek']));
    expect(new Set(creativeOs.map((item) => item.status))).toEqual(new Set(['ACTIVE', 'PAUSED', 'STANDBY']));
    expect(new Set(DEMO_CONVERSATIONS.map((item) => item.key)).size).toBe(DEMO_CONVERSATIONS.length);
    expect(DEMO_CONTEXT.some((item) => item.state === 'included' && item.pinned)).toBe(true);
    expect(DEMO_CONTEXT.some((item) => item.provenance === 'USER PROVIDED')).toBe(true);
    expect(DEMO_FROZEN.length).toBeGreaterThanOrEqual(1);
  });
});
