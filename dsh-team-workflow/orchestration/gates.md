# 独立性与门控（Independence & Gates）

## 不可协商的四条

1. **实施 owner 不得审查自己的 diff。**
2. **QA 不得修改被测实现**——发现缺陷只能报告并退回 owner。
3. **代码审查与合规/安全评审是独立的门**，互不替代，也不替代 PRD/ADR/Tech Spec/Test Spec/QA 报告。
4. **门控结论只对其标识的 revision 有效**；后续变更使受影响的门失效并必须重验。

违反上述任一条的门控结论无效，即使结论本身是对的。

## 门的种类与产出

| 门 | 执行角色 | 输入 | 产出 |
|---|---|---|---|
| QA 验收 | `qa` | Test Spec + 确切 revision | QA Acceptance Report：裁决、实际执行结果、缺陷、残余风险 |
| 代码审查 | `code-review`（或 `reviewer` 替代） | 指定 diff + 证据 | 缺陷清单：严重度、路径与行/构造、后果、可执行修复建议 |
| 合规/安全 | `compliance`（或 `security-reviewer` 替代） | 确切 revision + 任务合同 | `pass`/`risk`/`block`/`needs-authorization` 逐项分类 + 证据 |
| 产品验收 | `pm` **或用户** | PRD + 可见行为证据 | 最终产品接受决定 |

**最终产品验收只能由产品经理或用户作出。** QA、迁移作者、审查者都不得代替。

## 何时需要哪些门

- Fast：无独立门。主 Agent 自检，**不得**称为独立 QA。
- Standard：至少独立 `qa`。用户/仓库要求或风险提示时增加 `code-review`/`compliance`。
- Deep：`qa` + `code-review` + 适用时的 `compliance`/`security`，全部绑定确切 revision。

## 独立性在 DSH 上如何落地

- 用**不同的角色文件 + 不同的成员**承担 owner 与 reviewer；同一成员不得兼任两者。
- **路径隔离必须由 `denied_paths` 实现，不能只写 `allowed_paths`**：
  `allowed_paths` 只**增加**工作区外的可写路径，在工作区内部**不做白名单收窄**——
  `qa` 写了 `src/` 依旧会被放行（本机用已安装的 `policy_check.js` 实测：仅 `allowed_paths` 时 exit 0）。
  要让"QA 不得修改被测实现"成为工具层事实，必须：
  1. 在 `qa` 任务合同里写 `denied_paths: [<被测实现目录>]`；
  2. 把该合同作为**活动任务合同**放到 `~/.dsh/team/task-contract.json`（钩子只读这一份）；
  3. 实测一次 `qa` 写被测实现的 payload 必须 `exit 2` + `TASK_CONTRACT_DENIED_PATH`。
  只有这三步都做到，才能声称"从路径上排除了修改被测实现的可能"。
- 在报告里记录**如何证明独立性**：成员名、角色 id、被审 revision、实际命令。
- DSH **不能**自动强制角色身份：若 Lead 把同一成员既派为 owner 又派为 reviewer，
  平台不会阻止。因此该约束由 Lead 的派发纪律承担，并在验收时被审阅。

## Revision 身份

- 优先用 commit SHA。
- 未提交工作树：用 `uncommitted+<改动文件集的内容哈希>`，
  并在报告中列出被审文件与其哈希（`shasum -a 256 <paths>`）。
- 无法给出可重复识别的 revision 时，门控结论标为 `blocked`，说明原因。
- 桌面材料/文档包（无 Git）可用包内 `SHA256SUMS` 或文件清单哈希标识审查对象。

## 缺陷回流

```text
门控发现缺陷 → 报告写明：路径、行/构造、后果、复现命令、严重度
        → 退回实施 owner（不修改被审实现）
        → owner 修复 → 记录新 revision
        → 受影响的门全部重跑（不是只重跑失败项）
        → 更新工件登记表的 revision 与状态
```

## 反模式（发现即记缺陷）

- 用提示词自述"我会遵守"替代工具层或 OS 层证据；
- 把"构建成功/候选健康"当作发布授权；
- 在 QA 报告里粘贴未实际执行的命令输出；
- 用同一个成员同时实施与审查；
- 代码变更后沿用旧 QA 报告；
- 把平台不支持的能力写成"已复刻"。
