import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockHarnessAdapter } from '../../src/main/adapters/mockHarnessAdapter';

describe('scoped deterministic Demo Harness', () => {
  afterEach(() => vi.useRealTimers());
  it('emits the real lifecycle shape at the adapter boundary for an explicit demo session', async () => {
    const adapter = new MockHarnessAdapter('codex', {
      sessionId: 'demo-session-a', now: () => '2026-09-01T00:00:00.000Z', id: () => 'native-1',
    });
    const events: Array<{ method: string; runtimeSessionRef?: string; params?: unknown }> = [];
    adapter.onEvent((next) => events.push(next));
    const receipt = await adapter.dispatch('intent-1', 'demo://workspace', 'Build the demo result');

    expect(receipt).toMatchObject({
      intentId: 'intent-1', harness: 'codex', status: 'ACCEPTED', runtimeRef: 'demo:demo-session-a:codex:native-1',
      source: 'protocol', protocolEvidence: 'mock-harness:demo-session-a:deterministic',
    });
    expect(events.map((next) => next.method)).toEqual([
      'session/started', 'turn/started', 'tool-started', 'tool-completed', 'item/completed', 'turn/completed',
    ]);
    expect(events.find((next) => next.method === 'item/completed')?.params).toMatchObject({
      type: 'assistant', text: expect.stringContaining('Build the demo result'), simulated: true,
    });
  });

  it('does not share identity or mutable state between demo sessions or agents', async () => {
    const a = new MockHarnessAdapter('codex', { sessionId: 'demo-a', id: () => '1' });
    const b = new MockHarnessAdapter('claude', { sessionId: 'demo-b', id: () => '1' });
    const [ra, rb] = await Promise.all([
      a.dispatch('intent-a', 'demo://workspace', 'A'),
      b.dispatch('intent-b', 'demo://workspace', 'B'),
    ]);
    expect(ra.runtimeRef).toBe('demo:demo-a:codex:1');
    expect(rb.runtimeRef).toBe('demo:demo-b:claude:1');
    expect(ra.runtimeRef).not.toBe(rb.runtimeRef);
  });

  it('can keep the simulated execution observably live before completion', async () => {
    vi.useFakeTimers();
    const adapter = new MockHarnessAdapter('codex', { sessionId: 'demo-live', id: () => '1', completionDelayMs: 250 });
    const methods: string[] = [];
    adapter.onEvent((event) => methods.push(event.method));
    const pending = adapter.dispatch('intent-live', 'demo://workspace', 'Live probe');
    await vi.advanceTimersByTimeAsync(0);
    expect(methods).toContain('turn/started');
    expect(methods).not.toContain('turn/completed');
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(methods.at(-1)).toBe('turn/completed');
  });
});
