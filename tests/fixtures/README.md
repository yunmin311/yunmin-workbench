# Fixtures

- `legacy/` — current Overlay 实际结构（dialogue-registry v1 / project-adapter v2 /
  machine-profile v2 / INBOX.md / MEMORY.md）。上游契约 MIGRATING，这些 fixture 代表
  **现行遗留结构**，不代表最终契约。
- `new-contract/` — 上游契约冻结后再落；届时 legacy 与新契约并存解析，迁移完成后删 legacy。
- `overlay/` — **portable Personal Overlay 整树**：`overlay.yaml` 标记、`INBOX.md`、
  `memory/`、`projects/instances/*.adapter.yaml`、`profiles/machines/instances/`、
  `harness/manifest.yaml`，以及 `project-roots/`（项目仓 fixture）。树内不含任何机器
  绝对路径；`overlayFixture.ts` 把它复制到临时目录后，只写入那一个必须含绝对路径的
  文件——机器 profile（机器绑定的 `paths.governance_repo` 与 `project_roots`）。

规则：真实 Overlay 变更不得导致测试脆断——单测只跑 fixture。Overlay 只读 slice 优先走
正式 env seam `GOV_OVERLAY`；未设置时用 `overlay/` fixture，所以同一组断言在任意机器
上都真的执行，不会退化成 skip。
