# 可灵 AI API 接入参考

## 基础信息

- **平台**：快手可灵 AI（Kling AI），内部代号 Nami（奈美）
- **底层模型**：Seedance 系列
- **官方域名**：`klingai.com`（API 域名 `api.so.n.cn` 是快手的短域名）
- **接口文档**：https://klingai.com/document-api/

## 核心 API

### 视频生成任务提交

```
POST https://api.so.n.cn/api/nami/public/gen_video
Authorization: Bearer ***
Content-Type: application/json
```

Body 示例：
```json
{
  "apply_model": "seedance20",
  "duration": 5,
  "gen_mod": 0,
  "generate_audio": false,
  "prompt": "一只老虎在森林中奔跑",
  "ratio": "16:9",
  "reference_audios": [],
  "reference_images": [],
  "reference_videos": [],
  "resolution": "720p"
}
```

### 任务进度查询

```
POST https://api.so.n.cn/api/nami/public/gen_video/progress
Authorization: Bearer ***
Content-Type: application/json
```

Body 示例：
```json
{
  "mid": "Vgwgt0mH5SZ"
}
```

## 参数说明

| 参数 | 类型 | 说明 |
|---|---|---|
| `apply_model` | string | 模型编码：`seedance20` / `seedance20-fast` |
| `duration` | int | 时长，1~60 秒 |
| `gen_mod` | int | 0 普通模式，1 首尾帧模式 |
| `generate_audio` | bool | 是否生成配套音频 |
| `prompt` | string | 提示词，最大 1000 字 |
| `ratio` | string | `16:9` / `9:16` / `1:1` |
| `resolution` | string | `720p` / `1080p` |
| `reference_audios` | array[string] | 参考音频 URL 数组 |
| `reference_images` | array[string] | 参考图片 URL 数组 |
| `reference_videos` | array[string] | 参考视频 URL 数组 |

## 鉴权方式

- **纯 Bearer Token**，无需 Cookie/登录态
- 申请地址：https://klingai.com/dev/api-key
- 门槛较低，在线申请即可使用

## 并发限制

- 最大 400 并发数
- 24,000 RPM

## 返回数据结构

### 提交响应
```json
{
  "code": 0,
  "msg": "ok",
  "data": { "mid": "Vfw0unIDPUs" }
}
```

### 查询响应
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "mid": "qDMJ5E0EwqB",
    "task_status": 3,
    "download_url": "",
    "cover": "",
    "failure_reason": null,
    "token_count": 368100,
    "coin_consume": "16.9326"
  }
}
```

## 任务状态码

| 值 | 含义 |
|---|---|
| 0 | 排队中 |
| 1 | 处理中 |
| 2 | 处理中（中间态） |
| 3 | 已完成 |
| 4 | 失败 |
| 5 | 已取消 |

## 常见错误码

| 错误码 | 含义 |
|---|---|
| 100001 | 参数格式错误 |
| 100002 | 参数无效（最常见：参考素材 URL 不可访问） |
| 301030 | 提示词违规 |
| 301031 | 参考图片违规 |
| 301037 | 参考视频违规 |
| 301043 | 参考音频违规 |
| 301050 | 参考音频时长超过 10 分钟 |
| 401001 | 认证失败（Token 无效/过期） |
| 429001 | 请求频率超限 |
| 551003 | 任务失败 |

## 参考素材 URL 要求

- 提交接口**会校验 URL 是否真实可访问**（服务器发起 HTTP 请求检测）
- 无效 URL 将导致 `code：100002` 错误
- 纯前端 `file://` 路径或 `blob://` URL 不可用
- 必须上传到公网可访问的存储服务

## 支持的文件类型

| 类型 | 扩展名 |
|---|---|
| 音频 | .mp3, .wav, .aac, .flac, .ogg, .m4a |
| 图片 | .jpg, .jpeg, .png, .webp, .gif, .bmp |
| 视频 | .mp4, .webm, .avi, .mov, .mkv, .flv |

## vs 即梦 AI（火山引擎）

| 维度 | 可灵 AI | 即梦 AI |
|---|---|---|
| 鉴权 | Bearer Token（简单） | AK/SK 签名 → access_token |
| 申请门槛 | 低，在线申请即用 | 需企业实名认证、签约 |
| 底层模型 | Seedance（视频） | Seedream（图片）/ Seedance（视频） |
| API 域名 | api.so.n.cn | api.volcengine.com |