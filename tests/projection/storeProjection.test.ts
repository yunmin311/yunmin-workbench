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
});
