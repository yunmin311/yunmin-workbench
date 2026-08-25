import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry } from '../../src/core/parse/dialogueRegistry';
import { parseInbox } from '../../src/core/parse/inbox';
import { parseMemoryIndex } from '../../src/core/parse/memoryIndex';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';
import { discoverProjects } from '../../src/core/project/discovery';
import type { MachineProfile, Observation, OverlaySnapshot } from '../../src/core/types';

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/legacy', n), 'utf8');
const obs: Observation = { source: 'canonical-file', sourceRef: 'fixture', observedAt: 't', verification: 'OBSERVED' };

function snapshot(machine?: MachineProfile): OverlaySnapshot {
  return {
    overlayRoot: '/fake',
    foundAt: '2026-08-25T00:00:00Z',
    conversations: parseDialogueRegistry(fx('dialogues.yaml'), obs),
    projects: [parseProjectAdapter(fx('creative-os.adapter.yaml'), obs)!],
    inbox: parseInbox(fx('INBOX.md')),
    memoryIndex: parseMemoryIndex(fx('MEMORY.md')),
    machine,
    harness: [],
    sourceFingerprints: [],
    problems: [],
  };
}

const machine: MachineProfile = {
  deviceId: 'claude-company-d',
  displayName: '公司电脑',
  availableTools: {},
  projectRoots: { 'creative-os': 'D:\\project', 'design-library': 'D:\\design-library' },
  observed: obs,
};

describe('discoverProjects coverage tiers (PDF §7)', () => {
  const list = discoverProjects(snapshot(machine));
  const byId = Object.fromEntries(list.map((p) => [p.projectId, p]));

  it('adapter + VERIFIED canonical => VERIFIED with adapter+git coverage', () => {
    expect(byId['creative-os'].trust).toBe('VERIFIED');
    expect(byId['creative-os'].coverage).toEqual(['adapter', 'git', 'conversation']);
  });

  it('git-bound without adapter => DISCOVERED', () => {
    expect(byId['design-library'].trust).toBe('DISCOVERED');
    expect(byId['design-library'].coverage).toEqual(['git']);
  });

  it('conversation-only => UNKNOWN, never promoted', () => {
    expect(byId['governance'].trust).toBe('UNKNOWN');
    expect(byId['governance'].coverage).toEqual(['conversation']);
    expect(byId['personal-site'].trust).toBe('UNKNOWN');
  });

  it('works with no machine profile at all (coverage degrades, nothing guessed)', () => {
    const bare = discoverProjects(snapshot(undefined));
    expect(bare.find((p) => p.projectId === 'creative-os')!.coverage).toEqual(['adapter', 'conversation']);
  });
});
