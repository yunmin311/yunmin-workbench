# Memory Index

## 用户画像 / 工作纪律
- [用户是设计师不是工程师](user-is-designer-not-engineer.md) — 产品判断强、有 CS 底子
- [探不到就停,别猜](fail-closed-not-silent.md) — 静默失效最坏;报 UNKNOWN
- [先复用再自研](reuse-before-rebuild.md) — 先证明成熟方案不够用,再写新轮子
- [一次只推进一件事](one-track-per-turn.md) — 并行分支越多,收口成本越高

## git / 回复习惯
- [对话用中文](converse-in-chinese.md) — 跟用户一律中文回复
- [提交前跑完整门禁](gate-before-commit.md) — install → typecheck → build → test → e2e
- [分支只承载一个主题](one-topic-per-branch.md) — 拒绝把 WIP 混进正本分支

## 投影与正本边界
- [投影层不反写外部事实](projection-never-writes-back.md) — 数据库/缓存/画布永远只是 projection
- [没有 task_source 就不做 Task 板](no-task-source-no-task-board.md) — Conversation lifecycle 不是 TaskState
- [cwd 不是身份](cwd-is-not-identity.md) — 路径/文件名/标题相似度都不能当 canonical identity
- [缺失就显示 UNKNOWN](unknown-over-inference.md) — 不用推断填满界面
- [冻结包只增不改写](frozen-packets-are-immutable.md) — 外部变化只改变 validity,不重写 body
