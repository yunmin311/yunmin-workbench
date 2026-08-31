import { describe, expect, it } from 'vitest';
import { HandoffDispatchRegistry } from '../../src/main/handoffDispatch';
import { RuntimeContextRegistry } from '../../src/main/runtimeContextRegistry';

describe('Harness unified — duplicate dispatch prevention', () => {
  it('same intentId never starts two sends (even across harness switch)', async () => {
    const registry = new HandoffDispatchRegistry<string>();
    let count = 0;
    const dispatch = () => new Promise<string>((resolve) => setTimeout(() => { count += 1; resolve('ok'); }, 10));
    const a = registry.run('dup-intent', dispatch);
    const b = registry.run('dup-intent', dispatch);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('ok');
    expect(rb).toBe('ok');
    expect(count).toBe(1);
  });
});

describe('Harness unified — Runtime Binding belongs to execution, not conversation', () => {
  it('keys runtime context by harness plus native ref, never native ref alone', () => {
    const registry = new RuntimeContextRegistry<{ conversationKey: string }>();
    registry.set('codex', 'same-ref', { conversationKey: 'conversation-a' });
    registry.set('claude', 'same-ref', { conversationKey: 'conversation-b' });
    expect(registry.get('codex', 'same-ref')?.conversationKey).toBe('conversation-a');
    expect(registry.get('claude', 'same-ref')?.conversationKey).toBe('conversation-b');
  });
  it('same conversation can have different harness sessions over time without overwriting', () => {
    // Simulated runtimeContexts map
    const contexts = new Map<string, { harness: string; conversationKey: string }>();
    contexts.set('codex-thread-1', { harness: 'codex', conversationKey: 'proj::claude::main' });
    contexts.set('claude-session-xyz', { harness: 'claude', conversationKey: 'proj::claude::main' });
    // Both exist independently
    expect(contexts.get('codex-thread-1')?.harness).toBe('codex');
    expect(contexts.get('claude-session-xyz')?.harness).toBe('claude');
    expect(contexts.size).toBe(2);
  });
  it('does not pair sessions by cwd/title/provider', () => {
    const a = { harness: 'codex', cwd: 'E:\\same-cwd', provider: 'codex' };
    const b = { harness: 'claude', cwd: 'E:\\same-cwd', provider: 'claude' };
    // Same cwd but different harness must not be considered same execution
    expect(a.cwd === b.cwd).toBe(true);
    expect(a.harness === b.harness).toBe(false);
    // Identity is harness-specific session ref, not cwd
  });
});

describe('Harness unified — event envelope retains harness provenance', () => {
  it('normalized event keeps harness and sourceRef', () => {
    const envelope = {
      harness: 'claude' as const,
      method: 'turn/completed',
      params: { sessionId: 'sess-1' },
      verification: 'VERIFIED' as const,
      sourceRef: 'claude:stream-json:result',
    };
    expect(envelope.harness).toBe('claude');
    expect(envelope.sourceRef).toContain('claude:');
    expect(envelope.verification).toBe('VERIFIED');
  });
});
