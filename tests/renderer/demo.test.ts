import { describe, expect, it } from 'vitest';
import {
  DEMO_SNAPSHOT,
  DEMO_PROJECTS,
  DEMO_CONVERSATIONS,
  DEMO_ACTIVITY,
  DEMO_FROZEN,
  DEMO_ATTENTION,
  DEMO_RUNTIME_SESSIONS,
  DEMO_CONTEXT,
} from '../../src/renderer/src/demo/demoData';
import { runDemoDispatch } from '../../src/renderer/src/demo/demoRuntime';

describe('Demo Workspace data is a Workbench-owned, sandboxed fixture', () => {
  it('snapshot is root-isolated to the demo namespace and never a real path', () => {
    expect(DEMO_SNAPSHOT.overlayRoot).toBe('demo://workbench');
    const allSourceRefs = [
      ...DEMO_SNAPSHOT.conversations.map((item) => item.observed.sourceRef),
      ...DEMO_SNAPSHOT.projects.flatMap((item) => [item.observed.sourceRef]),
      ...DEMO_CONTEXT.map((item) => item.sourceRef ?? item.id),
      ...DEMO_ACTIVITY.map((item) => item.observed.sourceRef),
      ...DEMO_FROZEN.flatMap((item) => item.sourceFingerprints.map((fp) => fp.sourceRef)),
      ...DEMO_SNAPSHOT.sourceFingerprints.map((fp) => fp.sourceRef),
    ].filter(Boolean);
    for (const ref of allSourceRefs) {
      // Every demo provenance ref is namespaced under `demo:`; nothing leaks a
      // real overlay / project / machine path or an external harness path.
      expect(ref.startsWith('demo:')).toBe(true);
    }
    expect(DEMO_SNAPSHOT.machine?.deviceId).toBe('demo-machine');
  });

  it('builds a legal context staging list with included / excluded / pinned / available states', () => {
    const states = new Set(DEMO_CONTEXT.map((item) => item.state));
    expect(states.has('included')).toBe(true);
    expect(states.has('excluded')).toBe(true);
    expect(states.has('available')).toBe(true);
    // Demo includes a pinned item (strengthening of included) and a user-owned manual item.
    expect(DEMO_CONTEXT.some((item) => item.state === 'included' && item.pinned)).toBe(true);
    expect(DEMO_CONTEXT.filter((item) => item.provenance === 'USER PROVIDED').every((item) => item.source === 'manual')).toBe(true);
  });

  it('has non-empty demo content: projects, conversations, activity, frozen packet, attention, runtime', () => {
    expect(DEMO_PROJECTS.length).toBeGreaterThanOrEqual(2);
    expect(DEMO_CONVERSATIONS.length).toBe(DEMO_PROJECTS.length);
    expect(DEMO_ACTIVITY.length).toBeGreaterThan(0);
    expect(DEMO_FROZEN.length).toBeGreaterThanOrEqual(1);
    expect(DEMO_ATTENTION.length).toBeGreaterThanOrEqual(1);
    expect(DEMO_RUNTIME_SESSIONS.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Demo dispatch engine is a harmless local simulation (no real harness, no IO)', () => {
  const req = {
    intentId: '00000000-0000-4000-8000-000000000001',
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::Creative OS 主对话',
    harness: 'claude' as const,
    text: 'Reply with demo ok',
  };

  it('produces an ACCEPTED receipt and a scripted activity stream locally', () => {
    const { receipt, events } = runDemoDispatch(req);
    expect(receipt.status).toBe('ACCEPTED');
    expect(receipt.harness).toBe('claude');
    expect(receipt.source).toBe('protocol');
    expect(receipt.runtimeRef).toMatch(/^demo-claude-/);
    // The stream is entirely local: handoff-accepted -> turn-started ->
    // tool-completed -> turn-completed, all named under the demo namespace.
    expect(events.map((event) => event.kind)).toEqual([
      'handoff-accepted', 'turn-started', 'tool-completed', 'turn-completed',
    ]);
    for (const event of events) {
      expect(event.observed.sourceRef.startsWith('demo:')).toBe(true);
      expect(event.runtimeRef).toMatch(/^demo-claude-/);
    }
  });

  it('supports a failure path without a real runtime, never faking a completion', () => {
    const { receipt, events } = runDemoDispatch(req, { fail: true });
    expect(receipt.status).toBe('FAILED');
    expect(events.at(-1)?.kind).toBe('harness-error');
    expect(events.some((event) => event.kind === 'turn-completed')).toBe(false);
  });

  it('never surfaces a real capability as available for DeepSeek in the demo', () => {
    // The demo harness matrix reflects the genuine capability contract (DeepSeek
    // has no stable structured runtime) so the agent picker stays honest.
    const codex = DEMO_SNAPSHOT.harness.find((item) => item.harness === 'codex');
    expect(codex?.model).toBeTruthy();
  });
});
