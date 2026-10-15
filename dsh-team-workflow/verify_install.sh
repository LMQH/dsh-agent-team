#!/usr/bin/env bash
# DeepSeekHarness 团队开发工作流 —— 安装后验证
# 只做读取与自检；不修改任何文件。
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
TARGET_TEAM="$DSH_HOME_RESOLVED/team"
MANIFEST="$TARGET_TEAM/manifest/installed-files.txt"
SUMS="$TARGET_TEAM/manifest/SHA256SUMS"
PROFILE_PATCH="$DSH_HOME_RESOLVED/profiles/desktop/cordis.patch.yml"

pass=0; fail=0; warn=0
ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  WARN  %s\n' "$1"; warn=$((warn+1)); }

echo "== 1. 指令层 =="
if [ -f "$DSH_HOME_RESOLVED/AGENTS.md" ]; then
  if cmp -s "$SRC/instructions/AGENTS.md" "$DSH_HOME_RESOLVED/AGENTS.md"; then
    ok "全局指令 ~/.dsh/AGENTS.md 与产物一致 ($(wc -c < "$DSH_HOME_RESOLVED/AGENTS.md" | tr -d ' ') 字节)"
  else
    note "~/.dsh/AGENTS.md 与产物不一致（可能被用户修改）"
  fi
else bad "缺少 ~/.dsh/AGENTS.md"; fi
[ -f "$TARGET_TEAM/RULES.md" ] && ok "~/.dsh/team/RULES.md" || bad "缺少 RULES.md"

echo "== 2. 技能层 =="
n=$(find "$TARGET_TEAM/../skills" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -ge 24 ] && ok "已安装技能 $n 个 (>=24)" || bad "已安装技能仅 $n 个 (<24)"
nested=$(find "$DSH_HOME_RESOLVED/skills" -mindepth 3 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
[ "$nested" = 0 ] && ok "无嵌套 SKILL.md（平台只发现一层）" || bad "存在 $nested 个嵌套 SKILL.md，平台不会发现"
for missing in react-page-implementation branch-diff-static-review; do
  if [ -e "$DSH_HOME_RESOLVED/skills/$missing" ]; then bad "不应存在的悬空技能被创建: $missing"; else ok "悬空技能未被伪造: $missing"; fi
done
[ -f "$SRC/skills/_tools/validate_skills.js" ] && node "$SRC/skills/_tools/validate_skills.js" >/dev/null 2>&1 \
  && ok "skills 校验器通过" || bad "skills 校验器失败（运行 node skills/_tools/validate_skills.js 看详情）"

echo "== 3. 角色层 =="
r=$(find "$DSH_HOME_RESOLVED/roles" -mindepth 1 -maxdepth 1 -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')
[ "$r" -eq 10 ] && ok "已安装角色 $r 个" || bad "已安装角色 $r 个（期望 10）"
[ -f "$SRC/roles/_tools/validate_roles.js" ] && node "$SRC/roles/_tools/validate_roles.js" >/dev/null 2>&1 \
  && ok "roles 校验器通过" || bad "roles 校验器失败（运行 node roles/_tools/validate_roles.js 看详情）"

echo "== 4. 策略层 =="
[ -f "$TARGET_TEAM/hooks.json" ] && ok "~/.dsh/team/hooks.json" || bad "缺少 hooks.json"
if [ -f "$TARGET_TEAM/hooks.json" ]; then
  if grep -q '__DSH_TEAM_DIR__' "$TARGET_TEAM/hooks.json"; then bad "hooks.json 仍有未解析占位符 __DSH_TEAM_DIR__"; else ok "hooks.json 占位符已解析"; fi
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TARGET_TEAM/hooks.json" \
    && ok "hooks.json 是合法 JSON" || bad "hooks.json 不是合法 JSON"
fi
[ -f "$TARGET_TEAM/policies/policy_check.js" ] && node -e 'require("fs").readFileSync(process.argv[1])' "$TARGET_TEAM/policies/policy_check.js" \
  && ok "policy_check.js 可读" || bad "缺少 policy_check.js"
if [ -f "$SRC/policies/tests/run.js" ]; then
  node "$SRC/policies/tests/run.js" >/dev/null 2>&1 && ok "策略测试全部通过" || bad "策略测试失败（运行 node policies/tests/run.js 看详情）"
else note "未找到 policies/tests/run.js，跳过策略测试"; fi

echo "== 5. 台账层 =="
L="$TARGET_TEAM/ledger/agent-ledger.jsonl"
[ -f "$L" ] && ok "append-only 台账存在 ($(wc -l < "$L" | tr -d ' ') 条)" || bad "缺少 $L"
[ -f "$TARGET_TEAM/policies/ledger.js" ] && node "$TARGET_TEAM/policies/ledger.js" --verify >/dev/null 2>&1 \
  && ok "台账完整性校验通过" || note "台账校验未通过或 ledger.js 不可用"

echo "== 6. 挂载状态 =="
if [ -f "$PROFILE_PATCH" ] && grep -q "dsh-hooks-claude-code" "$PROFILE_PATCH"; then
  ok "profile 已挂载 hooks-claude-code"
  # 2026-10-13 实测更正：挂载在运行中的实例上**即时生效**，无需重启。
  # 真正需要证明的是"钩子是否真的会触发"，因此这里做一次**只读**决策探针：
  # 把一条必然被拒的 payload 喂给已安装的策略程序，观察是否返回 exit 2。
  PROBE='{"session_id":"verify","transcript_path":"","cwd":"'"$PWD"'","hook_event_name":"PreToolUse","tool_name":"write","tool_input":{"file_path":"'"$HOME"'/.ssh/id_rsa","content":"x"},"tool_use_id":"tu-verify-probe"}'
  printf '%s' "$PROBE" | node "$TARGET_TEAM/policies/policy_check.js" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 2 ]; then ok "策略程序探针已拦截（exit 2，决策链路可工作）"
  elif [ "$rc" -eq 0 ]; then bad "策略探针未被拦截（期望 exit 2，实际 0）——钩子可能未生效"
  else note "策略探针返回 exit ${rc}（非 2 非 0）——检查 node 与 policy_check.js"; fi
  if [ -f "$SRC/evidence/live-hook-firing.txt" ]; then
    ok "存在运行中实例的活体触发证据 evidence/live-hook-firing.txt（无需重启）"
  else
    note "无活体触发证据文件；挂载与探针以上述结果为准"
  fi
else
  bad "profile 未挂载 hooks-claude-code（运行 ./install.sh）"
fi

echo "== 7. 清单哈希 =="
if [ -f "$SUMS" ]; then
  if ( cd / && shasum -a 256 -c "$SUMS" >/dev/null 2>&1 ); then ok "SHA256SUMS 全部匹配"; else bad "SHA256SUMS 有文件不匹配或被修改"; fi
else note "无 SHA256SUMS（清单未生成）"; fi

echo ""
echo "== 汇总：PASS=$pass FAIL=$fail WARN=$warn =="
[ "$fail" = 0 ] || exit 1
