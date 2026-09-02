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
  ActivityEvent,
  AttentionItem,
  Conversation,
  ContextItem,
  FrozenPacket,
  FrozenPacketSummary,
  HarnessCapabilities,
  OverlaySnapshot,
} from '../../../core/types';
import type { MemoryEvidenceExpansion, MemorySearchHit, MemorySearchResult } from '../../../core/memory/types';
import type { HistoryCatalogResult, HistoryHit, HistoryMessage, HistorySearchResult, HistorySession, HistorySessionDetail } from '../../../core/history/types';

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
  note?: string;
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
    note: seed.note,
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

// ---- Activity events (single + parallel + handoff scenarios) -------------

const MAIN_CONV = 'creative-os::claude::Creative OS 主对话';
const PLANNING_CONV = 'creative-os::claude::Creative OS 规划';
const ADVISOR_CONV = 'creative-os::deepseek::Creative OS 顾问';
const DESIGN_CONV = 'creative-os::claude::Creative OS 设计';
const CODEX_STANDBY_CONV = 'creative-os::codex::Creative OS Codex 替补';

function evt(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    projectId: overrides.projectId ?? 'creative-os',
    conversationKey: overrides.conversationKey ?? MAIN_CONV,
    kind: overrides.kind ?? 'agent-response',
    summary: overrides.summary ?? '',
    observed: overrides.observed ?? obs('process', `demo:activity:${overrides.id ?? 'unknown'}`, 'OBSERVED'),
    harness: overrides.harness,
    adapter: overrides.adapter,
    capability: overrides.capability,
    runtimeRef: overrides.runtimeRef,
    turnRef: overrides.turnRef,
    intentId: overrides.intentId,
    groupId: overrides.groupId,
    parentSourceRef: overrides.parentSourceRef,
    content: overrides.content,
    evidenceRef: overrides.evidenceRef,
    simulated: overrides.simulated ?? true,
    binding: overrides.binding,
    runtimeState: overrides.runtimeState,
    attentionKey: overrides.attentionKey,
    attentionKind: overrides.attentionKind,
    attentionStatus: overrides.attentionStatus,
  };
}

const GROUP_SINGLE = 'group-single-001';
const GROUP_PARALLEL = 'group-parallel-002';
const GROUP_HANDOFF_A = 'group-handoff-a-003';
const GROUP_HANDOFF_B = 'group-handoff-b-004';

function bindingFor(harness: 'claude' | 'codex' | 'deepseek', externalRef: string) {
  return {
    harness,
    machine: 'demo-machine',
    cwd: `demo/projects/creative-os`,
    worktree: 'main',
    branch: 'feature/landing-v2',
    head: 'demo-sha-head',
    externalSessionRef: externalRef,
  };
}

export const DEMO_ACTIVITY: ActivityEvent[] = [
  // ---- Single execution on 主对话 ----
  evt({
    id: 'evt-main-session-start',
    conversationKey: MAIN_CONV,
    kind: 'session-started',
    summary: 'Session started',
    content: 'Open the Creative OS main conversation to drive the new landing brief.',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    observed: obs('protocol', 'demo:claude:sess-main-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-main-turn-start',
    conversationKey: MAIN_CONV,
    kind: 'turn-started',
    summary: 'Turn started',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    observed: obs('protocol', 'demo:claude:turn-main-001', 'OBSERVED'),
  }),
  evt({
    id: 'evt-main-handoff-dispatched',
    conversationKey: MAIN_CONV,
    kind: 'handoff-dispatched',
    summary: 'Handoff dispatched',
    content: 'Draft a 3-screen landing flow for Creative OS targeting designers and indie makers.',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    evidenceRef: 'demo:intent:single-001',
    observed: obs('protocol', 'demo:dispatch:single-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-main-handoff-accepted',
    conversationKey: MAIN_CONV,
    kind: 'handoff-accepted',
    summary: 'Handoff accepted',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    evidenceRef: 'demo:receipt:single-001',
    observed: obs('protocol', 'demo:receipt:single-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-main-tool-list',
    conversationKey: MAIN_CONV,
    kind: 'tool-completed',
    summary: 'Tool call',
    content: 'list_files(workspace/landing/)',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    evidenceRef: 'demo:tool:list-001',
    observed: obs('protocol', 'demo:tool:list-001', 'OBSERVED'),
  }),
  evt({
    id: 'evt-main-file-change',
    conversationKey: MAIN_CONV,
    kind: 'file-change',
    summary: 'File changed',
    content: 'workspace/landing/brief.md',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    evidenceRef: 'demo:file:brief-001',
    observed: obs('canonical-file', 'demo:file:brief-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-main-response',
    conversationKey: MAIN_CONV,
    kind: 'agent-response',
    summary: 'Agent response',
    content: 'I drafted a 3-screen flow: Hook (problem + audience), Solution (workflow stages), Outcome (proof + CTA). Each screen has a one-line promise and a primary CTA. Ready for visual design review.',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    evidenceRef: 'demo:response:main-001',
    observed: obs('protocol', 'demo:response:main-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-main-turn-completed',
    conversationKey: MAIN_CONV,
    kind: 'turn-completed',
    summary: 'Turn completed',
    harness: 'claude',
    runtimeRef: 'claude::sess-main-001',
    turnRef: 'turn-main-001',
    intentId: 'intent-single-001',
    groupId: GROUP_SINGLE,
    observed: obs('protocol', 'demo:turn:main-001', 'VERIFIED'),
  }),

  // ---- Parallel execution: claude + codex on 规划 ----
  evt({
    id: 'evt-parallel-session-start',
    conversationKey: PLANNING_CONV,
    kind: 'session-started',
    summary: 'Session started',
    content: 'Open the planning conversation to run the same brief through two Agents in parallel.',
    harness: 'claude',
    runtimeRef: 'claude::sess-planning-001',
    intentId: 'intent-parallel-claude',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:claude:sess-planning-001', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-dispatch-claude',
    conversationKey: PLANNING_CONV,
    kind: 'handoff-dispatched',
    summary: 'Handoff dispatched (Claude)',
    content: 'Same brief: draft a 3-screen landing flow for Creative OS.',
    harness: 'claude',
    runtimeRef: 'claude::sess-planning-001',
    turnRef: 'turn-par-claude',
    intentId: 'intent-parallel-claude',
    groupId: GROUP_PARALLEL,
    evidenceRef: 'demo:intent:parallel-claude',
    observed: obs('protocol', 'demo:dispatch:parallel-claude', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-dispatch-codex',
    conversationKey: PLANNING_CONV,
    kind: 'handoff-dispatched',
    summary: 'Handoff dispatched (Codex)',
    content: 'Same brief: draft a 3-screen landing flow for Creative OS.',
    harness: 'codex',
    runtimeRef: 'codex::sess-parallel-001',
    turnRef: 'turn-par-codex',
    intentId: 'intent-parallel-codex',
    groupId: GROUP_PARALLEL,
    evidenceRef: 'demo:intent:parallel-codex',
    observed: obs('protocol', 'demo:dispatch:parallel-codex', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-accept-claude',
    conversationKey: PLANNING_CONV,
    kind: 'handoff-accepted',
    summary: 'Handoff accepted (Claude)',
    harness: 'claude',
    runtimeRef: 'claude::sess-planning-001',
    turnRef: 'turn-par-claude',
    intentId: 'intent-parallel-claude',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:receipt:parallel-claude', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-accept-codex',
    conversationKey: PLANNING_CONV,
    kind: 'handoff-accepted',
    summary: 'Handoff accepted (Codex)',
    harness: 'codex',
    runtimeRef: 'codex::sess-parallel-001',
    turnRef: 'turn-par-codex',
    intentId: 'intent-parallel-codex',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:receipt:parallel-codex', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-response-claude',
    conversationKey: PLANNING_CONV,
    kind: 'agent-response',
    summary: 'Agent response (Claude)',
    content: 'Plan: 1) Hook (problem + audience), 2) Workflow (3 stages), 3) Outcome (proof + CTA). Each screen commits to a single outcome with one CTA. Visual cues stay in the same accent.',
    harness: 'claude',
    runtimeRef: 'claude::sess-planning-001',
    turnRef: 'turn-par-claude',
    intentId: 'intent-parallel-claude',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:response:parallel-claude', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-response-codex',
    conversationKey: PLANNING_CONV,
    kind: 'agent-response',
    summary: 'Agent response (Codex)',
    content: 'Plan: 1) Landing (positioning + 1 demo), 2) Workflow (3 numbered steps), 3) CTA (sign up). Tighter copy than the previous draft; assumes a 5-second first impression.',
    harness: 'codex',
    runtimeRef: 'codex::sess-parallel-001',
    turnRef: 'turn-par-codex',
    intentId: 'intent-parallel-codex',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:response:parallel-codex', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-tool-codex',
    conversationKey: PLANNING_CONV,
    kind: 'tool-completed',
    summary: 'Tool call',
    content: 'list_dir(workspace/landing/)',
    harness: 'codex',
    runtimeRef: 'codex::sess-parallel-001',
    turnRef: 'turn-par-codex',
    intentId: 'intent-parallel-codex',
    groupId: GROUP_PARALLEL,
    evidenceRef: 'demo:tool:list-002',
    observed: obs('protocol', 'demo:tool:list-002', 'OBSERVED'),
  }),
  evt({
    id: 'evt-parallel-completed-claude',
    conversationKey: PLANNING_CONV,
    kind: 'turn-completed',
    summary: 'Turn completed (Claude)',
    harness: 'claude',
    runtimeRef: 'claude::sess-planning-001',
    turnRef: 'turn-par-claude',
    intentId: 'intent-parallel-claude',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:turn:parallel-claude', 'VERIFIED'),
  }),
  evt({
    id: 'evt-parallel-completed-codex',
    conversationKey: PLANNING_CONV,
    kind: 'turn-completed',
    summary: 'Turn completed (Codex)',
    harness: 'codex',
    runtimeRef: 'codex::sess-parallel-001',
    turnRef: 'turn-par-codex',
    intentId: 'intent-parallel-codex',
    groupId: GROUP_PARALLEL,
    observed: obs('protocol', 'demo:turn:parallel-codex', 'VERIFIED'),
  }),

  // ---- Handoff A (Claude produces) → Context → B (Codex continues) ----
  evt({
    id: 'evt-handoff-a-dispatch',
    conversationKey: DESIGN_CONV,
    kind: 'handoff-dispatched',
    summary: 'Handoff dispatched',
    content: 'Use the Claude plan as Context, then produce a visual system (tokens + 3 screen mocks) for the landing flow.',
    harness: 'claude',
    runtimeRef: 'claude::sess-design-001',
    turnRef: 'turn-handoff-a',
    intentId: 'intent-handoff-a',
    groupId: GROUP_HANDOFF_A,
    observed: obs('protocol', 'demo:dispatch:handoff-a', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-a-accept',
    conversationKey: DESIGN_CONV,
    kind: 'handoff-accepted',
    summary: 'Handoff accepted',
    harness: 'claude',
    runtimeRef: 'claude::sess-design-001',
    turnRef: 'turn-handoff-a',
    intentId: 'intent-handoff-a',
    groupId: GROUP_HANDOFF_A,
    observed: obs('protocol', 'demo:receipt:handoff-a', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-a-response',
    conversationKey: DESIGN_CONV,
    kind: 'agent-response',
    summary: 'Agent response',
    content: 'Visual system for the 3-screen flow. Surface tokens, accent #98aaf8, 1 column at 980px. Each screen: 1 headline, 1 subhead, 1 CTA, 1 image. Ready to hand to Codex for screen copy.',
    harness: 'claude',
    runtimeRef: 'claude::sess-design-001',
    turnRef: 'turn-handoff-a',
    intentId: 'intent-handoff-a',
    groupId: GROUP_HANDOFF_A,
    evidenceRef: 'demo:response:handoff-a',
    observed: obs('protocol', 'demo:response:handoff-a', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-a-completed',
    conversationKey: DESIGN_CONV,
    kind: 'turn-completed',
    summary: 'Turn completed',
    harness: 'claude',
    runtimeRef: 'claude::sess-design-001',
    turnRef: 'turn-handoff-a',
    intentId: 'intent-handoff-a',
    groupId: GROUP_HANDOFF_A,
    observed: obs('protocol', 'demo:turn:handoff-a', 'VERIFIED'),
  }),

  // B continues using A's result as Context
  evt({
    id: 'evt-handoff-b-dispatch',
    conversationKey: CODEX_STANDBY_CONV,
    kind: 'handoff-dispatched',
    summary: 'Handoff dispatched (handoff from A)',
    content: 'Use the visual system from Claude as Context. Write the actual screen copy (3 screens, headline + subhead + CTA each).',
    harness: 'codex',
    runtimeRef: 'codex::sess-handoff-001',
    turnRef: 'turn-handoff-b',
    intentId: 'intent-handoff-b',
    groupId: GROUP_HANDOFF_B,
    parentSourceRef: 'harness-result:claude::demo:response:handoff-a',
    observed: obs('protocol', 'demo:dispatch:handoff-b', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-b-accept',
    conversationKey: CODEX_STANDBY_CONV,
    kind: 'handoff-accepted',
    summary: 'Handoff accepted',
    harness: 'codex',
    runtimeRef: 'codex::sess-handoff-001',
    turnRef: 'turn-handoff-b',
    intentId: 'intent-handoff-b',
    groupId: GROUP_HANDOFF_B,
    observed: obs('protocol', 'demo:receipt:handoff-b', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-b-response',
    conversationKey: CODEX_STANDBY_CONV,
    kind: 'agent-response',
    summary: 'Agent response',
    content: 'Screen copy: Hook — "Designers ship 3× faster when the system shows the way" / "Creative OS turns your model into a daily co-worker" / CTA "Open the demo". Solution — 3 stage cards. Outcome — 1 line of social proof + "Get the repo".',
    harness: 'codex',
    runtimeRef: 'codex::sess-handoff-001',
    turnRef: 'turn-handoff-b',
    intentId: 'intent-handoff-b',
    groupId: GROUP_HANDOFF_B,
    observed: obs('protocol', 'demo:response:handoff-b', 'VERIFIED'),
  }),
  evt({
    id: 'evt-handoff-b-completed',
    conversationKey: CODEX_STANDBY_CONV,
    kind: 'turn-completed',
    summary: 'Turn completed',
    harness: 'codex',
    runtimeRef: 'codex::sess-handoff-001',
    turnRef: 'turn-handoff-b',
    intentId: 'intent-handoff-b',
    groupId: GROUP_HANDOFF_B,
    observed: obs('protocol', 'demo:turn:handoff-b', 'VERIFIED'),
  }),

  // ---- Approval / needs input on 顾问 (paused) ----
  evt({
    id: 'evt-advisor-approval',
    conversationKey: ADVISOR_CONV,
    kind: 'approval-required',
    summary: 'Approval required',
    content: 'DeepSeek advisor needs your approval before writing into memory/decision-log.md.',
    harness: 'deepseek',
    runtimeRef: 'deepseek::sess-advisor-001',
    turnRef: 'turn-advisor-001',
    attentionKey: 'attn-approval-001',
    attentionKind: 'approval-required',
    attentionStatus: 'active',
    observed: obs('protocol', 'demo:approval:advisor-001', 'VERIFIED'),
  }),
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
    id: 'demo:creative-os:memory:product-rebuild',
    title: 'Memory: Product rebuild donor provenance',
    source: 'memory:product-rebuild',
    body: 'Donor references for the Product Rebuild visual system: Reasonix main-v2, dsh-synapse, Agent Cockpit, LinkCode. MIT/Apache/BUSL attribution kept verbatim.',
    state: 'available',
    pinned: false,
    isReference: true,
    sourceRef: 'demo:memory:product-rebuild.md',
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
  {
    id: 'demo:creative-os:manual:2',
    title: 'Manual: 出口契约',
    source: 'manual',
    body: 'Demo 模式只能注入 deterministic fixture，真实 SOT 一律不动。Reset 后应能重新跑 Mock Harness。',
    state: 'included',
    pinned: true,
    isReference: false,
    provenance: 'USER PROVIDED',
  },
];

// ---- Frozen Packet (draft + frozen example) --------------------------------

export const DEMO_FROZEN: FrozenPacketSummary[] = [
  {
    schemaVersion: 1,
    packetId: 'demo-packet-001',
    projectId: 'creative-os',
    conversationKey: MAIN_CONV,
    version: 1,
    hash: 'demo-frozen-001',
    frozenAt: now(),
    roughTokens: 240,
    taskSummary: '为 Creative OS 新用户设计开箱即用的 Demo 首屏',
    sourceFingerprints: [
      { sourceRef: 'demo:project-file:creative-os:CLAUDE.md', sha256: 'demo-sha-canon' },
      { sourceRef: 'demo:adapter:creative-os', sha256: 'demo-sha-adapter' },
    ],
    unresolvedDependencies: [],
  },
  {
    schemaVersion: 1,
    packetId: 'demo-packet-002',
    projectId: 'creative-os',
    conversationKey: DESIGN_CONV,
    version: 1,
    hash: 'demo-frozen-002',
    frozenAt: now(),
    roughTokens: 320,
    taskSummary: '3 屏 landing 流程：visual system + screen copy',
    sourceFingerprints: [
      { sourceRef: 'demo:project-file:creative-os:CLAUDE.md', sha256: 'demo-sha-canon' },
      { sourceRef: 'demo:memory:design-system.md', sha256: 'demo-sha-memory' },
    ],
    unresolvedDependencies: [],
  },
];

export function getDemoFrozenDetail(summary: FrozenPacketSummary): FrozenPacket {
  return {
    schemaVersion: 1,
    packetId: summary.packetId,
    projectId: summary.projectId,
    conversationKey: summary.conversationKey,
    hash: summary.hash,
    version: summary.version,
    createdAt: summary.frozenAt,
    frozenAt: summary.frozenAt,
    taskSummary: summary.taskSummary,
    included: DEMO_CONTEXT.filter((c) => c.state === 'included').slice(0, 3),
    references: DEMO_CONTEXT.filter((c) => c.state !== 'included'),
    governanceRefs: ['demo:adapter:creative-os'],
    sourceFingerprints: summary.sourceFingerprints,
    unresolvedDependencies: summary.unresolvedDependencies,
    roughTokens: summary.roughTokens,
  };
}

// ---- Runtime sessions (for sidebar live state) ----------------------------

export const DEMO_RUNTIME_SESSIONS = [
  {
    id: 'rt-claude-main-001',
    conversationId: 'demo-conv-main-001',
    conversationKey: MAIN_CONV,
    binding: bindingFor('claude', 'claude::sess-main-001'),
    state: 'idle' as const,
    observed: obs('protocol', 'demo:claude:sess-main-001', 'VERIFIED'),
    startedAt: now(),
  },
  {
    id: 'rt-claude-design-001',
    conversationId: 'demo-conv-design-001',
    conversationKey: DESIGN_CONV,
    binding: bindingFor('claude', 'claude::sess-design-001'),
    state: 'idle' as const,
    observed: obs('protocol', 'demo:claude:sess-design-001', 'VERIFIED'),
    startedAt: now(),
  },
];

// ---- Harness capabilities (demo deterministic) ---------------------------

export const DEMO_HARNESS_CAPABILITIES: Record<string, HarnessCapabilities> = {
  claude: {
    harness: 'claude',
    support: { dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'YES', needsInput: 'YES', toolEvents: 'YES', fileEvents: 'YES', externalSessionRef: 'YES', resume: 'YES' },
    canDispatch: true,
    canCreateSession: true,
    canResumeSession: true,
    canObserveRuntime: true,
    canReceiveReceipt: true,
    protocol: 'claude-desktop-bridge',
    evidence: 'demo · Claude desktop app-server',
  },
  codex: {
    harness: 'codex',
    support: { dispatch: 'YES', observe: 'YES', receipt: 'YES', approval: 'YES', needsInput: 'YES', toolEvents: 'YES', fileEvents: 'YES', externalSessionRef: 'YES', resume: 'YES' },
    canDispatch: true,
    canCreateSession: true,
    canResumeSession: true,
    canObserveRuntime: true,
    canReceiveReceipt: true,
    protocol: 'codex-app-server',
    evidence: 'demo · Codex app-server',
  },
  deepseek: {
    harness: 'deepseek',
    support: { dispatch: 'YES', observe: 'UNKNOWN', receipt: 'UNKNOWN', approval: 'YES', needsInput: 'YES', toolEvents: 'NO', fileEvents: 'NO', externalSessionRef: 'NO', resume: 'NO' },
    canDispatch: true,
    canCreateSession: true,
    canResumeSession: false,
    canObserveRuntime: false,
    canReceiveReceipt: false,
    protocol: 'deepseek-cli',
    evidence: 'demo · DeepSeek CLI',
  },
};

// ---- Memory search hits (for demo) ----------------------------------------

export const DEMO_MEMORY_HITS: MemorySearchHit[] = [
  { id: 'design-system', recordType: 'fact', summary: 'Design system tokens: surface / border / text / emphasis. No new Material mode.', sourceRefs: ['demo:memory:design-system.md'], sourceSessionIds: ['demo-sess-design-001'], mentionedAt: '2026-08-15', currentness: 'CURRENT', verification: 'VERIFIED', useCount: 7, score: 0.92 },
  { id: 'product-rebuild', recordType: 'fact', summary: 'Product rebuild donor provenance: Reasonix main-v2, dsh-synapse, Agent Cockpit, LinkCode.', sourceRefs: ['demo:memory:product-rebuild.md'], sourceSessionIds: ['demo-sess-rebuild-001'], mentionedAt: '2026-08-12', currentness: 'CURRENT', verification: 'VERIFIED', useCount: 4, score: 0.81 },
  { id: 'release-process', recordType: 'event', summary: 'Last release: typecheck/test/build green, no Critical review. Frozen packet kept in governance/release/2026-08-12.', sourceRefs: ['demo:memory:release-process.md'], sourceSessionIds: ['demo-sess-release-001'], mentionedAt: '2026-08-12', currentness: 'CURRENT', verification: 'OBSERVED', useCount: 3, score: 0.66 },
];

export function getDemoMemoryDetail(hitId: string): MemoryEvidenceExpansion | null {
  const hit = DEMO_MEMORY_HITS.find((h) => h.id === hitId);
  if (!hit) return null;
  if (hit.recordType === 'fact') {
    return {
      record: {
        id: hit.id,
        statement: hit.summary,
        status: 'ACTIVE',
        currentness: hit.currentness,
        verification: hit.verification,
        sourceRefs: hit.sourceRefs,
        sourceEventIds: [],
        supersedes: [],
        conflicts: [],
      },
      evidence: { verdict: 'SUFFICIENT', evidenceRefs: hit.sourceRefs, missing: [], nextStrategy: 'NONE' },
      messages: [
        { id: 'mem-msg-1', role: 'assistant', text: hit.summary, at: hit.mentionedAt, observed: obs('process', hit.sourceRefs[0] ?? 'demo:memory', 'VERIFIED'), sessionId: hit.sourceSessionIds[0] ?? 'demo-sess', seq: 0, truncated: false },
      ],
      missingSourceRefs: [],
    };
  }
  return {
    record: {
      id: hit.id,
      sourceRefs: hit.sourceRefs,
      sourceMessageIds: ['mem-msg-1'],
      sourceSessionIds: hit.sourceSessionIds,
      sourceDigest: `digest-${hit.id}`,
      mentionedAt: hit.mentionedAt,
      status: hit.currentness,
      summary: hit.summary,
      participants: ['user', 'assistant'],
      tags: ['release', 'process'],
      supersedes: [],
      conflicts: [],
      verification: hit.verification,
      kind: 'event',
    },
    evidence: { verdict: 'SUFFICIENT', evidenceRefs: hit.sourceRefs, missing: [], nextStrategy: 'NONE' },
    messages: [
      { id: 'mem-msg-1', role: 'assistant', text: hit.summary, at: hit.mentionedAt, observed: obs('process', hit.sourceRefs[0] ?? 'demo:memory', 'VERIFIED'), sessionId: hit.sourceSessionIds[0] ?? 'demo-sess', seq: 0, truncated: false },
    ],
    missingSourceRefs: [],
  };
}

export function getDemoMemorySearchResult(query: string): MemorySearchResult {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { hits: [], problems: [], emptyReason: 'below-min-length' };
  }
  const matches = DEMO_MEMORY_HITS.filter((hit) =>
    hit.summary.toLowerCase().includes(trimmed.toLowerCase()) ||
    hit.id.toLowerCase().includes(trimmed.toLowerCase()),
  );
  return { hits: matches.length > 0 ? matches : DEMO_MEMORY_HITS, problems: [] };
}

// ---- History (demo deterministic) -----------------------------------------

function makeHistorySession(
  sessionId: string,
  harness: 'claude-code' | 'codex',
  nativeId: string,
  title: string,
  preview: string,
  startedAt: string,
  endedAt: string,
  messageCount: number,
  compacted: boolean,
): HistorySession {
  return {
    sessionId,
    harness,
    nativeId,
    cwd: 'demo/projects/creative-os',
    title,
    preview,
    startedAt,
    endedAt,
    messageCount,
    sourceFiles: [`demo:history:${sessionId}`],
    compacted,
    observed: obs('canonical-file', `demo:history:${sessionId}`, 'VERIFIED'),
  };
}

export const DEMO_HISTORY_CATALOG: HistoryCatalogResult = {
  sessions: [
    makeHistorySession('demo-history-claude-001', 'claude-code', 'claude-native-001', 'Creative OS main draft', '3 screens: hook, workflow, outcome.', '2026-08-12T09:00:00Z', '2026-08-12T10:00:00Z', 2, false),
    makeHistorySession('demo-history-codex-001', 'codex', 'codex-native-001', 'Landing copy variants', 'Tight copy for a 5-second first impression.', '2026-08-13T09:00:00Z', '2026-08-13T10:00:00Z', 2, false),
    makeHistorySession('demo-history-deepseek-001', 'claude-code', 'claude-native-002', 'Release notes research', 'Cross-checked against last 5 releases.', '2026-08-10T09:00:00Z', '2026-08-10T11:00:00Z', 2, false),
  ],
  problems: [],
  stats: { sessions: 3, messages: 6, filesSkipped: 0, filesIndexed: 3 },
};

function makeHistoryMessages(sessionId: string, harness: 'claude-code' | 'codex', texts: { role: 'user' | 'assistant'; text: string; at: string }[]): HistoryMessage[] {
  return texts.map((t, idx) => ({
    id: `${sessionId}-msg-${idx}`,
    sessionId,
    seq: idx,
    at: t.at,
    role: t.role,
    text: t.text,
    truncated: false,
    observed: obs('canonical-file', `demo:history:${sessionId}:${idx}`, 'VERIFIED'),
  }));
}

export const DEMO_HISTORY_DETAILS: Record<string, HistorySessionDetail> = {
  'demo-history-claude-001': {
    session: makeHistorySession('demo-history-claude-001', 'claude-code', 'claude-native-001', 'Creative OS main draft', '3 screens: hook, workflow, outcome.', '2026-08-12T09:00:00Z', '2026-08-12T10:00:00Z', 2, false),
    problems: [],
    messages: makeHistoryMessages('demo-history-claude-001', 'claude-code', [
      { role: 'user', text: 'Draft a 3-screen landing flow for Creative OS.', at: '2026-08-12T09:01:00Z' },
      { role: 'assistant', text: 'Hook (problem + audience), Workflow (3 stages), Outcome (proof + CTA). Each screen commits to a single outcome with one CTA.', at: '2026-08-12T09:05:00Z' },
    ]),
  },
  'demo-history-codex-001': {
    session: makeHistorySession('demo-history-codex-001', 'codex', 'codex-native-001', 'Landing copy variants', 'Tight copy for a 5-second first impression.', '2026-08-13T09:00:00Z', '2026-08-13T10:00:00Z', 2, false),
    problems: [],
    messages: makeHistoryMessages('demo-history-codex-001', 'codex', [
      { role: 'user', text: 'Write tight copy for a 5-second first impression.', at: '2026-08-13T09:01:00Z' },
      { role: 'assistant', text: 'Landing — positioning + 1 demo. Workflow — 3 numbered steps. CTA — sign up.', at: '2026-08-13T09:05:00Z' },
    ]),
  },
  'demo-history-deepseek-001': {
    session: makeHistorySession('demo-history-deepseek-001', 'claude-code', 'claude-native-002', 'Release notes research', 'Cross-checked against last 5 releases.', '2026-08-10T09:00:00Z', '2026-08-10T11:00:00Z', 2, false),
    problems: [],
    messages: makeHistoryMessages('demo-history-deepseek-001', 'claude-code', [
      { role: 'user', text: 'Compare current release notes against the last 5.', at: '2026-08-10T09:01:00Z' },
      { role: 'assistant', text: 'Coverage is consistent. The new section is the only addition; everything else is the same scope as last release.', at: '2026-08-10T10:30:00Z' },
    ]),
  },
};

export function getDemoHistorySearchResult(query: string): HistorySearchResult {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { hits: [], problems: [], emptyReason: 'below-min-length', stats: { sessions: 0, messages: 0, filesSkipped: 0, filesIndexed: 0 } };
  }
  const lower = trimmed.toLowerCase();
  const hits: HistoryHit[] = DEMO_HISTORY_CATALOG.sessions
    .filter((s) => s.title?.toLowerCase().includes(lower) || s.preview.toLowerCase().includes(lower) || s.harness.includes(lower))
    .map((session, idx) => ({
      session,
      snippet: `... ${session.preview} ...`,
      snippetTruncated: false,
      score: 1 - idx * 0.1,
    }));
  return { hits, problems: [], stats: { sessions: hits.length, messages: hits.length * 2, filesSkipped: 0, filesIndexed: 3 } };
}

// ---- Attention items (demo) -----------------------------------------------

export const DEMO_ATTENTION: AttentionItem[] = [
  {
    id: 'attn-demo-001',
    kind: 'approval-required',
    level: 'action',
    title: 'DeepSeek advisor wants to write to memory/decision-log.md',
    summary: 'Approval required before DeepSeek advisor records the release decision into long-term memory.',
    projectId: 'creative-os',
    conversationKey: ADVISOR_CONV,
    sessionRef: 'deepseek::sess-advisor-001',
    sourceRef: 'demo:approval:advisor-001',
    eventRef: 'evt-advisor-approval',
    observedAt: now(),
    verification: 'VERIFIED',
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
  memoryIndex: DEMO_MEMORY_HITS.map((hit) => ({ id: hit.id, title: hit.summary.slice(0, 60), hook: hit.summary, category: hit.recordType === 'fact' ? 'product' : 'release', sourceRef: `demo:memory:${hit.id}.md` })),
  machine: {
    deviceId: 'demo-machine',
    displayName: 'Demo Machine',
    availableTools: { codex: 'demo codex', claude: 'demo claude', deepseek: 'demo deepseek' },
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
    { sourceRef: 'demo:memory:design-system.md', sha256: 'demo-sha-memory' },
    { sourceRef: 'demo:memory:product-rebuild.md', sha256: 'demo-sha-memory-2' },
    { sourceRef: 'demo:memory:release-process.md', sha256: 'demo-sha-memory-3' },
    // buildStaging derives gate items from each adapter's observed ref, so the
    // demo snapshot must fingerprint those refs or rebuilt staging (any session
    // switch) compiles an INVALID dispatch packet.
    ...DEMO_PROJECTS.map((p) => ({ sourceRef: `demo:project:${p.projectId}`, sha256: `demo-sha-project-${p.projectId}` })),
  ],
  problems: [],
};
