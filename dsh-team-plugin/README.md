# Agent 团队工作流 · DSH 插件

把资源包 **`OMP团队开发工作流-DeepSeekHarness复刻包-20261013`** 的团队工作流复刻到 DeepSeekHarness：
**10 个角色**、各自的职责与明确产物、能力边界（只读/可写）。

**无门控、无钩子、无授权校验** —— 派不派人、派谁、派几个，由主 Agent 自主判断。

**UI 分工**：页头只有一个入口位置，**官方优先、本插件让位**（宪法 C1）——

| 情形 | 页头显示 | 为什么 |
|---|---|---|
| 官方「智能体团队」插件**启用** | **只有官方那张卡片**；本插件不显示任何东西 | 两条注册记录占同一个槽位格子，DSH 按 `(priority ?? 0)` 升序取第一个 → 官方默认 0 胜出 |
| 官方插件**关闭** | 本插件的「Agent 团队工作流」卡片自动接管（补上官方原来的序位） | 官方缺席 → 本插件（priority 100）成为唯一胜出者 |

让位是**自动**的（用户 2026-10-14 裁决）：不需要每次去插件管理页手动关本插件，
也不需要运行时检测——靠的是 DSH 内置的槽位遮蔽语义。完整机制与实测数据见
[CONSTITUTION.md](CONSTITUTION.md) C1.1。

> **前提条件（2026-10-14 查明的根因，务必先看）**：官方「智能体团队」是一个 **profile bundle**
> （`@deepseek-ai/dsh-experimental-agent-team-profile`），它同时提供**官方卡片**与**派发工具**
> `spawn_teammate`，而且是**互斥**设计——启用它会 `disabled: true` 掉 `subagent` / `subagent_fork`。
> 所以这层没挂载时：页头只剩本插件（C1 的"官方缺席 → 接管"路径），而且
> **没有 `spawn_teammate` ⇒ 成员建不出来 ⇒ `agentTeam` 投影永远为空 ⇒ 任何卡片都无从显示运行状态**。
> 一条命令自检（只读）：`node _tools/check-agent-team-layer.js`
> （`dsh.profile.bundles` 的权威写入者是 GUI 插件管理器；本仓库的 `install.sh` 走同一条通路也写它）。

本插件的卡片以**官方客户端 bundle 为外壳**（样式表与 DOM 结构原样保留，只重命名前缀），
内容层换成自己的 10 角色名册；**身份层**（locale ns / CSS 前缀 / 模块 id）全部自有。
详见下文「它是怎么生成的」。

## 权威来源

| 内容 | 来源 |
|---|---|
| 10 个角色定义 | `sources/omp/agents/*.md`（front-matter + 正文） |
| 工作流规则（三级分诊、任务合同、工件链、独立门） | `01-现行工作流.md` |
| 复刻分层与约束 | `02-DeepSeekHarness复刻方案.md` |
| 缺口与悬空技能 | `03-来源与差距.md` |
| 验收口径 | `04-验收清单.md` |

**本插件不自行发明任何角色或规则。** 改角色要改资源包，然后重跑生成器。

## 架构：单一角色来源

```
资源包 sources/omp/agents/*.md（10 份权威定义）
        │  _tools/sync-roles-from-pack.js
        │  （解析 front-matter；自动判定悬空技能；比对可用技能目录）
        ▼
dsh-team-plugin/roles.json  ←── 唯一角色来源，不再有第二份角色表
        │
        ├─ index.js      宿主半侧：读 roles.json，注册 /team，落盘名册
        └─ ~/.dsh/AGENTS.md   工作流规则（_tools/sync-agents-md.js 生成）
```

## 10 个角色

| id | 名称 | 能力 | 产物 |
|---|---|---|---|
| `pm` | 产品经理 | 只读 | PRD 草稿 / 用户流 / 明确的非目标 / 优先级 / 验收标准 / 未决问题 |
| `architect` | 架构师 | 只读 | 可实施的技术方案 / 接口契约 / 所有权边界 / ADR 影响分析 |
| `backend` | 后端 | 可写 | 变更路径 / 验证证据 / 风险 / 所需的下一道门 |
| `frontend` | 前端 | 可写 | 变更路径 / 验证证据 / 风险 / 所需的下一道门 |
| `harness` | 智能体 | 可写 | 变更路径 / 被实际执行的行为 / 风险 / 所需的下一道门 |
| `devops` | 运维 | 可写 | 目标环境 / 不可变工件与 Docker 清单 / 回滚门 / 命令证据 / 风险 / 下一道门 |
| `qa` | 测试 | 可写 | 独立执行的测试证据 / 缺陷（复现、期望vs实际、revision、严重度、owner） |
| `code-review` | 代码审查 | 只读 | 发现项（严重度 / 路径与行 / 后果 / 修复建议） |
| `compliance` | 合规 | 只读 | 每条结论归类 pass / risk / block / needs-authorization + 证据 |
| `quota-control` | 资源财务 | 只读 | 事实 / 数据缺口 / 阈值突破 / 建议 |

**按需创建角色，不常驻。** 派发团队角色用官方「智能体团队」的 `spawn_teammate`
（需继承会话上下文时 `context: "fork"`，否则 `context: "fresh"`），续活用 `send_message`。
**不要用 `subagent` 派发团队角色**：官方团队面板的数据源 `agentTeam` 投影只收录
`spawn_teammate` 创建的成员，用 `subagent` 派发的子会话不进成员列表，成员运行状态就永远是空的。
本插件自己不声明任何团队成员工具——它们属于官方插件的能力面（详见
`dsh-team-workflow/evidence/tool-surface-2026-10-14.txt`）。

### 悬空技能（包中不存在，已移出自动加载）

- `frontend` → `react-page-implementation`
- `code-review` → `branch-diff-static-review`

资源包明确要求：**不得以空壳文件消除缺口，也不得静默加载**。生成器会自动检出并把它们
从 `autoloadSkills` 移入 `danglingSkills`；`/team` 会显式标红提示。

## 页头卡片：为什么必须自带身份

这里记的是一次真实故障，因为它决定了卡片**必须怎么造**。

**第一版（已退役）**：卡片外壳逐字取自官方
`@deepseek-ai/dsh-experimental-client-ui-agent-team` 的客户端 bundle，只换了文案与数据。
结果与官方结构性冲突——改的时候只换了内容、没换身份：

| 坐标 | 官方 | 第一版（退役） | 后果 |
|---|---|---|---|
| locale 命名空间 + 键 | `agent-team` + `{zh,en}` | 同 | `locale.register` **抛错**（无 priority / 无 merge）——实际命中的**第一处** |
| list slot id | `agent-team` @ `conversation.session.header.actions` | 同 | `SlotCore.register` 抛 `already has an entry with id "agent-team"`（只在 ns 改名后才会轮到） |
| order / priority | `-20` / 0 | 同 | 同优先级不能靠 shadow 共存 |
| CSS 类名前缀 | `_2tNPVa_` | 同 | 两个 `<style>` 互相覆盖，样式随加载顺序抖动 |

两个插件的 `apply` 都是**先 `locale.register`、后 `slots.inject`**，所以第二个 apply 先在 locale 那行炸：
`locale namespace "agent-team" already has locale "zh"`。

**后果比"少一张卡片"严重**（用户实测确认）：客户端 entry 的 `apply` 一抛，Web 外壳的启动激活审计就
`throw web boot: N entries did not activate`，而它在 `uiRenderer.mount()` **之前**执行 ——
**整个 Web 客户端不挂载**，停在 `Failed to load plugins`；桌面端还会弹恢复对话框并写崩溃报告。
更坑的是真实异常文本**既不在 console 也不在 boot 页**（浏览器合成的 cordis logger 只有 1000 条内存
环形缓冲、没有 exporter），console 里只剩 `<包名>: failed`。
另外 `immediately` **不是优先级、也不保证先 apply**（只是预取 tier，浏览器侧是 `Promise.all` 并发建 entry），
所以"谁炸"没有契约，**只改 slot 的 priority 也修不好**——必须先换 locale ns。

第二层问题：第一版的数据源被换成了静态 `workflowRoster()`（10 个角色写死、`phase: "active"`、
成员行 `disabled: true`），**根本没接 `useSessionStatus`**，所以哪怕它渲染出来也永远不显示真实运行状态。

**第二版（自研外观，已废弃）**：坐标干净了，但我自己另写了一套外观与 DOM——
每行三段文字的大卡片。用户反馈「改得面目全非，之前那套就挺好」。**教训**：坐标要自己的，
但**观感应当照搬官方**，不该顺手重新设计。

**第三版（自研外观，已废弃）**：坐标干净了，但我自己另写了一套外观与 DOM——
每行三段文字的大卡片。用户反馈「怎么改得面目全非的」。**教训**：外观应当照搬官方，不该顺手重新设计。

**第四版（当前）**：把四件事分开——

| 层 | 做法 |
|---|---|
| 让位层 | **同槽位遮蔽**（宪法 C1.1）：slot id 与 order 与官方相同，但 `priority: 100` 压过官方默认的 0 → 官方在场时本插件被 DSH 自动遮蔽；官方关闭时自动接管。注册语句外包 `try/catch` 兜底 |
| 视觉层 | **官方客户端 bundle 的样式表与 DOM 结构原样保留**（前缀重命名后 84 处、47 条规则全在）。面板、两列角色卡、状态点、小字、portal 定位、悬停展开、Esc 关闭、aria 全部是官方那套 |
| 身份层 | `locale ns` / `CSS 前缀` / `模块 id` 全部自有（这三项沿用官方会与第二个 apply 撞车） |
| 内容层 | 数据来源换成 `roles.json` 内联的 10 个角色，并与 `agentTeam` 投影的真实成员按「成员名 = 角色 id」对齐，显示**真实运行状态**（口径与官方一致：`useSessionStatus` 优先、`useSessions.byId` 兜底、用 `??` 不用 `\|\|`）；行可点击进入成员会话详情（`openTeammate`，官方同一入口）；**角色行只有五项**（状态点 + 中文名 + 角色 id Tag + 状态词 + 职责，C5.1），悬停提示固定「打开成员会话」；任务板透传官方投影的 `tasks`/`failure`；面板顶部是**状态卡片**并带「打开插件管理」按钮（C20.3）；产物/边界/能力/悬空技能挂在插件管理页的详情区块（C20.2） |

| 坐标 | 本插件 | 官方 | 说明 |
|---|---|---|---|
| slot id | `agent-team`（**与官方相同，有意为之**） | `agent-team` | 遮蔽要求同一个「格子」 |
| order | `-20`（同官方） | `-20` | 官方缺席时正好补上它原来的位置 |
| **priority** | **100** | 默认 `0` | 谁小谁胜出 → 官方优先 |
| locale ns | `dsh-team-workflow` | `agent-team` | **同值会抛错**（namespace 冲突） |
| CSS 前缀 | `_twf_` | 它自己的哈希前缀 | 同值会污染官方样式 |
| 模块 id | `@local/dsh-team-workflow` | 官方包名 | 不得冒充官方 |
| 服务 inject | `sessions`/`uiWorkspace`/`slots`/`locale`（与官方相同——外壳要用到，且官方插件已证明这几个服务在本应用里都可用） | 同 |

`_tools/build-client.js` 通过**逐条断言"锚点命中恰好一次"**的精确锚点补丁从官方 bundle 生成产物：任一锚点对不上就报错退出
（官方升级后立刻发现，而不是静默出错）；落盘前再硬断言官方 CSS 前缀与包名 **0 处**、
官方 slot id **恰好 1 处**（只作为遮蔽用的只读常量）、自有坐标齐全、`priority` 与 `try/catch` 在位。
角色表在生成期内联自 `roles.json`（10 个角色，运行时零 RPC、零文件读取）。

- 回归门：`verify-acceptance.js` 的 `6a–6j`——声明完整性 / 官方标识计数与自有坐标 /
  生成器幂等 / **把真实产物在真实 `SlotCore` 上跑一遍遮蔽语义**（官方在场仅官方胜出、
  官方缺席本插件接管、加载顺序无关、同 priority 仍抛错，再模拟"官方同 priority 占位"验证
  `apply` **行为上**不抛错）/ CSS 选择器合法性 / **渲染冒烟**（10 行名册、每行恰为五项、
  悬停文案固定「打开成员会话」、可点击行真的调用 `openTeammate(sessionId, 成员会话 id)`、
  未派发行必须禁用、「配置」按钮打开**自有弹窗**且不跳官方页、任务板透传 `tasks`/`failure`、
  class 与 CSS 对齐、位置兜底）/ **插件管理页**（locale meta 一句话、`plugins.detail.section`
  只对本包 subject 渲染且承载 10 角色与悬空技能、弹窗内次级链接走 `openBundle`、
  服务缺席时 `selectPanel("plugins")` 降级）/
  **自有配置弹窗**（六字段齐全、值来自 `ctx.configForms` 快照并落回 C21.2 默认值、
  保存走到官方作用域的 `mutate`、服务抛错或缺席时降级为"不可写"且不抛异常、
  展示层三字段**行为上**生效）/ **宿主半配置**（真 import 宿主模块：`Config` 六字段全部
  `.volatile()` 且默认值 = 改动前行为、`/team` 输出真的随配置变化、`configure({ auto: false })`）。
- 反证已做（改生成器/宿主半 → 重新生成 → 跑门，宪法 C14 要求）：**21/21 个变异精确命中预期门**，
  逐条列在 `CONSTITUTION.md` 的"反证记录"表里。

### 第二次实测反馈修掉的两个 bug（用户报「样式完全不对、展不开、点不了」）

卡片确实挂载上了（boot 没崩），但**21 条 CSS 规则全部无效**：

| # | 根因 | 表现 | 现在怎么防 |
|---|---|---|---|
| 1 | CSS 写成 `${CSS_PREFIX}root{...}` → 产物是 `_twf_root{...}`，那是**元素选择器**（去找 `<_twf_root>` 标签），不是类选择器。官方是 `._2tNPVa_root`，我漏的就是那个前导点 | 面板丢掉 `position:fixed`（`useAnchoredPosition` 算出的 `left/top` 全废）、丢掉 `z-index` 与背景；还量不到尺寸 → 一直停在 `visibility:hidden` 兜底态。就是"样式全错 + 展不开" | 生成器改用 `S()` 包装类名（点落在调用处）；门 `6e` 逐条校验选择器，门 `6f` 再交叉校验"渲染树里每个 class 都有对应 CSS 规则" |
| 2 | 面板是 `createPortal` 到 `document.body` 的、**不在 `rootRef` 里**，但我只给 root 接了 `onMouseLeave`，没给面板接 `onMouseEnter/onMouseLeave` | 鼠标从按钮移向面板时先触发 root 的 `onMouseLeave` → 面板被关掉，表现为"点不开 / 闪一下就没" | 门 `6f` 直接断言面板元素上必须有这两个 handler |

两个 bug 各自都有**独立**反证：删掉 CSS 前导点 → `6e` 报 25 条非法选择器，`6f` 同时报
17 个 class 无规则；删掉面板的悬停接线 → `6f` 精确报「面板缺 onMouseEnter/onMouseLeave」。
- 第一版的产物与生成器仍在 `dsh-team-workflow/_tools/retired/`（含「重做必须满足 6 条」的记录），
  仅作事故档案，**不要运行**。

## 插件管理页与状态卡片（C20 第二次 UI 裁决；C20.3 已按第三次裁决改写）

| 用户要求 | 实现 |
|---|---|
| 每行只显示：状态点 + 角色中文名 + Tag 角色 id + 状态词 + 职责简述 | 角色行照此渲染（C5.1）；官方 `.member` 卡片的类名、尺寸、网格一律不动 |
| 悬停提示改成「打开成员会话」 | `Tooltip.label = t("open")`（官方原文），不可点的行与官方一样 `disabled` |
| 附加状态行保留，但要做成卡片/按钮样式 | 面板顶部 `_twf_statusCard`：图标 + 状态文案 + 「配置」按钮 |
| 插件管理页不要全杂糅到一起 | locale `meta.description` 收敛为一句话；结构化内容（10 角色的职责/产物/边界/能力、悬空技能）挂到 `plugins.detail.section` 区块（C20.1 / C20.2） |
| 不要把我送到官方插件管理页 | 「配置」按钮打开**本插件自己的配置弹窗**（C21）；官方入口降级为弹窗里的次级链接「在插件管理页中查看」（C20.3 改写） |
| 共享任务板借鉴官方设计 | `workflowRoster()` 透传投影里的 `tasks` 与 `failure`，官方任务卡与失败横幅原样渲染，空态用官方原文（C20.4） |

**诚实边界**：平台**没有**"打开某个插件自己的配置弹窗"的 API，也**没有**"打开插件管理弹窗"的
API——插件管理器是一个**侧栏面板**（`PANEL_ID = "plugins"`），官方给其他 Client 插件的公开入口只有
`ctx.pluginNavigation.openBundle(packageName)`（切到该面板并直达组合包详情页）。
所以"我自己的配置界面"必须**自己渲染**：本插件用官方 `Modal` + `SettingsForm` 原语做弹窗（C21），
观感与官方设置页一致；官方管理器入口只作为弹窗内的次级链接保留，
缺席时降级为 `ctx.layout.selectPanel("plugins")`，两者都没有则静默无操作。
插件导航服务用 `ctx.reflect.get` 懒取、不写进 `inject`：官方管理器缺席时本插件仍要能激活。

## 配置界面（C21，用户 2026-10-14 第三次裁决）

卡片面板顶部的**「配置」按钮**打开本插件自己的弹窗（官方 `Modal` + `SettingsForm` + `Switch`
原语，观感与官方设置页一致）。弹窗里只有下面六项，**没有第七个口子**：

| 字段 | 类型 | 默认值（= 改动前的行为） | 作用 |
|---|---|---|---|
| `disabledRoles` | 角色 id 列表（逗号/空格分隔） | `[]` | 从 `/team` 名册与简报里排除这些角色，并显式报告"已按配置停用" |
| `autoloadSkills` | 布尔 | `true` | 派发简报是否附技能清单；关掉时该行改成"已按配置关闭" |
| `routeGuard` | 布尔 | `true` | `/team route` 是否强制写明触发原因 |
| `showTaskBoard` | 布尔 | `true` | 卡片面板是否渲染共享任务板 |
| `hideUnassignedRoles` | 布尔 | `false` | 是否只显示已派发（有实时成员）的角色 |
| `forceCompactPanel` | 布尔 | `false` | 面板是否强制用官方紧凑宽度 |

**单一真源**：配置只有一份——宿主 `Config`（`@deepseek-ai/schemastery`，六个字段全部
`.volatile()`）。客户端不存 localStorage、不另开状态，读写都经官方设置服务的
`ctx.configForms.get("team-workflow")`：读 = 拿 scope 快照、缺省字段落回默认值；
写 = 走 scope 的 `mutate`（保存按钮 → 官方表单模型的 `save()`）。
`apply` 里用可选注入 `ctx.inject(["settings"], …)` 调 `settings.configure({ auto: false })`，
**关掉官方自动生成的设置表单**，避免两个入口写同一份配置。

**坐标契约**：客户端的 `configForms.get(...)` 用的键是 **profile 里的条目 id `team-workflow`**
（`~/.dsh/profiles/<profile>/cordis.yml` 里的条目 id）。**改包名、改条目 id 都会让配置弹窗读不到值**
（会降级成"不可写 + 默认值"，不报错）。

**降级**：官方设置服务抛错或缺席时，弹窗照常能开，但显示"不可写"、字段全部为默认值，
**不抛异常**（宿主半缺席也不影响插件激活）。

**依赖与安装**：宿主半自本版起依赖 `@deepseek-ai/schemastery`（官方设置服务读取配置 schema 的
唯一方式，用它的 `default()` / `.volatile()`）。因此安装走**官方 pnpm 通路**（见下节），
旧的符号链接装法已废弃。

**诚实边界**：`Config` 的六字段与默认值已在**装进 profile 后**用**真 schemastery** 解析验证
（`Config.toJSON()` 打印六字段 `type`/`default`/`volatile: true`）；`.volatile()` 的**热更新语义**
（改完不重启就生效）尚未在真实浏览器里端到端验过——本机只验到"宿主侧每次调用都重新读
`ctx.fiber.config`，因此纤维上的新值确实会被下一次 `/team` 用上"。弹窗在真实 GUI 里的目视外观
也待人工确认。

## 文件

```
dsh-team-plugin/
├── package.json        # dsh.bundle.patch + dsh.client(platform/inject) + icon + exports
├── index.js            # 宿主半侧：读 roles.json，/team 命令，名册落盘
├── client.js           # 客户端半侧：页头「角色」卡片（脚本生成，勿手改）
├── roles.json          # 10 个角色（脚本生成，勿手改）
├── cordis.patch.yml    # 组合包补丁层
├── ACCEPTANCE.md       # 验收报告（脚本生成）
├── locale/{zh,en}.json # 插件管理页卡片的标题与描述
├── icon.svg
├── install.sh / uninstall.sh

dsh-team-workflow/_tools/
├── inspect-dsh-checkout.js   # 只读 asar 检查器
├── sync-roles-from-pack.js   # 资源包 → roles.json
├── sync-agents-md.js         # roles.json → ~/.dsh/AGENTS.md
├── build-client.js           # roles.json → client.js（自有身份，生成期断言坐标）
├── verify-acceptance.js      # 按 04-验收清单 + 客户端坐标回归门自动核验
├── scan-client-slot-ownership.js # 全量扫描哪些插件占了哪些坐标
└── retired/                  # 第一版卡片与其生成器（事故档案，勿运行）
```

`client.js` 与 `roles.json` 都是**派生产物**：改角色改资源包 → 重跑 `sync-roles-from-pack.js`
→ 重跑 `build-client.js`。手改产物会被 `6c`（生成器幂等）抓住。

## 安装与重新生成

**只走官方通路**（C21.4；旧的符号链接装法已废弃）：

```bash
cd dsh-team-plugin && ./install.sh          # pnpm add file:<本目录> + 登记组合包 + 触发重载
```

`install.sh` 做的事：摘掉可能的旧符号链接 → `pnpm add file:<本目录>`（profile 的
`node_modules` 下装出**真实目录拷贝**，并把 `@deepseek-ai/schemastery` 提升到 profile 根）→
打印实机证据（装出来的文件清单 + 真 schemastery 解析出的六字段与默认值）→ 登记
`dsh.profile.bundles` → 「摘掉 → 触发 → 等 8 秒 → 挂回 → 触发」重新组合并等日志确认。
pnpm 用 DSH 运行时自带的那份（本机 `11.7.0`；可用 `DSH_NODE` / `DSH_PNPM` 覆盖）。

```bash
cd ../dsh-team-workflow
node _tools/sync-roles-from-pack.js         # 角色改动后（改的是资源包）
node _tools/build-client.js                 # roles.json → client.js
node _tools/sync-agents-md.js               # 工作流规则
node _tools/verify-acceptance.js            # 验收 + 客户端坐标回归门
node _tools/redcheck-second-ruling.mjs      # 反证（变异 → 重新生成 → 跑门）
```

> ⚠️ **装完之后，改工作区不再自动生效**（这是走官方通路的代价）。改动后必须：
> `node _tools/build-client.js` → `./install.sh` → **重启 DSH**（客户端产物变更，C15）。
> 卸载用 `./uninstall.sh`（`pnpm remove`，脚本不做 `rm -rf`）。

**改了 `dsh.client` / `client.js` 之后必须重启 DSH**（不是刷新）：`dsh-client-modules`
把「这个包是不是客户端包」的判定**按包名缓存到进程重启**，只重挂载不会让浏览器侧加载新产物。
同一 pid 内，客户端 bundle 也不会被重新 `import`。

生成器对每个锚点断言「命中恰好 1 次」：官方升级导致对不上会**立刻报错**，而不是静默出错。

## 对外交付（把插件给别人）

交付物三件（示例位置 `dist/dsh-team-workflow-0.3.0/`）：官方 tarball、自带依赖的解压目录、`交付说明.md`。重现命令：

```bash
D=<交付目录>
NODE=<dsh-runtime>/dependencies/node/bin/node
PNPM=<dsh-runtime>/dependencies/pnpm/bin/pnpm.mjs
cd dsh-team-plugin && "$NODE" "$PNPM" pack --pack-destination "$D"     # files 白名单：不含 _tools/install.sh
tar -xzf "$D"/local-dsh-team-workflow-0.3.0.tgz -C "$D"/dsh-team-workflow --strip-components=1
cd "$D"/dsh-team-workflow && "$NODE" "$PNPM" install --prod --config.node-linker=hoisted --config.auto-install-peers=false
```

**解压目录为什么必须自带 `node_modules`**（实测，非推断）：官方插件管理器对**本地目录** spec 生成的是
`link:` 依赖，pnpm **不安装它的依赖**，插件会以
`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'` 加载失败；
对 **tarball** spec 生成 `file:`，依赖会被正常安装。给别人的安装步骤、自检、卸载、限制见 `交付说明.md`。

## 加载器行为（实测，写脚本时必须知道）

| 现象 | 说明 |
|---|---|
| **按 id 去重** | 组件已存在且无变化时重复挂载**不会**重新 `apply`；"没看到新日志"≠"没生效" |
| **近距变更会合并** | `install.sh` 因此采用「摘掉 → 触发 → 等 8 秒 → 挂回 → 触发」 |
| **改 `dsh.client` 声明要重启** | `dsh-client-modules` 把「是否客户端包」的判定**按包名缓存到重启** |
| **插件模块被缓存到重启** | 同一 pid 内反复重挂载，`apply` 会重跑，但模块**不会重新 `import`**。**改 `index.js` 代码必须重启。** |
| **`roles.json` 走惰性读取** | `loadRoster()` 每次调用都重新读盘。**改角色数据只需重挂载，不必重启。** |
| **同 id 同 priority 的 list slot 会抛错** | 不是覆盖（`order` ≠ `priority`）。同 id 不同 priority：两条记录、**只有一个渲染**，按 `(priority ?? 0)` 升序取第一个——这正是本插件「让位」的实现方式（C1.1） |
| **同 ns 同 locale 键会抛错** | `locale.register` 没有 priority / merge，必须自带 ns |
| **客户端 entry 失败 = 整页失败** | boot 审计在 mount 之前 throw，整个 Web 客户端停在 `Failed to load plugins`；真实异常只进内存环形缓冲，console 看不到 |

## 验收状态

`ACCEPTANCE.md`：**自动核验 27/27 通过**，含资源包自身的 `shasum -a 256 -c sources/SHA256SUMS.txt`
（51 个文件，失败 0）、客户端坐标 / 渲染 / 配置弹窗回归门 `6a–6j`、规则层派发通路门 `7a–7b`。关键项：10 个角色 ID 与包
front-matter 逐一对上；只读/可写判定无矛盾；自动加载技能 24/24 可用；两个悬空技能被显式报告且未被静默加载；
配置六字段默认值 = 改动前行为。

反证：`redcheck-second-ruling.mjs` **21/21 个变异精确命中预期门**（第三轮新增 13 个：9 个客户端
——按钮改回直接跳官方页 / 弹窗不用官方 `Modal` / 弹窗不读作用域 / 保存不写回 / 三个展示层字段
各自不消费 / 弹窗不挂进卡片树 / 次级链接不调 `openBundle`；4 个宿主半——去 `.volatile()` /
`disabledRoles` 不消费 / `routeGuard=false` 不生效 / 不关官方自动表单）。

另有 **10 项如实标为「未执行」**（需人机交互：分诊触发、越界拒绝、授权拦截、门失效等），
按清单口径**不冒充通过**。浏览器里的最终目视确认也不在自动核验范围内——`6d` 只能证明
「在真实 `SlotCore` 上注册成功且与官方共存」，`6f`/`6i` 只能证明「渲染树与接线正确」，
都不能证明像素长得对，也不能证明弹窗在真实 GUI 里的观感。

## 非目标（明确不做）

- **不做门控**：不拦截工具调用、不做授权校验、不做路径沙箱
- **不做策略执行层**：资源包 `extension/index.ts` 的拦截器未按 DSH pre-tool hook 重写
- **不做记账钩子**：`agent-usage-ledger` 技能已安装，但未自动写台账
- **不占用官方身份**：卡片以官方 bundle 为**外壳**（观感照搬），但 locale ns / CSS 前缀 / 模块 id 全部自有；
  官方 slot id 只出现一次、只作为遮蔽用的只读常量。`retired/` 里那版（沿用官方坐标）是反面教材
- **不复制凭据/模型配置**：`model: "@team_*"` 只作角色映射
- **不迁移 Obsidian 个人库**：`hermes-obsidian` 技能的 vault 路径未接入
