#!/usr/bin/env bash
# DeepSeekHarness 团队开发工作流 —— 安装器
#
# 把本目录的复刻产物安装到 DSH 用户配置根（$DSH_HOME，默认 ~/.dsh）。
# 幂等：重复执行只覆盖本工作流自己安装的文件，并留下清单与哈希。
# 所有破坏性动作前都会先备份；可用 uninstall.sh 回滚。
#
# 用法：
#   ./install.sh                 # 安装
#   ./install.sh --dry-run       # 只打印将要执行的动作
#   ./install.sh --no-profile    # 不修改 desktop profile 的 cordis.patch.yml
#   ./install.sh --no-instructions  # 不安装全局 ~/.dsh/AGENTS.md
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
TARGET_TEAM="$DSH_HOME_RESOLVED/team"
TARGET_SKILLS="$DSH_HOME_RESOLVED/skills"
TARGET_ROLES="$DSH_HOME_RESOLVED/roles"
PROFILE_PATCH="$DSH_HOME_RESOLVED/profiles/desktop/cordis.patch.yml"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DSH_HOME_RESOLVED/team/.install-backups/$STAMP"

DRY_RUN=0
DO_PROFILE=1
DO_INSTRUCTIONS=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-profile) DO_PROFILE=0 ;;
    --no-instructions) DO_INSTRUCTIONS=0 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '%s\n' "$*"; }
run()  { if [ "$DRY_RUN" = 1 ]; then log "  [dry-run] $*"; else "$@"; fi; }

log "== DeepSeekHarness 团队工作流安装 =="
log "源:      $SRC"
log "DSH_HOME: $DSH_HOME_RESOLVED"
log "备份:    $BACKUP_DIR"
[ "$DRY_RUN" = 1 ] && log "模式:    DRY-RUN（不写入）"

# ---------- 0. 前置校验 ----------
fail=0
for f in instructions/AGENTS.md instructions/RULES.md policies/hooks.json; do
  [ -f "$SRC/$f" ] || { log "缺少必要文件: $f"; fail=1; }
done
[ -d "$SRC/skills" ] || { log "缺少 skills/ 目录"; fail=1; }
[ -d "$SRC/roles" ]  || { log "缺少 roles/ 目录";  fail=1; }
skill_count=$(find "$SRC/skills" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
role_count=$(find "$SRC/roles" -mindepth 1 -maxdepth 1 -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')
log "待安装技能: $skill_count  待安装角色: $role_count"
[ "$skill_count" -lt 1 ] && { log "skills/ 下没有发现 <name>/SKILL.md"; fail=1; }
[ "$role_count"  -lt 1 ] && { log "roles/ 下没有发现角色文件"; fail=1; }
if [ "$fail" = 1 ]; then log "安装中止：产物不完整。"; exit 1; fi

if [ -z "${DSH_HOME:-}" ]; then
  log "提示: 未设置 DSH_HOME，使用默认 $DSH_HOME_RESOLVED"
fi

# ---------- 1. 备份既有受管路径 ----------
run mkdir -p "$BACKUP_DIR"
backup_if_exists() {
  local p="$1" name="$2"
  if [ -e "$p" ]; then
    log "  备份 $p -> $BACKUP_DIR/$name"
    run cp -R "$p" "$BACKUP_DIR/$name"
  fi
}
if [ "$DO_INSTRUCTIONS" = 1 ]; then backup_if_exists "$DSH_HOME_RESOLVED/AGENTS.md" "AGENTS.md"; fi
backup_if_exists "$TARGET_TEAM"  "team"
backup_if_exists "$TARGET_ROLES" "roles"
if [ "$DO_PROFILE" = 1 ] && [ -f "$PROFILE_PATCH" ]; then
  backup_if_exists "$PROFILE_PATCH" "cordis.patch.yml"
fi

# ---------- 2. 指令层 ----------
if [ "$DO_INSTRUCTIONS" = 1 ]; then
  log "[指令] 安装全局指令 $DSH_HOME_RESOLVED/AGENTS.md"
  run cp "$SRC/instructions/AGENTS.md" "$DSH_HOME_RESOLVED/AGENTS.md"
fi

log "[指令] 安装团队规则与编排文档 -> $TARGET_TEAM"
run mkdir -p "$TARGET_TEAM/orchestration" "$TARGET_TEAM/templates" "$TARGET_TEAM/standards" "$TARGET_TEAM/ledger" "$TARGET_TEAM/policies" "$TARGET_TEAM/manifest"
run cp "$SRC/instructions/RULES.md" "$TARGET_TEAM/RULES.md"
if [ -d "$SRC/orchestration" ]; then run cp "$SRC"/orchestration/*.md "$TARGET_TEAM/orchestration/"; fi
if [ -d "$SRC/templates" ];     then run cp "$SRC"/templates/*.md     "$TARGET_TEAM/templates/";     fi

# ---------- 3. 策略层 ----------
log "[策略] 安装钩子配置与策略程序 -> $TARGET_TEAM"
if [ -f "$SRC/policies/hooks.json" ];      then run cp "$SRC/policies/hooks.json"      "$TARGET_TEAM/hooks.json"; fi
if [ -f "$SRC/policies/policy_check.js" ]; then run cp "$SRC/policies/policy_check.js" "$TARGET_TEAM/policies/policy_check.js"; fi
if [ -f "$SRC/policies/ledger.js" ];       then run cp "$SRC/policies/ledger.js"       "$TARGET_TEAM/policies/ledger.js"; fi

# 台账文件：只在不存在时创建，永不截断
if [ ! -f "$TARGET_TEAM/ledger/agent-ledger.jsonl" ]; then
  run touch "$TARGET_TEAM/ledger/agent-ledger.jsonl"
  log "[台账] 新建 append-only 台账 $TARGET_TEAM/ledger/agent-ledger.jsonl"
else
  log "[台账] 已存在，保持不动（append-only）"
fi

# 修正 hooks.json 中的占位路径为本机绝对路径（占位符 + 产物源路径都要指向安装位置）
if [ "$DRY_RUN" = 0 ] && [ -f "$TARGET_TEAM/hooks.json" ]; then
  node -e '
    const fs=require("fs");
    const p=process.argv[1], team=process.argv[2], src=process.argv[3];
    let s=fs.readFileSync(p,"utf8");
    s=s.split("__DSH_TEAM_DIR__").join(team);
    // 把指向产物源的绝对路径改写到安装位置，避免依赖工作区存在
    s=s.split(src+"/policies/").join(team+"/policies/");
    fs.writeFileSync(p,s);
  ' "$TARGET_TEAM/hooks.json" "$TARGET_TEAM" "$SRC"
  if grep -q '__DSH_TEAM_DIR__' "$TARGET_TEAM/hooks.json"; then
    log "[策略] 警告：hooks.json 仍有未解析占位符"; exit 1
  fi
  log "[策略] hooks.json 路径已重写为 $TARGET_TEAM"
fi

# ---------- 4. 技能层 ----------
log "[技能] 安装 $skill_count 个技能 -> $TARGET_SKILLS"
run mkdir -p "$TARGET_SKILLS"
if [ "$DRY_RUN" = 0 ]; then
  ( cd "$SRC/skills" && find . -mindepth 1 -maxdepth 1 -type d ! -name '_*' -print0 ) |
  while IFS= read -r -d '' d; do
    name="$(basename "$d")"
    rm -rf "${TARGET_SKILLS:?}/$name"
    cp -R "$SRC/skills/$name" "$TARGET_SKILLS/$name"
  done
  log "[技能] 完成（只替换同名技能目录，未触碰其他技能）"
fi

# ---------- 5. 角色层 ----------
log "[角色] 安装角色合同 -> $TARGET_ROLES"
run mkdir -p "$TARGET_ROLES"
if [ "$DRY_RUN" = 0 ] && [ -d "$SRC/roles" ]; then
  find "$SRC/roles" -mindepth 1 -maxdepth 1 -name '*.md' -exec cp {} "$TARGET_ROLES/" \;
  [ -f "$SRC/roles/registry.yaml" ] && cp "$SRC/roles/registry.yaml" "$TARGET_ROLES/"
fi

# ---------- 6. profile 挂载（钩子生效） ----------
if [ "$DO_PROFILE" = 1 ]; then
  log "[挂载] 追加 hooks-claude-code 到 $PROFILE_PATCH"
  if [ ! -f "$PROFILE_PATCH" ]; then
    log "  profile patch 不存在，跳过。请手动按 policies/ACTIVATION.md 挂载。"
  elif grep -q "dsh-hooks-claude-code" "$PROFILE_PATCH"; then
    log "  已存在 hooks-claude-code 条目，保持不动（幂等）"
  else
    if [ "$DRY_RUN" = 0 ]; then
      cat >> "$PROFILE_PATCH" <<EOF

# --- DSH 团队工作流策略层（由 install.sh 于 $STAMP 追加；回滚见 uninstall.sh）---
# 必须用 insert: 形式。本层是 patch 列表，裸 '- id:' 只会“覆盖已存在条目”，
# 而 hooks-claude-code 不属于任何 bundle，会被拒绝：patch: entry "hooks-claude-code" not found。
# 不设置 projectDir：让桥接使用每次会话的工作目录作为 hook cwd / CLAUDE_PROJECT_DIR。
- insert:
    - id: hooks-claude-code
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: $TARGET_TEAM/hooks.json
        defaultTimeoutMs: 10000
EOF
      log "  已追加（insert: 形式）。在运行中的实例上即时生效（2026-10-13 实测：无需重启）。"
    else
      log "  [dry-run] 将追加 insert: hooks-claude-code 条目"
    fi
  fi
fi

# ---------- 7. 生成清单与哈希 ----------
MANIFEST="$TARGET_TEAM/manifest/installed-files.txt"
SUMS="$TARGET_TEAM/manifest/SHA256SUMS"
if [ "$DRY_RUN" = 0 ]; then
  : > "$MANIFEST"
  {
    [ "$DO_INSTRUCTIONS" = 1 ] && [ -f "$DSH_HOME_RESOLVED/AGENTS.md" ] && echo "$DSH_HOME_RESOLVED/AGENTS.md"
    find "$TARGET_TEAM" -type f ! -path '*/.install-backups/*' \
      ! -path '*/ledger/*' ! -name 'installed-files.txt' ! -name 'SHA256SUMS' 2>/dev/null
    find "$TARGET_SKILLS" -type f 2>/dev/null
    find "$TARGET_ROLES"  -type f 2>/dev/null
  } | sort -u > "$MANIFEST"
  ( cd / && shasum -a 256 $(cat "$MANIFEST") ) > "$SUMS" 2>/dev/null || true
  log "[清单] $MANIFEST ($(wc -l < "$MANIFEST" | tr -d ' ') 个文件)"
  log "[清单] $SUMS"
fi

# ---------- 8. 自检 ----------
log "[自检] 运行技能校验器"
if [ "$DRY_RUN" = 0 ] && [ -f "$SRC/skills/_tools/validate_skills.js" ]; then
  node "$SRC/skills/_tools/validate_skills.js" || { log "技能校验失败：安装已写入，但产物不合格。"; exit 1; }
fi
if [ "$DRY_RUN" = 0 ] && [ -f "$SRC/roles/_tools/validate_roles.js" ]; then
  node "$SRC/roles/_tools/validate_roles.js" || { log "角色校验失败：安装已写入，但产物不合格。"; exit 1; }
fi

log ""
log "== 安装完成 =="
log "下一步："
log "  1) 挂载在运行中的实例上即时生效（实测：无需重启）；只有改 hooks.json 本身才需重新加载 profile。"
log "  2) 验证：./verify_install.sh"
log "  3) 回滚：./uninstall.sh"
log "  4) 技能与角色校验：node skills/_tools/validate_skills.js && node roles/_tools/validate_roles.js"
