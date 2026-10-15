# roles/ — DSH 开发团队角色层（WS-B）

本目录把迁移包中 OMP 的 10 份 `agents/*.md` 角色定义，转换为 **DSH 上的角色提示合同**，并登记源
`team-workflow` 角色表的全部 **15** 个角色（10 个本地定义 + 5 个 `dsh-builtin-substitute`）。

关键事实（已核对 DSH 随包实现，不是假设）：

- **DSH 没有角色文件自动加载机制，也没有 `agents/` 注册表**（NON-CAPABILITY）。`roles/*.md` 不会自动生效；
  必须由 Lead 读取后并入 `spawn_teammate` / `subagent` 的提示词。
- `spawn_teammate` 的 schema 只有 `name` / `description` / `prompt` / `context`（`fresh` | `fork`），
  **没有 `tools` 或权限参数**：工具子集只能是提示词层面的声明，平台不按角色收窄工具。
- `team_task_create` 的 schema 只有 `subject` / `description` / `blocked_by` / `write_scopes`；其中
  `write_scopes` 的官方描述是 “Advisory workspace-relative file or directory prefixes this task expects to modify.”
  —— 它只产生重叠警告，**不阻止任何写入，也不构成授权**。
- 任务更新是 revision 上的 compare-and-set（`team_task_update` 必填 `expected_revision`，过期即 `TEAM_TASK_STALE_REVISION`）。
- `blocked_by` 是**会拦**的：未满足依赖的任务不能被 claim（`TEAM_TASK_BLOCKED`）。
- 成员共享同一个工作目录与文件系统，编辑立即互相可见；**没有 worktree 隔离，也没有自动所有权释放**。

## 1. 派发配方（Lead 每次派发按此执行）

1. **分诊**：按 `team-workflow` 的三级门（Fast / Standard / Deep）路由，写明理由；Deep 才需要完整工件链。
2. **选角色**：从 `registry.yaml` 选 `local-definition` 角色；无本地定义的角色按下表用替代方式（见 §5）。
3. **写任务合同**：填全 11 个字段（见各角色文件 `## 派发合同` 与 `templates` 中的合同模板来源）。
4. **上任务板**：`team_task_create({ subject, description, blocked_by, write_scopes })`
   —— 产出的是 **unowned / pending** 任务；`write_scopes` 填 `allowed_paths`，`blocked_by` 填依赖任务 id。
   任务板上记录的是**义务清单**，不是权限授予。
5. **组提示词**：把 `<role>.md` 全文 + 已填任务合同 + 技能加载指令 + DSH 边界提醒拼进 `prompt`（模板见 §2）。
6. **派发**：`spawn_teammate({ name, description, prompt, context: "fresh" })`；需要继承 Lead 已完成上下文时才用 `"fork"`。
7. **确认 owner**：成员用 `team_task_get` / `team_task_list` 取最新 revision 后 `team_task_update({action:"claim"})`；
   或由 Lead 用 `action:"reassign", owner:"<teammate>"` 指定（reassign 仅 Lead 可用）。
8. **过门**：按角色 `required_gates` 另派 `qa` / `code-review` / `compliance` 实例；门报告绑定 revision。
9. **收口**：`action:"complete"`（仅 `in_progress` 可完成）；代码有变更时 `action:"reopen"` 并按新 revision 重跑受影响门。

### 审核角色单独派发

`qa`、`code-review`、`compliance` 必须是与被审实现**不同的 teammate 实例**，且提示词里只给：
被审 revision / diff 范围、任务合同、证据材料、以及它们自己的角色合同。
不得把实现者自己当成 reviewer，也不得让 `backend` / `frontend` / `harness` 互相充当对方唯一审查者。

## 2. 提示词模板（含留空占位）

```text
你是 <role_id>（<display_name>），DSH 团队成员；Team Lead 名为 "lead"。

【角色提示合同｜逐条遵守，原文来自 roles/<role_id>.md】
<<<ROLE-CONTRACT
<把 roles/<role_id>.md 全文粘到这里，含 YAML frontmatter>
ROLE-CONTRACT>>>

【任务合同｜Lead 已填，缺项即回报 blocked】
- task_id: <团队任务板 id>
- worktree_or_revision: <commit SHA，或「未提交工作树」+ 可复核快照界定>
- owner_role: <role_id>
- allowed_paths: <允许写入/读取的路径前缀>
- denied_paths: <显式排除的路径；QA/审查类任务必须含被测实现目录 —— 仅靠 allowed_paths 收窄不了工作区内部路径（实测）>
- input_artifacts: <已批准输入>
- output_artifacts: <期望产出>
- dependencies: <依赖任务/工件；对应任务板 blocked_by>
- acceptance_criteria: <可观察、可判定的验收点>
- independent_reviewer: <与实施 owner 不同的角色>
- required_gates: <本任务必须过的门>
- authorization_record: <谁/何时/批准了什么；无则写「未授权」>

【技能加载｜DSH 无 autoload，必须显式加载】
用 skill 工具按需加载：<roles/<role_id>.md 的 skills 列表>。
只能加载本会话目录（<projectRoot>/.dsh/skills、~/.dsh/skills 等）中真实存在的技能；
任何加载失败必须写进回报，不得当作已加载成功。
本包 skills/ 的安装（复制到 <projectRoot>/.dsh/skills）属于另行授权的动作，未安装时上面的名字不可用。

【DSH 边界提醒】
- 你与其他成员共享同一工作目录与文件系统，编辑立即可见；没有 worktree 隔离。
- write_scopes 只是 advisory 提示，DSH 不自动阻止越界写入（NON-CAPABILITY）；allowed_paths 之外一律不写。
- **路径隔离靠 `denied_paths`**：`allowed_paths` 只增加工作区外的可写路径，在工作区内部它不是白名单。
  要让"只读角色不得改被测实现"在工具层成立，必须把含 `denied_paths` 的合同设为活动任务合同
  `~/.dsh/team/task-contract.json`（钩子只读这一份），并实测越界写入返回 `exit 2` + `TASK_CONTRACT_DENIED_PATH`。
- 未在 authorization_record 中明确授权的提交、推送、部署、密钥/账号访问、破坏性清理，一律不做。
- 只读角色（write_access: none）不得写任何文件，包括用 bash 间接写入。

【汇报】按角色合同「汇报格式」返回 status（complete | blocked | needs-authorization | needs-decision）、
精确 revision/工作树身份、实际执行的命令、变更/审查路径、证据、风险、未覆盖项、下一 owner 与门。
```

## 3. 任务板怎么记（`team_task_create` / `team_task_update`）

| 目的 | 调用 | 说明 |
|---|---|---|
| 建任务 | `team_task_create({subject, description, blocked_by, write_scopes})` | 建立 **unowned / pending** 任务；合同全文写进 `description`（含 11 个字段与验收标准） |
| 查最新 revision | `team_task_get` / `team_task_list` | 任何更新都要带最新的 `expected_revision`（CAS） |
| 认领 | `team_task_update({task_id, expected_revision, action:"claim"})` | 仅 `pending` 且依赖就绪时可 claim；否则 `TEAM_TASK_BLOCKED` |
| 指派/改派 | `team_task_update({..., action:"reassign", owner})` | **仅 Lead** 可用；省略 owner 即取消指派 |
| 改范围 | `team_task_update({..., action:"edit", write_scopes})` | `write_scopes` 仍是 advisory 提示 |
| 改依赖 | `team_task_update({..., action:"set_dependencies", blocked_by})` | 完整替换阻塞列表 |
| 完成/重开 | `action:"complete"` / `action:"reopen"` | 仅 `in_progress` 可 complete；变更后重开并重跑门 |
| 释放 | `action:"release"` | 显式动作；DSH 不会自动释放所有权（NON-CAPABILITY） |

`team_task_list` 会返回 readiness、owner、revision、blockers 与 write-scope warnings。**只有 warnings** ——
重叠写入不会被拒绝；发现重叠时 Lead 必须指定唯一集成者或改为串行。

## 4. 审查独立性怎么落地

- **结构上**：独立门角色（`qa` / `code-review` / `compliance`）用**另一次 `spawn_teammate`** 创建，提示词中
  不含实现者的自证材料；实现者的角色合同里明确写了自己不是 reviewer。
- **身份上**：每个门报告必须写明被审的 revision / 工作树身份；测试证据只能覆盖它标示的那个 revision。
- **时间上**：`code-review`、`compliance` 分别独立于实现；两者互不替代，也都不替代产品验收（产品验收属 PM/用户）。
- **失效传播**：任何后续代码变更使受影响 QA / code-review / compliance 门失效，必须按新 revision 重跑。
  DSH **不会**自动标记失效或自动重开任务（NON-CAPABILITY），由 Lead 用 `action:"reopen"` + 重新派发来维持。
- **无本地定义的角色**（`reviewer` / `security-reviewer`）用 `code-review` / `compliance` 的合同另起实例，
  不能用同一个 teammate 重复扮演实现者与审查者。

## 5. 15 个角色与 5 个替代映射

| 角色 id | 显示名 | 类型 | 状态 | 定义 / DSH 替代 |
|---|---|---|---|---|
| `pm` | 产品经理 | read-only | local-definition | `roles/pm.md` |
| `architect` | 架构师 | read-only | local-definition | `roles/architect.md` |
| `backend` | 后端开发工程师 | implementation | local-definition | `roles/backend.md` |
| `frontend` | 前端开发工程师 | implementation | local-definition | `roles/frontend.md` |
| `harness` | 智能体开发工程师 | implementation | local-definition | `roles/harness.md` |
| `devops` | 运维工程师 | implementation | local-definition | `roles/devops.md` |
| `qa` | 测试工程师 | review | local-definition | `roles/qa.md` |
| `code-review` | 代码审查专员 | review | local-definition | `roles/code-review.md` |
| `reviewer` | 技术审查专员 | review | **dsh-builtin-substitute** | 复用 `code-review` 合同另起独立实例；**未导入本地角色定义** |
| `compliance` | 合规审查专员 | review | local-definition | `roles/compliance.md` |
| `security-reviewer` | 安全审查专员 | review | **dsh-builtin-substitute** | 复用 `compliance` 合同 + `security-test-matrix` 另起独立实例；**未导入本地角色定义** |
| `scout` | 代码探查专员 | read-only | **dsh-builtin-substitute** | `subagent`，仅 `read`/`grep`/`glob`，无写入范围；**未导入本地角色定义** |
| `quota-control` | 资源财务专员 | read-only | local-definition | `roles/quota-control.md` |
| `sonic` | 自动化操作员 | mechanical | **dsh-builtin-substitute** | Lead 直接执行，或 `subagent` 按逐条命令清单执行；每项破坏性动作仍需该清单的明确授权；**未导入本地角色定义** |
| `task` | 通用开发工程师 | general | **dsh-builtin-substitute** | `spawn_teammate` / `subagent` 通用成员 + 完整任务合同与 reviewer；**未导入本地角色定义** |

源 OMP 专属 `agents/` 目录中只有 10 份定义；**不得把这 10 份说成 15 份**。5 个替代角色没有源侧
`autoloadSkills` 声明，因此其 `skill_bindings` 为空（`skill_reference_status: not-applicable`）。

## 6. 典型变通与偏差（相对源 OMP 定义）

| 源写法 | DSH 处理 |
|---|---|
| `autoloadSkills: [...]` 自动加载 | 无 autoload（NON-CAPABILITY）：改在派发提示词中要求用 `skill` 工具**显式**加载；仅当技能已安装到 DSH 技能根时才可用 |
| `model: "@team_*"` | 只保留为溯源字段 `source_model_alias`；不推断提供商、不复制凭据、不做任何模型绑定 |
| `tools: [..., lsp]` | DSH 无 `lsp` 工具，未声明；其余映射到 DSH 工具名 |
| `spawns: false` | 保留为合同声明；DSH 能否对单个成员禁用 spawn 未经验证，本包不作强制声明 |
| 正文中的 `/Users/lmqhx/wiki`、`~/.omp/agent/RULES.md`、`~/.omp/agent/usage/...jsonl` | 视为来源定位，**不得假定存在**；vault 未配置时 `hermes-obsidian` 的 vault 流程处于惰性状态（inert） |
| `react-page-implementation`（前端）、`branch-diff-static-review`（代码审查） | 源包中不存在同名技能；已从 `skills` 移除并记入 `removed_skills`，能力由 `react-best-practices` / `code-review-defect-patterns` 等既有技能覆盖（与 `skills/MISSING-SKILLS.md` 的重路由决定一致） |

## 7. 本层明确不声称的能力（NON-CAPABILITY 汇总）

- **不声称** DSH 会自动强制 `write_scopes`：它只产生重叠警告，既不阻止写入也不构成授权。
- **不声称** DSH 会自动释放任务所有权、自动标记门失效、或自动重开变更后的任务。
- **不声称** DSH 提供按角色的 OS 沙箱或 worktree 隔离：所有成员共享同一工作目录与文件系统。
- **不声称** `spawn_teammate` 会按角色收窄工具：它没有 `tools` 参数，工具子集是提示词层面的声明。
- **不声称** 角色文件会被自动加载：Lead 必须显式把角色合同并入提示词。
- **不声称** 本包 `skills/` 已安装：把 `skills/*` 复制到 `<projectRoot>/.dsh/skills` 或 `~/.dsh/skills`
  是另行授权的安装动作；未安装时技能名不可加载。

## 8. 自检

```sh
node roles/_tools/validate_roles.js          # 从 dsh-team-workflow/ 目录运行
node roles/_tools/validate_roles.js --skills-dir=<path>   # 用替代技能根做严格/反例自测
```

校验项：10 个角色文件与 frontmatter 必需字段、5 个必需章节、`write_access` 与工具一致性、
status 取值与汇报字段、DSH 版 vault 规则、`independent_reviewer` 合法性（含实现角色不得只由实现角色审查）、
`skills` 的悬空自动加载检查（对照 `../skills/<name>/SKILL.md` 或 `../skills/MISSING-SKILLS.md`）、
`registry.yaml` 的 15 角色与 5 个替代、以及「未标注的虚假能力声明」扫描。
`skills/` 不存在时技能存在性检查为 `DEFERRED`（退出码仍为 0，且结果明确标注未校验）；一旦存在则严格校验。
