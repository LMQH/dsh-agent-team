# DSH 团队开发工作流（OMP 现行工作流 → DeepSeekHarness 复刻）

把资源包 `/Users/maxwell/Downloads/OMP团队开发工作流-DeepSeekHarness复刻包-20261013` 描述的
**现行 OMP 团队开发工作流**，按 `02-DeepSeekHarness复刻方案.md` 的七层顺序，
在**本机实际 DeepSeekHarness** 上复刻为一套可安装、可运行、可验证的配置。

> 本目录是**产物源**；`./install.sh` 把它安装到 `$DSH_HOME`（默认 `~/.dsh`）。
> 验收结论与逐项证据见 [verification/acceptance-run.md](verification/acceptance-run.md)。
> 未通过/未执行/未复刻的条目**不会**被写成已完成。

## 30 秒上手

```sh
cd dsh-team-workflow
./install.sh --dry-run     # 先看会做什么
./install.sh               # 安装（自动备份 + 生成清单与 SHA256）
./verify_install.sh        # 安装后自检：18 PASS / 0 FAIL / 1 WARN
```

**实测：不需要重启。** 2026-10-13 在本机运行中的桌面实例上追加挂载条目后，钩子**立即生效**
（`bash` 与 `spawn_teammate` 均被真实拦截）。见 [evidence/live-hook-firing.txt](evidence/live-hook-firing.txt)。
但**修改 `hooks.json` 本身**（配置）需要重新加载 profile 才生效；修改 `policy_check.js`/`ledger.js`
（程序体）下一次调用即生效。

回滚：`./uninstall.sh`（只删自己清单内的文件，保留用户新增文件）。

## 它复刻了什么

| 层 | 内容 | 安装位置 |
|---|---|---|
| 宿主规则 | 三级分诊、权威顺序、角色分界、工件链、独立门、授权边界、编码准则 | `~/.dsh/AGENTS.md` |
| 安全边界 | 提交/推送/部署/密钥/破坏性清理的硬边界与 Docker 清理清单协议 | `~/.dsh/team/RULES.md` |
| 技能 | 15 个团队技能 + 9 个共享技能（真实存在者），两个缺失技能不伪造 | `~/.dsh/skills/<name>/SKILL.md` |
| 角色 | 10 份角色派发合同 + 15 角色注册表（5 个标为 DSH 内置替代） | `~/.dsh/roles/` |
| 编排 | 分诊、派发、工件链与登记、门控与独立性、知识权威 | `~/.dsh/team/orchestration/` |
| 模板 | 任务合同、PRD/ADR/Tech Spec/Test Spec/QA 报告 | `~/.dsh/team/templates/` |
| 策略 | PreToolUse 钩子：受保护路径、越界、破坏性命令、派发授权 | `~/.dsh/team/hooks.json` + `policies/` |
| 记账 | 派发前 append-only JSONL 台账 | `~/.dsh/team/ledger/agent-ledger.jsonl` |

## 关键设计（诚实边界）

- **双层防护**：工具层 PreToolUse 钩子 + DSH 文件沙箱（`read-only`/`workspace-write`/`danger-full-access`）。
  钩子在非 2 退出码或崩溃时**失败开放**，因此策略程序被写成永不抛异常、异常即 `exit 2`。
- **钩子进程是只读沙箱**（实测：只有 `/tmp`、`$TMPDIR` 可写；会话工作区与 `~/.dsh` 都 `EPERM`）。
  因此"由钩子强制写台账"**平台不可复刻**：改为**主 Agent 预写台账 + 钩子只读校验并阻断缺记录派发**。
  强制点仍在钩子上，只是写者从钩子移到了主 Agent。见 [policies/ACTIVATION.md](policies/ACTIVATION.md) §4b。
- **钩子配置在插件挂载时读一次，程序体每次调用重读**：挂载即时生效，改 `hooks.json` 需重新加载 profile。
- **DSH 没有角色自动加载**：角色是**派发提示词合同**，由 Lead 组装后经 `spawn_teammate`/`subagent` 派发。
- **任务板 `write_scopes` 只是咨询性告警**，不阻止也不授权写入；并发安全靠**路径隔离 + 唯一集成者 + Lead 终审**。
- **工作区内的路径隔离必须用 `denied_paths`**（实测）：任务合同的 `allowed_paths` 只增加工作区外的可写路径，
  在工作区内部**不做白名单收窄**。只写 `allowed_paths` 时 `qa` 写被测实现仍会被放行。
- **成员共享同一工作目录**：无 worktree、无文件锁、无自动所有权释放。
- **知识库未配置**：不假定 `/Users/lmqhx/wiki` 存在；相关技能显式标注并 `blocked` 而非假装成功。
- **五个角色无本地定义**：`reviewer`/`security-reviewer`/`scout`/`sonic`/`task` 以 DSH 内置能力替代，
  不声称已导入专属定义。

## 目录

```text
dsh-team-workflow/
  README.md                     本文件
  install.sh / uninstall.sh / verify_install.sh
  instructions/AGENTS.md        → ~/.dsh/AGENTS.md（合并 OMP AGENTS + 上游编码准则）
  instructions/RULES.md         → ~/.dsh/team/RULES.md
  skills/<name>/SKILL.md        → ~/.dsh/skills/（24 个技能 + _tools/validate_skills.js）
  skills/MISSING-SKILLS.md      两个悬空绑定的处置记录
  skills/CONVERSION-NOTES.md    路径重映射与语义变更清单
  roles/<role>.md + registry.yaml + _tools/validate_roles.js
  policies/hooks.json           挂载用的 Claude Code dialect 钩子配置
  policies/policy_check.js      PreToolUse 决策程序
  policies/ledger.js            账本写入与完整性校验
  policies/tests/run.js         可执行的策略测试套件
  policies/ACTIVATION.md        挂载/回滚/验证运行手册
  policies/GAP-ANALYSIS.md      与原 OMP 拦截器的逐项差距
  ledger/README.md              台账记录 schema
  orchestration/*.md            分诊 / 派发 / 工件链 / 门控 / 知识权威
  templates/*.md                任务合同与工件模板
  docs/                         源包对照、复刻落地记录、验收执行说明
  evidence/                     所有原始命令输出（技能/角色/策略/源包完整性）
  verification/                 04-验收清单的实际执行结果
```

## 验证入口

```sh
node skills/_tools/validate_skills.js      # 24 技能格式、路径、悬空技能
node roles/_tools/validate_roles.js        # 10 角色、独立 reviewer、悬空技能绑定
node policies/tests/run.js                 # 策略：70 用例（允许/阻断/绕过/授权/台账/测试隔离）
node policies/tests/bridge-probe.js        # 桥接映射：43 用例
node ~/.dsh/team/policies/ledger.js --verify
./verify_install.sh                        # 安装完整性 + SHA256 清单（PASS=20 / FAIL=0 / WARN=0）
shasum -a 256 -c sources/SHA256SUMS.txt    # 源包本身（在资源包根执行）
```

## 端到端验收（真实运行，非声明）

`verification/acceptance-run.md` 是对 `04-验收清单.md` 的逐项执行结果：
**9 项通过、1 项部分**（Docker 仅策略侧验证，镜像构建未执行 —— 属授权决定，非环境限制）。

其中 §6 在隔离项目 `scratch-delivery/` 上真实走完 **4 轮**"实施 → 独立门 → 缺陷返回 owner → 门重取"：

```
task-4 复审(不通过, 发现 CR-B1) → task-5 修复 → task-6 QA(Pass) → task-7 复审(通过, 发现 CR7-B1)
   → task-8 硬化 → task-9 QA(Pass) → task-10 复审(最终门通过)
```

三次门**各抓到不同的东西**，无法互相替代：实施者拒绝改测试/自审；QA 抓到测试工件自相矛盾并用
变异测试证明套件非空转；代码审查抓到 QA 漏掉的 `CR-B1`，并在"通过"的同时抓到**修复自身引入**的
`CR7-B1` fail-open 回归。最终 revision 的 QA 与代码审查结论均已由 Lead 亲自复跑。

**已知残余风险不隐藏**：`allowed_paths` 不收窄工作区内、`send_message` 续派活不受记账门控、
shell 分析为文本级（有漏报也有假阳性）、钩子 fail-open、`workflow` 默认不门控。
`scratch-delivery/` 交付物仍有**契约外**已知行为（有状态 getter 致库存膨胀、`Infinity` 不夹紧等），
**不得**读作"已完成 stock 校验"。完整清单见 `acceptance-run.md` 文末。

其中 4 项已于 2026-10-13 经用户确认转为**「已批准的未实现要求」**，落在
`scratch-delivery/delivery/tech-spec-addendum-2.md`（TS-2）：

- `requested` 键空间定义为**自有可枚举字符串键** —— **已被现实现满足**（澄清，非变更）
- **R-1** `requested` 值语义校验（防有状态 getter 绕过）—— **未实现**
- **R-2** 非法 `stock` 改用独立错误码 `INVALID_STOCK` + 值域收紧为非负整数 —— **未实现**

落实方式由用户选定为**零代码改动、只落规格**。因此 **QA-3 与 CR-3 两道门不覆盖 R-1/R-2**：
**不得**把"双门通过"读作这两项已满足。将来实施须按「变更使门失效」重跑 QA 与代码审查门。
（v1 的 `tech-spec.md` 刻意保持逐字节不变，以免污染两道门所审输入的可追溯性。）

## 未复刻与未执行

逐项声明见 [docs/源包对照.md](docs/源包对照.md) 与 [docs/验收执行说明.md](docs/验收执行说明.md)；
实际执行结论见 [verification/acceptance-run.md](verification/acceptance-run.md)。
本复刻**不**包含：OMP 插件 API、模型/账号配置、旧会话与台账、个人知识库、生产基础设施。
