#!/usr/bin/env bash
# DeepSeekHarness 团队开发工作流 —— 卸载/回滚
#
# 只删除 install.sh 清单内的文件；用户自己新增的文件一律保留并告警。
# 若安装时有备份，优先还原备份。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
TARGET_TEAM="$DSH_HOME_RESOLVED/team"
MANIFEST="$TARGET_TEAM/manifest/installed-files.txt"
PROFILE_PATCH="$DSH_HOME_RESOLVED/profiles/desktop/cordis.patch.yml"

DRY_RUN=0
KEEP_INSTRUCTIONS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --keep-instructions) KEEP_INSTRUCTIONS=1 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then log "  [dry-run] $*"; else "$@"; fi; }

log "== 卸载 DSH 团队工作流 =="
log "DSH_HOME: $DSH_HOME_RESOLVED"

# 安全检查：DSH_HOME 必须是绝对路径且位于 $HOME 之下（防误删）
case "$DSH_HOME_RESOLVED" in
  "$HOME"/*) : ;;
  *) log "拒绝执行：DSH_HOME 不在 \$HOME 之下（$DSH_HOME_RESOLVED）"; exit 1 ;;
esac

# ---------- 1. 移除清单内文件 ----------
if [ -f "$MANIFEST" ]; then
  removed=0; skipped=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      "$DSH_HOME_RESOLVED"/*) : ;;
      *) log "  跳过（不在 DSH_HOME 内）: $f"; skipped=$((skipped+1)); continue ;;
    esac
    if [ "$KEEP_INSTRUCTIONS" = 1 ] && [ "$f" = "$DSH_HOME_RESOLVED/AGENTS.md" ]; then
      log "  保留（--keep-instructions）: $f"; continue
    fi
    if [ -e "$f" ]; then run rm -f "$f"; removed=$((removed+1)); else skipped=$((skipped+1)); fi
  done < "$MANIFEST"
  log "清单文件: 已移除 $removed，跳过 $skipped"
else
  log "未找到清单 $MANIFEST —— 保守起见不做批量删除。"
  log "请手动检查 $TARGET_TEAM / $DSH_HOME_RESOLVED/skills / $DSH_HOME_RESOLVED/roles。"
fi

# ---------- 2. 清理空目录 ----------
if [ "$DRY_RUN" = 0 ]; then
  find "$TARGET_TEAM" "$DSH_HOME_RESOLVED/roles" -type d -empty -delete 2>/dev/null || true
  # 只删除已空的技能目录（不动其他技能）
  find "$DSH_HOME_RESOLVED/skills" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
fi

# ---------- 3. 还原备份的 AGENTS.md ----------
latest_backup="$(ls -1dt "$DSH_HOME_RESOLVED"/team/.install-backups/*/ 2>/dev/null | head -1 || true)"
if [ -n "$latest_backup" ] && [ -f "$latest_backup/AGENTS.md" ] && [ "$KEEP_INSTRUCTIONS" = 0 ]; then
  log "还原备份的 AGENTS.md: $latest_backup/AGENTS.md"
  run cp "$latest_backup/AGENTS.md" "$DSH_HOME_RESOLVED/AGENTS.md"
fi

# ---------- 4. 移除 profile 挂载条目 ----------
if [ -f "$PROFILE_PATCH" ]; then
  if grep -q "dsh-hooks-claude-code" "$PROFILE_PATCH"; then
    if [ "$DRY_RUN" = 1 ]; then
      log "  [dry-run] 从 $PROFILE_PATCH 移除 hooks-claude-code 挂载块"
    else
      cp "$PROFILE_PATCH" "$PROFILE_PATCH.bak-uninstall-$(date +%Y%m%d-%H%M%S)"
      node -e '
        const fs=require("fs");
        const p=process.argv[1];
        const lines=fs.readFileSync(p,"utf8").split("\n");
        const start=lines.findIndex(l=>l.startsWith("# --- DSH 团队工作流策略层"));
        if(start<0){ console.log("未找到安装标记；未修改 profile patch。"); process.exit(0); }
        // 移除标记行及其后的整个追加块：块由 "- insert:" 起始，其余行均带缩进。
        let end=start;
        for(let i=start+1;i<lines.length;i++){
          const l=lines[i];
          if(l.trim()===""){ end=i; continue; }
          if(i===start+1){ if(l.trim()!=="- insert:"){ break; } end=i; continue; }
          if(/^\s/.test(l)){ end=i; continue; }
          break;
        }
        lines.splice(start,end-start+1);
        while(lines.length&&lines[lines.length-1].trim()==="")lines.pop();
        fs.writeFileSync(p,lines.join("\n")+"\n");
        console.log("已移除策略挂载块（原文件另有备份 .bak-uninstall-*）");
      ' "$PROFILE_PATCH"
    fi
    log "  **需要重启 DeepSeekHarness 才会真正卸载钩子。**"
  else
    log "profile patch 中没有本工作流的挂载条目。"
  fi
fi

log ""
log "== 卸载完成 =="
log "保留项：~/.dsh/team/.install-backups/（如需彻底清理请手动确认后删除）"
