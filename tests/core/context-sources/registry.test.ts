import { describe, expect, it } from 'vitest';
import { ContextSourceRegistry } from '../../../src/core/context-sources/registry';
import type {
  CapabilityAnswer,
  ContextSource,
  ContextSourceCapabilities,
  ContextSourceKind,
} from '../../../src/core/context-sources/types';

function makeCapabilities(answer: CapabilityAnswer = 'YES'): ContextSourceCapabilities {
  const cap = (name: string): ContextSourceCapabilities['list'] => ({
    answer,
    evidence: `${name} evidence`,
  });
  return {
    list: cap('list'),
    search: cap('search'),
    read: cap('read'),
    fingerprint: cap('fingerprint'),
    recheck: cap('recheck'),
  };
}

function makeSource(overrides: Partial<ContextSource> = {}): ContextSource {
  const kind: ContextSourceKind = 'history';
  return {
    id: 'history',
    kind,
    label: 'History',
    provenance: 'WORKBENCH_BUILTIN',
    capabilities: makeCapabilities(),
    async availability() { return { state: 'AVAILABLE', reason: 'stub' }; },
    async currentness() { return { state: 'FRESH', reason: 'stub' }; },
    ...overrides,
  };
}

describe('ContextSourceRegistry', () => {
  it('registers a valid source and returns it from list / get', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(makeSource());
    expect(result.ok).toBe(true);
    expect(registry.size()).toBe(1);
    expect(registry.get('history')?.kind).toBe('history');
    expect(registry.list()).length(1);
  });

  it('rejects a second registration of the same id', () => {
    const registry = new ContextSourceRegistry();
    registry.register(makeSource());
    const second = registry.register(makeSource());
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('ALREADY_REGISTERED');
    }
    expect(registry.size()).toBe(1);
  });

  it('rejects id that does not equal kind', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(makeSource({ id: 'wrong-id', kind: 'history' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ID_MISMATCH');
    }
  });

  it('rejects a source whose capability answers are not YES/NO/UNKNOWN', () => {
    const registry = new ContextSourceRegistry();
    const bad = makeSource();
    (bad.capabilities.list as unknown as { answer: string }).answer = 'MAYBE';
    const result = registry.register(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CAPABILITY');
    }
  });

  it('accepts UNKNOWN as an honest capability answer', () => {
    const registry = new ContextSourceRegistry();
    const result = registry.register(makeSource({
      kind: 'coffee',
      id: 'coffee',
      label: 'Coffee (placeholder)',
      provenance: 'PLACEHOLDER_PENDING_AUDIT',
      capabilities: makeCapabilities('UNKNOWN'),
    }));
    expect(result.ok).toBe(true);
    expect(registry.get('coffee')?.provenance).toBe('PLACEHOLDER_PENDING_AUDIT');
  });

  it('returns a fresh array from list(); mutating it does not change the registry', () => {
    const registry = new ContextSourceRegistry();
    registry.register(makeSource());
    const first = registry.list();
    first.length = 0;
    expect(registry.size()).toBe(1);
    expect(registry.list().length).toBe(1);
  });

  it('has() reports membership without exposing the entry', () => {
    const registry = new ContextSourceRegistry();
    registry.register(makeSource());
    expect(registry.has('history')).toBe(true);
    expect(registry.has('overlay-memory')).toBe(false);
    expect(registry.get('overlay-memory')).toBeNull();
  });
});