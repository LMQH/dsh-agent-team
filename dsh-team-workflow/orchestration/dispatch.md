# 派发（Dispatch）— 任务合同、共享任务板、记账

把"派发一个专家"分解为四个可检查动作：**写合同 → 建看板任务 → 记账 → 派发**。
四步缺一即为流程缺陷；DSH 上第 3、4 步由 PreToolUse 钩子强制。

## 1. 写任务合同

使用 `~/.dsh/team/templates/任务合同模板.md`。必填字段：

| 字段 | 要求 |
|---|---|
| `task_id` | 唯一稳定标识（看板 task id 可用 `task-<n>`） |
| `repository` | 目标仓库绝对路径 |
| `worktree_or_revision` | 分支/工作树身份/commit SHA；未提交时用"未提交工作树 + 内容哈希" |
| `owner_role` | `~/.dsh/roles/<role>.md` 中的角色 id |
| `allowed_paths` | **穷举**允许写入的路径前缀；未列出即不允许 |
| `denied_paths` | 显式排除的路径。**工作区内部的收窄只能靠它**：`allowed_paths` 不构成白名单（实测） |
| `input_artifacts` / `output_artifacts` | 含路径与 owner |
| `dependencies` | 必须先完成的 task_id |
| `acceptance_criteria` | 可观察、可验证；含拒绝/边界路径 |
| `reviewer_role` | 与 `owner_role` **不同**的角色；实现类角色不得互为唯一 reviewer |
| `required_gates` | 例如 `qa`、`code-review`、`compliance` |
| `authorization_record` | 适用时指明用户授权（动作+目标+引用）；无则写 `未授权` |

拒绝在以下情况派发：允许多个 writer 写同一文件却无唯一集成者；缺少验收标准；
缺少独立 reviewer；需要授权却无授权记录。

## 2. 建共享任务板任务

用 `team_task_create`：
- `subject`：`[<task_id>] <一句话目标> (<owner_role>)`
- `description`：嵌入**完整任务合同**（YAML 代码块）
- `write_scopes`：与 `allowed_paths` 一致
- `blocked_by`：与 `dependencies` 一致

然后把返回的 task id 回填到合同的 `task_id`。

**DSH 事实（必须如实告知成员）**：`write_scopes` 是**咨询性提示**——
仅当两个 in-progress 任务的 scope 重叠时产生告警，它既不阻止 `claim`，也不授权写入。
真正的写入边界来自任务合同 + 钩子 + 人工审阅。

## 3. 记账（派发前）

按 `agent-usage-ledger` 技能向 `~/.dsh/team/ledger/agent-ledger.jsonl` 追加一条派发记录。
append-only：**永不改写、永不删除、永不去重**。记录是计数证据，不是批准。

钩子层强制：`spawn_teammate` / `subagent` / `subagent_fork` / `workflow` 若没有对应的
授权/派发记录会被 PreToolUse 阻断，且被阻断的派发**不会**推进台账。

## 4. 派发

- DSH 机制：`spawn_teammate`（具名、持久、可多次通信、可认领任务板任务）
  或 `subagent` / `subagent_fork`（一次性、返回结果、消耗调用方上下文更少）。
- 口径：需要**持久协作、任务板认领、来回追问** → `spawn_teammate`；
  自包含、只需一个结果 → `subagent`。
- 提示词组装（`~/.dsh/roles/README.md` 有完整配方）：
  `<角色合同全文>` + `<任务合同 YAML>` + `<汇报格式>` + `<DSH 硬事实：共享 cwd、无 worktree、无自动释放、write_scopes 仅咨询>`。
- 并发写同一文件时：指定唯一集成者，其余 writer 必须 `blocked_by` 该集成者任务。

## 5. 硬事实与常见失败

| 事实 | 影响 |
|---|---|
| 成员共享同一 cwd 与文件系统，编辑立即可见 | 并行写同一文件会产生竞态；版本守卫不覆盖 bash/格式化器/生成器 |
| 无 worktree、无文件锁、无 merge | 大改动需靠路径隔离，而非分支隔离 |
| 任务所有权不会因空闲/中断/进程退出自动释放 | 成员失败后必须由 Lead 显式 `team_task_release`/重新指派 |
| 任务更新是 compare-and-set | 用 `team_task_get` 的最新 `revision` 更新，过期即被拒 |
| 只有 Lead 能 spawn / interrupt / reassign | 成员不得自行增加成员 |
| 消息持久且有幂等投递 | 已 `queued` 的消息**不要重发** |
| 名称永久、不复用 | 失败的成员也占用名字 |
