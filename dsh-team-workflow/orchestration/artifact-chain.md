# 工件链与工件登记（Artifact Chain & Registry）

## 链与权威

| 序 | 工件 | 默认文件名 | Owner | 权威 |
|---:|---|---|---|---|
| 1 | PRD | `<delivery>/prd.md` | `pm` | 目标、范围、角色、用户可见行为、验收标准、非目标 |
| 2 | ADR | `<delivery>/adr/ADR-<n>-<slug>.md` | `architect` | 仅持久边界/不变量/权衡；**有决策才写** |
| 3 | Tech Spec | `<delivery>/tech-spec.md` | 具名技术负责人 | 组件、API、schema、数据模型、故障、迁移、发布、验证 |
| 4 | Implementation Plan | `<delivery>/implementation-plan.md` | 具名实施 owner | 有序切片与 owner，不重定义规格 |
| 5 | Test Spec | `<delivery>/test-spec.md` | `qa` | 可追溯到验收标准的场景、期望可观察结果、证据要求、覆盖边界 |
| 6 | QA Acceptance Report | `<delivery>/qa-report-<revision>.md` | `qa` | 绑定确切 revision 的裁决、实际执行结果、缺陷、残余风险 |

`<delivery>` 默认为 `<目标仓库>/delivery/`。**与代码版本绑定的工件留在目标仓库**，
不放进用户配置目录或知识库。

后序工件**不得静默修改**前序工件拥有的事实或约束：
- 产品事实缺失 → `architect` 返回 `needs-decision`，不自行补齐。
- ADR 约束缺失 → 技术设计返回 `needs-decision`，不发明架构。
- ADR **不是**技术设计：除用户明确授权为架构决策的条目外，不得固定字段、表、端点载荷、
  错误码、token 格式、存储、文件、函数、库、配置、算法或调用顺序。

不是每个 Standard 任务都要补齐模板。**只为凑模板而生产的工件是负资产。**

## 工件登记表（Artifact Registry）

在 `<delivery>/registry.md` 维护，每次工件产出或失效时更新：

```yaml
artifacts:
  - type: prd | adr | tech-spec | implementation-plan | test-spec | qa-report | review | compliance
    id: <唯一标识>
    owner_role: <角色 id>
    path: <相对仓库路径>
    revision: <commit SHA | "uncommitted+<内容哈希>">
    status: draft | approved | superseded
    source_artifacts: [<其依据的工件 id>]
    gates_required: [qa, code-review, compliance]
    created_at: <ISO8601>
    superseded_by: <工件 id | null>
```

规则：
- `draft` 与 `approved` **必须显式区分**；默认 `draft`。只有用户能把团队规范/ADR 标为 `approved`。
- 依赖顺序：工件只能依赖**已存在**的 `source_artifacts`；缺失即 `blocked`，不得跳过。
- `revision` 是门控的键：门控结论只对它标识的 revision 有效。

## 变更使门失效

任何代码或工件内容变更后：

1. 找出所有 `source_artifacts` 传递依赖该工件的门控工件（QA 报告、代码审查、合规结论）；
2. 把它们标为 `superseded`，写明失效原因与新的待验 revision；
3. 重跑受影响的门；**不得**沿用旧结论；
4. 更新登记表。

判定"受影响"的范围：按**变更路径**与每个门控工件记录的"被审路径/命令"取交集；
交集非空即失效。纯文档变更不影响代码门，但影响该文档自身的文档门。

## 报告格式（所有工件与门控报告共用）

```yaml
status: complete | blocked | needs-authorization | needs-decision
revision: <commit SHA | uncommitted+<hash> | N/A>
commands_run:            # 实际执行的命令，逐条原样
  - <command>
  - exit_code: <n>
changed_paths: [<...>]   # 实施类必填
reviewed_paths: [<...>]  # 审查/QA 类必填
evidence: [<证据文件路径>]
risks: [<限制与残余风险>]
uncovered: [<未覆盖项>]
next_owner: <角色 id>
next_gate: <qa | code-review | compliance | product-acceptance | none>
```

**报告是证据，不是批准。** 缺少实际命令与证据路径的报告视为未完成。
