# Agent 团队工作流（DSH 插件）· 项目根

给 DeepSeek Harness 加一个**角色名册卡片**与 `/team` 命令的完整项目：宿主半 + 客户端半 + 角色资源包 + 生成器 + 门脚本 + 证据。

> 2026-10-15 从 `~/Documents/deepseek-harness/default-workspace/` 迁移到此处。
> 迁移记录与验证证据见 `dsh-team-workflow/evidence/迁移-2026-10-15.md`。

## 目录结构（两部分，缺一不可）

```
agent-team-workflow/
├── dsh-team-plugin/       ← DSH 插件包本体（也是 pnpm pack 的直接来源）
│   ├── index.js           手写：宿主半（/team 命令、角色名册、配置声明）
│   ├── client.js          生成：客户端半（页头卡片 + 配置弹窗）
│   ├── roles.json         生成：角色数据（卡片与名册共用）
│   ├── package.json       dsh.bundle.patch / dsh.client 声明
│   ├── cordis.patch.yml   profile 补丁层（挂载条目 team-workflow）
│   ├── locale/{zh,en}.json  自有命名空间文案
│   └── CONSTITUTION.md / README.md / ACCEPTANCE.md / install.sh / uninstall.sh
└── dsh-team-workflow/     ← 资源包与工具链
    ├── roles/*.md         真源：10 个角色定义
    ├── skills/           真源：技能清单（含 MISSING-SKILLS.md）
    ├── _tools/           生成器 + 门脚本 + 反证脚本 + 只读 ASAR 检视器
    ├── policies/         团队策略钩子（hooks.json 模板 + policy_check.js + ledger.js）
    ├── evidence/         每轮的实测证据
    └── docs/ templates/ orchestration/ verification/ ledger/ manifest/
```

两个目录必须保持**兄弟关系**：`_tools/*.js` 通过 `../dsh-team-plugin/` 读写产物，`install.sh` 也按脚本自身位置推导路径。

## 真源规则（改之前先读这条）

| 文件 | 性质 | 怎么改 |
|---|---|---|
| `dsh-team-workflow/roles/*.md`、`skills/` | **真源** | 直接改，然后 `sync-roles-from-pack.js` → `build-client.js` |
| `dsh-team-plugin/index.js`、`package.json`、`locale/`、`cordis.patch.yml`、`icon.svg` | **手写** | 直接改 |
| `dsh-team-plugin/client.js`、`roles.json` | **生成物** | **禁止手改**，门 `6c` 会抓（生成器幂等） |
| `dsh-team-workflow/_tools/build-client.js` | 客户端补丁生成器 | 改界面就改它，再重跑 |

## 常用命令

```bash
cd dsh-team-workflow
node _tools/sync-roles-from-pack.js      # 角色资源包 → roles.json
node _tools/build-client.js              # roles.json + 官方 bundle → client.js
node _tools/verify-acceptance.js         # 验收门（当前 27/27）+ 客户端坐标回归
node _tools/redcheck-second-ruling.mjs   # C14 反证：21 个变异逐个必须红
node _tools/inspect-dsh-checkout.js find <子串>   # 只读检视 app.asar

cd ../dsh-team-plugin
./install.sh                             # 官方通路安装（pnpm add file:<本目录> + 登记组合包）
./uninstall.sh                           # 卸载（pnpm remove，不做 rm -rf）
```

## 对外交付

交付包在 `dist/dsh-team-workflow-0.3.0/`，三件：`local-dsh-team-workflow-0.3.0.tgz`（官方 tarball spec）、自带依赖的解压目录、`安装说明.md`。
重现命令与"为什么解压目录要自带 `node_modules`"（官方对本地目录 spec 用 `link:`、不装依赖）见 `dsh-team-plugin/README.md` 的「对外交付」节。

## 迁移后仍指向旧路径的地方（有意保留）

- `dsh-team-workflow/evidence/**` 里的历史证据：记录当时发生的事，**不改写**（其中出现的 `…/default-workspace/…` 是历史事实）。
- `~/.dsh/team/ledger/agent-ledger.jsonl`：append-only，永不改写。
- `~/.dsh/team/authorizations.json` 里 5 条 **已消费**的历史授权（`AUTH-20261013-00x`）：指向 `scratch-delivery/`（未搬迁）与一处已搬走的 `dsh-team-workflow/docs`，保持原样。
- `~/.dsh/storages/session_projcache/**`、各处 `.bak-*`：缓存与备份，不动。
