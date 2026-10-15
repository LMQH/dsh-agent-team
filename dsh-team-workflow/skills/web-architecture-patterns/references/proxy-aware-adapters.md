# 代理感知多平台适配器架构

当 React SPA 需要同时对接多个视频生成平台（OpenAI 兼容 / 可灵 AI / 即梦 CLI），且部分平台受 CORS 限制需通过本地代理转发时，使用本模式。

## 1. 核心问题

| 平台 | 通信方式 | CORS | 需要代理？ |
|------|---------|------|-----------|
| OpenAI 兼容 (doubao/sora) | REST JSON + FormData | 可能受限 | 可选（代理在线时走 /proxy，离线直连） |
| 可灵 AI (api.so.n.cn) | REST JSON | 受限 | 可选（同上） |
| 即梦 (Dreamina CLI) | 本地 CLI 调用 | N/A | 必须（通过代理 /cli 端点调用） |

**关键约束**：代理离线时 OpenAI/可灵仍可直连（CORS 允许的情况下），代理在线时走代理转发。即梦始终需要代理（CLI 只在本地运行）。

## 2. 架构总览

```
React SPA
  ├── createAdapter(platform, proxyUrl) → PlatformAdapter
  │     ├── OpenAIAdapter  (baseUrl, token, proxyUrl)
  │     ├── KlingAdapter   (baseUrl, token, proxyUrl)
  │     └── JimengAdapter  (platform, proxyUrl)
  │
  ├── request(url, options, proxyUrl)  ← JSON 请求函数
  │     ├── proxyUrl = null  → 直连 fetch
  │     └── proxyUrl != null → POST {proxyUrl}/proxy {url, method, headers, body}
  │
  ├── requestRaw(url, options, proxyUrl)  ← 透明转发函数（任意 Content-Type，含 FormData）
  │     ├── proxyUrl = null  → 直连 fetch
  │     └── proxyUrl != null → POST {proxyUrl}/proxy-raw  Header: X-Proxy-Target: url  Body: 原始字节
  │
  └── Store (Zustand)
        └── getAdapter() → createAdapter(platform, proxyOnline ? proxyUrl : null)
```

## 3. 适配器接口（单一接口，三种实现）

```typescript
// types/index.ts — 统一定义，避免循环依赖
export interface PlatformAdapter {
  getPlatformInfo(): PlatformInfo;
  submitTask(params: TaskParams): Promise<{ taskId: string }>;
  queryProgress(taskId: string): Promise<TaskProgress>;
}
```

**⚠️ 关键**：`PlatformAdapter` 接口必须在 `types/index.ts` 中定义一次，不要在 `adapters/index.ts` 重复定义。否则当 `adapters/index.ts` 导入 `JimengAdapter`、而 `JimengAdapter` 又需要 `PlatformAdapter` 时，会产生循环依赖，`tsc --noEmit` 报 `Cannot find name 'PlatformAdapter'`。

## 4. 代理路由逻辑

### 4.1 JSON 请求（Kling submit/query、OpenAI query）

```typescript
async function request(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
  proxyUrl: string | null,
): Promise<{ status: number; json: any }> {
  if (!proxyUrl) {
    // 直连
    const res = await fetch(url, { method: options.method || 'GET', headers: options.headers, body: options.body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, json: await res.json() };
  }
  // 代理转发
  const proxyRes = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url, method: options.method || 'GET',
      headers: options.headers || {}, body: options.body,
    }),
  });
  if (!proxyRes.ok) throw new Error(`Proxy HTTP ${proxyRes.status}`);
  const proxyData = await proxyRes.json();
  if (proxyData.status !== 200) throw new Error(`Upstream HTTP ${proxyData.status}`);
  // 代理返回的 body 是字符串，需要 JSON.parse
  const json = typeof proxyData.body === 'string' ? JSON.parse(proxyData.body) : proxyData.body;
  return { status: proxyData.status, json };
}
```

### 4.2 FormData 请求（OpenAI submitTask）— 透明转发模式

OpenAI 的 submitTask 使用 multipart/form-data。**v2.1 起，FormData 可以通过 `/proxy-raw` 透明转发端点代理**，不再需要直连。目标 URL 通过 `X-Proxy-Target` header 传递，原始 body 字节直接透传：

```typescript
async function requestRaw(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: BodyInit },
  proxyUrl: string | null,
): Promise<Response> {
  if (!proxyUrl) {
    return fetch(url, { method: options.method || 'POST', headers: options.headers, body: options.body });
  }
  const proxyHeaders: Record<string, string> = { 'X-Proxy-Target': url };
  if (options.headers) for (const [k, v] of Object.entries(options.headers)) proxyHeaders[k] = v;
  return fetch(`${proxyUrl}/proxy-raw`, {
    method: options.method || 'POST',
    headers: proxyHeaders,
    body: options.body,
  });
}

// OpenAIAdapter.submitTask 使用 requestRaw
async submitTask(params: TaskParams): Promise<{ taskId: string }> {
  const formData = new FormData();
  // ... 填充 formData
  const res = await requestRaw(
    `${this.baseUrl}/videos`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` }, body: formData },
    this.proxyUrl,
  );
  // ...
}
```

Python 代理端 `/proxy-raw` 实现（零依赖标准库）：

```python
def _handle_proxy_raw(self):
    content_length = int(self.headers.get("Content-Length", 0))
    raw_body = self.rfile.read(content_length) if content_length > 0 else b""
    target_url = self.headers.get("X-Proxy-Target", "")
    if not target_url:
        self._send_json({"error": "missing X-Proxy-Target header"}, 400); return
    if target_url.startswith("file://"):
        self._send_json({"error": "file:// not allowed"}, 403); return
    # 提取转发 headers（排除 hop-by-hop 和代理控制 headers）
    skip = {"x-proxy-target", "host", "content-length", "connection", "accept-encoding"}
    fwd_headers = {k: v for k, v in self.headers.items() if k.lower() not in skip}
    req = urllib.request.Request(target_url, data=raw_body, method=self.command)
    for k, v in fwd_headers.items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
            resp_body = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.headers.get("Content-Type", "application/octet-stream"))
            self._send_cors()
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
    except urllib.error.HTTPError as e:
        # 上游错误也原样返回
        resp_body = e.read()
        self.send_response(e.code)
        self.send_header("Content-Type", e.headers.get("Content-Type", "application/octet-stream"))
        self._send_cors()
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)
    except Exception as e:
        self._send_json({"error": str(e), "type": type(e).__name__}, 502)
```

**为什么 `/proxy-raw` 比 `/proxy` 更适合 FormData**：
- `/proxy` 将 body 包装在 JSON `{url, method, headers, body}` 中，body 必须是字符串 → FormData 无法序列化
- `/proxy-raw` 将目标 URL 放在 header，body 原样透传 → 任何 Content-Type 都支持
- `/proxy-raw` 返回原始响应（含上游 Content-Type），`/proxy` 返回 JSON 包装的 `{status, headers, body}`

### 4.3 CLI 请求（即梦 Dreamina）

即梦不走 `/proxy`，走专用 `/cli` 端点：

```typescript
private async execCli(command: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${this.proxyUrl}/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  if (!res.ok) throw new Error(`CLI HTTP ${res.status}`);
  const data = await res.json();
  if (data.exitCode !== 0) throw new Error(`dreamina ${command} 失败: ${data.stderr}`);
  return data.json ?? JSON.parse(data.stdout || '{}');
}
```

## 5. 即梦 CLI 命令映射

| UI 生成模式 | CLI 命令 | 必填参数 | 判断条件 |
|------------|---------|---------|---------|
| 文生视频 (t2v) | `text2video` | `--prompt` | 无图片/视频参数 |
| 首帧参考 | `image2video` | `--image` `--prompt` | `j.imagePath` 存在 |
| 首尾帧参考 | `frames2video` | `--first` `--last` `--prompt` | `j.firstFramePath && j.lastFramePath` |
| 参考生成 | `multimodal2video` | `--image`(≥1) 或 `--video`(≥1) | `j.referenceImages?.length || j.referenceVideos?.length` |
| 查询结果 | `query_result` | `--submit_id` | — |

**任务状态映射**：
| CLI `gen_status` | 内部 `TaskStatus` |
|---|---|
| `querying` | `processing` |
| `success` | `succeeded` |
| `fail` | `failed` |

## 6. 工厂函数

```typescript
export function createAdapter(platform: PlatformConfig, proxyUrl: string | null = null): PlatformAdapter {
  switch (platform.type) {
    case 'jimeng':  return new JimengAdapter(platform, proxyUrl);
    case 'kling':   return new KlingAdapter(platform.baseUrl, platform.token, proxyUrl);
    case 'openai':  return new OpenAIAdapter(platform.baseUrl, platform.token, proxyUrl);
    default: throw new Error(`Unknown platform type: ${platform.type}`);
  }
}
```

Store 中的调用方式：
```typescript
getAdapter: () => {
  const platform = get().platforms.find(p => p.id === get().activePlatformId);
  if (!platform) return null;
  const proxyUrl = get().proxyOnline ? `http://localhost:${get().proxyPort}` : null;
  return createAdapter(platform, proxyUrl);
}
```

## 7. 代理端点协议

本地代理（Python http.server，零依赖，默认端口 3928）需实现：

| 端点 | 方法 | 请求体 | 响应 | 用途 |
|------|------|--------|------|------|
| `/health` | GET | — | `{"status":"ok","version":"2.0"}` | 健康检查 |
| `/proxy` | POST | `{url, method, headers, body}` | `{status, headers, body(string)}` | CORS 代理转发（仅 JSON body） |
| `/proxy-raw` | POST | 原始 body + Header: `X-Proxy-Target: url` | 上游原始响应（含 Content-Type） | 透明转发（任意 Content-Type，含 multipart/form-data） |
| `/upload` | POST | multipart (field: `file`) | `{"path":"/tmp/.../filename"}` | 文件上传，返回本地路径 |
| `/cli` | POST | `{command, args}` | `{stdout, stderr, exitCode, json}` | 执行 dreamina CLI |
| `/download` | GET | `?path=/tmp/...` | 二进制流 | 下载本地文件 |

## 8. Pitfalls

- ✅ **FormData 可以走 /proxy-raw**（v2.1 修复）：`/proxy-raw` 端点接受任意 Content-Type 的原始 body，目标 URL 通过 `X-Proxy-Target` header 传递。前端用 `requestRaw()` 函数封装。**旧方案**（FormData 始终直连）已过时——直连在 `file://` 或跨域场景下会被浏览器 CORS 策略阻止。
- 🚫 **空 `baseUrl: ''` 导致 404**：`fetch(\`${''}/videos\`)` = `fetch('/videos')`，浏览器向当前页面 origin 请求。在 `file://` 下请求 `file:///videos` → 失败；在 web server 下请求 `/videos` → 404。所有平台默认 `baseUrl` 必须是完整 URL。
- 🚫 **PlatformAdapter 接口重复定义导致循环依赖**：如果在 `adapters/index.ts` 定义接口，而 `JimengAdapter.ts` 从 `./index` 导入它，同时 `index.ts` 又导入 `JimengAdapter`，会产生循环依赖。**解法**：接口只在 `types/index.ts` 定义一次，`adapters/index.ts` 用 `export type { PlatformAdapter }` re-export。
- 🚫 **代理返回的 body 是字符串**：`/proxy` 响应的 `body` 字段是 JSON 字符串，不是对象，必须 `JSON.parse(proxyData.body)`。
- 🚫 **Tree-shaking 会移除未调用的适配器**：如果 `createAdapter` 没有从 UI 组件的渲染路径中被调用，Vite 会 tree-shake 掉所有适配器类，bundle 中看不到 `text2video`、`/cli` 等字符串。这不是错误——适配器已正确接入，只是还没被 UI 触发。
- 🚫 **即梦的 proxyUrl 兜底**：`JimengAdapter` 构造函数应支持 `proxyUrl || platform.baseUrl` 兜底，因为即梦的 `baseUrl` 本身就是代理地址（`http://localhost:3928`）。

## 9. 验证清单

- [ ] `npx tsc --noEmit` 零适配器相关错误（`grep adapters/` 无匹配）
- [ ] `npm run build` 成功，产物单文件
- [ ] 代理在线时 OpenAI/可灵 queryProgress 走 `/proxy`，离线时直连
- [ ] 代理在线时 OpenAI submitTask 走 `/proxy-raw`（FormData 透明转发），离线时直连
- [ ] `/proxy-raw` 端点正确转发 multipart/form-data（用 curl -F 测试：`curl -X POST http://localhost:3928/proxy-raw -H "X-Proxy-Target: http://127.0.0.1:PORT" -F "field=value"`）
- [ ] 即梦 submitTask/queryProgress 走 `/cli` 端点
- [ ] `proxyOnline` 状态切换时 `getAdapter()` 返回正确的 proxyUrl 或 null
- [ ] Store 中 `getAdapter()` 能根据 `activePlatformId` 返回对应平台适配器
