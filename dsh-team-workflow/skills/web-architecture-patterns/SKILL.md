---
name: web-architecture-patterns
description: Web 架构常见模式 — 跨域、反向代理、前后端通信、文件上传策略。捕获纯前端限制和标准解决方案。
whenToUse: 用户询问 CORS/跨域、反向代理/nginx、文件上传/form data、纯前端 HTML 为何无法直连 API、前端直连与同源策略、前后端分离部署、更换 API Base URL 或平台兼容性、OpenAI 兼容中转站、单文件 HTML 重构为 React、即梦 AI 风格布局、多平台适配器/代理感知适配器、即梦 CLI 集成时使用。
---

# Web 架构常见模式

## 1. CORS 的本质

**CORS（Cross-Origin Resource Sharing）是浏览器的安全策略，不是服务器的限制。**

```
浏览器 (localhost)  ──→ 远程 API (api.example.com)
                    ↓
         浏览器拦截响应：❌ 跨域，不放行给 JS
```

- 浏览器在跨域请求时会先发 `OPTIONS` 预检请求，检查服务器是否返回 `Access-Control-Allow-Origin` 头
- **请求实际已经发出去了，服务器也处理了**，只是浏览器不让 JS 拿响应
- 所以可灵 API（`api.so.n.cn`）本身没有拒绝请求，是浏览器不让页面拿到结果

## 2. 反向代理解决 CORS

反向代理就是在中间加一个你自己控制的服务器：

```
浏览器 (localhost:8000)  ──→ 你的后端 (localhost:8000)  ──→ 可灵 API (api.so.n.cn)
            ↑                              ↑
      同源，无跨域              服务器间通信，无浏览器，无 CORS
```

| 步骤 | 场景 | 有浏览器？ | 有 CORS？ |
|---|---|---|---|
| 浏览器→你的后端 | 同源请求 | ✅ | ❌ 无 |
| 后端→远程 API | 服务器间通信 | ❌ | ❌ |
| 后端→浏览器 | 同源返回 | ✅ | ❌ 无 |

**CORS 只在「浏览器 → 不同域名/端口服务器」这一步出现。** 反向代理让所有请求先进同源的后端，由后端去转发远程 API，就绕过了浏览器对跨域的限制。

## 3. 纯前端无法实现的操作

纯前端（打开 HTML 文件）**无法绕过**以下限制：

- ❌ **本地上传文件给远程 API** — 远程服务器需要能访问到文件，`file://` 路径和 `blob://` URL 只有浏览器自己能访问
- ❌ **绕过 CORS** — 即使请求发了，浏览器会拦截响应
- ❌ **隐藏 API Key** — 前端代码中的 Token 用户可见
- ❌ **操作本地文件系统**（除了 `<input type="file">` 用户主动选择）

## 4. 文件上传常见架构

### 4.1 轻量后端代理（开发/测试推荐）

```
Python 后端 (FastAPI/Flask)
  ├─ GET / → 返回 HTML 页面（同源，无 CORS）
  ├─ POST /upload → 接收文件，存本地 static/
  │                 返回 http://host:port/static/file.ext
  └─ POST /api/nami/public/gen_video → 反向代理转发到可灵 API
       POST /api/nami/public/gen_video/progress → 反向代理
```

**启动方式**：`python server.py` → 自动 `webbrowser.open("http://localhost:8000")`

**依赖**：fastapi + uvicorn（或 flask）

### 4.2 对象存储直传（生产环境）

```
前端 → 云存储（OSS/COS/S3）← 后端签发临时 STS Token
    ↓
拿到公网 URL → 提交给远程 API
```

### 4.3 注意事项（参考素材背景知识）
- 可灵 API 的 `reference_images/audios/videos` 要求 URL **必须真实可访问**
- 服务器会发起 HTTP 请求验证文件是否存在
- 这意味着本地文件必须上传到公网可访问的地址

## 5. 可灵 AI API 鉴权模式

- **鉴权方式**：`Authorization: Bearer ***`
- **无需账号 Cookie 或登录态**，纯 API Key 校验
- 接入流程：开放平台申请 Key → Header 传 Key → 调用
- 门槛较低，在线申请即可，无需企业实名认证

### vs 即梦 AI（火山引擎）
- 即梦走 AK/SK 签名 → access_token 模式
- 需要火山引擎企业账号 + 实名认证
- 两者 API 层面都是纯 Key 鉴权，核心区别在申请门槛

## 6. API 平台兼容性判断

当用户想把一个已写好的工具从平台 A 换到平台 B 时（如"把 Base URL 从 api.so.n.cn 换到 token.yundashi.com/v1 会不会报错"），**不要靠猜**——用 curl 探测目标平台，对比三要素：端点路径、请求体 schema、响应格式。三者全匹配才能直接换 URL。

核心区分：OpenAI 兼容中转站（New-API / One-API）只代理 `/v1/*` 标准端点，不会自动适配 360/即梦等私有 API 路径。Bearer Token 鉴权方式相同 ≠ 接口兼容。

详见 `references/api-platform-compatibility.md`（含平台指纹识别速查表、3 条 curl 探测步骤、实测案例）。

## 6.2 代理感知多平台适配器架构

当 React SPA 需要同时对接多个视频生成平台（OpenAI / 可灵 AI / 即梦 CLI），且部分平台受 CORS 限制需通过本地 Python 代理转发时，使用代理感知适配器模式。核心要素：统一 `PlatformAdapter` 接口（**必须定义在 `types/index.ts`，不要在 `adapters/index.ts` 重复定义**，否则 sibling adapter 导入接口时产生循环依赖）、`createAdapter(platform, proxyUrl)` 工厂函数、`request()` 统一 JSON 请求函数（代理在线走 `/proxy`，离线直连）。**v2.1 新增**：`requestRaw()` 透明转发函数支持 multipart/form-data（代理在线走 `/proxy-raw`），解决了 OpenAI submitTask 的 FormData 跨域问题。即梦走专用 `/cli` 端点调用 dreamina CLI。

详见 `references/proxy-aware-adapters.md`（含架构总览、代理路由逻辑、即梦 CLI 命令映射、代理端点协议、循环依赖陷阱）。

## 6.2 演示前端模式（静态原型 → Docker 化）

当需要快速将一个静态 HTML/CSS/JS 原型演变为 Docker 容器化的演示前端，对接已有后端 API 时，使用 nginx 反向代理（不 CORS）、AbortController fetch 超时、优雅降级=模拟回复模式。

关键模式：
- **nginx 反代而非 CORS** — 后端不需要加 CORS middleware
- **API 层统一封装 + 15s 超时** — 防止模型调用 timeout=300s 阻塞浏览器
- **启动时健康检查 + 降级开关** — 后端不可用时自动切换模拟，不直接报错
- **Docker 多服务编排** — 前端 nginx:alpine + 后端独立容器，同一网络

详见 `references/demo-frontend-with-docker.md`（含完整架构、API 对接层 JS 模式、降级策略、Docker 配置、常见陷阱）。

## 6.1 单文件 HTML 工具 → React SPA 重构

当用户想把一个大型单文件 HTML 工具（内联 CSS+JS，通常 1000+ 行）重构为 React SPA，且要求**保持单文件部署**（双击 .html 即用，无需服务器）时，有三条技术路线：CDN React + 浏览器内 Babel（零构建但慢）、Vite + `vite-plugin-singlefile`（推荐，产物单文件 + 开发体验最优）、Preact + htm（零构建超轻量但非 JSX）。

推荐路线 B：开发时 `npm run build` 产单文件 .html，使用者无需碰 npm。即梦 AI 风格布局：64px 侧边栏导航 + 生成入口为中心（大 prompt 框 + 参数横排 + 全宽按钮）+ 任务管理独立页 + 设置独立页。React Router 必须用 `HashRouter`（`BrowserRouter` 在 `file://` 下不工作）。

详见 `references/html-to-react-spa-refactor.md`（含诊断方法论、三路线对比表、即梦风格布局模板、组件拆分模板、痛点映射表、响应式断点、Pitfalls、验证清单）。

## 7. Pitfalls

- 🚫 CORS 在 `file://` 协议下表现不稳定——某些浏览器完全禁止 file 协议发起 fetch
- 🚫 不要用 `URL.createObjectURL()` 生成的 Blob URL 发给远程 API——只有本机能访问
- 🚫 'Failed to fetch' 很可能是 CORS 问题，不是网络断了
- 🚫 中文字符文件名上传到服务端建议转译或生成唯一短文件名
- 🚫 Token 明文存在前端 localStorage 只适合测试环境
- 🚫 Base URL 带 `/v1` 后缀 + 工具再拼 `/api/nami/...` → 路径双重拼接变成 `/v1/api/nami/...`，必 404
- 🚫 OpenAI 兼容中转站 ≠ 万能代理——New-API 只转发 OpenAI 标准端点，不适配私有 API 路径
- 🚫 React Router 的 `BrowserRouter` 在 `file://` 协议下刷新白屏——单文件部署必须用 `HashRouter`
- 🚫 适配器接口（`PlatformAdapter`）在 `adapters/index.ts` 和 `types/index.ts` 重复定义会导致循环依赖——当 `index.ts` 导入 `JimengAdapter` 而 `JimengAdapter` 反向导入接口时，`tsc` 报 `Cannot find name`。接口只在 `types/index.ts` 定义一次，`adapters/index.ts` 用 `export type {}` re-export
- ✅ **FormData（multipart/form-data）可以通过 `/proxy-raw` 透明转发端点代理**——目标 URL 通过 `X-Proxy-Target` header 传递，原始 body 字节直接透传，上游响应原样返回（含 Content-Type）。前端用 `requestRaw()` 函数封装：代理在线时 `fetch(\`${proxyUrl}/proxy-raw\`, { headers: { 'X-Proxy-Target': url, ...originalHeaders }, body: formData })`，离线时直连。**旧方案**（`/proxy` 只接受 JSON body，FormData 始终直连）已过时——直连在 `file://` 或跨域场景下会被浏览器 CORS 策略阻止，导致 404/网络错误
- 🚫 代理 `/proxy` 响应的 `body` 字段是 JSON 字符串不是对象——必须 `JSON.parse(proxyData.body)` 才能拿到结构化数据
- 🚫 **空 `baseUrl: ''` 会导致 fetch 拼接出相对路径**——`fetch(\`${''}/videos\`)` = `fetch('/videos')`，浏览器向当前页面 origin 请求，无论页面在 `file://` 还是某 web server 上都会 404。所有平台默认 `baseUrl` 必须是完整 URL（含协议+域名）

## 7. 验证清单

- [ ] 浏览器打开页面后，F12 控制台是否有 CORS 错误
- [ ] 参考素材文件是否能通过浏览器直接访问（打开 URL 看是否 200）
- [ ] curl 测试可灵 API 是否正常工作（绕过浏览器直接测）
- [ ] 上传文件的扩展名是否在可灵允许列表内