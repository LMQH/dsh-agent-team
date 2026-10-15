#!/usr/bin/env bash
# 卸载「Agent 团队工作流」组合包：从 bundles 摘除 + 用官方通路把依赖卸掉。
# 不动 profile 的其它任何内容。符号链接式的旧安装也会被一并清掉。
set -euo pipefail

PROFILE_NAME="${DSH_PROFILE:-desktop}"
PROFILE="$HOME/.dsh/profiles/$PROFILE_NAME"
PKG_JSON="$PROFILE/package.json"
PATCH="$PROFILE/cordis.patch.yml"
BUNDLE="@local/dsh-team-workflow"
TARGET="$PROFILE/node_modules/@local/dsh-team-workflow"
MARK="# team-workflow-reload:"

RUNTIME="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies"
NODE_BIN="${DSH_NODE:-}"
PNPM_JS="${DSH_PNPM:-}"
if [ -z "$NODE_BIN" ] && [ -x "$RUNTIME/node/bin/node" ]; then NODE_BIN="$RUNTIME/node/bin/node"; fi
if [ -z "$PNPM_JS" ] && [ -f "$RUNTIME/pnpm/bin/pnpm.mjs" ]; then PNPM_JS="$RUNTIME/pnpm/bin/pnpm.mjs"; fi
if [ -z "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi
run_pnpm() {
  if [ -n "$PNPM_JS" ]; then "$NODE_BIN" "$PNPM_JS" "$@";
  elif command -v pnpm >/dev/null 2>&1; then pnpm "$@";
  else return 127; fi
}

if [ ! -f "$PKG_JSON" ]; then
  echo "找不到 profile：$PROFILE" >&2
  exit 1
fi

# ---------- 1. 从组合包清单摘除 ----------
node -e '
const fs = require("fs");
const [file, bundle] = process.argv.slice(1);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const list = (doc.dsh && doc.dsh.profile && doc.dsh.profile.bundles) || [];
const next = list.filter((b) => b !== bundle);
doc.dsh.profile.bundles = next;
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log("bundles =", JSON.stringify(next));
' "$PKG_JSON" "$BUNDLE"

# ---------- 2. 卸依赖（官方通路；旧符号链接也在这里被摘掉）----------
if [ -L "$TARGET" ]; then
  rm "$TARGET"
  echo "已摘掉旧的符号链接安装：$TARGET"
elif [ -d "$TARGET" ]; then
  echo "pnpm remove $BUNDLE （卸掉真实目录拷贝）"
  ( cd "$PROFILE" && run_pnpm remove "$BUNDLE" ) || {
    echo "✗ pnpm remove 失败：请手动处理 ${TARGET}（本脚本不做 rm -rf）" >&2
    exit 1
  }
else
  echo "node_modules 下没有本插件：$TARGET"
fi

# ---------- 3. 触发重新组合 ----------
grep -v "^$MARK" "$PATCH" > "$PATCH.tmp" 2>/dev/null || true
mv "$PATCH.tmp" "$PATCH"
printf '%s %s\n' "$MARK" "$(date +%s)" >> "$PATCH"

echo "已从组合包清单移除。"
echo "注意：实测运行时卸载不一定立即生效（可能需重启 DSH 才彻底卸下）。"
echo "插件的落盘数据仍在 ~/.dsh/team-workflow/。"
