// Yunmin Workbench Demo Workspace — Workbench-owned fixture data.
//
// This fixture describes only the isolated demo workspace and its initial
// Context. Executions still travel through the production dispatch pipeline;
// the main process selects a scoped deterministic adapter from the explicit
// demo session identity and never persists those events into real SOT.
//
// Everything here is a local constant: immutable, reset by re-instantiating,
// and visibly labelled DEMO. It shares the production type shapes so the
// renderer projections (Session Spine, Context staging, Packet, Runtime
// Inspector, Attention, History/Memory panels, Collaboration) all render
// against the same contract surface the real data uses — but the values are
// fictional and derived solely from this file.

import type {
  ContextItem,
  Conversation,
  FrozenPacket,
  OverlaySnapshot,
} from '../../../core/types';

export const DEMO_MODE = 'demo' as const;
export const DEMO_VERSION = 1;
export const DEMO_SOURCE = 'workbench-demo';

const now = () => new Date().toISOString();

function obs(kind: 'protocol' | 'process' | 'canonical-file', ref: string, verification: 'VERIFIED' | 'OBSERVED' | 'INFERRED' | 'UNKNOWN' = 'OBSERVED') {
  return { source: kind, sourceRef: ref, observedAt: now(), verification };
}

// ---- Projects -------------------------------------------------------------

interface DemoProject {
  projectId: string;
  displayName: string;
  platform: 'claude' | 'codex' | 'deepseek' | 'other';
  role: string;
}

export const DEMO_PROJECTS: DemoProject[] = [
  { projectId: 'creative-os', displayName: 'Creative OS', platform: 'claude', role: 'Creative OS 主对话' },
  { projectId: 'governance', displayName: 'Product Governance', platform: 'codex', role: 'Governance 栈' },
  { projectId: 'personal-site', displayName: 'Personal Site', platform: 'claude', role: '站点发布' },
];

// ---- Conversations --------------------------------------------------------
// Creative OS mirrors a real multi-session setup: one main dialogue plus
// supporting roles across platforms. Lifecycle states deliberately differ so
// the sidebar and Governance strip exercise non-ACTIVE routing.

interface DemoConversationSeed {
  project: string;
  platform: DemoProject['platform'];
  role: string;
  status: Conversation['status'];
  taskState: Conversation['taskState'];
  runtimeState: Conversation['runtimeState'];
  verification: Conversation['verification'];
  sourceRef: string;
}

function conv(seed: DemoConversationSeed): Conversation {
  return {
    key: `${seed.project}::${seed.platform}::${seed.role}`,
    role: seed.role,
    project: seed.project,
    platform: seed.platform,
    status: seed.status,
    taskState: seed.taskState,
    runtimeState: seed.runtimeState,
    attention: 'none',
    verification: seed.verification,
    observed: obs('canonical-file', seed.sourceRef, 'VERIFIED'),
  };
}

export const DEMO_CONVERSATIONS: Conversation[] = [
  // Creative OS — six real, anonymised role conversations.
  conv({ project: 'creative-os', platform: 'claude', role: 'Creative OS 主对话', status: 'ACTIVE', taskState: 'active', runtimeState: 'idle', verification: 'VERIFIED', sourceRef: 'demo:conversation:creative-os:main' }),
  conv({ project: 'creative-os', platform: 'claude', role: 'Creative OS 规划', status: 'ACTIVE', taskState: 'waiting', runtimeState: 'unknown', verification: 'VERIFIED', sourceRef: 'demo:conversation:creative-os:planning' }),
  conv({ project: 'creative-os', platform: 'deepseek', role: 'Creative OS 顾问', status: 'PAUSED', taskState: 'waiting', runtimeState: 'stopped', verification: 'UNVERIFIED', sourceRef: 'demo:conversation:creative-os:advisor' }),
  conv({ project: 'creative-os', platform: 'claude', role: 'Creative OS 设计', status: 'ACTIVE', taskState: 'active', runtimeState: 'idle', verification: 'VERIFIED', sourceRef: 'demo:conversation:creative-os:design' }),
  conv({ project: 'creative-os', platform: 'claude', role: 'Creative OS 笔记', status: 'PAUSED', taskState: 'unknown', runtimeState: 'stopped', verification: 'UNVERIFIED', sourceRef: 'demo:conversation:creative-os:notes' }),
  conv({ project: 'creative-os', platform: 'codex', role: 'Creative OS Codex 替补', status: 'STANDBY', taskState: 'standby', runtimeState: 'stopped', verification: 'VERIFIED', sourceRef: 'demo:conversation:creative-os:codex-standby' }),
  // Other demo workspaces keep one conversation each.
  conv({ project: 'governance', platform: 'codex', role: 'Governance 栈', status: 'ACTIVE', taskState: 'waiting', runtimeState: 'idle', verification: 'VERIFIED', sourceRef: 'demo:conversation:governance' }),
  conv({ project: 'personal-site', platform: 'claude', role: '站点发布', status: 'ACTIVE', taskState: 'active', runtimeState: 'unknown', verification: 'VERIFIED', sourceRef: 'demo:conversation:personal-site' }),
];

// ---- Context staging (visible Included / Excluded / Pinned) ---------------

export const DEMO_CONTEXT: ContextItem[] = [
  {
    id: 'demo:creative-os:canon',
    title: 'Canonical source: CLAUDE.md',
    source: 'adapter:creative-os',
    body: 'Creative OS 项目约定：所有产物先落 doc/，评审闭环后再合入主干。',
    state: 'included',
    pinned: true,
    isReference: true,
    sourceRef: 'demo:project-file:creative-os:CLAUDE.md',
    provenance: 'EXTERNAL',
  },
  {
    id: 'demo:creative-os:gate:release',
    title: 'Gate: release',
    source: 'adapter:creative-os',
    body: 'release gate 要求 typecheck / test / build 全绿，且 review 无 Critical。',
    state: 'included',
    pinned: false,
    isReference: false,
    sourceRef: 'demo:adapter:creative-os',
    provenance: 'EXTERNAL',
  },
  {
    id: 'demo:creative-os:memory:design-system',
    title: 'Memory: Design system tokens',
    source: 'memory:design-system',
    body: 'Material tokens：surface / border / text / emphasis 四层级，禁止新增 Material mode。',
    state: 'available',
    pinned: false,
    isReference: true,
    sourceRef: 'demo:memory:design-system.md',
    provenance: 'EXTERNAL',
  },
  {
    id: 'demo:creative-os:inbox:12',
    title: 'INBOX #12',
    source: 'inbox:12',
    body: '这次发布要带上新的 landing 首屏。',
    state: 'excluded',
    pinned: false,
    isReference: true,
    sourceRef: 'demo:overlay:INBOX.md',
    provenance: 'EXTERNAL',
  },
  {
    id: 'demo:creative-os:manual:1',
    title: 'Manual: 本次交付目标',
    source: 'manual',
    body: '给 Creative OS 新用户设计一套零配置的开箱体验，并保证退出后真实数据不受影响。',
    state: 'included',
    pinned: false,
    isReference: false,
    provenance: 'USER PROVIDED',
  },
];

// ---- Frozen Packet (draft + frozen example) --------------------------------

export const DEMO_FROZEN: FrozenPacket[] = [
  {
    schemaVersion: 1,
    packetId: 'demo-packet-001',
    projectId: 'creative-os',
    conversationKey: 'creative-os::claude::Creative OS 主对话',
    hash: 'demo-frozen-001',
    version: 1,
    createdAt: now(),
    frozenAt: now(),
    taskSummary: '为 Creative OS 新用户设计开箱即用的 Demo 首屏',
    included: DEMO_CONTEXT.slice(0, 2),
    references: DEMO_CONTEXT.slice(2, 4),
    governanceRefs: ['demo:adapter:creative-os'],
    sourceFingerprints: [
      { sourceRef: 'demo:project-file:creative-os:CLAUDE.md', sha256: 'demo-sha-canon' },
      { sourceRef: 'demo:adapter:creative-os', sha256: 'demo-sha-adapter' },
    ],
    unresolvedDependencies: [],
    roughTokens: 120,
  },
];

// ---- Overlay snapshot ------------------------------------------------------

export const DEMO_SNAPSHOT: OverlaySnapshot = {
  overlayRoot: 'demo://workbench',
  foundAt: now(),
  conversations: DEMO_CONVERSATIONS,
  projects: DEMO_PROJECTS.map((project, index) => ({
    projectId: project.projectId,
    displayName: project.displayName,
    status: 'ACTIVE',
    roles: index === 0
      ? [{ name: 'product', responsibility: '把产品意图落成可体验流程' }]
      : [{ name: 'maintainer', responsibility: '维护 governance/发布' }],
    gates: index === 0
      ? { release: 'typecheck/test/build green + no Critical review' } as Record<string, string>
      : { nocontract: 'demo governance project keeps truth read-only' } as Record<string, string>,
    trust: 'VERIFIED' as const,
    observed: obs('canonical-file', `demo:project:${project.projectId}`, 'VERIFIED'),
  })),
  inbox: [
    { id: 'demo-inbox-12', scope: 'project', projectId: 'creative-os', raw: '这次发布要带上新的 landing 首屏。', done: false, attention: true, line: 12, sourceRef: 'demo:overlay:INBOX.md#12' },
  ],
  memoryIndex: [
    { id: 'design-system', title: 'Design system tokens', hook: 'Material tokens：surface / border / text / emphasis 四层级。', category: 'product', sourceRef: 'demo:memory:design-system.md' },
  ],
  machine: {
    deviceId: 'demo-machine',
    displayName: 'Demo Machine',
    availableTools: { codex: 'demo codex', claude: 'demo claude' },
    projectRoots: Object.fromEntries(DEMO_PROJECTS.map((p) => [p.projectId, `demo/projects/${p.projectId}`])),
    observed: obs('canonical-file', 'demo:machine', 'VERIFIED'),
  },
  harness: [
    { harness: 'codex', model: 'gpt-5.6-luna', pluginsEnabled: 2, hooks: [], observed: obs('process', 'demo:harness:codex', 'OBSERVED') },
    { harness: 'claude', model: 'claude-sonnet', pluginsEnabled: 0, hooks: [], observed: obs('process', 'demo:harness:claude', 'OBSERVED') },
    { harness: 'deepseek', pluginsEnabled: 0, hooks: [], observed: obs('process', 'demo:harness:deepseek', 'OBSERVED') },
  ],
  sourceFingerprints: [
    { sourceRef: 'demo:project-file:creative-os:CLAUDE.md', sha256: 'demo-sha-canon' },
    { sourceRef: 'demo:adapter:creative-os', sha256: 'demo-sha-adapter' },
    // buildStaging derives gate items from each adapter's observed ref, so the
    // demo snapshot must fingerprint those refs or rebuilt staging (any session
    // switch) compiles an INVALID dispatch packet.
    ...DEMO_PROJECTS.map((p) => ({ sourceRef: `demo:project:${p.projectId}`, sha256: `demo-sha-project-${p.projectId}` })),
  ],
  problems: [],
};
