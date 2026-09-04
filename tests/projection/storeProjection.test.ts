import { beforeAll, describe, expect, it } from 'vitest';
import { useWorkbench } from '../../src/renderer/src/store';

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { wb: {} },
  });
});

describe('renderer Projection ownership', () => {
  it('builds a verified projection in the existing store for Demo facts', () => {
    useWorkbench.getState().enterDemo();
    const state = useWorkbench.getState();
    expect(state.projection.status).toBe('VERIFIED');
    expect(state.projection.current?.candidate.scope.projectId).toBe('creative-os');
    expect(state.projection.current?.candidate.semanticFacts.conversations.length).toBeGreaterThan(0);
  });

  it('replaces cross-project last-good instead of displaying the prior project', () => {
    useWorkbench.getState().enterDemo();
    const firstRevision = useWorkbench.getState().projection.current?.revisionId;
    useWorkbench.getState().selectProject('governance');
    const state = useWorkbench.getState();
    expect(state.projection.current?.candidate.scope.projectId).toBe('governance');
    expect(state.projection.current?.revisionId).not.toBe(firstRevision);
  });

  it('selects a Conversation only through a verified semantic ref', () => {
    useWorkbench.getState().enterDemo();
    useWorkbench.getState().selectProject('creative-os');
    expect(useWorkbench.getState().conversation).toBeNull();

    const conversationRef = useWorkbench.getState().projection.current
      ?.candidate.semanticFacts.conversations[0]?.id;
    if (!conversationRef) throw new Error('fixture must include a verified Conversation');
    useWorkbench.getState().selectProjectedConversation(conversationRef);
    expect(useWorkbench.getState().conversation?.key).toBe(
      useWorkbench.getState().projection.current
        ?.candidate.semanticFacts.conversations[0]?.conversationKey,
    );

    useWorkbench.getState().selectProject('creative-os');
    useWorkbench.getState().selectProjectedConversation('conversation:not-verified');
    expect(useWorkbench.getState().conversation).toBeNull();
  });
});
