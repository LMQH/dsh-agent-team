# 单文件 HTML 工具 → React SPA 重构指南

当用户想把一个大型单文件 HTML 工具（含内联 CSS+JS，通常 1000+ 行）重构为 React SPA，且要求**保持单文件部署**（双击 .html 即用，无需服务器）时，按本指南执行。

## 1. 诊断方法论：先量化再动手

重构前先通读全文，产出三类数据：

| 维度 | 怎么测 | 判断标准 |
|------|--------|----------|
| **区块占比** | `read_file` 分段，统计 CSS / HTML / JS 行数 | JS >40% → 逻辑复杂，适合组件化拆分 |
| **JS 复杂度信号** | `search_files` 计数 `function`/`fetch`/`setInterval`/`innerHTML`/`localStorage` | innerHTML 拼接多 → 有 XSS 风险，React 默认转义可根治 |
| **痛点定位** | 逐区标注问题 + 严重度（高/中/低） | 表单字段全量渲染、列表高度硬编码、详情无 tab 是三大典型痛点 |

实例（AI 视频测试工具，2530 行 / 99KB）：
- CSS 32% / HTML 13% / JS 51% / 模态框 4%
- JS 中 76 处 function/fetch/innerHTML/localStorage 信号
- 三大痛点：表单 20+ 字段平铺无分组、任务列表 max-height:200px 仅显 3-4 个、详情全滚动平铺无 tab

## 2. 三条技术路线（保持单文件部署）

| 路线 | 方案 | 产物单 .html | 浏览器直接打开 | 需要 Node | 首次联网 | 运行时体积 | 启动速度 | JSX | TS | HMR |
|------|------|:---:|:---:|:---:|:---:|---|---|:---:|:---:|:---:|
| **A** | CDN React + 浏览器内 Babel | ✅ | ✅ | ❌ | ✅ | ~2.1MB | ⚠️ 慢(浏览器内转译 2-5s) | ✅ | ❌ | ❌ |
| **B** | Vite + `vite-plugin-singlefile` | ✅ | ✅ | ✅ 构建时 | ❌ 构建后离线 | ~140KB | ✅ 快 | ✅ | ✅ | ✅ |
| **C** | Preact + htm | ✅ | ✅ | ❌ | ✅ | ~6KB | ✅ 快 | ❌(用 html`` 模板) | ❌ | ❌ |

### 推荐：路线 B（Vite + vite-plugin-singlefile）

理由：
1. 产物仍是单 .html，完全满足"双击即用"
2. 无浏览器内转译性能惩罚（React 官方明确不推荐浏览器内 Babel 用于生产）
3. 开发体验最优（JSX 完整 / TS 可选 / HMR / ESLint）
4. 构建后无 CDN 依赖，离线可用
5. 未来拆正式项目零迁移成本

**唯一代价**：开发时需 `npm install` + `npm run build`。但产物 .html 的使用者无需碰 npm。

### 路线 B 配置要点

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist', assetsInlineLimit: 100000000 } // 内联所有资源
});
```

构建产物：`dist/index.html`（单文件，内联所有 JS/CSS）。

## 3. SPA 布局模式：即梦 AI 风格

用户明确参考即梦 AI（Dreamina）web 界面时的设计模式：

### 核心特征
- **左侧窄边栏导航**（64px，仅图标 + tooltip）
- **生成入口为中心**：主操作区是大 prompt 输入框 + 参数横排 + 全宽生成按钮
- **任务管理独立页**：不与生成入口挤同一屏
- **设置独立页**：配置从顶部折叠面板移到独立页

### 页面结构

```
┌────────┬──────────────────────────────┐
│ SideNav│  页面内容区（Router 切换）      │
│ 64px   │                              │
│ ✨生成  │                              │
│ 📋任务  │                              │
│ ⚙️设置  │                              │
└────────┴──────────────────────────────┘
```

**侧边栏**：固定 64px，图标导航，当前页高亮 + 品牌色竖条。底部可放帮助/链接。

**生成页**（主入口）：
```
大 prompt textarea（占页面宽度主体）
参数横排（模型/时长/比例/分辨率 — 一行）
高级参数折叠（mode/audio/n — 第二行）
参考素材折叠区（按 mode 动态渲染）
全宽生成按钮（视觉重心）
```

**任务页**：左右分栏（列表 + 详情），筛选 chips（全部/进行中/已完成/失败），详情 tab 分区（概览/请求/响应）。

**设置页**：API 配置（平台/BaseURL/Token 密码遮罩）+ 轮询设置 + 数据管理（导入/导出/清除）。

## 4. 组件拆分模板

```
App
├── SideNav (固定侧边栏, React Router)
├── Routes
│   ├── /generate → GeneratePage
│   │   ├── PromptSection
│   │   ├── ParamsRow (核心参数横排)
│   │   ├── AdvancedParams (可折叠)
│   │   ├── ReferenceSection (按 mode 条件渲染)
│   │   └── GenerateButton
│   ├── /tasks → TasksPage
│   │   ├── TaskToolbar (筛选 + 导入导出 + 轮询)
│   │   ├── TaskList (左, flex scroll)
│   │   └── TaskDetail (右, tab 分区)
│   └── /settings → SettingsPage
├── ErrorDialog (全局)
└── HelpModal (全局)
```

逻辑层抽取：
- `api/<platform>.js` — 各平台提交/查询适配器
- `hooks/useTasks` — 任务状态 + localStorage 持久化 + 轮询
- `hooks/useConfig` — 配置持久化
- 常量文件：STATUS_MAP / ERROR_CODE_MAP / ALLOWED_EXT

## 5. 原生 HTML → React 的痛点映射

| 原生 HTML 痛点 | React 解决方式 |
|----------------|---------------|
| `innerHTML` 字符串拼接（XSS 风险） | JSX `{var}` 默认转义 |
| 手动 `renderList()`/`renderDetail()` 散落 | `setState` 自动驱动重渲染 |
| 全局变量难追踪（tasks/selectedMid/pollTimer） | `useState`/`useReducer`/`useEffect` 组件内封装 |
| 双平台逻辑混在 submit/query 里 | 抽 `namiApi`/`openaiApi` 适配器模块 |
| CSS class 显隐全量字段（`.nami-only`/`.openai-only`） | React 条件渲染 `{platform === 'nami' ? <NamiFields/> : <OpenAIFields/>}` |
| Tooltip 每字段 5-8 行重复 HTML | `<FieldLabel name="prompt" type="string" required>` 组件 |
| 任务列表 max-height 硬编码 | `flex:1; overflow-y:auto` 撑满栏 |
| 详情全平铺无分区 | Tab 分区（概览/请求/响应） |
| MetaGrid 固定 2 列 | `grid-template-columns: repeat(auto-fit, minmax(120px,1fr))` |

## 6. 响应式断点

| 断点 | 布局 | 表单处理 |
|------|------|----------|
| ≥1280px | 三栏或侧边栏+宽内容区 | 生成页参数横排 |
| 768–1279px | 双栏（列表+详情），表单变抽屉 | "新建任务"按钮唤出 |
| <768px | 单栏 Tab 切换 | 底部 Tab Bar |

## 7. Pitfalls

- 🚫 浏览器内 Babel（路线 A）首次加载慢 2-5 秒，不适合频繁使用——仅适合快速原型验证
- 🚫 `vite-plugin-singlefile` 需设置 `assetsInlineLimit` 足够大，否则小资源仍会外链
- 🚫 React Router 的 `BrowserRouter` 在 `file://` 协议下不工作——必须用 `HashRouter`
- 🚫 重构时不要丢失原有的 localStorage key 兼容性——用户的历史任务数据会丢
- 🚫 Token 密码遮罩：用 `type="password"` + 👁️ 切换，不要明文显示在 input 中
- 🚫 产物 .html 体积：React+ReactDOM gzip 后约 45KB，可接受；但如果原工具 <50KB 且无复杂状态，考虑是否真需要 React

## 8. 验证清单

- [ ] `npm run build` 产物为单个 .html（无外部 JS/CSS 文件）
- [ ] 双击产物 .html 在浏览器中能正常打开（file:// 协议）
- [ ] React Router 用 HashRouter，刷新页面不白屏
- [ ] 原有 localStorage 数据能正确读取（key 兼容）
- [ ] 两个平台的提交/查询逻辑都能正常工作
- [ ] 轮询、导入导出、错误弹窗等功能完整迁移
