# New-API /v1/videos 端点规范（OpenAI Sora 格式）

New-API（QuantumNous/new-api，基于 One-API 的 fork）提供 OpenAI 兼容的视频生成接口。当目标平台指纹为 New-API 时，视频生成走此端点。

来源：New-API 官方文档 https://github.com/QuantumNous/new-api-docs/blob/main/docs/en/api/openai-video.md

## 端点总览

| 操作 | 方法 | 路径 | 请求体 |
|---|---|---|---|
| 提交视频任务 | POST | `/v1/videos` | `multipart/form-data` |
| 查询任务状态 | GET | `/v1/videos/{video_id}` | 无 |
| 下载视频内容 | GET | `/v1/videos/{video_id}/content` | 无 |

## 鉴权

```
Authorization: Bearer sk-xxxx
```

与 OpenAI 标准完全一致。Key 在 New-API 后台创建。

## 提交任务参数（multipart/form-data）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| prompt | string | 是 | 视频生成提示词 |
| model | string | 否 | 模型 ID，默认 sora-2 |
| seconds | string | 否 | 视频时长（秒），默认 4 |
| size | string | 否 | 输出分辨率 宽x高，默认 720x1280 |
| input_reference | file | 否 | 图生视频用参考图片文件 |
| metadata | string | 否 | 扩展参数（JSON 字符串），用于非 Sora 模型的特殊参数 |

### metadata 用途

传递非 Sora 模型的专属参数，如阿里万相的图片 URL、水印、提示词改写：
```json
{"img_url":"https://example.com/image.jpg","watermark":false,"prompt_extend":true}
```

## 提交响应

```
HTTP 201 Created
{
  "id": "video_123",
  "object": "video",
  "model": "sora-2",
  "created_at": 1640995200,
  "status": "processing",
  "progress": 0
}
```

| 字段 | 说明 |
|---|---|
| id | 视频任务 ID（用于后续查询） |
| status | `processing`（进行中） |
| progress | 生成进度百分比 |

## 查询响应

```
HTTP 200
{
  "id": "video_123",
  "object": "video",
  "model": "sora-2",
  "created_at": 1640995200,
  "status": "succeeded",   // processing / succeeded / failed
  "progress": 100,
  "size": "1920x1080",
  "seconds": "5",
  "url": "https://...video.mp4",  // 完成后才有
  "error": null                      // 失败时有
}
```

## 错误响应格式

New-API 有两种错误格式，工具需要都处理：

```
// OpenAI 风格
{"error":{"message":"Invalid token","type":"new_api_error","code":"insufficient_user_quota"}}

// 中转站自身风格（部分端点）
{"code":"insufficient_user_quota","message":"用户额度不足","data":null}
```

## 支持的模型

- `sora-2`：OpenAI Sora 视频生成
- `doubao-seedance-2-0` / `doubao-seedance-2-0-fast` / `doubao-seedance-2-0-mini`：字节 Seedance
- `kling-v1` / `kling-v2-master`：可灵 AI
- `jimeng_vgfm_t2v_l20` / `jimeng_vgfm_i2v_l20`：即梦
- `viduq1`：Vidu
- `wan2.5-t2v-preview` / `wan2.5-i2v-preview`：阿里万相

## JavaScript 调用示例（FormData）

```javascript
const formData = new FormData();
formData.append('prompt', '一只老虎在森林中奔跑');
formData.append('model', 'doubao-seedance-2-0');
formData.append('seconds', '5');
formData.append('size', '1920x1080');
// 图生视频时追加文件
// formData.append('input_reference', imageFile);

const res = await fetch(baseUrl + '/videos', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token },
  body: formData,  // 不要手动设 Content-Type，浏览器自动加 boundary
});
const json = await res.json();
const videoId = json.id;  // 提取任务 ID
```

## 查询示例

```javascript
const res = await fetch(baseUrl + '/videos/' + encodeURIComponent(videoId), {
  method: 'GET',
  headers: { 'Authorization': 'Bearer ' + token },
});
const json = await res.json();
if (json.status === 'succeeded') {
  // json.url 是视频下载链接
}
```

## 与 360 纳米 API 的关键差异

| 维度 | 360 纳米 `/api/nami/public/gen_video` | New-API `/v1/videos` |
|---|---|---|
| 请求格式 | JSON | multipart/form-data |
| 任务 ID 字段 | `data.mid` | `id` |
| 状态值 | 数字 0-5 | 字符串 processing/succeeded/failed |
| 查询方式 | POST + JSON body | GET + URL path |
| 分辨率参数 | `resolution: "720p"` | `size: "1920x1080"` |
| 时长参数 | `duration: 5` | `seconds: "5"` |
| 参考素材 | `reference_images/audios/videos` URL 数组 | `input_reference` 文件上传 |
| 错误格式 | `{code, msg}` | `{error:{message, type}}` |
