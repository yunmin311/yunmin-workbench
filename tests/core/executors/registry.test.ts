import { describe, expect, it } from 'vitest';
import { ExecutorRegistry } from '../../../src/core/executors/registry';
import type {
  CapabilityAnswer,
  ExecutionBackend,
  Executor,
  ExecutorCapabilities,
  ProviderIdentity,
} from '../../../src/core/executors/types';

function makeCapabilities(answer: CapabilityAnswer = 'YES'): ExecutorCapabilities {
  const cap = (name: string): ExecutorCapabilities['discover'] => ({
    answer,
    evidence: `${name} evidence`,
  });
  return {
    discover: cap('discover'),
    capabilities: cap('capabilities'),
    dispatch: cap('dispatch'),
    observe: cap('observe'),
    cancel: cap('cancel'),
    resume: cap('resume'),
  };
}

function makeExecutor(overrides: Partial<Executor> = {}): Executor {
  const backend: ExecutionBackend = 'native';
  const provider: ProviderIdentity = 'codex';
  const identity = { backend, provider, id: `${backend}:${provider}`, label: 'Codex (native)' };
  return {
    id: identity.id,
    identity,
    capabilities: makeCapabilities(),
    async availability() { return { state: 'AVAILABLE', reason: 'stub' }; },
    ...overrides,
  };
}

describe('ExecutorRegistry', () => {
  it('registers a valid executor and returns it', () => {
    const registry = new ExecutorRegistry();
    const result = registry.register(makeExecutor());
    expect(result.ok).toBe(true);
    expect(registry.size()).toBe(1);
    expect(registry.get('native:codex')?.identity.label).toBe('Codex (native)');
  });

  it('rejects a second registration of the same id', () => {
    const registry = new ExecutorRegistry();
    registry.register(makeExecutor());
    const second = registry.register(makeExecutor());
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('ALREADY_REGISTERED');
    }
    expect(registry.size()).toBe(1);
  });

  it('rejects id that does not equal identity.id', () => {
    const registry = new ExecutorRegistry();
    const result = registry.register(makeExecutor({ id: 'claude', identity: { backend: 'native', provider: 'codex', id: 'native:codex', label: 'X' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ID_MISMATCH');
    }
  });

  it('rejects an executor whose capability answers are not YES/NO/UNKNOWN', () => {
    const registry = new ExecutorRegistry();
    const bad = makeExecutor();
    (bad.capabilities.dispatch as unknown as { answer: string }).answer = 'maybe';
    const result = registry.register(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CAPABILITY');
    }
  });

  it('accepts UNKNOWN as the honest answer for resume', () => {
    const registry = new ExecutorRegistry();
    const caps = makeCapabilities('YES');
    caps.resume = { answer: 'UNKNOWN', evidence: 'provider does not document resume' };
    const result = registry.register(makeExecutor({ capabilities: caps }));
    expect(result.ok).toBe(true);
    expect(registry.get('native:codex')?.capabilities.resume.answer).toBe('UNKNOWN');
  });

  it('rejects identity.id not in backend:provider format', () => {
    const registry = new ExecutorRegistry();
    const result = registry.register(makeExecutor({ identity: { backend: 'native', provider: 'codex', id: 'invalid', label: 'X' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ID_MISMATCH');
    }
  });

  it('returns a fresh array from list(); mutating it does not change the registry', () => {
    const registry = new ExecutorRegistry();
    registry.register(makeExecutor());
    const first = registry.list();
    first.length = 0;
    expect(registry.size()).toBe(1);
    expect(registry.list().length).toBe(1);
  });

  it('has() reports membership without exposing the entry', () => {
    const registry = new ExecutorRegistry();
    registry.register(makeExecutor());
    expect(registry.has('native:codex')).toBe(true);
    expect(registry.has('paseo:codex')).toBe(false);
  });

  it('listByBackend() filters by backend', () => {
    const registry = new ExecutorRegistry();
    const nativeResult = registry.register(makeExecutor({ id: 'native:codex', identity: { backend: 'native', provider: 'codex', id: 'native:codex', label: 'Codex (native)' } }));
    expect(nativeResult.ok).toBe(true);
    const paseoResult = registry.register(makeExecutor({ id: 'paseo:claude', identity: { backend: 'paseo', provider: 'claude', id: 'paseo:claude', label: 'Claude (Paseo)' } }));
    expect(paseoResult.ok).toBe(true);
    const native = registry.listByBackend('native');
    const paseo = registry.listByBackend('paseo');
    expect(native.length).toBe(1);
    expect(paseo.length).toBe(1);
    expect(native[0].executor.identity.provider).toBe('codex');
    expect(paseo[0].executor.identity.provider).toBe('claude');
  });

  it('getByBackendAndProvider() finds exact match', () => {
    const registry = new ExecutorRegistry();
    registry.register(makeExecutor());
    const exec = registry.getByBackendAndProvider('native', 'codex');
    expect(exec).not.toBeNull();
    expect(exec?.identity.backend).toBe('native');
    expect(exec?.identity.provider).toBe('codex');
    expect(registry.getByBackendAndProvider('paseo', 'codex')).toBeNull();
  });
});