# Yunmin Workbench

（产品类别名：Agent Workbench）个人 Agent 工作环境：Governance Kernel + Personal
Overlay/Profile + Project/Git/Harness 之上的**投影层 GUI**。不替代 Harness，不复制
外部 Source of Truth。轻量任务仍然直接在 Claude Code、Codex、DeepSeek 等 Harness
里完成。

## 当前形态：Session Spine + on-demand drawers

中心 Session/Transcript 是唯一永久工作表面；左侧只承担 workspace/session switching、
Recent/Running/Attention；Context 从 composer 按需进入 staging drawer/sheet；Packet
是宽 review layer；Evidence/Changes 从相关事件或按需 drawer 出现；Canvas/Trajectory
可以替换中央 surface。普通 UNKNOWN/IDLE/CURRENT 不做状态墙，只突出
STALE/INVALID/error/approval/attention。

已明确否决、不要加回来的形态：永久 Project tree、永久右侧 Context/Packet inspector、
Home stats dashboard、大量表格与状态墙、巨型 empty state、明显的网站/后台管理台感。

## 稳定数据流

```
Governance Kernel + Personal Overlay / Profile + Project / Git / Harness
  → Adapter / Normalize → Workbench Projection → Interaction
```

数据库、缓存、Canvas、Timeline、History index 永远只是 projection/cache。Workbench
默认只读外部正本；UI 排序、Canvas 拖动、Context 操作不反写 Governance、Project 或 Git。

## 正本在哪

| 问题 | 权威来源 |
|---|---|
| 当前事实（代码 / 测试 / Runtime / 依赖） | Git、实际文件、测试、Harness Runtime |
| 执行基准 | `doc/` · *E LONG-TERM BASELINE — FROZEN v2* |
| Reuse / donor / license 决策 | `doc/` · *REUSE-MAP FINAL v2* |
| 产品意图与边界（历史合同） | `doc/` · *Yunmin Workbench 项目完整描述* |
| 已核验的第三方溯源与许可证 | `THIRD_PARTY_NOTICES.md` |

`doc/` 是文档与交接资料入口，**不是 Source of Truth**。基准文档里的 SHA、测试数字与
依赖都是快照，不能反过来覆盖真实外部事实。

## Projection Integrity（domain 级约束）

1. **Observation Contract**：投影实体带 `observed = { source, sourceRef, observedAt,
   verification: VERIFIED|OBSERVED|INFERRED|UNKNOWN }`；heuristic 永不与
   canonical/protocol 同级；无模型 confidence。
2. **Execution Binding**：`RuntimeSession`/`RuntimeBinding` 带
   harness/machine/cwd/worktree/branch/HEAD/externalSessionRef；Binding 属于一次
   Runtime Session/Execution，不永久绑 Conversation，同一 Conversation 可先后或并行
   对应不同 Harness session。Codex app-server adapter 是当前唯一写入方。
3. **State Separation**：`TaskState` / `RuntimeState` / `AttentionState` 三个枚举
   永久分开。没有 canonical `task_source`，因此不生成假 Task、不做 Task Board；
   Conversation lifecycle 只表示 Conversation lifecycle。
4. **Frozen Packet Validity**：依赖全部可核验且一致 → CURRENT；fingerprint 改变 →
   STALE；声明依赖但来源消失/无法确认 → INVALID。本地确定性比较，不调用模型、
   不自动重建。Frozen body 不可变，变化只产生新版本。
5. **Intent/Receipt**：`DRAFT → DISPATCHED → ACCEPTED|REJECTED|FAILED`；Codex
   dispatch/receipt 已实现，**external session Resume adapter 未实现**（workbench
   workspace restore/resume 与之无关）。Dispatch receipt 不等于 Task completion。
6. **Write-surface collision**：不实现；未来只做纯 projection warning，无
   lock/scheduler/orchestrator。

## Codex adapter 当前能力

| Dispatch | Observe | Receipt | external session Resume |
|---|---|---|---|
| YES | YES | YES | **NO** |

已有 app-server handoff、receipt、double-send 防护、structured
lifecycle/tool/file events、Activity Timeline 与 Canvas execution evidence。
Claude/DeepSeek 结构化 live adapter 尚未完成。

## R0 Reliability（不可回退）

已覆盖并保持：Frozen store 的 Zod per-file validation、单文件 corruption isolation、
atomic temp+rename、per-conversation serialization、max(valid)+1 versioning、
summary-only list + lazy detail；renderer root+view ErrorBoundary、single instance
+focus、Copy/Freeze/Dispatch 失败可见、5MB precheck、pending disabled、bounded
concurrency 8。损坏历史不能吞合法版本，损坏后仍能 freeze 新版本。

## 架构边界

| 层 | 位置 | 说明 |
|---|---|---|
| `src/core` | 纯函数零 IO：parse（对话登记/项目适配/INBOX/记忆索引/机器档案/Harness Manifest）、project（Canvas+dagre / Staging / Packet 编译·Freeze·Validity / Activity / Binding / Draft）、attention（显式事件/状态 → bounded projection）；Canvas 区分 membership/mount 结构关系与 execution/handoff/data-context 真实流 | Vitest 直测 |
| `src/core/history` | Claude Code / Codex parser、Harness 原生 identity 命名空间、bounded message excerpt 与 lexical Search 合同；cwd / filename / title 只作 observed metadata | Vitest 直测 |
| `src/main/adapters` | `overlaySource.ts`（只读 Overlay + 发现规则 + 文件指纹 + 记忆正文懒加载）、`gitFacts.ts`（simple-git 只读 remote/branch/HEAD/status）、`projectFiles.ts`（containment/traversal 保护）、`codexAppServer.ts` | 只读外部事实 / Harness 协议 |
| `src/main` | IPC；chokidar 监听 Overlay canonical 文件 → `overlay:changed` 失效通知；History 按文件 byte watermark 增量读取，变化文件先核对旧长度范围的完整 hash，截断/替换/删除后失效重建；History index、Frozen Packet / Draft / Workspace / Activity / Window / Attention dismissal / Portability binding state 落 `userData` | 只写 Workbench 自有状态 |
| `src/renderer` | React + @xyflow/react + zustand；Session Spine + 按需 Context/Packet/Changes/Evidence drawer | 投影渲染，拖动不改外部事实 |

## 环境

- Node `>= 22.13`（pnpm 11 的下限）
- pnpm 版本由 `packageManager` 固定，通过 corepack 使用：

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` 固定 `nodeLinker: hoisted`（pnpm 11 从该文件读项目配置，根目录
`.npmrc` 会被忽略）。默认的 isolated linker 需要为每个顶层依赖建 junction；在无法可靠
创建 reparse point 的机器上，`pnpm install` 会报成功但把 `node_modules/<pkg>` 留成空
目录，electron/esbuild 的 install script 也就不会跑（没有 Electron 二进制，`pnpm build`
与 Playwright 都起不来）。hoisted linker 写真实目录，全新 clone 可以稳定装好。

## 命令

- `pnpm dev` / `pnpm start` — 开发 / 预览
- `pnpm typecheck` / `pnpm build`
- `pnpm test` — Vitest（单测跑 fixture；Overlay 只读 slice 走 `GOV_OVERLAY` 或仓库自带的 portable fixture）
- `pnpm e2e` — 先 build，再跑 Playwright Electron 关键路径（只读 + 断言 UI 不反写外部事实）。
  GPU 进程起不来的机器（headless CI、远程/虚拟会话）需要同时给 `WB_ELECTRON_ARGS`，见下

## 外部事实 env seam

测试不依赖任何旧机器绝对路径。

| 变量 | 作用 |
|---|---|
| `GOV_OVERLAY` | 指定 Personal Overlay 根目录（生产发现路径的正式 seam） |
| `WB_OVERLAY_SEARCH_ROOT` | 覆盖 Overlay 扫描根目录 |
| `WB_STATE_DIR` | 把 Workbench 自有状态重定向到临时目录（E2E 用） |
| `WB_CLAUDE_HISTORY_ROOT` | 覆盖 Claude Code 只读历史根目录（默认 `~/.claude/projects`；测试与便携验证用） |
| `WB_CODEX_HISTORY_ROOT` | 覆盖 Codex 只读历史根目录（默认 `~/.codex/sessions`） |
| `WB_CODEX_ARCHIVED_HISTORY_ROOT` | 覆盖 Codex archived sessions 只读根目录（默认 `~/.codex/archived_sessions`） |
| `WB_ELECTRON_ARGS` | 额外的 Electron 启动开关。没有可用 GPU 的环境（headless CI、远程/虚拟会话）用 `WB_ELECTRON_ARGS="--no-sandbox --disable-gpu"`；默认不设，本地运行保持 Chromium sandbox 与硬件加速 |

没有真实 Overlay 时，`tests/fixtures/overlay` 会被 materialize 到临时目录：机器
profile 的 `paths.governance_repo` 与 `project_roots` 按实际生成的路径写入，再经
`GOV_OVERLAY` 交给应用，所以跑的始终是生产发现路径。

## 当前顺序

1. **CLEAN-ROOM GREEN** — 全新 clone → install → typecheck → build → Vitest → Playwright
2. **History / Search Phase 1（已完成）** — 只读 Claude Code + Codex 发现、parser、per-file watermark index、lexical Search、Command Palette / Session 入口与详情；index 在 Electron `userData/state/history`，parser problem 显式；History 不成为 live Runtime truth，也不自动进入 Context
3. **Attention Phase 1（已完成）** — 纯 reducer 投影 approval / needs-input / failed receipt / runtime-harness error / STALE-INVALID packet or gate / explicit review-worthy completion；显式 ref 跳转、重复事实收敛、恢复后消退；dismissal 仅在 `userData/state/attention`，不用 cwd/provider pairing 猜 identity
4. **Portability Phase 1（已完成）** — versioned + digest-locked Workbench Profile Bundle；强制 import preview、冲突 fail-closed、事务回滚；只迁移 Workspace session、Draft/Manual Context、Project File locator/fingerprint metadata 与非权威历史 root locator。项目根只能显式重绑，并复核 containment 与项目 identity；外部 SOT、Runtime、Git、History raw/index、Attention projection 与 secret 不进入 bundle

其后才是 activity durability、换机 Doctor GUI、真实大数据量后的 virtualization / SQLite WAL，以及任何云同步或跨客户端同步能力。

明确的延后项：视觉系统（用户拍板域）、Inspector 完整 Machine/Harness 视图、
实时 Runtime 控制、云同步、Git sync、CRDT 与 Runtime resume。
