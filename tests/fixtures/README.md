# Fixtures

- `legacy/` — current Overlay 实际结构（dialogue-registry v1 / project-adapter v2 /
  machine-profile v2 / INBOX.md / MEMORY.md）。上游契约 MIGRATING，这些 fixture 代表
  **现行遗留结构**，不代表最终契约。
- `new-contract/` — 上游契约冻结后再落；届时 legacy 与新契约并存解析，迁移完成后删 legacy。

规则：真实 Overlay 变更不得导致测试脆断——单测只跑 fixture；真实 Overlay 只进
`tests/project/overlay.smoke.test.ts`（可跳过）。
