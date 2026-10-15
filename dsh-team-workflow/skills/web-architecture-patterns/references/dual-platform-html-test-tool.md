# 双平台 HTML 测试工具设计模式

当需要用一个 HTML 页面同时支持**私有 API**（如 360 纳米 AI）和 **OpenAI 兼容中转站**（New-API/One-API）时，采用以下设计模式。

## 核心架构

```
HTML 单页
  ├── CSS: platform-specific class toggling
  ├── HTML: dual form fields, each gated by class
  └── JS:
       ├─ currentPlatform state variable
       ├─ switchPlatform() → body class toggle
       ├─ submitTask() branches by platform
       ├─ queryProgress() branches by platform
       └─ Status mapping unification layer
```

## 1. CSS 层：显示/隐藏控制

```css
.nami-only, .openai-only { display: none; }
body.platform-nami .nami-only { display: revert; }
body.platform-openai .openai-only { display: revert; }
body.platform-openai .openai-only.inline { display: inline-flex; }
body.platform-openai .openai-only.block { display: block; }
body.platform-openai .openai-only.grid { display: grid; }
body.platform-openai .openai-only.flex { display: flex; }
```

每个表单字段用 `class="nami-only"` 或 `class="openai-only"` 标记，切换平台时自动显示/隐藏。

## 2. 表单字段分叉策略

| 参数 | 私有 API | OpenAI 兼容 |
|---|---|---|
| 模型 | `apply_model` (seedance20) | `model` (doubao-seedance-2-0 / sora-2) |
| 时长 | `duration` (1~60) | `seconds` (4~15) |
| 分辨率 | `resolution` (720p, 1080p) | `size` (480P, 720P, 1080P, 4K) |
| 画面比例 | `ratio` (16:9, 9:16, 1:1) | `metadata.ratio` (9:16,3:4,1:1,4:3,16:9,21:9,智能) |
| 生成模式 | `gen_mod` (0普通,1首尾帧) | `metadata.mode` (t2v,first_frame,first_last_frame,reference) |
| 参考素材 | `reference_audios/images/videos` (URL array) | `input_reference` (文件上传, 图生视频) |
| 音频 | `generate_audio` (boolean) | — |

**注意**：OpenAI 兼容平台的 `mode` 和 `ratio` 通过 `metadata` JSON 字符串传递（multipart/form-data 中的文本字段）。

## 3. 提交逻辑分叉 (submitTask)

```javascript
if (currentPlatform === 'openai') {
  const meta = {};
  if (mode !== 't2v') meta.mode = mode;
  if (ratio !== '智能') meta.ratio = ratio;
  formData.append('metadata', JSON.stringify(meta));

  await fetch(baseUrl + '/videos', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,  // 不设 Content-Type → 浏览器自动设 multipart/form-data
  });
  // 响应: { id: "task_xxx", status: "queued", ... }
  task.mid = json.id;
} else {
  await fetch(baseUrl + '/api/nami/public/gen_video', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),  // JSON 格式
  });
  // 响应: { code: 0, data: { mid: "xxx" } }
  task.mid = json.data.mid;
}
```

## 4. 查询逻辑分叉 (queryProgress)

| 维度 | 私有 API | OpenAI 兼容 |
|---|---|---|
| 请求 | `POST {baseUrl}/api/nami/public/gen_video/progress` + JSON body `{mid}` | `GET {baseUrl}/videos/{id}` |
| 状态字段 | `json.data.task_status` (数字 0-5) | `json.status` (字符串 `queued/in_progress/completed/failed`) |
| 下载 URL | `json.data.download_url` | `json.url || json.metadata.url` |
| 封面 | `json.data.cover` | 无，等同 cover 字段 |
| 失败原因 | `json.data.failure_reason` | `json.error` |
| 完成检测 | `d.task_status === 3` | `['succeeded', 'completed'].includes(d.status)` |
| 活跃检测 | `s === 0 || s === 1 || s === 2` | `['unknown','queued','processing','in_progress'].includes(s)` |

**重要陷阱**：New-API 的下载 URL 在 `metadata.url` 中（非顶层 `url` 字段）。必须同时检查 `d.url` 和 `d.metadata.url`。

## 5. 状态映射统一层

```javascript
function getTaskStatusInfo(task) {
  if (task.platform === 'openai') {
    const map = {
      'unknown': { label: '排队中', cls: 's-0' },
      'queued': { label: '排队中', cls: 's-0' },
      'processing': { label: '处理中', cls: 's-1' },
      'in_progress': { label: '处理中', cls: 's-1' },
      'succeeded': { label: '已完成', cls: 's-3' },
      'completed': { label: '已完成', cls: 's-3' },
      'failed': { label: '失败', cls: 's-4' },
    };
    return map[task.status] || { label: task.status || '未知', cls: 's-0' };
  }
  // 私有 API 数字状态
  const s = task.status !== undefined ? task.status : 0;
  return STATUS_MAP[s] || { label: '未知', cls: 's-0' };
}
```

## 6. 任务记录跨平台兼容

每个任务对象保存 `platform` 字段（`'nami'` 或 `'openai'`），切换平台后历史任务仍能正确查询和渲染：

```javascript
const task = {
  mid: taskMid,
  platform: currentPlatform,  // ← 关键
  status: json.status || 0,
  // ...
};
```

## 7. 错误处理兼容两种格式

| 平台 | 错误格式 |
|---|---|
| OpenAI | `{ error: { message, type, code } }` |
| New-API | `{ code, message, data: { reason } }` |
| 360 私有 | `{ code, msg, data: { reason } }` |

```javascript
if (json.error) {
  // OpenAI 格式
  code = json.error.code || json.error.type || 'error';
  msg = json.error.message || '未知错误';
} else {
  // 私有 API / New-API 格式
  code = json.code;
  msg = json.msg || json.message || '未知错误';
  reason = json.data?.reason || null;
}
```

## 8. 已验证的 OpenAI 视频端点行为 (token.yundashi.com)

提交：
```
POST /v1/videos (multipart/form-data)
  Fields: prompt, model, seconds, size(480P/720P/1080P/4K)
  metadata: JSON string { mode?, ratio? }

Response (201):
  {
    "id": "task_xxx",
    "task_id": "task_xxx",
    "object": "video",
    "model": "doubao-seedance-2-0",
    "status": "queued",
    "progress": 0,
    "created_at": 1784801099
  }
```

查询：
```
GET /v1/videos/{id}

Response (200):
  {
    "id": "task_xxx",
    "task_id": "task_xxx",
    "object": "video",
    "model": "doubao-seedance-2-0",
    "status": "completed",      // queued → in_progress → completed
    "progress": 100,
    "created_at": 1784801099,
    "completed_at": 1784801321,
    "metadata": {
      "url": "https://..."     // ← 下载链接在这里
    }
  }
```

## 9. Pitfalls

- 🚫 用户提供的 API key 余额不足时，提交返回 `queued` 但查询返回任务未找到或参数错误——服务端校验在后
- 🚫 立即查询（提交后几秒内）可能返回 `status: "unknown"`——服务端还没来得及注册任务
- 🚫 doubao-seedance-2-0 t2v 模式不接收 `seconds` 作为自定义参数——不低于4秒、不高15秒范围会触发服务端 `InvalidParameter`
- 🚫 Base URL 如果填到 `/v1`、工具内部再拼 `/videos` → 最终正确；如果填成 `token.yundashi.com`（无后缀）→ 最终变成 `token.yundashi.com/videos`（缺少 `/v1` 前缀）
- 🚫 curl 命令必须传递 `metadata`，否则 mode/ratio 参数丢失