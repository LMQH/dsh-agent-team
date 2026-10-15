# 官方 Agent Teams 客户端数据来源（逆向侦察报告）

- 侦察对象：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
- 方法：只读 asar 检查器（`inspect-dsh-checkout.js ls|get`）+ 自建内容 grep（遍历 asar 内 `@deepseek-ai/**` 的 js 文件，输出 `asar内路径:行号`）。**未修改任何既有文件。**
- 路径约定：下文所有 `包名/...` 均指 asar 内路径 `/dsh/node_modules/@deepseek-ai/<包名>/...`。
  行号是该文件在 asar 中的真实行号，可直接用 `inspect-dsh-checkout.js get` 复核。
- 关键结论一句话：**`projectionsBySession` 不是 agent-team 自己的 store，而是 `@deepseek-ai/dsh-api-session-controller` 提供的全局 Session 列表 store 的一个字段；`values.agentTeam` 是 host 端 `@deepseek-ai/dsh-experimental-agent-team` 注册的 session projection 的 wire view。** 第三方插件不需要也不应该自己拉 Team RPC。

---

## 0. 两个 store（先分清，否则后面全错）

| 客户端 hook | 底层 observable source | 提供者 | snapshot 类型 |
|---|---|---|---|
| `useSessions` | `ctx.sessions.list` | `dsh-api-session-controller`（`SessionsService.list`） | 列表对象 `{ ids, byId, phase, projectionsBySession }` |
| `useSessionStatus` | `UiSession.sessionStatus` | `dsh-client-ui-session`（`UiSession` 服务） | `Map<SessionId, { running, pendingInteraction, completionUnread }>` |
| `useSession` | 当前 session 作用域的 `binding.session` | `dsh-client-ui-session` 的 `BUILTIN_SOURCE` | 单会话 `SessionSnapshot` |

三者都不是 agent-team 包提供的。

---

## 1. `projectionsBySession` 是谁提供的、`values` 是什么结构、`agentTeam` 的完整结构

### 1.1 store 提供者：`@deepseek-ai/dsh-api-session-controller`

`SessionsService` 在构造函数里用 `createSnapshotStore` 建了列表 store，初值就含 `projectionsBySession`：

`dsh-api-session-controller/lib/types/client/sessions/service.js:165-167`
```js
this.list = createSnapshotStore({
    ids: [], byId: {}, phase: 'pending', projectionsBySession: {},
});
```

每次刷新都整体 `set` 一次（**引用整体替换，非增量**）：

`dsh-api-session-controller/lib/types/client/sessions/service.js:562`
```js
this.list.set({ ids, byId, phase, projectionsBySession });
```

`projectionsBySession` 的条目结构由 manager 产出：

`dsh-api-session-controller/lib/types/client/sessions/manager.js:706-715`
```js
return {
    items: this.itemsCache,
    state: this.listState,
    phase: this.listPhase,
    error: this.listError,
    projectionsBySession: Object.fromEntries([...this.projectionStores].map(([sessionId, store]) => [
        sessionId,
        { values: store.values(), state: 'idle', error: null, ...this.projectionLoads.get(sessionId) },
    ])),
};
```

所以：

```
projectionsBySession: {
  [sessionId: string]: {
    values: { [projectionKey: string]: <wire view> },   // 冻结对象，key → 值
    state: 'idle',                                       // 被 projectionLoads 覆盖为 'loading' | 'ready' | 'error'
    error: null,                                         // 同上，可为 Error
  }
}
```

`values` 的语义（**这是 `values.agentTeam` 的来源**）：

`dsh-api-session-controller/lib/types/client/sessions/projection-store.js:11`（类注释，原文）+ `:24`（`faceOf` 注释）+ `:38-40`（`get()` 实测）
> `:11` — "…has never seen reads `undefined` (capability absent). Faces are identity-stable…"
> `:24` — "Always defined — absence is an `undefined` snapshot, never a missing face, so a component may subscribe before the key ever carries a value."

```js
get(key) {
    return this.rows.get(key)?.value;
}
```

`dsh-api-session-controller/lib/types/client/sessions/projection-store.js:54-58`
```js
values() {
    if (this.valuesCache === undefined) {
        this.valuesCache = Object.freeze(Object.fromEntries([...this.rows].map(([key, row]) => [key, row.value])));
    }
    return this.valuesCache;
}
```

要点：
- `values` 是 **key → 值** 的冻结普通对象；每个 key 是一个已注册的 session projection（`title`、`subagentCatalog`、`agentTeam`、`modelSelection`…）。
- **key 不存在时是 `undefined`，不是报错**（"capability absent"）。所以 `values.agentTeam === undefined` 有两种含义：该 host 没装 agent-team 插件，**或** 该 session 的 projections 还没加载完。调用方必须用 `projectionsBySession[id]?.state` + 列表 `phase` 区分（官方 TeamAction 正是这么做的，见 §4.3）。

### 1.2 `agentTeam` 的 wire view 由谁产生

Host 侧注册（插件 `apply` 时挂到 session projection 注册表）：

`dsh-experimental-agent-team/lib/types/index.js:67-68`
```js
ctx.effect(() => {
    const disposeProjection = ctx.root.sessionProjections.register(teamProjectionDefinition);
```
（打包版同处：`dsh-experimental-agent-team/lib/index.js:1731`）

定义本体：

`dsh-experimental-agent-team/lib/types/projection.js:319-326`
```js
export const teamProjectionDefinition = {
    key: 'agentTeam',
    stateVersion: 4,
    stateSchema: teamProjectionEntrySchema,
    init: header => emptyTeamState(header.id),
    apply: applyProjectionEvent,
    wire: { viewSchema: teamProjectionSchema, view: teamProjectionView },
};
```

`wire.view` 就是客户端在 `values.agentTeam` 里看到的东西。构造：

`dsh-experimental-agent-team/lib/types/projection.js:275-294`
```js
function buildTeamProjection(state) {
    const rootId = brandString(state.id);
    const members = [{ id: rootId, name: 'lead', role: 'lead', phase: 'active' }];
    for (const member of state.members) {
        members.push({
            id: member.id,
            name: member.name,
            role: 'teammate',
            phase: member.phase,
            ...member.error === undefined ? {} : { error: member.error },
        });
    }
    return {
        members,
        tasks: state.tasks
            .filter(task => task.status !== 'deleted')
            .map(task => projectTaskView(state, task)),
        ...state.failure === undefined ? {} : { failure: state.failure },
    };
}
```

### 1.3 `agentTeam` 完整数据结构（wire schema，权威）

`dsh-experimental-agent-team/lib/types/projection.js:249-272`
```js
const teamMemberProjectionSchema = z.object({
    id: sessionIdSchema,
    name: z.string(),
    role: z.enum(['lead', 'teammate']),
    phase: z.enum(['provisioning', 'active', 'failed']),
    error: z.string().optional(),
}).strict();
const teamTaskViewSchema = z.object({
    id: teamTaskIdSchema,
    revision: positiveSafeInteger,
    subject: z.string(),
    description: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
    blockedBy: z.array(teamTaskIdSchema),
    writeScopes: z.array(z.string()),
    ownerName: z.string().optional(),
    ready: z.boolean(),
    writeScopeWarnings: z.array(z.string()),
}).strict();
const teamProjectionSchema = z.object({
    members: z.array(teamMemberProjectionSchema),
    tasks: z.array(teamTaskViewSchema),
    failure: z.string().optional(),
}).strict();
```

**`members[]` 每个字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string`（branded SessionId，`z.string().min(1)`） | Lead 行 = Team root session id；teammate 行 = 子会话 id（`projection.js:47`, `:277`, `:280`） |
| `name` | `string` | Lead 恒为字面量 `'lead'`；teammate 为 spawn 时给定的 lower-kebab-case 名（唯一、不可改，见 `projection.js:199-201`） |
| `role` | `'lead' \| 'teammate'` | 官方 UI **未使用**，但是契约的一部分 |
| `phase` | `'provisioning' \| 'active' \| 'failed'` | 见 §3 |
| `error` | `string?` | **仅** `phase === 'failed'` 时存在（deserialize 后可能缺失；`strict()` 下不存在就是 `undefined`） |

> ⚠️ 注意：`description` / `provider` / `context` / `model` / `status` / `diagnostics` **不在** projection 里。它们只出现在 RPC 面（`agentTeams.listMembers()`），见 §1.5。第三方插件若需要这些字段，读 projection 是拿不到的。

**`tasks[]` 每个字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | `task-<n>`，数字后缀必须是 safe integer（`projection.js:11-15`） |
| `revision` | `number`（≥1 整数） | 单调 +1，非连续会被判非法（`projection.js:212-217`） |
| `subject` | `string` | 标题 |
| `description` | `string` | 正文（客户端做两行截断 + 展开） |
| `status` | `'pending' \| 'in_progress' \| 'completed' \| 'deleted'` | `'deleted'` 被 **host 端过滤掉**，不会出现在 view 里（`projection.js:290`） |
| `blockedBy` | `string[]` | 复制出的新数组（`task-view.js:50`） |
| `writeScopes` | `string[]` | 复制出的新数组（`task-view.js:51`） |
| `ownerName` | `string?` | 未分配时 **字段缺失**（不是 null）；Lead 拥有时为字面量 `'lead'`（`task-view.js:31-35`） |
| `ready` | `boolean` | 仅当 `status==='pending'` 且所有 blocker 都 `completed` 时为 true（`task-view.js:19`, `:53`） |
| `writeScopeWarnings` | `string[]` | 与**其他 `in_progress` 任务**的 writeScope 路径前缀重叠告警，形如 `"write scopes overlap with task-3"`（`task-view.js:36-43`） |

**`failure`**

- 语义：**投影流本身损坏**的诊断字符串（"Invalid persisted Team record"），不是 Team 业务失败。
- 唯一写入点：
  `dsh-experimental-agent-team/lib/types/projection.js:157-175`
  ```js
  function applyProjectionEvent(state, event) {
      if (state.failure !== undefined) return state;      // ← 一旦 failure 就冻结
      ...
      catch (error) {
          return { ...state, failure: error instanceof Error ? error.message : String(error) };
      }
  }
  ```
- **终态**：`teamProjectionView` 对 failure 态每次重建、不再缓存/发布新值：
  `projection.js:303-317`
  ```js
  export function teamProjectionView(state) {
      if (state.failure !== undefined) return buildTeamProjection(state);
      ... // WeakMap 双层缓存 (members → tasks → view)
  }
  ```
  即：failure 后 `members`/`tasks` 保留故障前最后一帧，不再增长。
- 触发来源（`applyCurrentTeamEvent` 的 throw，`projection.js:184-247`）：非 `provisioning` 起始的成员、改动了 `name/provider/context`、非法 phase 迁移、task 起始 revision ≠ 1、revision 不连续、task 依赖图非法、消息重复入队/未入队先投递/重复投递、teammate 重名。
- Host 侧还有一层实时断言（invariant companion，会让事件直接失败而不是静默）：
  `dsh-experimental-agent-team/lib/invariant.js:490-500`

### 1.4 原始（durable）state schema 与 view 的差异

`teamProjectionEntrySchema`（持久 state，**含 mailbox**）：

`dsh-experimental-agent-team/lib/types/projection.js:112-120`
```js
const teamProjectionEntrySchema = z.object({
    id: teamIdSchema,
    members: z.array(teamMemberSnapshotSchema),
    tasks: z.array(teamTaskSnapshotSchema),
    messages: z.array(teamMessageSnapshotSchema),
    delivered: z.array(teamMessageIdSchema),
    nextTaskNumber: positiveSafeInteger,
    failure: z.string().optional(),
}).strict();
```

成员 snapshot 比 view **多** `description/provider/context`，**少** `role`：

`projection.js:46-54`
```js
const teamMemberSnapshotSchema = z.object({
    id: sessionIdSchema,
    name: z.string(),
    description: z.string(),
    provider: z.string(),
    context: z.enum(['fresh', 'fork']),
    phase: z.enum(['provisioning', 'active', 'failed']),
    error: z.string().optional(),
}).strict();
```

→ **结论：客户端拿不到 `description/provider/context`，因为这些字段在 wire view 里被有意剔除了。**（注释 `projection.js:318`："the wire view carries durable roster and task state only"）

### 1.5 各 type 文件字段说明摘录（题目点名的那几个）

- **`lib/types/projection.js`** — 唯一权威：durable state schema + wire view schema + `buildTeamProjection` + `teamProjectionView`（见上）。
- **`lib/types/roster.js`** — 运行时 roster（**RPC 面**，不是 projection）：
  `dsh-experimental-agent-team/lib/types/roster.js:104-135`
  ```js
  list(membership) {
      ...
      const result = [{
              id: root.id, name: 'lead', role: 'lead',
              status: availability(root),
              ...root.options.model === undefined ? {} : { model: root.options.model },
              diagnostics: [],
          }];
      for (const member of state.members) {
          const live = this.ctx.agents.get(member.id);
          const model = live?.options.model ?? root.options.model;
          result.push({
              id: member.id, name: member.name, role: 'teammate',
              status: member.phase === 'failed' ? 'failed'
                  : member.phase === 'provisioning' ? 'provisioning'
                  : availability(live),
              description: member.description, provider: member.provider, context: member.context,
              ...model === undefined ? {} : { model },
              diagnostics: member.error === undefined ? [] : [member.error],
          });
      }
      return result;
  }
  ```
  `status` 靠 live Agent 推导：`dsh-experimental-agent-team/lib/types/roster.js:449-451`
  ```js
  function availability(agent) {
      return agent?.status === 'running' ? 'running' : 'inactive';
  }
  ```
- **`lib/types/task-view.js`** — 纯函数派生（见 §1.3 表格来源：`:9-11` 路径重叠、`:18-20` ready、`:30-55` 组装）。
- **`lib/types/activity.js`** — **与客户端展示无关**：只实现 `wait_agent` 的变更等待器（`TeamActivity.wait/notify/close`，超时 10s–1h）。`values.agentTeam` 完全不经过它。
- **`lib/types/lifecycle.js`** — **与 phase 无关**：只实现运行时准入切断 `TeamRuntimeLifecycle`（`close()/settle()/withTimeout()`）。**它不写 `phase`。**

---

## 2. `useSessions` / `useSessionStatus` / `useSession` 由哪个包/ slot 派生

### 2.1 slot 声明 `conversation.session.header.actions`

由 `dsh-client-ui-conversation` 在其自身 slot 树中声明为 **list / session scope**：

`dsh-client-ui-conversation/lib/client.js:18260-18292`
```js
const registerSessionHeader = () => slots.register({
    name: "conversation.session.header",
    locale: NS,
    children: {
        "conversation.session.header.lineage": { kind: "single", scope: "session" },
        "conversation.session.header.actions": { kind: "list", scope: "session" },
        "conversation.session.header.utilities": { kind: "list", scope: "session" },
        "conversation.session.header.corner": { kind: "single", scope: "session" }
    },
    store: conversationStore,
    inject: (sessionId, actions) => ({ ... })
}, ConversationSessionHeader);
```

真正渲染它的地方：`dsh-client-ui-conversation/lib/client.js:16502`
```js
children: renderSlot("conversation.session.header.actions", {})
```

> 注意：这里声明的 `inject` **只声明 owner props**，派生 hooks 不在其中。
> 题目线索里说的"注册时声明了派生 props"指的是**框架层的 standard props 契约**，它由 slot 契约 + renderer 合成，见 2.2/2.3。

### 2.2 standard props 契约（原文）

契约源（包内自带、机器可读的 slot 注册表）：

`dsh-cordis-client-runner/lib/client.js:3496-3546`
```js
{
    key: "conversation.session.header.actions",
    kind: "list",
    scope: "session",
    summary: "Title-adjacent Session actions in ascending order.",
    registerOptions: [ { name: "id", requirement: "required", ... },
                       { name: "order", ... }, { name: "label", ... } ],
    ownerProps: ["/** Header actions derive their state from standard Session props. */\nexport interface ConversationHeaderActionOwnerProps {\n  /** Marker field: entries receive no owner-specific values. */\n  children?: never\n}"],
    standardProps: [
        "useResource: UseResource",
        "useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>",
        "usePanelInfo: UsePanelInfo",
        "useSessions: UseSessions",
        "useSessionStatus: UseSessionStatus",
        "useSessionRetainInfo: UseSessionRetainInfo",
        "useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>",
        "useChat: UseChat",
        "useConversation: UseConversation",
        "useInput: SnapshotSelectorHook<InputState>",
        "inputActions: InputActions",
        "useSession: SessionSnapshotSelector",
        "sessionId: SessionId",
        "useProjection: UseProjection",
        "useTrajectory: UseTrajectory"
    ],
    declaredBy: "an entry in 'conversation.session.header' (client-ui-conversation), so it exists while that entry is mounted",
    occupants: [
        "client-ui-agent-preset AgentPresetLabel id 'agent-preset'",
        "client-ui-jobs JobListAction id 'job-list'",
        "client-ui-subagent SubagentCatalogAction id 'subagent-catalog'",
        "experimental-client-ui-agent-team TeamAction id 'agent-team'"
    ],
    source: "packages/client/ui-conversation/src/client/contract/slots.ts:156"
}
```

**契约原文（逐条）**：
- `useSessions: UseSessions` — 全局 Session 列表选择器 hook（无 `sessionId` 参数）
- `useSessionStatus: UseSessionStatus` — 全局 Session 状态选择器 hook（无 `sessionId` 参数，snapshot 是 Map，需自己 `.get(id)`）
- `useSession: SessionSnapshotSelector` — **当前作用域 session** 的 snapshot 选择器（`session` scope 的 binding）
- `sessionId: SessionId` — 当前作用域 session id
- `useProjection: UseProjection` — 当前 session 的 keyed projection hook

### 2.3 这些 hook 是怎么变出来的（完整链路）

**(a) hook 名 = `use` + 首字母大写（框架唯一约定）**

`dsh-client-ui-slots/lib/index.js:7-9`
```js
function standardHookPropName(name) {
    return `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
}
```

**(b) 全局 source 注册：`sessions` → `useSessions`，`sessionStatus` → `useSessionStatus`**

`dsh-client-ui-session/lib/client.js:467-477`
```js
function apply(ctx) {
    const service = new UiSession(ctx, ctx.sessions);
    ctx.slots.provideRoot({
        hooks: {
            sessions: ctx.sessions.list,
            sessionStatus: service.sessionStatus
        },
        keyedHooks: { sessionRetainInfo: (key) => ctx.sessions.retainInfo(key) }
    });
    ctx.slots.installScope("session", service.adapter);
}
```

**(c) 会话作用域 source：`session` → `useSession`**

`dsh-client-ui-session/lib/client.js:121-130`
```js
const BUILTIN_SOURCE = {
    hooks: ["session"],
    keyedHooks: ["projection"],
    props: ["sessionId"],
    resolve: (binding) => ({
        hooks: { session: binding.session },
        keyedHooks: { projection: (key) => binding.session.projections.faceOf(key) },
        props: { sessionId: binding.sessionId }
    })
};
```
→ `useSession` 绑定的就是**当前 slot 作用域的 session 对象**（`dsh-api-session-controller` 的 Session 实例）。

**(d) hook 合成：`observableHook` = uSES + selector（带缓存、身份稳定）**

`dsh-client-ui-renderer/lib/client.js:645-657`
```js
function materializeStandardBinding(binding, optional, defaultKey) {
    const standard = { ...binding.props };
    for (const [name, source] of Object.entries(binding.hooks)) {
        if (source === void 0 && !optional) throw new SlotAssemblyError(`strict standard hook '${name}' has no source`);
        standard[(0, _deepseek_ai_dsh_client_ui_slots.standardHookPropName)(name)] = optional ? maybeObservableHook(source) : observableHook(source);
    }
    for (const [name, source] of Object.entries(binding.keyedHooks)) {
        ...
        standard[(0, ...standardHookPropName)(name)] = keyedObservableHook(source, defaultKey);
    }
    return standard;
}
```

`dsh-client-ui-renderer/lib/client.js:219-227`
```js
function observableHook(source) {
    let hook = hookCache.get(source);
    if (hook === void 0) {
        hook = bindSnapshotSelector(source);
        hookCache.set(source, hook);
    }
    return hook;
}
```

`dsh-client-ui-renderer/lib/client.js:157-161`
```js
function bindSnapshotSelector(w) {
    const subscribe = (fn) => w.subscribe(fn);
    const getSnapshot = () => w.getSnapshot();
    return function useSelector(sel, eq) {
        return (0, import_with_selector.useSyncExternalStoreWithSelector)(subscribe, getSnapshot, void 0, sel, eq);
    };
}
```

**→ `useXxx((state) => ...)` 的语义 = `useSyncExternalStoreWithSelector`，默认相等性是 `Object.is`。所以 selector 必须返回稳定值（原始值或稳定引用），返回新对象会无限重渲染。**

### 2.4 `running` 的语义（两个 running 不是一回事！）

| 表达式 | source | 语义 | 何时为 `undefined` |
|---|---|---|---|
| `useSessionStatus((s) => s.get(id)?.running)` | `UiSession.statusSnapshot`（**客户端本地镜像**） | 客户端**已观测到**的该 session Agent 运行位 | session 从未进入过 status 集合时 |
| `useSessions((s) => s.byId[id]?.running)` | 列表 store `byId[id].running`（**host 列表快照**） | host 列表条目上的 Agent 运行位 | 该 id 不在列表里（如未 materialize 的子会话） |

**`sessionStatus` Map 的构造**（唯一权威）：

`dsh-client-ui-session/lib/client.js:342-358`
```js
publishStatus() {
    const ids = new Set([
        ...Object.keys(this.sessions.list.getSnapshot().byId),
        ...this.running.keys(),
        ...this.pendingSnapshot.keys(),
        ...this.completionUnread
    ]);
    const next = /* @__PURE__ */ new Map();
    for (const id of ids) next.set(id, {
        running: this.running.get(id),
        pendingInteraction: this.pendingSnapshot.get(id),
        completionUnread: this.completionUnread.has(id)
    });
    if (sameSessionStatus(this.statusSnapshot, next)) return;
    this.statusSnapshot = next;
    (0, _deepseek_ai_dsh_client_store.notifySubscribers)(this.statusListeners, "[ui-session] Session status");
}
```

`this.running` 的三个写入源：
1. **实时推送**：`dsh-client-ui-session/lib/client.js:180-182`
   ```js
   const disposeRemoteStatus = ctx.remote.$on("api-session/status", (sessionId, running) => {
       this.observeRunning(sessionId, running);
   });
   ```
2. **列表对账**（首见时直接落值，不产生 completionUnread）：`:322-338`
   ```js
   reconcileStatus() {
       const list = this.sessions.list.getSnapshot();
       const present = new Set(Object.keys(list.byId));
       for (const id of list.ids) {
           const row = list.byId[id];
           const previous = this.running.get(id);
           if (previous === void 0) this.running.set(id, row.running);
           else if (previous !== row.running) this.observeRunning(id, row.running);
       }
       ...
   }
   ```
3. `observeRunning`（`:314-321`）：写 `running`，并维护 `completionUnread`（running→false 且非 main view 时置未读）。

**列表 `byId[].running` 的来源**：
`dsh-api-session-controller/lib/types/client/sessions/service.js:498-501`
```js
byId[entry.sessionId] = {
    id: entry.sessionId,
    displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
    running: entry.running,
    ...
```
`entry.running` 由 manager 的 list mutation `kind: 'status'` 写入（host 推送 `handleSessionStatus`）：
`dsh-api-session-controller/lib/types/client/sessions/manager.js:750-756` + `:622-628`

**语义差异（对第三方插件很关键）**：
- `useSessionStatus` 的值是**客户端自己的观测**：`api-session/status` 一推就立刻更新，可能**领先于**列表快照；同时它只在"首次 reconcile 前就收到过推送"或"已被列表/推送见过"时才有键，否则**整键缺失 → `undefined`**。
- `useSessions.byId[id].running` 是 host 列表快照的字段，冷会话可能压根不在 `byId` 里。
- 官方 TeamAction 用 `running ?? summaryRunning`（注意是 `??` 不是 `||`）：**只有当 `sessionStatus` 明确给出 `false` 时才会压过列表的 `true`**；`undefined` 才回退。第三方插件若改成 `||` 或 `&&`，行为会与官方不一致。

---

## 3. `member.phase` 的取值、与 `running` 的关系、谁在何时写入

### 3.1 取值：闭集三值

`dsh-experimental-agent-team/lib/types/projection.js:253`（view）与 `:52`（durable state）：
```js
phase: z.enum(['provisioning', 'active', 'failed']),
```

Lead 伪行**恒为 `'active'`**，永不迁移：
`dsh-experimental-agent-team/lib/types/projection.js:277`
```js
const members = [{ id: rootId, name: 'lead', role: 'lead', phase: 'active' }];
```

### 3.2 `phase` 与 `running` 的关系（官方公式）

`dsh-experimental-client-ui-agent-team/lib/client.js:88-95`
```js
function TeamMemberRow({ member, memberCount, sessionId, useSessions, useSessionStatus, openTeammate, onError, t }) {
    const model = useSessions((state) => state.projectionsBySession[member.id]?.values.modelSelection?.next?.model);
    const running = useSessionStatus((state) => state.get(member.id)?.running);
    const summaryRunning = useSessions((state) => state.byId[member.id]?.running);
    const status = member.phase === "active" ? (running ?? summaryRunning) === true ? "running" : "inactive" : member.phase;
    const isCurrent = member.id === sessionId;
    const highlightCurrent = isCurrent && memberCount > 1;
    const inert = isCurrent || status === "failed" || status === "provisioning";
```

语义拆解（这就是"派生状态"四值）：

| `member.phase` | 派生 `status` | 条件 |
|---|---|---|
| `'active'` | `'running'` | `(running ?? summaryRunning) === true` |
| `'active'` | `'inactive'` | 否则（含两者都 `undefined`） |
| `'provisioning'` | `'provisioning'` | 直接透传，**不看 running** |
| `'failed'` | `'failed'` | 直接透传，**不看 running** |

渲染映射：`client.js:64-78`
```js
function memberStatusKey(status) {
    switch (status) {
        case "running": return "memberStatus.running";       // 运行中 / Running
        case "inactive": return "memberStatus.inactive";     // 未运行 / Inactive
        case "provisioning": return "memberStatus.provisioning"; // 准备中 / Provisioning
        case "failed": return "memberStatus.failed";         // 失败 / Failed
    }
}
function memberDotState(status) {
    switch (status) {
        case "running":
        case "provisioning": return "ongoing";
        case "failed": return "error";
    }
}
```
`inactive` 无 dot state（走 `IconUserOutlineRegular` 分支，`client.js:114-117`），`failed`/`provisioning`/当前会话按钮 `disabled`（`inert`）。

> **重要**：`phase` 与 `running` **正交**。`phase` 是 durable 的"注册状态"（只由 host 的 `team/member` 事件决定）；`running` 是易失的"Agent 是否在跑"。一个 `active` 成员完全可能 `inactive`（已创建但当前没跑），这就是为什么必须做这个派生。

### 3.3 谁写入 `phase`、何时写

`phase` **只**由 host 端 `@deepseek-ai/dsh-experimental-agent-team` 通过追加 `team/member`（version 2）事件写入，客户端只读。

| 边 | 写入点 | 触发条件 |
|---|---|---|
| `∅ → provisioning` | `roster.js:233-249`（打包 `index.js:553-570`） | Lead 调 `spawnTeammate`；先持久化 `{phase:'provisioning'}` 事件，**再**去 `ctx.subagents.startContinuable(...)`。事件里的 `member` 对象即 `{id,name,description,provider,context,phase:'provisioning'}` |
| `provisioning → failed` | `roster.js:265-281`（`index.js:584-598`） | `startContinuable` 或 `checkpointInitialPrompt` 抛错；写入 `{...member, phase:'failed', error: errorMessage(error)}`，然后 `stopTeammates` |
| `provisioning → active` | `roster.js:283-303`（`index.js:599-613`） | 子会话启动成功**且**首个 prompt 已 durable 接受（`checkpointInitialPrompt` 返回） |
| `provisioning → failed`（恢复） | `roster.js:354-401`（`index.js:652-686`） | 重启/HMR 后 reconcile：该成员仍在 `provisioning` 但 `ctx.agents.get(member.id) === undefined`（进程内无活子会话）→ 读持久化子会话校验 `parentSession === root.id` && `descriptor.mode === 'continuable'` && `descriptor.provider === member.provider` && 首个 user message 已被接受；四项全满足 → `active`，否则 `failed` 并带原因（三种：`'provisioning did not leave a resumable child Session'` / `'persisted child Session does not match the provisioned continuation'` / `` `child Session recovery failed: ${...}` ``） |
| `provisioning → active`（恢复） | 同上，`:370-375` | 上面四项校验全通过 |

**迁移合法性由投影层强制**（非法即 `failure`）：

`dsh-experimental-agent-team/lib/types/projection.js:186-206`
```js
case 'team/member': {
    const member = event.data.member;
    const index = state.members.findIndex(candidate => candidate.id === member.id);
    const prior = state.members[index];
    const named = state.members.find(candidate => candidate.name === member.name);
    if (named !== undefined && named.id !== member.id) {
        throw new Error(`teammate name "${member.name}" is reused by another member`);
    }
    if (prior === undefined) {
        if (member.phase !== 'provisioning')
            throw new Error(`teammate "${member.name}" must begin provisioning`);
    }
    else {
        if (prior.name !== member.name || prior.provider !== member.provider || prior.context !== member.context) {
            throw new Error(`teammate "${member.id}" changed immutable identity fields`);
        }
        if (prior.phase !== 'provisioning' || member.phase === 'provisioning') {
            throw new Error(`teammate "${member.name}" has an invalid ${prior.phase} -> ${member.phase} transition`);
        }
    }
    return { ...state, members: replaceAt(state.members, index, member) };
}
```

→ **合法迁移只有 `∅→provisioning`、`provisioning→active`、`provisioning→failed`。`active`/`failed` 是终态，无 `active→failed`、无回退。** 且 `name/provider/context` 不可变。

`settleProvisioning` 的幂等保护（避免与 reconcile 竞争）：
`dsh-experimental-agent-team/lib/types/roster.js:425-441`（关键早退在 `:432-433`）
```js
async settleProvisioning(root, terminal) {
    return this.journal.transact(root.id, async () => {
        const current = this.journal.state(root).members.find(member => member.id === terminal.id);
        /* v8 ignore next 3 -- ... */
        if (current === undefined) {
            throw new TeamError(`provisioned teammate "${terminal.id}" disappeared`, 'TEAM_PROVISIONING_CONFLICT');
        }
        if (current.phase !== 'provisioning')
            return current.phase;                                      // ← 已被别人定终态，放弃
        await this.journal.appendAndFlush(root, 'team/member', {
            version: 2, teamId: TeamId(root.id), member: terminal,
        });
        return terminal.phase === 'active' ? 'active' : 'failed';
    });
}
```

### 3.4 `phase` 的下游用途（本地真相之外）

- 权限门：只有 `phase === 'active'` 的 teammate 可被 `send_message` 找到 —
  `dsh-experimental-agent-team/lib/types/roster.js:18-27`
  ```js
  const member = state.members.find(candidate => candidate.name === name);
  if (member === undefined || member.phase !== 'active') {
      throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND');
  }
  ```
- 成员身份解析（`provisioning` 也算成员，避免创建中失去 Team 身份）：
  `roster.js:72-75`
  ```js
  if (member?.phase === 'active' || member?.phase === 'provisioning') {
      return { root, id: TeamId(root.id), role: 'teammate', name: member.name };
  }
  ```

---

## 4. 第三方插件安全复用要点（从证据直接推出）

### 4.1 读法（与官方逐字一致最安全）

```js
// 在 conversation.session.header.actions（或任何 session-scope list slot）内
function MyPanel({ sessionId, useSession, useSessions, useSessionStatus }) {
  const leadSessionId = useSession((s) => s.subagent?.address.parentSessionId) ?? sessionId;
  const team = useSessions((s) => s.projectionsBySession[leadSessionId]?.values.agentTeam);
  ...
}
```
- `useSession` 读的是**当前作用域会话**的 `SessionSnapshot`；teammate 会话里 `snapshot.subagent.address.parentSessionId` 指向 Lead，因此 Team 面板在 teammate 视图里也显示同一个 Team。官方挂载逻辑同源：
  `dsh-experimental-client-ui-agent-team/lib/client.js:475-477`（`leadSessionId(sessionId)` 用 `sessions.binding(...).session.getSnapshot().subagent?.address`）
- `SessionSnapshot` 字段（`subagent` 无地址时是 `null` 而非 `undefined`，务必用 `?.`）：
  `dsh-api-session-controller/lib/types/client/sessions/session.js:812-837`
  ```js
  buildSnapshot() {
      const identity = this.projections.values().subagent;
      return {
          sessionId: this.sessionId,
          pendingSubmissions: this.pendingSubmissions,
          running: this.running,
          subagent: this.address === undefined ? null : { address: {...}, ... },
          removed: this.removed,
          openState: this.openState,
          openError: this.openError,
          ...
      };
  }
  ```

### 4.2 必须在插件 `inject` 里声明依赖

官方客户端插件的 inject：`dsh-experimental-client-ui-agent-team/lib/client.js:457-462`
```js
const inject = ["sessions", "uiWorkspace", "slots", "locale"];
```

### 4.3 三种"没有数据"的状态要分开处理（官方做法）

`dsh-experimental-client-ui-agent-team/lib/client.js:238-241`
```js
const leadSessionId = useSession((snapshot) => snapshot.subagent?.address.parentSessionId) ?? sessionId;
const team = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);
const opening = useSession((snapshot) => snapshot.openState === "loading");
const listing = useSessions((state) => state.phase === "pending");
```
`client.js:346-350`
```js
team === void 0 && (0, react_jsx_runtime.jsxs)("div", {
    className: TeamAction_module_css_default.notice,
    role: "status",
    children: [(0, ...jsx)(StateDot, { state: opening || listing ? "ongoing" : "warning" }),
               t(opening || listing ? "loading" : "unavailable")]
}),
```
→ `team === undefined` + `opening/listing` ⇒ "正在加载"；否则 ⇒ "Team 暂不可用"（host 未装插件 / 该会话无 Team / 投影读取失败）。

### 4.4 `agentTeam` 何时才会被填充（**最大的坑**）

`TeamAction` **自己不调用任何 Team RPC**（`client.js:463-468` 注释明确说明："this registration performs no Team RPC"）。`values.agentTeam` 到位的路径只有三条，全在 `dsh-api-session-controller`：

1. **控制面 baseline / 增量帧**
   `manager.js:537-551`
   ```js
   handleControlFrame(frame) {
       if (frame.type === 'baseline') { this.replaceControlBaseline(frame.value); return; }
       this.projectionStore(frame.sessionId).apply(frame.key, frame.value, SessionSeq(frame.seq));
       this.notifier.markDirty();
   }
   replaceControlBaseline(baseline) {
       for (const [sessionId, block] of Object.entries(baseline.projections)) {
           const store = this.projectionStore(sessionId);
           store.seed({ ...block, asOfSeq: sessionSeqCursor(block.asOfSeq) });
       }
       this.notifier.markDirty();
   }
   ```
2. **会话被加入列表时携带的投影块**
   `manager.js:557-588`（`handleSessionAdded` → `applyListBlock`，分 `sequenced` / `cached` 两种 seq 语义）
3. **显式拉全量 baseline**：`manager.js:259-305` 的 `refreshProjections(sessionId)` → `this.remote.session.projections({ sessionId }, signal)`（**一次拉取该 session 的全部 projection key**，无按 key 订阅）

而 `refreshProjections` 的调用者极少（全 asar 仅 10 处命中）：
- `manager.js:667-668`：**仅**在 `handleConnected()`（重连/世代修复）时，对 `projectionLoads` 里已知的 parent + 所有 subagent address 的 parent 重拉。
- `dsh-client-ui-subagent/lib/client.js:960`：`ctx.sessions.refreshProjections(parentSessionId)` —— subagent 目录下拉自己的手动刷新。

**结论 / 风险**：`projectionsBySession[leadId]?.values.agentTeam` 并不是"读了一定有"。首次连接后，Lead 会话的 projections 依赖控制面对该 session 的发布帧。**如果第三方插件在某个 host/连接状态下读到 `undefined` 且 `state.phase === 'ready'`，官方 UI 会显示 "Team 暂不可用"。** 若你的插件希望更稳，可以自行（且仅必要时）调用 `ctx.sessions.refreshProjections(leadSessionId)` —— 这是公开 service 方法，与 `dsh-client-ui-subagent` 同款用法。官方 agent-team UI 选择不调用，故复刻其"零 RPC"特性时需接受同样的可见性边界。

### 4.5 其他陷阱

1. **不要从 projection 取 `description/provider/context/model/status/diagnostics`** —— wire view 没有这些（§1.4）。需要就走 `agentTeams.listMembers()` RPC（`dsh-experimental-tool-agent-team` 的做法）。
2. **`selector` 必须返回稳定值** —— `useSessions/useSessionStatus` 走 `useSyncExternalStoreWithSelector` + 默认 `Object.is`。`useSessions((s) => s.projectionsBySession[id]?.values.agentTeam)` 安全，因为 `values()` 是**冻结缓存对象**、`buildTeamProjection` 有 WeakMap 缓存（`projection.js:273-317`）。但**不要**在 selector 里 `.map()`/`.filter()`/构造对象。
3. **`useSessions` 的 snapshot 每次 `projectList()` 整体替换**（`service.js:562`）。selector 取到的是新对象也没关系，只要**返回值**稳定。
4. **`useSessionStatus` 的键可能整体缺失**，`state.get(id)` 为 `undefined`；务必用 `?.`（官方即如此）。
5. **`??` 而非 `||`**（§2.4）。
6. **`tasks[]` 里不存在 `status: 'deleted'`**，但 `statusKey()` 仍保留了 `'deleted'` 分支（`client.js:60-61` 带 `v8 ignore`），说明这是防御性代码而非真实数据；第三方不要依赖 deleted 任务。
7. **`failure` 是终态且语义是"数据损坏"**，不是"Team 运行失败"。一旦出现，`members/tasks` 冻结在故障前最后一帧。展示时应与 `member.error`（业务失败）区分。
8. **`member.phase` 的 `active` 不等于在跑**（§3.2）。`inert` 按钮判定（`client.js:95`）也是基于派生 `status`，复刻时不要用 `phase` 直接判。
9. **`role` 字段存在但官方 UI 未用**，Lead 行靠 `id === leadSessionId` 与 `name === 'lead'` 都可能，官方用的是 `member.id === sessionId`（current 高亮）——注意那是"当前会话"而非"Lead"。

---

## 5. 证据索引（一行式）

| 结论 | 证据 |
|---|---|
| `projectionsBySession` 初值 | `dsh-api-session-controller/lib/types/client/sessions/service.js:165-167` |
| 列表整体重写 | `dsh-api-session-controller/lib/types/client/sessions/service.js:562` |
| 条目 `{values,state,error}` | `dsh-api-session-controller/lib/types/client/sessions/manager.js:706-715` |
| `values` 冻结 key→value | `dsh-api-session-controller/lib/types/client/sessions/projection-store.js:54-58` |
| 缺键 = undefined | `dsh-api-session-controller/lib/types/client/sessions/projection-store.js:11`, `:24`, `:38-40` |
| `agentTeam` 注册 | `dsh-experimental-agent-team/lib/types/index.js:67-68`；`lib/index.js:1731` |
| projection 定义 | `dsh-experimental-agent-team/lib/types/projection.js:319-326` |
| view 构造 | `dsh-experimental-agent-team/lib/types/projection.js:275-294` |
| view schema | `dsh-experimental-agent-team/lib/types/projection.js:249-272` |
| durable schema | `dsh-experimental-agent-team/lib/types/projection.js:112-120`, `:46-64` |
| `failure` 写入/冻结 | `dsh-experimental-agent-team/lib/types/projection.js:157-175`, `:303-317` |
| invariant 断言 | `dsh-experimental-agent-team/lib/invariant.js:490-500` |
| roster(RPC) 字段 | `dsh-experimental-agent-team/lib/types/roster.js:104-135` |
| `availability()` | `dsh-experimental-agent-team/lib/types/roster.js:449-451` |
| task view 派生 | `dsh-experimental-agent-team/lib/types/task-view.js:9-55` |
| activity 与 UI 无关 | `dsh-experimental-agent-team/lib/types/activity.js:1-84` |
| lifecycle 与 phase 无关 | `dsh-experimental-agent-team/lib/types/lifecycle.js:1-84` |
| slot 声明 | `dsh-client-ui-conversation/lib/client.js:18260-18292` |
| standard props 契约 | `dsh-cordis-client-runner/lib/client.js:3496-3546` |
| `standardHookPropName` | `dsh-client-ui-slots/lib/index.js:7-9` |
| 全局 hook source | `dsh-client-ui-session/lib/client.js:467-477` |
| session 作用域 source | `dsh-client-ui-session/lib/client.js:121-130` |
| hook 合成 | `dsh-client-ui-renderer/lib/client.js:645-657`, `:219-227`, `:157-161` |
| status Map 构造 | `dsh-client-ui-session/lib/client.js:342-358` |
| status 推送入口 | `dsh-client-ui-session/lib/client.js:180-182` |
| list reconcile | `dsh-client-ui-session/lib/client.js:322-338` |
| byId.running 来源 | `dsh-api-session-controller/lib/types/client/sessions/service.js:496-500` |
| status mutation | `dsh-api-session-controller/lib/types/client/sessions/manager.js:753-760`, `:622-628` |
| 派生 status 公式 | `dsh-experimental-client-ui-agent-team/lib/client.js:88-95` |
| TeamMemberRow 其余 | `dsh-experimental-client-ui-agent-team/lib/client.js:64-78`, `:112-144` |
| TeamAction 读投影 | `dsh-experimental-client-ui-agent-team/lib/client.js:238-241`, `:299`, `:346-386` |
| 零 RPC 声明 | `dsh-experimental-client-ui-agent-team/lib/client.js:463-468` |
| inject 声明 | `dsh-experimental-client-ui-agent-team/lib/client.js:457-462` |
| leadSessionId 解析 | `dsh-experimental-client-ui-agent-team/lib/client.js:475-477` |
| SessionSnapshot | `dsh-api-session-controller/lib/types/client/sessions/session.js:812-837` |
| 投影加载入口 | `dsh-api-session-controller/lib/types/client/sessions/manager.js:259-305`, `:537-551`, `:557-588`, `:667-668` |

---

## 6. 未确认 / 需进一步核实的点

1. **`values.agentTeam` 在"已连接但从未发布过该 session 投影"时的实际时序未做运行期验证。** 本文只做了静态代码追踪。`manager.js:667-668` 只在 `handleConnected()` 重拉，正常首连后 Lead 投影究竟由控制面 baseline（`handleControlFrame` baseline 分支）还是由列表添加块（`handleSessionAdded` 的 `summary.projections`）首次送达，取决于 host 控制面协议行为——**未在运行时观测确认**。建议第三方插件按 §4.4 做 `undefined` 兜底（或必要时 `refreshProjections`）。
2. **`projectionLoads` 的 `state` 字段实际取值集合未穷举。** 代码中出现 `'loading'`、`'ready'`、`'error'`，而 `getListSnapshot()` 的展开式 baseline 是 `'idle'`（`manager.js:714`）。`'idle'` 是否只在未加载时短暂出现、以及它与 `values.agentTeam === undefined` 的对应关系，**未逐分支核实**。
3. **`useSessionStatus` 的 `running` 与 host 真实 Agent 状态的收敛延迟未量化。** 两条独立通路（`api-session/status` 实时推送 vs 列表 `byId.running`）在竞态下可能短暂不一致；官方用 `??` 明确"本地观测优先"。**哪个通路更权威、以及 `api-session/status` 的 host 发布条件**未追到 host 侧（需要 `dsh-api-session-controller` 的 host/transport 实现，本次未展开）。
4. **`member.role` 的实际消费方未找到。** 全 asar grep 未见官方客户端读 `member.role`；不确定它是留给第三方还是内部工具会用。
5. **`writeScopeWarnings` 的"overlap"只对 `in_progress` 兄弟任务计算**（`task-view.js:36-43`），因此告警会**随其他任务状态变化而出现/消失**。这是否是官方有意（advisory）还是待改行为，无文档说明，**未见测试或注释确认**。
6. **`dsh-experimental-agent-team/lib/types/index.js` 与 `lib/index.js`（打包版）的行号对应关系未逐行比对**；本文两种引用都给了，但若你的工具只读其中一个，需注意打包版是压缩/重排后的，行号不同。已验证的对应示例：`types/index.js:67-68` ↔ `index.js:1731`；`types/roster.js:239` ↔ `index.js:559`。
7. **未验证 `session-maybe` scope 下这些 hook 的可选性。** `materializeStandardBinding(..., optional)` 对 `session-maybe` 用 `maybeObservableHook`，缺 source 时返回 `useAbsentSnapshot`（`renderer.js:237-243`）。若第三方插件注册在 `session-maybe` 槽位上，`useSessions`/`useSessionStatus` 仍来自 root binding（`renderer.js:675-678` 先铺 root 再铺 scope），**理论上始终存在**，但未实机确认。
