# Demo 前端开发模式（静态原型 → Docker 化演示）

记录于 2026-08-05 SynCore 前端 Demo 开发。

## 场景

后端已初步构建（FastAPI + SQLite + LangGraph），需要开发演示前端。
已有 HTML/CSS/JS 静态原型，需要：
1. 对接真实后端 API
2. Docker 容器化启动（前后分容器，不跑在本机）
3. 最小化实现，控制层真实可用，tool/skill 链路模拟

## 架构模式

```
浏览器 (localhost:8080)
  └─→ nginx (syncore-ui 容器, port 80)
       ├─ / → 静态文件（原型 HTML/CSS/JS）
       └─ /v1/* → proxy_pass → syncore:7777（后端容器）
                                └─ FastAPI
                                   ├─ GET /health
                                   ├─ POST /v1/tasks
                                   ├─ GET /v1/evidence/{id}
                                   ├─ GET /v1/quota/{agent_id}
                                   └─ GET /v1/agents
```

**关键选择：nginx 反向代理而非 CORS。** 理由：
- 不需要后端加 CORS middleware
- 同源请求，浏览器无跨域限制
- demo 阶段多个服务都在同一 Docker 网络

## 文件结构

```
core_ui/
├── Dockerfile              # nginx:alpine
├── nginx.conf              # 反代 /v1/ → 后端
└── prototype/
    ├── index.html          # 添加 <script src="api.js">
    ├── api.js              # 🆕 API 对接层
    ├── app.js              # 🔄 模拟→真实
    └── styles.css          # 不变
```

## API 对接层模式（api.js）

```js
const API = (() => {
  const BASE = '/v1';
  const ORIGIN = window.location.origin;
  const REQ_TIMEOUT = 15000;  // 关键：加 AbortController 超时

  async function _fetch(url, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT);
    try {
      return await fetch(url, { ...opts, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  // ... createTask, getEvidence, getQuota, topupQuota, listAgents
})();
```

**要点：**
- 所有方法通过 `_fetch` 统一走，确保超时一致
- 所有 API 通过 nginx 反代（同源），无需配置 base URL
- 环境切换（dev/prod）只需改 nginx proxy_pass

## 前端降级模式（app.js）

```js
let backendAvailable = false;

function initialize() {
  // 启动时健康检查
  API.healthCheck()
    .then(() => {
      backendAvailable = true;
      loadTaskHistory();
      getQuotaInfo();
    })
    .catch(() => {
      backendAvailable = false;
      showToast('🔌 演示模式：后端未连接');
    });
}

function generateAssistantReply(prompt) {
  // 1. 尝试真实 API
  API.createTask(prompt).then((result) => {
    // 成功后获取证据展示
    fetchEvidenceAndDisplay(result.run_id, prompt);
  }).catch((err) => {
    // 2. 后端不可用时降级到模拟
    if (!backendAvailable) {
      simulateFallbackReply(prompt);
      return;
    }
  });
}
```

**降级策略：**
- 启动时健康检查确定后端状态
- 请求失败时判断：从未成功过 → 走模拟；之前成功过 → 报错
- 模拟回复标注"🔌 后端服务未连接，已切换为模拟演示模式"

## Docker 多服务配置

```yaml
services:
  syncore:
    build: .
    ports: ["7777:7777"]
    environment:
      - SYNCORE_API_KEY=${SYNCORE_API_KEY:-}
    volumes:
      - ./data:/app/data

  syncore-ui:
    build: context: ./core_ui, dockerfile: Dockerfile
    ports: ["8080:80"]
    depends_on:
      - syncore
```

## 已知陷阱

### 🔴 后端依赖缺失导致容器崩溃重启

- `ModuleNotFoundError: No module named 'langgraph.checkpoint.sqlite'`
- **对策**：Dockerfile + pyproject.toml 都需引入 `langgraph-checkpoint-sqlite`
- 缺失时 `docker ps` 会显示 `Restarting` 状态，`docker logs` 查具体错误

### 🔴 `docker compose up -d` 被误判为长期进程

- macOS 上 docker compose 输出检测可能误判，导致终端工具 block
- **对策**：用 `execute_code`（Python subprocess）或分两步：`docker compose build` 后单独 `docker compose up -d`

### 🔴 遗留容器名冲突

- `Error: Conflict. The container name "/xxx" is already in use`
- **对策**：`docker rm -f <container-name>` 清理后重试

### 🔴 前端 fetch 无超时导致长挂

- 后端模型调用 timeout=300s，浏览器 fetch 默认无 timeout
- **对策**：api.js 用 AbortController + setTimeout 实现 15s 超时