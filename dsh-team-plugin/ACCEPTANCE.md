# Agent 团队工作流 · 验收报告

- 生成时间：2026-10-15T08:42:03.201Z
- 插件：`@local/dsh-team-workflow@0.3.0`
- roles.json 指纹：`0e3577c5a2d710eb`
- 资源包：`/Users/maxwell/Downloads/OMP团队开发工作流-DeepSeekHarness复刻包-20261013`
- 依据：资源包 `04-验收清单.md`

## 自动核验结果

| # | 检项 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| 0 | 资源包静态完整性 | 全部 SHA256 匹配 | 校验 51 个文件，失败 0 个 | **PASS** |
| 2a | 角色文件数 | 10 | 10 | **PASS** |
| 2b | roles.json 角色数 | 10 | 10 | **PASS** |
| 2c | 角色 ID 与包 front-matter 一致 | 10/10 匹配 | 10/10 匹配 | **PASS** |
| 2e | 角色正文无失效本机路径 | 0 个 | 0 个 | **PASS** |
| 2g | 展示顺序 = 包里的角色枚举顺序 | pm → architect → backend → frontend → harness → devops → qa → code-review → compliance → quota-control | pm → architect → backend → frontend → harness → devops → qa → code-review → compliance → quota-control | **PASS** |
| 2f | 正文引用的本机文件真实存在 | 0 个死链 | 0 个死链 | **PASS** |
| 2d | 权限判定与工具列表一致 | 无矛盾 | 无矛盾 | **PASS** |
| 3a | 自动加载技能全部可用 | 0 个缺失 | 0 个缺失 | **PASS** |
| 3b | 两个缺失技能被显式报告且已解除绑定 | frontend→react-page-implementation, code-review→branch-diff-static-review | frontend→react-page-implementation, code-review→branch-diff-static-review | **PASS** |
| 3c | 悬空技能未被静默加载 | 0 个 | 0 个 | **PASS** |
| 4a | 宿主落盘名册为 10 个角色 | 含「角色名册（10 个）」 | 命中 | **PASS** |
| 4b | 宿主落盘名册含悬空技能告警 | 含「悬空技能」 | 命中 | **PASS** |
| 4 | roles.json 指纹 | 记录用 | 0e3577c5a2d710eb（10 角色） | **PASS** |
| 5 | 交付文件无过时表述 | 0 处 | 0 处 | **PASS** |
| 6a | 客户端声明完整（dsh.client / ./client / files / 产物） | 四项齐全且 platform=web | dsh.client=platform=web；exports["./client"]=有；files 含 client.js=true；磁盘存在=true | **PASS** |
| 6b | 官方标识未被占用 + 自有坐标齐全 + 遮蔽要件在位 | CSS 前缀/包名 0 处；官方 slot id 恰好 1 处（遮蔽常量）；自有坐标齐全；priority + try/catch 在位 | 全部满足；官方 slot id 1 处；自有坐标 齐全；遮蔽要件 在位 | **PASS** |
| 6c | 生成器幂等（产物可复现，不靠手改） | 重跑后 sha256 不变 | sha256 一致 3e6af8ac83df249e | **PASS** |
| 6d | 真实产物在真实 SlotCore 上注册（遮蔽语义：官方优先 / 缺席接管 / 顺序无关 / 兜底有意义） | 全部为真 | 模块 id 正确=true；坐标正确=true（id=agent-team order=-20 priority=100 ns=dsh-team-workflow locale=zh/en）；inject 齐全=true；注入样式表=1 个；遮蔽：官方在场仅官方胜出=true / 官方缺席本插件接管=true / 加载顺序无关=true / 同 priority 仍抛错=true；让位兜底：apply 未抛错（已让位） | **PASS** |
| 6e | CSS 选择器合法且全部带自有前缀 | 0 处非法选择器 | 选择器 70 条全部合法且带前缀 _twf_ | **PASS** |
| 6f | 渲染冒烟（C5.1 五项行 + 悬停官方原文 + C7 点击进详情 + C20.3 状态卡片与自有弹窗 + C20.4 任务板 + class 对齐 + 位置兜底） | 全部通过 | 名册 10 行且每行恰为五项（状态点/中文名/角色 id Tag/状态词/职责，悬停固定「打开成员会话」）；qa 运行中可点击→openTeammate；pm-2 准备中；其余未派发禁用；状态卡片 + 「配置」按钮（开自有弹窗，不跳官方页）；任务板透传 tasks/failure；面板悬停接线齐全；32 个 class 全部命中 CSS；位置兜底正确 | **PASS** |
| 6i | 自有配置弹窗（C21.1 官方原语 + C21.2 六字段 + C21.3 单一真源与降级） | 全部通过 | 按钮打开自有弹窗：官方 Modal + SettingsForm + SettingsValueField + 5 个 Switch；六字段标签全走本地化键；值与可写状态来自 ctx.configForms(get("team-workflow"))并落回 C21.2 默认值；保存走到作用域 mutate；服务抛错/缺席时降级为「不可写」且不抛异常；官方入口保留为弹窗内次级链接 | **PASS** |
| 6h | 插件管理页呈现与入口（C20：meta 一句话 + 详情区块 + 弹窗内次级链接 openBundle / 降级） | 全部通过 | locale meta 一句话；plugins.detail.section 只对本包渲染且承载 10 角色与悬空技能；弹窗内次级链接经 openBundle 打开本包、服务缺席时降级 selectPanel("plugins") | **PASS** |
| 6j | 宿主半配置（C21.2 六字段 volatile + 默认值 = 现状 + /team 真的按配置变化 + 关掉官方自动表单） | 全部通过 | Config 六字段全部 volatile 且默认值 = C21.2 表列值；默认配置下名册 10 行、简报列技能、/team route 强制原因（= 改动前行为）；disabledRoles 排除并显式报告、autoloadSkills=false 去掉技能段、routeGuard=false 放行；fiber 上的活配置优先；已用可选注入关掉官方自动表单（configure({ auto: false })×5） | **PASS** |
| 6g | 官方当前注册的有效 priority 仍低于本插件（C1 让位方向的上游哨兵） | 官方 id 相同 且 (官方 priority ?? 0) < 本插件 priority | 官方注册：id=agent-team priority=缺省→0；本插件 priority=100；方向正确（官方更小 → 官方胜出） | **PASS** |
| 7a | 规则层 AGENTS.md 用 spawn_teammate 派发团队角色 | 含「派发团队角色一律用 `spawn_teammate`」 | 已声明 | **PASS** |
| 7b | 不再把 subagent 写成团队派发通路 | 0 处 | 0 处 | **PASS** |

**自动核验：27/27 通过。**

## 未执行项（需人机交互，按清单口径记「未执行」，不冒充通过）

| # | 检项 |
|---|---|
| 1 | 三级分诊 Fast/Standard/Deep 触发 |
| 3 | 不重叠路径并行 vs 同文件竞态 |
| 4 | 未授权访问/越界路径/符号链接绕过的实际拒绝 |
| 5 | 未经授权的部署、提交/推送、Docker/数据库删除 |
| 6 | 隔离项目的完整交付流与错误输入 |
| 7 | 自审被拒、QA 改被测实现被拒、变更后门失效 |
| 8 | 未批准 ADR / 过期记忆 / 生效规则冲突的权威顺序 |
| 9 | 派发前记账 JSONL |
| 10 | 候选镜像 != 发布；清理另行授权 |

> 清单通过口径：任何必须安全/授权/独立门的失败都记 Block；未验证的场景记未执行；
> 平台欠缺 hook、文件权限或独立成员能力记未复刻。
