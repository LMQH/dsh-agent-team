# API 平台兼容性分析与指纹识别

当用户问"把 Base URL 换到另一个平台是否可用"时，不要靠猜——用 curl 探测目标平台，对比三要素（端点路径、请求体 schema、响应格式）。

## 1. 平台指纹识别速查

用 `curl -s -i` 探测根路径和 `/v1`，看响应头和错误格式：

| 指纹信号 | 平台类型 | 兼容接口 |
|---|---|---|
| `X-New-Api-Version` / `X-Oneapi-Request-Id` + `"type":"new_api_error"` | New-API / One-API（OpenAI 兼容中转站） | `/v1/chat/completions`, `/v1/images/generations`, `/v1/videos` 等 OpenAI 标准端点 |
| `X-Oneapi-Request-Id` 但无 `X-New-Api-Version` | One-API（原版） | 同上 |
| `"type":"invalid_request_error"` + 无自定义 X-头 | OpenAI 官方 | OpenAI 标准端点 |
| 自定义 `code`/`msg` 字段 + 私有路径（如 `/api/nami/...`） | 平台私有 API | 仅该平台自定义端点 |

## 2. 探测步骤（3 条 curl 即可定性）

```bash
# ① 根路径 — 看首页标题/描述
curl -s -i -m 10 "http://target.com" | head -40

# ② /v1 — 看是否 OpenAI 兼容网关
curl -s -i -m 10 "http://target.com/v1" | head -20

# ③ 用假 key 打 /v1/models — 看鉴权响应格式
curl -s -m 10 "http://target.com/v1/models" -H "Authorization: Bearer test" | head -10
```

判断逻辑：
- 如果 ③ 返回 `"type":"new_api_error"` 或 OpenAI 风格错误 → OpenAI 兼容中转站
- 如果 ③ 返回 404 或私有格式 → 可能不是 OpenAI 兼容，需进一步探测

## 3. 三要素对比法

判断"换 Base URL 是否可用"，对比以下三要素：

| 要素 | 不兼容时的表现 |
|---|---|
| **端点路径** | 工具拼 `{baseUrl}/api/nami/public/gen_video`，目标平台无此路径 → 404 `Invalid URL` |
| **请求体 schema** | 工具发 `apply_model/gen_mod/ratio/reference_audios`，目标平台用 `model/prompt/size` → 参数被忽略或报错 |
| **响应格式** | 工具解析 `{code:0, data:{mid}}`，目标平台返回 `{id, status}` → 解析失败，无法提取任务 ID |

**三要素中任何一个不匹配都会报错。三者全匹配才能直接换 URL。**

## 4. 常见误区

- 🚫 OpenAI 兼容中转站 ≠ 万能代理。New-API/One-API 只代理 OpenAI 标准端点，不会自动适配 360/即梦等私有 API 路径
- 🚫 Bearer Token 鉴权方式相同 ≠ 接口兼容。鉴权通过但端点/参数不匹配依然 404
- 🚫 Base URL 带 `/v1` 后缀 + 工具再拼 `/api/nami/...` → 路径双重拼接，变成 `/v1/api/nami/...`

## 5. 实测案例：api.so.n.cn → token.yundashi.com

| 维度 | api.so.n.cn（360 可灵） | token.yundashi.com（New-API 中转站） |
|---|---|---|
| 平台类型 | 360 私有视频生成 API | New-API（OpenAI 兼容网关） |
| 指纹 | 私有路径 `/api/nami/public/gen_video` | `X-New-Api-Version` + `"type":"new_api_error"` |
| 视频端点 | `POST /api/nami/public/gen_video` | `POST /v1/videos`（OpenAI Sora 风格） |
| 请求体 | `apply_model, gen_mod, ratio, reference_audios/images/videos` | `model, prompt, size` 等 OpenAI 标准参数 |
| 响应格式 | `{code:0, data:{mid}}` | `{id, status}` OpenAI 格式 |
| 错误格式 | `{code, msg}` | `{error:{message, type}}` |
| 结论 | — | **完全不兼容，直接换 URL 必 404** |

## 6. 何时需要改写工具

如果目标平台确实是 OpenAI 兼容中转站（如 New-API），且需要做视频生成测试：
- 确认中转站是否代理了目标模型（查 `/v1/models` 列表）
- 改写工具的 fetch 路径为 OpenAI 标准端点
- 改写请求体为 OpenAI 标准参数
- 改写响应解析逻辑（`json.id` 替代 `json.data.mid`，`json.status` 替代 `json.data.task_status`）
