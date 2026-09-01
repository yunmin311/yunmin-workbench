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
    expect(DEMO_CONVERSATIONS.length).toBe(DEMO_PROJECTS.length);
    expect(DEMO_CONTEXT.some((item) => item.state === 'included' && item.pinned)).toBe(true);
    expect(DEMO_CONTEXT.some((item) => item.provenance === 'USER PROVIDED')).toBe(true);
    expect(DEMO_FROZEN.length).toBeGreaterThanOrEqual(1);
  });
});
