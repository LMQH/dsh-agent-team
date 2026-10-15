---
name: react-best-practices
description: "React 19 工程化最佳实践 — 组件架构、状态管理、Server Components、性能优化、常见陷阱。"
whenToUse: 构建新的 React 应用或组件库、审查现有 React 代码、重构状态管理、优化性能瓶颈、调试 hydration 或渲染错误时使用。
metadata:
  hermes:
    tags: [react, typescript, frontend, best-practices, component-patterns, state-management]
    category: software-development
    related_skills:
      - gsd-ui-phase
      - gsd-sketch
      - design-taste-frontend
      - gsd-ui-review
      - requesting-code-review
      - code-sandbox-review
---

# React Best Practices — React 19 工程化指南

从 OpenClaw (@ivangdavila/react) 转换为 Hermes 格式。

生产级 React 19 工程实践：架构决策、状态管理、Server Components、性能优化、常见陷阱。

## 何时使用

- 构建新的 React 应用或组件库
- 审查现有 React 代码
- 重构状态管理逻辑
- 优化性能瓶颈
- 调试 hydration 问题或渲染错误

## 快速参考

| 场景 | 推荐方案 |
|------|---------|
| 数据来自 API | **TanStack Query** — 永远不要用 useState + useEffect 手动 fetch |
| UI 状态跨组件共享 | **Zustand slice**，通过 selector 读取 |
| 单组件内部状态 | **useState**，就近放置；第二个消费者出现时再提升 |
| 很少变化的全局值（主题、语言、auth） | **Context + useMemo**，分离 state 和 dispatch context |
| 带验证的表单 | **React Hook Form + Zod**（非受控：击键不触发重渲染）；服务端 mutation → useActionState |
| 过滤视图中输入延迟 | **useDeferredValue** 包裹接收的值；**startTransition** 包裹设置的状态 |
| 数千行列表 | **Virtualize** (tanstack-virtual) — 成本是 DOM 节点数，不是数据量 |
| 组件需要在身份变化时重置 | 改变 `key`：`<Profile key={userId} />` — 重新挂载比手动清理状态更好 |
| 多步骤流程/wizard | 一个**区分联合的 status 字段**，而不是一堆布尔值 |
| 崩溃导致整个应用空白 | **react-error-boundary** 每个路由和每个高风险功能 |
| 其他/不确定 | useState 就近，具名导出；第二个消费者出现时再提取 |

## 核心规则

### 1. 派生值规则

**永远不要在 useEffect 中计算派生值** — 直接在 render 中计算：

```tsx
// ❌ 错误：useEffect 派生
const [total, setTotal] = useState(0)
useEffect(() => {
  setTotal(items.reduce((sum, item) => sum + item.price, 0))
}, [items])

// ✅ 正确：render 中直接计算
const total = items.reduce((sum, item) => sum + item.price, 0)
```

### 2. 组件结构规则

```tsx
// ✅ 标准组件结构
export function UserCard({ user, onEdit }: UserCardProps) {
  // 1. Hooks 优先，无条件调用
  const [isOpen, setIsOpen] = useState(false)
  
  // 2. 派生值在 render 中计算 — 永远不要放在 effect 中
  const fullName = `${user.firstName} ${user.lastName}`
  
  // 3. 事件处理器
  const handleEdit = () => onEdit(user.id)
  
  // 4. Early returns 放在所有 hooks 之后
  if (!user.isVisible) return null
  
  // 5. JSX
  return (
    <div className="user-card">
      <h3>{fullName}</h3>
      <button onClick={handleEdit}>编辑</button>
    </div>
  )
}
```

**关键点**：
- 具名导出（`export function`），不要默认导出
- Early returns 必须在所有 hooks **之后** — 条件返回在 hook 之前会改变 hook 调用顺序导致崩溃
- 导出 props 接口：`export interface UserCardProps { ... }`

### 3. 状态管理决策树

```
数据来自 API？
├─ 是 → TanStack Query（不是 Redux，不是 Zustand，不是 Context）
└─ 否 → 跨组件共享？
    ├─ 是 → Zustand（经常变化）或 Context（很少变化）
    └─ 否 → useState
```

## 状态管理详解

### TanStack Query（服务器状态）

```tsx
// Query key 工厂 — 单一事实来源，避免 key 拼写错误
export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => [...userKeys.all, id] as const,
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => fetchUser(id),
    staleTime: 5 * 60 * 1000,
  })
}
```

**关键模式**：
- `invalidateQueries` — 突变后使缓存失效
- `setQueryData` — 乐观更新
- `placeholderData: keepPreviousData` — 切换页面时保持旧数据

### Zustand（客户端状态）

```tsx
// 每个关注点一个 store（ui、session、cart）— god-store 会退化成没有 devtools 的 Redux
export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))

// ✅ 通过 selector 读取 — 直接 useUIStore() 会在 EVERY store change 时重渲染
const isOpen = useUIStore((s) => s.sidebarOpen)

// ❌ selector 返回新鲜对象/数组 → v5 中无限重渲染
// 用 useShallow 包裹：
const { a, b } = useUIStore(useShallow((s) => ({ a: s.a, b: s.b })))
```

### Context（全局配置）

每个值变化都会重渲染每个消费者，没有 selector。必须 memoize 值对象：

```tsx
// ✅ 正确：memoize value
const value = useMemo(() => ({ user, login }), [user])
return <UserContext.Provider value={value}>{children}</UserContext.Provider>

// ❌ 错误：每次 parent render 都创建新对象， defeats the purpose
<UserContext.Provider value={{ user, login }}>{children}</UserContext.Provider>
```

**状态 + 更新器分离**：分成两个 contexts，这样只有 set 的消费者永远不会重渲染。

## React 19 新特性

### Server Components（RSC）

```tsx
// Server Component（App Router 中默认）— 零 JS 发送
async function ProductList() {
  const products = await db.products.findMany()
  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} /> {/* server */}
          <AddToCartButton id={p.id} /> {/* client leaf */}
        </li>
      ))}
    </ul>
  )
}
```

**关键规则**：
- Server Component 不能直接传递 `onX` handlers 给 Client Component
- 用 `children` 模式或 Server Actions
- `use(promise)` 在客户端解析 promise

### Hooks & API 变更

```tsx
// ✅ use() 在 render 中解析 promise — suspends 直到 resolve
const comments = use(commentsPromise)

// ❌ 不能在 render 中调用 promise（会触发 warning）
// const comments = await commentsPromise

// ✅ use() 可以在条件逻辑中使用（与 useEffect 不同）
if (needsComments) {
  const comments = use(commentsPromise)
}
```

### Actions（表单 mutation）

```tsx
'use client'

function Form() {
  const [state, action, pending] = useActionState(submitAction, {})
  
  return (
    <form action={action}>
      <input name="email" disabled={pending} />
      <button disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  )
}
```

**useFormStatus**（来自 react-dom）从 form 的任何子组件读取 pending 状态 — 不需要把 pending prop 钻到提交按钮。

## 性能优化优先级

按顺序操作 — **在改代码之前先测量**：React DevTools Profiler，找出经常 commit 但 props 未变的组件，然后：

| 优先级 | 技术 | 何时使用 |
|--------|------|----------|
| **P0** | 基于路由的代码分割（`lazy` + Suspense） | 总是 — 用户只为访问的路由付费 |
| **P0** | 并行数据加载（`Promise.all`，prefetch） | 任何有 2+ 独立 fetch 的页面 — 瀑布流主导加载时间 |
| **P1** | 虚拟化长列表（tanstack-virtual） | 数千行或数百复杂行 — 分析，DOM 节点是成本 |
| **P1** | useDeferredValue / startTransition | 输入或拖拽感觉卡顿，因为重子树每次击键都重渲染 |
| **P2** | memo / useMemo（基于 Profiler 证据） | 仅在 React Compiler 关闭时使用 |

## 常见陷阱

| 陷阱 | 为什么失败 | 正确做法 |
|------|-----------|---------|
| `{count && <X />}` | `0` 是 falsy 但可渲染 — 页面显示字面量 `0` | `{count > 0 && <X />}` |
| `key={index}` 在可重排序/过滤的列表中 | state 和 DOM 粘在位置上，不是 item 上 — 输入显示错误的值 | `key={item.id}` |
| effect deps 中的对象/数组字面量 | 每次 render 都是新引用 → effect 每次 render 都触发 | 依赖原始值，或在上游 memoize |
|  mutating state 然后 setState | 相同引用 — React 跳过重渲染 | 新引用：`setArray([...array, item])` |
| 没有取消的 effect 中 fetch | 旧值的慢响应覆盖新值的快响应 — race condition | cleanup 中用 `AbortController`（见下） |
| "我的 effect 运行两次" → 删除 StrictMode | 双重挂载是 dev-only 且故意的 — 暴露缺失的 cleanup | 修复 cleanup；保持 StrictMode |
| 期望 error boundaries 捕获 handler/async 错误 | Boundaries 只捕获 render 和 lifecycle 错误 | handler 中 try/catch；mutation 中 `onError` |
| Hydration mismatch | `Date.now()`、`Math.random()`、locale 格式化、`typeof window` 分支在 server vs client render 不同 | 移到 effect，或在该元素上 `suppressHydrationWarning` |
| render 中 setState | render → setState → render，无限循环 | 内联计算派生值；handler/effect 中 setState |
| `useEffect(async () => …)` | Effect 必须返回 cleanup 或 nothing，不是 promise | 内部定义 async fn 并调用它 |

### Race Condition 修复

```tsx
// ✅ 取消 — race condition 修复
useEffect(() => {
  const controller = new AbortController()
  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then(setData)
    .catch((e) => { if (e.name !== 'AbortError') setError(e) })
  return () => controller.abort()
}, [url])
```

## AI 常见错误

生成代码容易犯的错误 — 审查时检查这些：

| 错误 | 正确模式 |
|------|---------|
| useEffect + useState 派生值 | render 中内联计算 |
| useEffect 中 fetch | TanStack Query，或 promise + use() 在 Suspense 下 |
| API 数据用 Redux/Context | TanStack Query — 服务器状态是缓存，不是 app 状态 |
| 默认导出 | 具名导出 |
|  everywhere 用 useCallback/useMemo | Compiler 开：都不用；关：先 Profiler 证据 |
| 第一次使用就抽象（`<DataTable>` 对于一个表） | 具体写；第二个真实消费者出现时再抽象 |
| 巨型组件 | ~50 JSX / ~300 行文件时分拆 |
| 没有 error boundaries | 路由级 + 每个高风险功能 |
| 到处 `any` 来沉默 strict mode | 修复类型；真正动态时用 `unknown` + narrowing |

## 项目决策持久化

项目决策和遇到的陷阱持久化在**项目内**的决策记录或交付工件（`<project>/delivery/`）中。OMP 来源使用 `~/react/memory.md`（模板 `memory-template.md`）——HOST PATH: not configured in DSH — do not assume this path exists。

首次设置原为运行 `setup.md`——该文件不在本迁移包内；HOST PATH: not configured in DSH — do not assume this path exists。

## 与其他 skill 的交互

```
react-best-practices
  └─ gsd-ui-review — 视觉审查
  └─ gsd-code-review — 代码审查
  └─ requesting-code-review — PR 审查
  └─ code-sandbox-review — 沙箱测试
```

## 使用示例

### 示例 1：新建组件

```
用户："创建一个用户卡片组件，显示头像、姓名、邮箱，可编辑"

→ 遵循 react-best-practices：
  1. 具名导出：export function UserCard
  2. Props 接口：export interface UserCardProps
  3. Hooks 优先，无条件调用
  4. Early returns 在所有 hooks 之后
  5. 派生值在 render 中计算
  6. 事件处理器内联
```

### 示例 2：状态管理决策

```
用户："我需要管理一个购物车状态，跨多个组件使用"

→ 决策树：
  1. 数据来自 API？否
  2. 跨组件共享？是 → Zustand
  3. 创建 cart store：
     - 一个 store 一个关注点（cart）
     - 通过 selector 读取
     - 用 useShallow 避免无限重渲染
```

### 示例 3：性能优化

```
用户："这个列表有 5000 行，滚动很卡"

→ P1 优化：
  1. 用 tanstack-virtual 虚拟化
  2. 只渲染可见行的 DOM 节点
  3. 成本从 5000 个节点降到 ~20 个
```

## 转换说明

本 skill 从 OpenClaw 的 `@ivangdavila/react` 转换为 Hermes 格式：

- **原始作者**：@ivangdavila (OpenClaw/ClawHub)
- **转换者**：lmqh
- **转换日期**：2026-07-25
- **变更**：
  - 添加 frontmatter 元数据（`metadata.hermes`）
  - 添加 triggers 路由配置 → DSH 无 autoload/触发路由；已改为 `whenToUse`，原 `triggers` 块移除（见 `../CONVERSION-NOTES.md`）
  - 添加 allowed-tools 声明 → DSH 技能 frontmatter 不能约束工具权限；已移除（见 `../CONVERSION-NOTES.md`）
  - 扩展中文文档和示例
  - 集成到 Hermes skill 生态系统
  - 添加项目决策持久化路径（`~/react/memory.md`；HOST PATH: not configured in DSH — do not assume this path exists）

## 参考资源

- [ClawHub React Skill](https://clawhub.ai/ivangdavila/react)
- [React 19 文档](https://react.dev)
- [TanStack Query](https://tanstack.com/query)
- [Zustand](https://zustand-demo.pmnd.rs)
- [React Hook Form](https://react-hook-form.com)
