import { describe, expect, it } from 'vitest';
import { ExecutorRegistry } from '../../../src/core/executors/registry';
import type {
  CapabilityAnswer,
  Executor,
  ExecutorCapabilities,
  ExecutorKind,
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
  const kind: ExecutorKind = 'codex';
  return {
    id: 'codex',
    kind,
    label: 'Codex',
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
    expect(registry.get('codex')?.label).toBe('Codex');
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

  it('rejects id that does not equal kind', () => {
    const registry = new ExecutorRegistry();
    const result = registry.register(makeExecutor({ id: 'claude', kind: 'codex' }));
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
    expect(registry.get('codex')?.capabilities.resume.answer).toBe('UNKNOWN');
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
    expect(registry.has('codex')).toBe(true);
    expect(registry.has('paseo')).toBe(false);
  });
});