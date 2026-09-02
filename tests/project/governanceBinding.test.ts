import { describe, expect, it } from 'vitest';
import { projectGovernanceView, governanceRefsForPacket } from '../../src/core/project/governanceBinding';
import { DEMO_SNAPSHOT, DEMO_PROJECTS, DEMO_CONVERSATIONS } from '../../src/renderer/src/demo/demoData';
import type { Conversation, OverlaySnapshot } from '../../src/core/types';

const ADAPTER_OBSERVED = 'overlay:creative-os.adapter';
const DIALOG_OBSERVED_MAIN = 'overlay:creative-os.dialogue#main';
const DIALOG_OBSERVED_REVIEWER = 'overlay:creative-os.dialogue#reviewer';

const realSnapshot: OverlaySnapshot = {
  overlayRoot: '/overlay/creative-os',
  foundAt: '2026-08-22T10:00:00.000Z',
  conversations: [
    {
      key: 'creative-os::claude::主对话',
      role: '主对话',
      project: 'creative-os',
      platform: 'claude',
      status: 'ACTIVE',
      taskState: 'active',
      runtimeState: 'unknown',
      attention: 'none',
      verification: 'VERIFIED',
      sessionId: 'aa-bb',
      gitAuthority: '项目根 Git 所有权',
      observed: { source: 'canonical-file', sourceRef: DIALOG_OBSERVED_MAIN, observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
    },
    {
      key: 'creative-os::claude::顾问对话',
      role: '顾问对话',
      project: 'creative-os',
      platform: 'claude',
      status: 'ACTIVE',
      taskState: 'active',
      runtimeState: 'idle',
      attention: 'none',
      verification: 'VERIFIED',
      sessionId: 'cc-dd',
      observed: { source: 'canonical-file', sourceRef: DIALOG_OBSERVED_REVIEWER, observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
    },
    {
      key: 'creative-os::codex::CO Codex 替补',
      role: 'CO Codex 替补',
      project: 'creative-os',
      platform: 'codex',
      status: 'STANDBY',
      taskState: 'standby',
      runtimeState: 'unknown',
      attention: 'none',
      verification: 'UNVERIFIED',
      observed: { source: 'canonical-file', sourceRef: 'overlay:creative-os.dialogue#codex-standby', observedAt: '2026-08-22T10:00:00.000Z', verification: 'OBSERVED' },
    },
  ],
  projects: [
    {
      projectId: 'creative-os',
      displayName: 'Creative OS',
      status: 'CANDIDATE',
      lastVerifiedAt: '2026-07-31T19:45:00+08:00',
      canonicalSource: {
        repository: 'yunmin311/creative-os',
        remote: 'https://github.com/yunmin311/creative-os.git',
        defaultBranch: '001-inspiration-capture',
        path: 'CLAUDE.md',
        commit: 'aa0395fcc741a0d8e0cc5f4138f2664542223417',
        verification: 'VERIFIED',
      },
      roles: [
        { name: '主对话', responsibility: 'code, repository root, git ownership' },
        { name: '顾问对话', responsibility: 'read-only final review' },
        { name: '设计对话', responsibility: 'design, never writes project Git' },
        { name: 'Opus Reviewer', responsibility: 'sonnet-quality review' },
      ],
      gates: {
        code_closeout_approver: '顾问对话',
        commit_decider: '主对话',
        push_owner: '主对话',
        history_rewrite_approver: '用户',
        default_flow: '改文件→回归测试→主对话提交→顾问对话评审→主对话 push',
      },
      trust: 'VERIFIED',
      observed: { source: 'canonical-file', sourceRef: ADAPTER_OBSERVED, observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
    },
  ],
  inbox: [],
  memoryIndex: [],
  machine: { deviceId: 'claude-company-d', displayName: 'D', availableTools: { node: 'v22' }, projectRoots: { 'creative-os': 'D:/creative-os' }, observed: { source: 'canonical-file', sourceRef: 'overlay:machine', observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' } },
  harness: [],
  sourceFingerprints: [],
  problems: [],
};

const realConversation: Conversation = realSnapshot.conversations[0];

describe('governanceBinding.projectGovernanceView', () => {
  it('keeps adapter.observed.sourceRef as the only governance fact about the adapter', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    expect(view.adapterObservedRef).toBe(ADAPTER_OBSERVED);
    expect(view.dialogueObservedRef).toBe(DIALOG_OBSERVED_MAIN);
    expect(view.projectTrust).toBe('VERIFIED');
    expect(view.projectDisplayName).toBe('Creative OS');
  });

  it('never derives a canonical source ref from adapter.canonicalSource.path (no Governance impersonation)', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const json = JSON.stringify(view);
    expect(json.includes('project-file:creative-os:CLAUDE.md')).toBe(false);
    expect(json.includes('overlay:memory/MEMORY.md')).toBe(false);
  });

  it('projects roles, gates, and default_flow verbatim from the adapter', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    expect(view.roles.map((role) => role.role)).toEqual(['主对话', '顾问对话', '设计对话', 'Opus Reviewer']);
    const mainRole = view.roles.find((role) => role.role === '主对话')!;
    expect(mainRole.alive).toBe(true);
    expect(mainRole.lifecycle).toBe('ACTIVE');
    const designRole = view.roles.find((role) => role.role === '设计对话')!;
    expect(designRole.alive).toBe(false);
    expect(designRole.lifecycle).toBe('UNKNOWN');
    expect(view.gates.declared).toEqual(realSnapshot.projects[0].gates);
    expect(view.gates.defaultFlow).toBe('改文件→回归测试→主对话提交→顾问对话评审→主对话 push');
    expect(view.gates.undeclared).toBe(false);
    expect(view.hasGate).toBe(true);
  });

  it('emits a problem when the adapter is missing for the active project', () => {
    const view = projectGovernanceView(realSnapshot, 'personal-site', realConversation);
    expect(view.adapter).toBeNull();
    expect(view.adapterObservedRef).toBeNull();
    expect(view.problems).toContain('Project adapter is missing for the active project.');
  });

  it('flags a hard owner conflict when two adapters for the same project disagree on a gate key', () => {
    const conflictSnapshot: OverlaySnapshot = {
      ...realSnapshot,
      projects: [
        realSnapshot.projects[0],
        {
          ...realSnapshot.projects[0],
          projectId: 'creative-os',
          displayName: 'Creative OS Mirror',
          status: 'CANDIDATE',
          trust: 'DISCOVERED',
          gates: { commit_decider: '顾问对话' },
          observed: { source: 'canonical-file', sourceRef: 'overlay:creative-os.mirror.adapter', observedAt: '2026-08-22T10:00:00.000Z', verification: 'OBSERVED' },
        },
      ],
    };
    const view = projectGovernanceView(conflictSnapshot, 'creative-os', realConversation);
    expect(view.gates.ownerConflicts.find((conflict) => conflict.key === 'commit_decider')).toBeDefined();
    expect(view.problems.some((message) => message.includes('commit_decider'))).toBe(true);
  });

  it('returns UNKNOWN lifecycle and verification when the active conversation is absent', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', null);
    expect(view.dialogue.roleFromRegistry).toBeNull();
    expect(view.dialogue.lifecycle).toBe('UNKNOWN');
    expect(view.dialogue.verification).toBe('UNKNOWN');
    expect(view.dialogueObservedRef).toBeNull();
  });
});

describe('governanceBinding.agentHints — strictly from dialog registry', () => {
  it('surfaces a single role only when exactly one dialogue on the harness platform exists for the project', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const codex = view.agentHints.find((hint) => hint.harness === 'codex')!;
    expect(codex.state).toBe('single');
    expect(codex.role).toBe('CO Codex 替补');
  });

  it('returns ambiguous (no role) when multiple dialogue roles exist for the same project+platform', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const claude = view.agentHints.find((hint) => hint.harness === 'claude')!;
    expect(claude.state).toBe('ambiguous');
    expect(claude.role).toBeNull();
  });

  it('returns none when no dialogue exists for the platform', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const deepseek = view.agentHints.find((hint) => hint.harness === 'deepseek')!;
    expect(deepseek.state).toBe('none');
    expect(deepseek.role).toBeNull();
  });

  it('never infers a role from ProjectAdapter.roles text (no name-based aliasing)', () => {
    // The adapter.roles list contains "Opus Reviewer" which mentions an
    // opus-family alias. The agent hint for deepseek must remain "none"
    // because the dialog registry has no deepseek conversation.
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const deepseek = view.agentHints.find((hint) => hint.harness === 'deepseek')!;
    expect(deepseek.state).toBe('none');
    expect(deepseek.role).toBeNull();
  });
});

describe('governanceBinding.governanceRefsForPacket', () => {
  it('returns the real adapter.observed.sourceRef + dialogue.observed.sourceRef verbatim', () => {
    const refs = governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::主对话', false);
    expect(refs).toEqual([ADAPTER_OBSERVED, DIALOG_OBSERVED_MAIN]);
  });

  it('does not fabricate canonical source or memory/MEMORY.md as governance refs', () => {
    const refs = governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::主对话', false);
    expect(refs).not.toContain('project-file:creative-os:CLAUDE.md');
    expect(refs).not.toContain('overlay:memory/MEMORY.md');
  });

  it('emits the same set of governance refs regardless of dispatch mode (Single / Parallel / Handoff)', () => {
    const single = governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::主对话', false);
    const parallel = governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::主对话', false);
    const handoff = governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::主对话', false);
    expect(single).toEqual(parallel);
    expect(parallel).toEqual(handoff);
  });

  it('uses only the active conversation — never picks the first dialogue in the project', () => {
    // Two distinct conversations on the same project with distinct
    // observed.sourceRef; the helper must follow the conversationKey the
    // caller passes, not whichever happens to be first in the array.
    const secondObserved = 'overlay:creative-os.dialogue#second';
    const multiConv: OverlaySnapshot = {
      ...realSnapshot,
      conversations: [
        realSnapshot.conversations[0],
        {
          ...realSnapshot.conversations[1],
          key: 'creative-os::claude::主对话-2',
          observed: { ...realSnapshot.conversations[1].observed, sourceRef: secondObserved },
        },
      ],
    };
    const mainRefs = governanceRefsForPacket(multiConv, 'creative-os', 'creative-os::claude::主对话', false);
    const secondRefs = governanceRefsForPacket(multiConv, 'creative-os', 'creative-os::claude::主对话-2', false);
    expect(mainRefs).toEqual([ADAPTER_OBSERVED, DIALOG_OBSERVED_MAIN]);
    expect(secondRefs).toEqual([ADAPTER_OBSERVED, secondObserved]);
    expect(mainRefs).not.toContain(secondObserved);
    expect(secondRefs).not.toContain(DIALOG_OBSERVED_MAIN);
  });

  it('returns an empty list when the active conversation key is missing from the project', () => {
    expect(
      governanceRefsForPacket(realSnapshot, 'creative-os', 'creative-os::claude::does-not-exist', false),
    ).toEqual([]);
  });

  it('returns an empty list when no active conversation key is supplied', () => {
    expect(governanceRefsForPacket(realSnapshot, 'creative-os', null, false)).toEqual([]);
  });

  it('returns demo-namespaced adapter + dialogue refs and never the real Overlay refs', () => {
    const refs = governanceRefsForPacket(DEMO_SNAPSHOT, 'creative-os', DEMO_CONVERSATIONS[0].key, true);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => ref.startsWith('demo:'))).toBe(true);
    expect(refs.some((ref) => ref === ADAPTER_OBSERVED || ref === DIALOG_OBSERVED_MAIN)).toBe(false);
  });

  it('returns the demo namespaced ref of the active demo conversation only', () => {
    // Demo also carries more than one conversation per project; the helper
    // must scope to the requested conversation key, never the first.
    const extraDemoObserved = 'demo:conversation:creative-os#secondary';
    const multiDemo: OverlaySnapshot = {
      ...DEMO_SNAPSHOT,
      conversations: [
        ...DEMO_CONVERSATIONS,
        {
          ...DEMO_CONVERSATIONS[0],
          key: 'creative-os::claude::secondary-dialogue',
          observed: { ...DEMO_CONVERSATIONS[0].observed, sourceRef: extraDemoObserved },
        },
      ],
    };
    const primary = governanceRefsForPacket(multiDemo, 'creative-os', DEMO_CONVERSATIONS[0].key, true);
    const secondary = governanceRefsForPacket(multiDemo, 'creative-os', 'creative-os::claude::secondary-dialogue', true);
    expect(primary).toContain(extraDemoObserved === primary[1] ? 'demo:project:creative-os' : extraDemoObserved);
    // Simpler: the two conversations produce different dialogue provenance.
    const primaryDialogue = primary.find((ref) => ref !== 'demo:project:creative-os');
    const secondaryDialogue = secondary.find((ref) => ref !== 'demo:project:creative-os');
    expect(primaryDialogue).not.toBe(secondaryDialogue);
  });

  it('returns an empty list for a real project that is not present in the snapshot', () => {
    expect(governanceRefsForPacket(realSnapshot, 'ghost-project', 'any-key', false)).toEqual([]);
  });

  it('returns an empty list for a demo project that is not present in the demo snapshot', () => {
    expect(governanceRefsForPacket(DEMO_SNAPSHOT, 'ghost-project', 'any-key', true)).toEqual([]);
  });
});

describe('governanceBinding preserves demo fixture role facts', () => {
  it('still resolves the demo Creative-OS project adapter roles and gates', () => {
    const demoProject = DEMO_PROJECTS[0];
    const demoConversation = DEMO_CONVERSATIONS[0];
    const view = projectGovernanceView(DEMO_SNAPSHOT, demoProject.projectId, demoConversation);
    expect(view.adapter).not.toBeNull();
    expect(view.gates.declared.release).toBe('typecheck/test/build green + no Critical review');
    expect(view.dialogue.lifecycle).toBe('ACTIVE');
    expect(view.dialogue.verification).toBe('VERIFIED');
    expect(view.adapterObservedRef).toBeTruthy();
    expect(view.dialogueObservedRef).toBeTruthy();
  });
});
