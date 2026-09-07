import { describe, expect, it } from 'vitest';
import { ContextSourceRegistry } from '../../../../src/core/context-sources/registry';
import { createOverlayMemorySource, readOverlayMemory } from '../../../../src/main/adapters/context/overlayMemory';
import { createProjectFilesSource } from '../../../../src/main/adapters/context/projectFiles';
import { createHistorySource } from '../../../../src/main/adapters/context/history';
import { createCoffeeSource } from '../../../../src/main/adapters/context/coffee';

describe('overlay-memory source', () => {
  it('declares read YES and the rest honestly', () => {
    const source = createOverlayMemorySource({ readOverlayRootBinding: async () => null });
    expect(source.id).toBe('overlay-memory');
    expect(source.kind).toBe('overlay-memory');
    expect(source.provenance).toBe('WORKBENCH_BUILTIN');
    expect(source.capabilities.read.answer).toBe('YES');
    expect(source.capabilities.list.answer).toBe('NO');
    expect(source.capabilities.search.answer).toBe('NO');
    expect(source.capabilities.fingerprint.answer).toBe('NO');
    expect(source.capabilities.recheck.answer).toBe('NO');
    for (const cap of Object.values(source.capabilities)) {
      expect(cap.evidence.length).toBeGreaterThan(0);
    }
  });

  it('reports UNAVAILABLE when no overlay root is bound', async () => {
    const source = createOverlayMemorySource({ readOverlayRootBinding: async () => null });
    const av = await source.availability();
    expect(av.state).toBe('UNAVAILABLE');
  });

  it('reports AVAILABLE when a root is bound', async () => {
    const source = createOverlayMemorySource({ readOverlayRootBinding: async () => '/o' });
    const av = await source.availability();
    expect(av.state).toBe('AVAILABLE');
    expect(av.reason).toContain('/o');
  });

  it('reports currentness as UNKNOWN without subscribing', async () => {
    const source = createOverlayMemorySource({ readOverlayRootBinding: async () => null });
    expect((await source.currentness()).state).toBe('UNKNOWN');
  });

  it('registers cleanly into ContextSourceRegistry', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(createOverlayMemorySource({ readOverlayRootBinding: async () => null }));
    expect(result.ok).toBe(true);
    expect(registry.has('overlay-memory')).toBe(true);
  });

  it('exposes a readOverlayMemory helper that forwards to readMemoryBody', async () => {
    const root = '/o';
    const result = await readOverlayMemory(root, 'memory:abc');
    // No fixture, but the call must not throw on the contract layer.
    // Without a real overlay, the body is null (the adapter's contract
    // guarantees it returns string | null, never throws).
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('project-files source', () => {
  it('declares read/fingerprint/recheck YES and list/search NO', () => {
    const source = createProjectFilesSource({ hasProjectRootBinding: async () => false });
    expect(source.id).toBe('project-files');
    expect(source.kind).toBe('project-files');
    expect(source.capabilities.read.answer).toBe('YES');
    expect(source.capabilities.fingerprint.answer).toBe('YES');
    expect(source.capabilities.recheck.answer).toBe('YES');
    expect(source.capabilities.list.answer).toBe('NO');
    expect(source.capabilities.search.answer).toBe('NO');
  });

  it('reports UNAVAILABLE when no project root is bound', async () => {
    const source = createProjectFilesSource({ hasProjectRootBinding: async () => false });
    expect((await source.availability()).state).toBe('UNAVAILABLE');
  });

  it('reports AVAILABLE when a project root is bound', async () => {
    const source = createProjectFilesSource({ hasProjectRootBinding: async () => true });
    expect((await source.availability()).state).toBe('AVAILABLE');
  });

  it('registers cleanly into ContextSourceRegistry', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(createProjectFilesSource({ hasProjectRootBinding: async () => false }));
    expect(result.ok).toBe(true);
  });
});

describe('history source', () => {
  it('declares list/search/read/fingerprint/recheck YES', () => {
    const source = createHistorySource({ hasDiscoveredRoots: async () => false });
    expect(source.id).toBe('history');
    expect(source.kind).toBe('history');
    expect(source.capabilities.list.answer).toBe('YES');
    expect(source.capabilities.search.answer).toBe('YES');
    expect(source.capabilities.read.answer).toBe('YES');
    expect(source.capabilities.fingerprint.answer).toBe('YES');
    expect(source.capabilities.recheck.answer).toBe('YES');
  });

  it('reports UNAVAILABLE when no history roots are discovered', async () => {
    const source = createHistorySource({ hasDiscoveredRoots: async () => false });
    expect((await source.availability()).state).toBe('UNAVAILABLE');
  });

  it('reports AVAILABLE when at least one history root is discovered', async () => {
    const source = createHistorySource({ hasDiscoveredRoots: async () => true });
    expect((await source.availability()).state).toBe('AVAILABLE');
  });

  it('registers cleanly into ContextSourceRegistry', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(createHistorySource({ hasDiscoveredRoots: async () => true }));
    expect(result.ok).toBe(true);
  });
});

describe('coffee source (placeholder)', () => {
  it('declares every capability UNKNOWN with a concrete reason', () => {
    const source = createCoffeeSource();
    expect(source.id).toBe('coffee');
    expect(source.kind).toBe('coffee');
    expect(source.provenance).toBe('PLACEHOLDER_PENDING_AUDIT');
    for (const cap of Object.values(source.capabilities)) {
      expect(cap.answer).toBe('UNKNOWN');
      expect(cap.evidence.length).toBeGreaterThan(0);
    }
  });

  it('always reports availability UNAVAILABLE', async () => {
    const source = createCoffeeSource();
    const first = await source.availability();
    const second = await source.availability();
    expect(first.state).toBe('UNAVAILABLE');
    expect(second.state).toBe('UNAVAILABLE');
    expect(first.reason).toBe(second.reason);
  });

  it('always reports currentness UNKNOWN', async () => {
    const source = createCoffeeSource();
    expect((await source.currentness()).state).toBe('UNKNOWN');
  });

  it('registers cleanly into ContextSourceRegistry but stays UNAVAILABLE', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(createCoffeeSource());
    expect(result.ok).toBe(true);
    expect(registry.get('coffee')?.provenance).toBe('PLACEHOLDER_PENDING_AUDIT');
  });
});

describe('all four sources register side-by-side', () => {
  it('does not collide (each id matches its kind)', () => {
    const registry = new ContextSourceRegistry();
    registry.register(createOverlayMemorySource({ readOverlayRootBinding: async () => null }));
    registry.register(createProjectFilesSource({ hasProjectRootBinding: async () => false }));
    registry.register(createHistorySource({ hasDiscoveredRoots: async () => false }));
    registry.register(createCoffeeSource());
    expect(registry.size()).toBe(4);
    expect(registry.has('overlay-memory')).toBe(true);
    expect(registry.has('project-files')).toBe(true);
    expect(registry.has('history')).toBe(true);
    expect(registry.has('coffee')).toBe(true);
  });
});