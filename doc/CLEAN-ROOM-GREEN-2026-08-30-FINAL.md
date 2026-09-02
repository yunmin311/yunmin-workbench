# CLEAN-ROOM GREEN · 2026-08-30

本文件承载 **Yunmin Workbench · E LONG-TERM BASELINE — FROZEN v3** 的启动门禁关闭状态。FROZEN v3 继续作为冻结产品/执行基准，不就地改写历史快照；自本记录起，其中尚未关闭的 CLEAN-ROOM 门禁描述视为已由本记录取代。

## 最终状态

日期：2026-08-30；最终 `main` SHA：`c0ca94047b10675ec7d13613ddaac0916b3679c4`；D→E 接班锚点：`e7bb5d5fcf6108081512af9249708dde595faed3`。

远端 `origin/main` 已核验为 `c0ca94047b10675ec7d13613ddaac0916b3679c4`，本地与远端 ahead/behind = `0 / 0`。正式工作树只剩本地 `doc/` 未跟踪；该目录按当前约定不进入代码仓库。

## Clean-room 结果

全新临时 clone；clone 时无 `node_modules`、`git status` 为空、无 D 机状态残留。最终门禁结果：`pnpm install --frozen-lockfile` PASS；`pnpm typecheck` PASS；`pnpm build` PASS；Vitest `22 files / 108 passed / 1 skipped`；Playwright `6 passed`。稳定性复核：Vitest 连跑 5 次一致；Playwright `--repeat-each=3` 为 `18/18`；`WB_BENCH=1 npx playwright test --config playwright.bench.config.ts` 为 `1 passed`。

Reliability 覆盖保留并真实执行：Frozen corruption（损坏不吞合法版本、损坏后仍可 freeze 且不覆盖坏文件）；missing Codex；single instance；Overlay no-write。没有通过删除测试、降低断言、增加 retry 或把真实路径测试全部改成 skip 来获得 green。

## 已关闭的四项启动问题

`pnpm-workspace.yaml allowBuilds`：已修为批准 Electron / esbuild 必要 install scripts，并最终将 pnpm 11 实际生效的 `nodeLinker: hoisted` 放入 `pnpm-workspace.yaml`；旧 `.npmrc` 落点已删除。全新 clone 安装结果为 0 空包目录、168 个真实包目录、Electron 二进制在位。

Draft E2E 偶发 timeout：已移除固定 `waitForTimeout(700)`，改为等待持久可见的 `Draft saved` 状态；断言语义未降低。修后 Playwright repeat 18/18。

Project-switcher / Overlay race：每个 spec 使用独立 materialized overlay fixture，并串行执行；共享真实 Overlay 的竞争前提已消失，未额外加入无证据等待机制。

旧机器 probe：`D:\ai-governance-system`、`D:\project`、`D:\ov` 等字面路径已经从相关测试/benchmark 清除，改为 `GOV_OVERLAY` env seam + portable fixture；benchmark 原先受 `hasOverlay` 包裹的 dead branch 已改为实际执行，并已单独实跑通过。

## 额外发现并修复的可移植性问题

宿主 shell 可能导出 `ELECTRON_RUN_AS_NODE=1`，导致 Electron 作为纯 Node 启动；E2E `workbenchEnv()` 已统一清除。

Windows 125% DPI 下窗口外框会发生取整偏差，因此原固定像素断言不可移植；现在验证持久化状态文件、实际接受几何与重启后几何的 round-trip 一致性。

WorkBuddy shell 会通过 `NODE_OPTIONS` 注入 safe-delete shim，干扰 pnpm 建链；clean-room 验证脚本会剥离该执行器特有变量以还原普通终端行为。

本机 Chromium GPU 进程受环境限制时，E2E 通过已文档化的 `WB_ELECTRON_ARGS="--no-sandbox --disable-gpu"` seam 启动；开关必须位于 app 路径之前。

## 提交链

`e803d3e` reproducibility + path portability → `091b9b1` node-linker → `773cacc` pnpm 11 配置落点 → `00374fd` draft race → `c0ca940` README / E2E 环境指引。

本轮正式代码范围集中于 reproducibility、path portability、README、THIRD_PARTY_NOTICES 与测试 fixture；`src/` 零改动。

## 剩余 skip

Vitest `codexAppServer.smoke.test.ts`：需要真实 Codex 二进制，E 当前没有；协议错误路径仍由 fake app-server fixture 覆盖。

`e2e/frozen-corruption.spec.ts` 的条件 skip：只在 registry 缺少目标 conversation 时触发；当前 fixture 正常路径实际执行并通过。

Reliability benchmark 默认需 `WB_BENCH=1`，不属于默认门禁；本轮已显式实跑并通过。

## 下一阶段

CLEAN-ROOM GREEN 已闭合。执行顺序正式进入：

**History / Search → Attention → Portability**

History 仍是只读副本/索引，不成为 live Runtime truth；parser problem 必须显式暴露；index/cache 放 Electron userData；第一阶段只做 Claude Code + Codex，OpenCode 后置。当前不做 UI redesign、Ambient Island、Material Layer、Task Board、Runtime 扩张或新 donor 集成。

**CLEAN-ROOM GREEN — E LONG-TERM BASELINE ACTIVE**
