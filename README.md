# Yunmin Workbench

（产品类别名：Agent Workbench）个人 Agent 工作环境：Governance Kernel + Personal Overlay +
Project/Git/Harness 之上的**投影层 GUI**。不替代 Harness，不复制外部 Source of Truth。

正本：
- 产品定义 `Yunmin-Workbench-项目完整描述.pdf`（桌面）
- Reuse Map `Yunmin-Workbench-REUSE-MAP.md`（桌面）
- Projection Integrity 约束（2026-08-25 用户批准，见下）

## Projection Integrity（domain 级约束）

1. **Observation Contract**：投影实体带 `observed = { source, sourceRef, observedAt,
   verification: VERIFIED|OBSERVED|INFERRED|UNKNOWN }`；heuristic 永不与 canonical/protocol 同级；
   无模型 confidence。
2. **Execution Binding**：`RuntimeSession`/`RuntimeBinding` 类型已留 seam（harness/machine/cwd/
   worktree/branch/HEAD/externalSessionRef）；Binding 属于一次 Session，不永久绑 Conversation。
   尚无 Runtime Adapter 写入。
3. **State Separation**：`TaskState` / `RuntimeState` / `AttentionState` 三个枚举永久分开；
   登记表原始 status 只表示 Conversation lifecycle。canonical `task_source` 尚未落地时
   `taskState=unknown`，绝不由 Conversation status 推导；Control Room 明示按 Conversation 分组。
4. **Frozen Packet Validity**：Packet 编译时分别记录已解析 fingerprint 与未解析声明依赖；
   unresolved/missing → INVALID，hash changed → STALE，全部可验证 → CURRENT，不调用模型、不自动重建。
5. **Intent/Receipt**：仅 domain seam（DRAFT→DISPATCHED→ACCEPTED|REJECTED|FAILED）；无实现。
6. **Write-surface collision**：不实现；未来只做纯 projection warning，无 lock/scheduler。

## 上游契约迁移边界（MIGRATING，2026-08-25）

Governance 侧 project_id/aliases、task_source、conversation_id↔session_id 分离、
INBOX scope 语义均在迁移中。Workbench 的规则：

- 差异只收敛在 `src/core/parse` + `src/main/adapters`；core/UI 不依赖文件命名
- 上游未提供的字段保持 absent/UNKNOWN：`Conversation.conversationId` 目前缺省，
  UI 用 `key`（本地渲染键），绝不用 role/session_id 冒充身份
- parser 带 schema 版本护栏：未知版本抛错进 `problems[]`，不静默误解
- fixture 分 `tests/fixtures/legacy/`（现行结构）与未来 `new-contract/`；
  真实 Overlay 只进 smoke 测试
## 架构边界

| 层 | 位置 | 说明 |
|---|---|---|
| `src/core` | 纯函数零 IO：parse（对话登记/项目适配/INBOX/记忆索引/机器档案/Harness Manifest）、project（Control Room / Canvas+dagre / Staging / Packet 编译·Freeze·Validity）；Canvas 区分 membership/mount 结构关系与 execution/handoff/data-context 真实流 | Vitest 直测 |
| `src/main/adapters` | `overlaySource.ts`（只读 Overlay + 发现规则 + 文件指纹 + 记忆正文懒加载）、`gitFacts.ts`（simple-git 只读 remote/branch/HEAD/status） | 只读外部事实 |
| `src/main` | IPC；chokidar 监听 Overlay canonical 文件→`overlay:changed` 失效通知；Frozen Packet 落 `userData/state/frozen-packets/` | 只写 Workbench 自有状态 |
| `src/renderer` | React + @xyflow/react + zustand；五视图 Projects / Control Room / Canvas / Context Staging / Packet | 投影渲染，拖动不改外部事实 |

## 命令

- `pnpm dev` / `pnpm start` — 开发 / 预览
- `pnpm test` — Vitest（含真实 Overlay 只读冒烟，缺 `D:\ai-governance-system` 自动跳过）
- `pnpm e2e` — Playwright Electron 关键路径（真实 Overlay 只读 + 断言 UI 不反写外部事实）
- `pnpm typecheck` / `pnpm build`

## 明确的延后项

- 视觉系统（用户拍板域）；shadcn/ReUI primitives 按需接入
- Inspector 完整 Machine/Harness 视图（Control Room 只放 health/binding 摘要）
- Profile Bundle Import/Export、换机 Doctor GUI、实时 Timeline / Runtime 控制
- Runtime Adapter（Claude/Codex/DeepSeek 结构化接入）→ 届时填 RuntimeSession
