import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry } from '../../src/core/parse/dialogueRegistry';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';
import { bindingCandidate } from '../../src/core/project/binding';
import { normalizeGitFacts } from '../../src/main/adapters/gitFacts';
import type { MachineProfile, Observation, OverlaySnapshot } from '../../src/core/types';

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/legacy', n), 'utf8');
const obs: Observation = { source: 'canonical-file', sourceRef: 'fixture', observedAt: 't', verification: 'OBSERVED' };
/** Machine profile project root binding: a fixture value, never a real machine path. */
const PROJECT_ROOT = '/workbench-fixtures/creative-os';
const machine: MachineProfile = {
  deviceId: 'claude-company-d',
  displayName: '公司电脑',
  availableTools: {},
  projectRoots: { 'creative-os': PROJECT_ROOT },
  observed: obs,
};
const snap: OverlaySnapshot = {
  overlayRoot: '/fake',
  foundAt: 't',
  conversations: parseDialogueRegistry(fx('dialogues.yaml'), obs),
  projects: [parseProjectAdapter(fx('creative-os.adapter.yaml'), obs)!],
  inbox: [],
  memoryIndex: [],
  machine,
  harness: [],
  sourceFingerprints: [],
  problems: [],
};
const git = normalizeGitFacts('creative-os', PROJECT_ROOT, {
  status: { current: '001-inspiration-capture', modified: [], not_added: [], created: [], deleted: [], ahead: 0, behind: 0, isClean: () => true },
  remotes: [{ name: 'origin', fetch: 'https://github.com/yunmin311/creative-os.git' }],
  head: 'aa0395f',
  observedAt: 't',
});

describe('bindingCandidate (Integrity §2: confirm what real data confirms)', () => {
  const design = snap.conversations.find((c) => c.role === 'CO 设计对话')!; // VERIFIED session
  const codexSub = snap.conversations.find((c) => c.role === 'CO Codex 替补')!; // no session

  it('fills harness/machine/cwd/branch/HEAD from canonical+process sources', () => {
    const { binding } = bindingCandidate(snap, design, git);
    expect(binding.harness).toBe('claude');
    expect(binding.machine).toBe('claude-company-d');
    expect(binding.cwd).toBe(PROJECT_ROOT);
    expect(binding.branch).toBe('001-inspiration-capture');
    expect(binding.head).toBe('aa0395f');
    expect(binding.externalSessionRef).toBe('317e0807');
  });

  it('unverified session ids never become externalSessionRef', () => {
    const { binding } = bindingCandidate(snap, codexSub, git);
    expect(binding.externalSessionRef).toBeUndefined();
  });

  it('missing git/machine data stays UNKNOWN, not guessed', () => {
    const bare: OverlaySnapshot = { ...snap, machine: undefined };
    const { binding, verification } = bindingCandidate(bare, design, null);
    expect(binding.machine).toBe('UNKNOWN');
    expect(binding.cwd).toBeUndefined();
    expect(binding.branch).toBeUndefined();
    expect(verification).toBe('UNKNOWN');
  });

  it('ignores git facts from a different project', () => {
    const other = { ...git, projectId: 'personal-site' };
    const { binding } = bindingCandidate(snap, design, other);
    expect(binding.branch).toBeUndefined();
  });

  it('keeps canonical-file and Git process evidence separate', () => {
    const candidate = bindingCandidate(snap, design, git);
    expect(candidate.evidence.map((e) => e.source)).toContain('canonical-file');
    expect(candidate.evidence.map((e) => e.source)).toContain('process');
    expect(candidate.verification).toBe('OBSERVED');
  });

  it('uses an explicitly verified Workbench-local root with separate provenance', () => {
    const rebound: OverlaySnapshot = {
      ...snap,
      workbenchProjectRoots: {
        'creative-os': {
          projectId: 'creative-os', root: 'E:/rebound/creative-os', canonicalPath: 'CLAUDE.md',
          observed: { source: 'process', sourceRef: 'workbench-userData:binding', observedAt: 't2', verification: 'VERIFIED' },
        },
      },
    };
    const candidate = bindingCandidate(rebound, design, null);
    expect(candidate.binding.cwd).toBe('E:/rebound/creative-os');
    expect(candidate.evidence.some((item) => item.sourceRef === 'workbench-userData:binding')).toBe(true);
  });
});
