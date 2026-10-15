#!/usr/bin/env bash
# 安装「Agent 团队工作流」为 DSH **组合包（bundle）**——走**官方通路**（C21.4）。
#
# 为什么不再用符号链接（旧做法，已废弃）：
#   宿主半自 C21 起依赖 `@deepseek-ai/schemastery`（官方设置服务读取配置 schema 的唯一方式），
#   符号链接装法给不了解析它的地方；而且用户 2026-10-14 明确裁决「只留官方安装」。
#
# 做法（与 GUI 插件管理器同一条路）：
#   1. `pnpm add file:<本目录>` —— 在 profile 的 node_modules 下装出**真实的目录拷贝**，
#      并把 dependencies 里的 @deepseek-ai/schemastery 提升到 profile 根
#      （本机实测：nodeLinker=hoisted，嵌套 import 能解析到它）。
#   2. 把包名登记进 profile package.json 的 `dsh.profile.bundles`。
#   3. 打印实机证据：装出来的文件清单 + 用**真 schemastery** 解析出的 Config 字段与默认值。
#   4. 触发一次重新组合（摘掉 → 触发 → 等一拍 → 挂回 → 触发），等日志确认宿主进程内真的执行了。
#
# ⚠️ 代价（C21.4 要求写进文档，也必须让用的人看到）：
#   装完之后**改工作区不再自动生效**。每次改动要：
#     node _tools/build-client.js        # 重新生成 client.js（若改了生成器/角色/词条）
#     ./install.sh                       # 重新装进 profile
#     重启 DSH                           # 客户端产物变更必须重启（C15）
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILE_NAME="${DSH_PROFILE:-desktop}"
PROFILE="$HOME/.dsh/profiles/$PROFILE_NAME"
PKG_JSON="$PROFILE/package.json"
PATCH="$PROFILE/cordis.patch.yml"
BUNDLE="@local/dsh-team-workflow"
TARGET="$PROFILE/node_modules/@local/dsh-team-workflow"
LOG="$HOME/.dsh/team-workflow/plugin.log"
MARK="# team-workflow-reload:"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG_JSON" ]; then
  echo "找不到 profile：${PROFILE}（可用 DSH_PROFILE 指定）" >&2
  exit 1
fi

# ---------- 0. 找 pnpm / node（优先 DSH 运行时自带的那份）----------
RUNTIME="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies"
NODE_BIN="${DSH_NODE:-}"
PNPM_JS="${DSH_PNPM:-}"
if [ -z "$NODE_BIN" ] && [ -x "$RUNTIME/node/bin/node" ]; then NODE_BIN="$RUNTIME/node/bin/node"; fi
if [ -z "$PNPM_JS" ] && [ -f "$RUNTIME/pnpm/bin/pnpm.mjs" ]; then PNPM_JS="$RUNTIME/pnpm/bin/pnpm.mjs"; fi
if [ -z "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi
if [ -z "$PNPM_JS" ]; then
  if command -v pnpm >/dev/null 2>&1; then PNPM_JS=""; else
    echo "找不到 pnpm：设置 DSH_PNPM=<pnpm.mjs 或 pnpm 可执行文件> 后重试" >&2
    exit 1
  fi
fi
run_pnpm() {
  if [ -z "$PNPM_JS" ]; then pnpm "$@"; else "$NODE_BIN" "$PNPM_JS" "$@"; fi
}

# ---------- 1. 旧符号链接必须先摘掉（否则 pnpm 会往链接里写）----------
if [ -L "$TARGET" ]; then
  echo "[1/4] 发现旧的符号链接安装（$TARGET -> $(readlink "$TARGET")），先摘掉"
  rm "$TARGET"
fi

# ---------- 2. 走官方通路装依赖 ----------
cp "$PKG_JSON" "$PKG_JSON.bak-team-workflow-$STAMP"
[ -f "$PATCH" ] && cp "$PATCH" "$PATCH.bak-team-workflow-$STAMP"
echo "[2/4] pnpm add file:$PLUGIN_DIR （profile=${PROFILE_NAME}；备份 package.json → .bak-team-workflow-${STAMP}）"
( cd "$PROFILE" && run_pnpm add "file:$PLUGIN_DIR" )

# ---------- 3. 实机证据：装出来的形状 + 真 schemastery 解析出的 Config ----------
if [ -L "$TARGET" ]; then
  echo "✗ 装出来仍是符号链接（官方通路应当装出真实目录拷贝）" >&2
  exit 1
fi
echo "[3/4] 已装出真实目录拷贝："
ls "$TARGET" | sed 's/^/      /'
( cd "$PROFILE" && "$NODE_BIN" -e '
const name = "@local/dsh-team-workflow";
import(name).then((plugin) => {
  const json = typeof plugin.Config?.toJSON === "function" ? plugin.Config.toJSON() : null;
  const fields = json === null ? {} : Object.fromEntries(
    Object.entries(json.refs[json.uid].dict).map(([key, ref]) => {
      const node = json.refs[String(ref)];
      return [key, { type: node.type, default: node.meta?.default, volatile: node.meta?.volatile === true }];
    }),
  );
  const okShape = ["disabledRoles", "autoloadSkills", "routeGuard", "showTaskBoard", "hideUnassignedRoles", "forceCompactPanel"]
    .every((key) => fields[key] !== undefined && fields[key].volatile === true);
  console.log("      plugin.name =", plugin.name);
  console.log("      Config（真 schemastery 解析）=", JSON.stringify(fields));
  console.log("      六字段齐全且全部 volatile =", okShape ? "是" : "否");
  console.log("      effectiveConfig({}) 默认值 =", JSON.stringify(plugin.effectiveConfig({})));
  if (!okShape) process.exit(1);
}).catch((error) => { console.error("      ✗ 导入失败：", error.message); process.exit(1); });
' ) || { echo "✗ 装出来的副本无法导入（依赖没解析到？）" >&2; exit 1; }

# ---------- 4. 登记为组合包 + 触发重新组合 ----------
# 实测结论：加载器按 id 去重，**无变化**的重复挂载不会重新激活组件；
# 而且两次重新组合若挨得太近会被合并成一次。所以要
#   摘掉 → 触发重新组合 → 等一拍 → 挂回 → 再触发
# 才能稳定地重新激活（这正是验证「组合包确实生效」的手段）。
set_bundle() {
  node -e '
const fs = require("fs");
const [file, bundle, mode] = process.argv.slice(1);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
doc.dsh = doc.dsh || {};
doc.dsh.profile = doc.dsh.profile || {};
let list = doc.dsh.profile.bundles || [];
if (mode === "remove") list = list.filter((b) => b !== bundle);
else if (!list.includes(bundle)) list.push(bundle);
doc.dsh.profile.bundles = list;
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
' "$PKG_JSON" "$BUNDLE" "$1"
}

recompose() {
  grep -v "^$MARK" "$PATCH" > "$PATCH.tmp" 2>/dev/null || true
  mv "$PATCH.tmp" "$PATCH"
  printf '%s %s\n' "$MARK" "$(date +%s%N)" >> "$PATCH"
}

set_bundle remove
recompose
sleep "${TOGGLE_PAUSE:-8}"
set_bundle add
recompose
echo "[4/4] bundles = $(node -e 'console.log(JSON.stringify(require(process.argv[1]).dsh.profile.bundles))' "$PKG_JSON")"

echo "已触发重新组合，等待激活（最多 40 秒）..."
BEFORE=0
[ -f "$LOG" ] && BEFORE=$(wc -l < "$LOG" | tr -d ' ')
for _ in $(seq 1 20); do
  NOW=0
  [ -f "$LOG" ] && NOW=$(wc -l < "$LOG" | tr -d ' ')
  if [ "$NOW" -gt "$BEFORE" ]; then
    echo "✅ 组合包已激活（宿主进程内执行）："
    tail -n $((NOW - BEFORE)) "$LOG"
    echo ""
    echo "角色名册：$HOME/.dsh/team-workflow/roles.md"
    echo "对话内输入 /team 查看角色；卡片右侧「配置」按钮打开本插件自己的配置弹窗。"
    echo "⚠️ 客户端产物（client.js）有改动时必须重启 DSH 才会生效（C15）。"
    exit 0
  fi
  sleep 2
done

echo "⚠️ 40 秒内未观察到激活。请重启 DSH；回滚：./uninstall.sh" >&2
exit 1
