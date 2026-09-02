import { describe, expect, it } from 'vitest';
import { projectGovernanceView, governanceRefsForPacket } from '../../src/core/project/governanceBinding';
import { DEMO_SNAPSHOT, DEMO_PROJECTS, DEMO_CONVERSATIONS } from '../../src/renderer/src/demo/demoData';
import type { Conversation, OverlaySnapshot } from '../../src/core/types';

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
      observed: { source: 'canonical-file', sourceRef: 'overlay:creative-os.dialogue', observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
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
      observed: { source: 'canonical-file', sourceRef: 'overlay:creative-os.dialogue', observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
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
      ],
      gates: {
        code_closeout_approver: '顾问对话',
        commit_decider: '主对话',
        push_owner: '主对话',
        history_rewrite_approver: '用户',
        default_flow: '改文件→回归测试→主对话提交→顾问对话评审→主对话 push',
      },
      trust: 'VERIFIED',
      observed: { source: 'canonical-file', sourceRef: 'overlay:creative-os.adapter', observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' },
    },
  ],
  inbox: [],
  memoryIndex: [],
  machine: { deviceId: 'claude-company-d', displayName: 'D', availableTools: { node: 'v22' }, projectRoots: { 'creative-os': 'D:/creative-os' }, observed: { source: 'canonical-file', sourceRef: 'overlay:machine', observedAt: '2026-08-22T10:00:00.000Z', verification: 'VERIFIED' } },
  harness: [],
  sourceFingerprints: [
    { sourceRef: 'project-file:creative-os:CLAUDE.md', sha256: 'a'.repeat(64) },
    { sourceRef: 'overlay:memory/MEMORY.md', sha256: 'b'.repeat(64) },
  ],
  problems: [],
};

const realConversation: Conversation = realSnapshot.conversations[0];

describe('governanceBinding.projectGovernanceView', () => {
  it('projects the active adapter roles and lifecycle from the dialogue registry', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    expect(view.projectId).toBe('creative-os');
    expect(view.projectDisplayName).toBe('Creative OS');
    expect(view.projectTrust).toBe('VERIFIED');
    expect(view.canonicalSourceRef).toBe('project-file:creative-os:CLAUDE.md');
    expect(view.canonicalSourceCommit).toBe('aa0395fcc741a0d8e0cc5f4138f2664542223417');
    expect(view.roles.map((role) => role.role)).toEqual(['主对话', '顾问对话', '设计对话']);
    const mainRole = view.roles.find((role) => role.role === '主对话')!;
    expect(mainRole.alive).toBe(true);
    expect(mainRole.lifecycle).toBe('ACTIVE');
    const designRole = view.roles.find((role) => role.role === '设计对话')!;
    expect(designRole.alive).toBe(false);
    expect(designRole.lifecycle).toBe('UNKNOWN');
  });

  it('reports every declared project_gates key with the verbatim owner and a parsed default_flow', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    expect(view.gates.declared).toEqual(realSnapshot.projects[0].gates);
    expect(view.gates.defaultFlow).toBe('改文件→回归测试→主对话提交→顾问对话评审→主对话 push');
    expect(view.gates.undeclared).toBe(false);
    expect(view.gates.ownerConflicts).toEqual([]);
    expect(view.hasGate).toBe(true);
  });

  it('emits a problem when the adapter is missing for the active project', () => {
    const view = projectGovernanceView(realSnapshot, 'personal-site', realConversation);
    expect(view.adapter).toBeNull();
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
        },
      ],
    };
    const view = projectGovernanceView(conflictSnapshot, 'creative-os', realConversation);
    expect(view.gates.ownerConflicts.find((conflict) => conflict.key === 'commit_decider')).toBeDefined();
    expect(view.problems.some((message) => message.includes('commit_decider'))).toBe(true);
  });

  it('suggests a role per harness only when adapter roles or dialogue registry name the harness family', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', realConversation);
    const claude = view.agentHints.find((hint) => hint.harness === 'claude')!;
    const codex = view.agentHints.find((hint) => hint.harness === 'codex')!;
    const deepseek = view.agentHints.find((hint) => hint.harness === 'deepseek')!;
    expect(claude.role).not.toBeNull();
    // Adapter roles are Chinese; the hint falls back to the dialogue registry
    // which carries Claude-platform conversations for this project.
    expect(['adapter+dialog', 'dialog']).toContain(claude.source);
    // codex/deepseek have no dialogue and no naming, so no hint.
    expect(codex.role).toBeNull();
    expect(codex.source).toBe('none');
    expect(deepseek.role).toBeNull();
  });

  it('returns UNKNOWN lifecycle and verification when the active conversation is absent', () => {
    const view = projectGovernanceView(realSnapshot, 'creative-os', null);
    expect(view.dialogue.roleFromRegistry).toBeNull();
    expect(view.dialogue.lifecycle).toBe('UNKNOWN');
    expect(view.dialogue.verification).toBe('UNKNOWN');
  });
});

describe('governanceBinding.governanceRefsForPacket', () => {
  it('returns the real project-file ref + MEMORY.md ref for a real workspace', () => {
    const refs = governanceRefsForPacket(realSnapshot, 'creative-os', false);
    expect(refs).toContain('project-file:creative-os:CLAUDE.md');
    expect(refs).toContain('overlay:memory/MEMORY.md');
  });

  it('returns a namespaced demo ref so Demo governance cannot leak into the real Overlay', () => {
    const refs = governanceRefsForPacket(DEMO_SNAPSHOT, 'creative-os', true);
    expect(refs).toEqual(['demo:adapter:creative-os']);
    expect(refs.some((ref) => ref === 'project-file:creative-os:CLAUDE.md')).toBe(false);
  });

  it('returns the canonical MEMORY.md ref even when the project is unknown to the snapshot (overlay-wide anchor)', () => {
    expect(governanceRefsForPacket(realSnapshot, 'ghost-project', false)).toEqual(['overlay:memory/MEMORY.md']);
    expect(governanceRefsForPacket(DEMO_SNAPSHOT, 'ghost-project', true)).toEqual([]);
  });

  it('is called identically by the real and demo sendTask paths (single source of truth)', () => {
    const realRefs = governanceRefsForPacket(realSnapshot, 'creative-os', false);
    const demoRefs = governanceRefsForPacket(DEMO_SNAPSHOT, 'creative-os', true);
    expect(realRefs).not.toEqual(demoRefs);
    expect(realRefs.length).toBeGreaterThan(0);
    expect(demoRefs.length).toBeGreaterThan(0);
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
  });
});
