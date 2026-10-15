# 已退役：页头卡片（2026-10-14，第一版）

> **后续（同日晚些时候）**：本插件又做出了**第二版**卡片——但它是 `_tools/build-client.js`
> **从零生成**的（slot id `team-workflow` / locale ns `dsh-team-workflow` / CSS `_twf_`），
> 与本目录这一版**没有任何代码关系**。本目录保留的只是**事故档案**：它记录「抄官方 bundle、
> 只换内容不换身份」会导致什么，以及重做时必须满足哪些硬要求。
> **不要让 `copy-official-client.js` 参与第二版的生成流程。**

这个目录里的东西**不要再运行**。它们生成的是第一版「Agent 团队工作流」页头卡片，
而那张卡片与官方插件存在**结构性冲突**，已于 2026-10-14 整体移除。

产品决定：**UI 归官方**。插件只保留宿主半侧（`/team` 名册、`roles.json`、工作流规则），
成员列表与实时运行状态由官方 `智能体团队`
（`@deepseek-ai/dsh-experimental-agent-team-profile` → `ui-agent-team`）提供。

## 为什么必须移除（不是「撞车」，是让整个 GUI 起不来）

官方客户端 bundle 是逐字复制过来改内容的，改的时候只换了**文案与数据**，
没换**身份**。于是两个插件在同一浏览器里注册了同一套坐标：

| 坐标 | 官方 | 本插件（移除前） | 后果 |
|---|---|---|---|
| locale 命名空间 + 键 | `agent-team` + `{zh,en}` | 同 | `locale.register` **抛错**（无 priority、无 merge）——**这是实际会命中的第一处** |
| list slot id | `agent-team` @ `conversation.session.header.actions` | 同 | `SlotCore.register` 抛 `already has an entry with id "agent-team"`（**只有 ns 改名后才会轮到它**） |
| order / priority | `-20` / 0 | 同 | 同优先级无法靠 shadow 共存 |
| CSS class 前缀 | `_2tNPVa_` | 同 | 两个 `<style>` 互相覆盖，样式随加载顺序抖动 |

两个插件的 `apply` 顺序都是**先 `locale.register`、后 `slots.inject`**，所以第二个
apply 会在 locale 那行就炸：

```js
// @deepseek-ai/dsh-client-locale/lib/client.js:1387-1414
throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
```

而失败的后果比"少一张卡片"严重得多（`@deepseek-ai/dsh-client-modules` + Web 外壳 boot 审计）：

```js
// web 外壳 dist/assets/index-*.js —— 启动激活审计
if (o.length > 0) throw new Error(`web boot: ${String(o.length)} entries did not activate\n${o.join("\n")}`);
```

该审计在 `uiRenderer.mount()` **之前**执行，一抛就是：

- **整个 Web 客户端不挂载**，停在 boot 页 `Failed to load plugins`；
- 桌面端还会经 `dshDesktopBoot.failed` → IPC → `reportFatal(..., "web-boot")`，弹恢复对话框并写崩溃报告；
- 真实的底层异常（locale/slot 那两行）**既不在 console 也不在 boot 页**——浏览器合成里 cordis logger 只有一个
  1000 条内存环形缓冲、没有任何 exporter；console 只留下 `web boot: 1 entry did not activate` 与 `<包名>: failed`。
  这是排查体验上的第二个坑：**报错本身看不见**。

注意 `immediately` **不是**优先级、也不保证先 apply：全 asar 里它只有一个消费点
（外壳的 `prefetchImmediateTier()`，在建 entry 之前预取一次 bundle），浏览器侧
`ClientEntries.start()` 是 `Promise.all` 并发建 entry，谁先 apply 没有契约。
所以"谁炸"是不确定的，不要依赖它。**只改 slot 的 priority 修不好**——必须先换 locale ns，
而换 ns 之后真正需要处理的就只剩 slot 的 id/priority 了。

第二个问题：卡片的数据源被换成了静态 `workflowRoster()`（10 个角色写死、`phase: "active"`，
成员行 `disabled: true`），**根本没接 `useSessionStatus`**，所以就算它自己渲染出来，
也只能显示「角色清单」，永远不显示真实运行状态。

## 文件

| 文件 | 说明 |
|---|---|
| `client.removed-20261014.js` | 被移除的卡片产物，sha256 `dff7bc822c60be1a67f5a6c468b203eb6fbc1c200e2056f5d55b406a5e501f09`，32 KB。仅存档，保留 1 个版本即可删。 |
| `copy-official-client.js` | 生成器：抓官方 bundle → 打补丁 → 写 `dsh-team-plugin/client.js`。 |
| `inject-official-css.js` | 早期版本：抽官方样式表、换 class 前缀、注入占位符（`copy-official-client.js` 出现后已失效）。 |

## 如果将来确实要再做一张卡片

必须同时满足下面 6 条，缺一条就会重演今天的故障：

1. **自己的 locale ns**（第一条，也是最先炸的那条）：不能叫 `agent-team`（例：`team-workflow`）。
   `locale.register` 没有 priority、没有 merge，同 ns 同 locale 键必然抛错。
2. **自己的 slot id**：不能叫 `agent-team`（例：`team-workflow`）。
   注意 `order` ≠ `priority`：判重只看 **id + priority**（默认 0），`order` 只是同 priority 内的显示序。
   不同 priority 确实能让两个注册共存，但 `SlotCore` 每个 id 只渲染**最低 priority** 那一个——
   也就是说"共存"只是"不炸"，不会同时出现两个按钮。
3. **自己的 CSS 前缀**：不能沿用 `_2tNPVa_`，且 `<style>` 的 `data-plugin-css` 要唯一。
4. **接受"整页一起挂"的失败模式**：客户端 entry 的 `apply` 一抛，boot 审计就 throw，
   整个 Web GUI 不挂载。所以改完**必须真机重启验证一次**，不能只看 `/team` 之类的宿主侧证据。
5. **接实时状态**：数据源用 `useSessions((s) => s.projectionsBySession[leadSessionId]?.values.agentTeam)`
   （官方 `client.js` 里 `TeamAction` 就是这么读的）。成员运行状态有**两条正交通路**：
   `useSessionStatus`（客户端本地镜像，键可能整体缺失，务必 `?.`）与
   `useSessions.byId[id].running`（host 列表快照），官方写法是 `running ?? summaryRunning`（`??` 而非 `||`），
   再与 `phase` 组合：
   `member.phase === "active" ? ((running ?? summaryRunning) === true ? "running" : "inactive") : member.phase`。
   selector 走 `useSyncExternalStoreWithSelector` + `Object.is`，**不得在 selector 里 `.map()/.filter()/造对象`**。
6. **准备好降级路径**：`values.agentTeam` **不保证被填充**（官方 TeamAction 零 RPC，值只由控制面
   baseline / session-added 投影块 / `refreshProjections()` 全量拉取送达，后者正常只在重连时触发）。
   投影缺席时要退回静态角色名册并显式标注「未运行」，而不是显示空白。

改完必须先跑 `verify-acceptance.js`（已加入「无客户端 UI 冲突」检项 `6a–6d`），
再加一次**真机重启后的目视确认**。
