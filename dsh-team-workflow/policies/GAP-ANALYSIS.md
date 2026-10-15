# GAP-ANALYSIS — OMP pre-tool interceptor → DSH policy hook layer

Reference: `sources/omp/extension/index.ts` (103 lines) and
`sources/omp/extension-tests/policy.test.ts` (33 lines, 5 cases) from the
migration package. The original is a **semantic reference only** — it imports
`@oh-my-pi/pi-coding-agent`, which is not used here.

Legend — **Status**: `same` (behaviour preserved) · `extended` (preserved and
broadened) · `changed` (deliberately different) · `new` (no original counterpart)
· `n/a` (no DSH seam).

---

## 1. Every behaviour of the original interceptor

| # | Original behaviour (`index.ts`) | Status | DSH implementation |
|---|---|---|---|
| O-1 | `evaluatePolicy("bash", cmd)` matches `BLOCKED_BASH[0]` = `/\b(?:kubectl\s+(?:apply\|delete)\|terraform\s+(?:apply\|destroy)\|helm\s+upgrade\|docker\s+push)\b/i` → block | **extended** | `policy_check.js` `analyzeWords` blocks `kubectl apply/delete/create/replace/patch/scale/rollout/drain/cordon/uncordon/edit`, `terraform apply/destroy/import/taint`, `helm upgrade/install/uninstall/rollback/delete`, `docker push` — and adds `docker compose up`, `docker-compose up`, `fly deploy/destroy`, `heroku …`, `scp`, `rsync <host>:…`. All are authorizable with an exact `type:"deploy"` record (the original had no authorization path at all). Code `DEPLOY_NO_AUTH`, auth type `deploy`. Tests `g4`, `g5`, `g6`. |
| O-2 | `BLOCKED_BASH[1]` = `/\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\b/i` → block **any** `rm -rf` | **changed** | `rm` with recursive+force flags is analysed by target: a wildcard/`~`/`/`/`$`-expanded target, or any target resolving (with real symlink resolution) outside the session workspace, is blocked **outright** (`RM_RECURSIVE_FORCE`, no authorization accepted); named targets **inside** the workspace are allowed. Rationale: the original's blanket block also stopped legitimate in-workspace `rm -rf node_modules`, while allowing `rm -rf /Users/…` to be caught only by luck of the flag spelling. Tests `k5` (allow), `h6` (block). |
| O-3 | Commit/push deliberately **removed** from `BLOCKED_BASH` on 2026-09-16 ("依仓库所有者授权移除…改为宪法 §四的流程门控"), so `git commit`/`git push`/`git add` are ALLOWED | **changed (re-tightened)** | `git commit` / `git push` are blocked again (`VCS_PUBLISH_NO_AUTH`, auth type `vcs_publish`), plus `npm`/`pnpm`/`yarn`/`bun publish` (`PACKAGE_PUBLISH_NO_AUTH`) and `gh release` (`RELEASE_PUBLISH_NO_AUTH`). The task contract for this port requires the tool-layer block, so the OMP owner-authorized exception is **not** inherited. `git add` stays allowed. Tests `f`, `g`, `g2`, `g3`, `k4`. |
| O-4 | `mutationPath` reads `input.path`, then `input.file`, then `edit`+`input.patch` (`^\[([^#\]]+)#`) | **extended** | `mutationPath` reads `file_path` (the real DSH argument name, verified against `@deepseek-ai/dsh-tool-fs`), then `path`, `file`, `filePath`, then the OMP `patch` form. A mutating tool with no resolvable path is **blocked** (`PATH_ARGUMENT_MISSING`) instead of silently allowed. Test `n5`. |
| O-5 | Gated tools are `["write","edit","lsp"]` | **changed** | Gated mutating set is `write`, `edit`, `str_replace_editor`, `notebook_edit`, `apply_patch`. `lsp` does not exist in DSH (no such tool is registered); `str_replace_editor` **does** exist (`@deepseek-ai/dsh-tool-str-replace-editor`, tool name verified in the shipped bundle) and is gated. |
| O-6 | `.env` / `.env.*` blocked, **except** `.env.example` | **changed (stricter default)** | `.env` and `.env.*` are blocked unconditionally, including `.env.example`. The task contract says "BLOCK, always: … `.env`, `.env.*`", so the original's template exemption is not the default. `DSH_TEAM_ALLOW_ENV_TEMPLATES=1` restores the original's exemption (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`). **This is the one place where a legitimate `.env.example` write that the original allowed is now blocked — flag it if the team wants the exemption back.** Tests `b`, `c`, `d`, `e`. |
| O-7 | `basename === ".env" \|\| basename.startsWith(".env.")` — basename only | **extended** | Same basename test, applied to **both** the lexical path and the realpath-resolved path, so a symlinked or traversed `.env` is caught. Tests `c`, `d`. |
| O-8 | `.gitlab-ci.yml` / `.gitlab-ci.yaml` blocked | **extended** | `.gitlab-ci.y(a)ml`, `Jenkinsfile`, `.travis.yml`, `azure-pipelines.y(a)ml`, `bitbucket-pipelines.yml`, `Dockerfile`, `Dockerfile.*`, `docker-compose*.y(a)ml`, `compose.y(a)ml`, and the `.github/workflows/**`, `.circleci/**`, `.gitlab/**` directory trees. Code `CI_CD_CONFIG`. Tests `e6`, `e7`. |
| O-9 | `/\bdeploy\/(?:k8s\/(?:test\|prod)\|monitoring)(?:\/\|$)/i` — only two hard-coded sub-trees | **extended** | Any path with a `deploy` path segment, and any `k8s`/`kubernetes` segment, regardless of sub-directory names. Code `PROTECTED_DEPLOY_PATH`. Test `e8`. |
| O-10 | `/Users/lmqhx/wiki/raw` — one machine-specific absolute path, regex-matched against a string that may not be absolute | **extended** | Any path with a `raw` segment whose parent directory looks like a knowledge vault (`…wiki`, `vault`, `obsidian`, `knowledge-base`, `notes`) — and, when `DSH_TEAM_VAULT_ROOTS` is set, any `raw/` tree under a configured vault root. Machine-independent. Code `VAULT_RAW_IMMUTABLE`. Test `e9`. |
| O-11 | `evaluateSubagentVaultWrite(hasUi, …)`: when `hasUi === false`, `write`/`edit`/`lsp` anywhere under `/Users/lmqhx/wiki` are blocked | **n/a → replaced** | The DSH hook payload carries **no UI-availability flag** and no per-call role identity, so `hasUi` cannot be reproduced. The equivalent protection is now stronger and role-independent: the entire vault `raw/` tree is immutable for every caller. **Uncovered:** the original also protected the *non-raw* vault (`wiki/concepts/…`, `wiki/log.md`) for headless callers; that is **not** re-implemented — see §3 G-18. |
| O-12 | `ctx.ui.notify("OMP team workflow policy active", "info")` on `session_start` | **n/a** | The Claude Code bridge's `SessionStart` hook can only inject model context; there is no toast channel, and `systemMessage` is explicitly logged-and-ignored by the bridge. Not implemented. |
| O-13 | `pi.registerCommand("team-policy")` — a slash command printing the active guardrails | **n/a** | No user-command seam in the hook bridge. Replaced by `policies/ACTIVATION.md` and `ledger/README.md` as human-readable documentation, and by the `DSH-POLICY-DENY` reason lines the model itself sees. |
| O-14 | `pi.setLabel("OMP Team Workflow")` | **n/a** | Cosmetic; the DSH plugin id is `hooks-claude-code`. |

---

## 2. Bypasses the original tests missed (and what the port does about them)

| # | Bypass in the original | Covered now? | Where |
|---|---|---|---|
| B-1 | **Symlinks** — no `realpath`; `write /repo/link` where `link → /repo/.env`, or a symlinked directory escaping the repo, passed cleanly | **yes** | `realpathDeepest()` resolves real symlinks on the deepest existing ancestor, then the protected-path and containment checks run on the *resolved* path as well as the lexical one. Test `d`. |
| B-2 | **`..` traversal** — `path.replace(/^\.\//,"")` only; `../../.env` or `/repo/../../etc/x` was never normalised | **yes** | `resolveUserPath()` applies `~` expansion then `path.resolve`, which normalises `..` before any check. Test `c`. |
| B-3 | **Absolute paths outside the workspace** — the original had no containment rule at all; `/etc/passwd`, `~/Library/…`, another repo were all writable | **yes** | Every mutating call must resolve inside a session-workspace root or a task-contract `allowed_paths` entry (checked on the realpath). Code `OUTSIDE_WORKSPACE`. Tests `e2`, `k5`. |
| B-4 | **Unlisted commands** — `npm publish`, `gh release`, `fly deploy`, `heroku`, `scp`, `dropdb`, `docker rm/rmi/volume rm`, `docker compose down -v`, `DROP DATABASE`, `TRUNCATE` all passed | **yes** | Full command families in `analyzeWords`/`analyzeRawSql`. Tests `g2`, `g3`, `h4`, `h5`, `i`, `h3`. |
| B-5 | **Indirect shell side effects** — `sh -c "git push"`, `ls && git push`, `echo $(git push)`, `` `git push` ``, `sudo git push`, `env git push` were invisible to the `/…/` regexes | **partly** | `splitTopLevel` splits on unquoted `;`, `&&`, `\|\|`, `\|`, newline; `extractSubstitutions` recurses into `$(…)` and backticks; `sudo`/`doas`/`env`/`nohup`/`time`/`nice`/`command` wrappers are stripped; env assignments are skipped. Tests `h7`, `h8`, `h9`. **Still uncovered:** `bash deploy.sh`, `eval "$X"`, `psql -f wipe.sql` — the command string does not contain the payload. |
| B-6 | **`prune` / wildcard deletion treated as an ordinary command** — `docker system prune -a` matched nothing; there was no notion of a named vs. blanket removal, and no authorization concept at all | **yes** | `docker prune`, `docker system/image/container/volume/builder/network prune`, `docker compose down -v/--rmi/--remove-orphans`, `docker rm $(…)`, `TRUNCATE` with no table, `dropDatabase()`, and `rm -rf` with a wildcard are blocked **outright** — an authorization record cannot unlock them. A plainly named `docker rm <id>` is a separate, authorizable case. Tests `h`, `h2`, `h3`, `j4`, `h9`. |
| B-7 | **No authorization verification** — the original only ever blocked; there was no way to record "the human approved exactly this" | **new** | `authorizations.json` (or a payload-carried record) with `id`, `type`, `issued_by`, optional `expires_at`, exact `resources` (wildcards rejected), optional `command_sha256` binding, and — for dispatch — `role` + `scope`. Tests `i`, `j`, `j2`, `j3`, `l`, `m`, `m2`. |
| B-8 | **Dispatch was completely ungoverned** — no ledger, no role/scope check on `task`/`agent()` spawns | **new** | `spawn_teammate` / `subagent` / `subagent_fork` require a `type:"dispatch"` record matching role + scope, and the pre-dispatch ledger line must be written **before** the call is allowed. Tests `l`, `m`, `m2`, `m3`, `m4`. |
| B-9 | **Secrets beyond `.env`** — `*.pem`, `*.key`, `id_rsa`, `~/.ssh`, `~/.aws`, `~/.dsh/.credentials.yaml`, `credentials/` directories were all writable | **yes** | Codes `SECRET_KEY_FILE`, `SECRET_SSH_KEY`, `SECRET_DIRECTORY`, `SECRET_HOME_DIR`, `SECRET_CREDENTIALS_FILE`, `SECRET_DSH_CREDENTIALS`. Tests `e3`, `e4`, `e5`. |
| B-10 | **Fail-open on internal error** — a thrown regex or any exception inside `tool_call` would surface as a rejected hook promise, not a block | **yes (for the program's own errors)** | `main()` is wrapped in a last-resort `catch` that exits `2` with `POLICY_INTERNAL_ERROR`; empty/non-JSON/non-object stdin and a missing `tool_name` also exit `2`. Tests `n`–`n5`. See `ACTIVATION.md` R1 for what still fails open (SIGKILL, unresolvable `node`). |
| B-11 | **Test coverage holes** — the original suite never exercised the `file` key, the `lsp` tool, `evaluatePolicy` with the `patch` form, `deploy/monitoring`, or any `bash` string other than `kubectl apply`, `bun test`, `git *` | **yes** | `policies/tests/run.js` — 64 end-to-end cases that spawn the real checker and assert the real exit code and stderr; `policies/tests/bridge-probe.js` — 43 cases against the shipped bridge code. |

---

## 3. Still uncovered (honest residuals)

| # | Gap | Why | Impact |
|---|---|---|---|
| G-14 | Script-file indirection: `bash deploy.sh`, `make release`, `psql -f wipe.sql`, `docker compose -f x.yml up` | The hook sees only the command string, never file contents | Real, but out of scope for a string-level hook. Complementary controls: the file sandbox, `read`-only reviews, and the Docker/DB SOP in `sources/omp/RULES.md`. |
| G-15 | Dynamically constructed commands: `X="git push"; $X`, `eval "$CMD"`, `bash -c "$PAYLOAD"` from an env var | Same | As above. `bash -c "git push"` *is* caught, because the literal text is present; a variable indirection is not. |
| G-16 | Aliases, functions, `git -c … push`, unusual git invocations, `git send-email` | Fixed subcommand list (`commit`, `push`), with `-c`/`-C`/`--git-dir`/`--work-tree`/`--exec-path` skipped | Low. `git -c x=y push` **is** handled. |
| G-17 | Network exfiltration (`curl -d @secrets https://…`), `nc`, reverse shells | Not in the original's scope and not in this contract | Out of scope; needs a different control (egress policy). |
| G-18 | Non-`raw` knowledge-vault protection for headless subagents (`wiki/concepts/*.md`) | The DSH hook payload carries no UI/role flag, so the original's `hasUi` discriminator cannot be reproduced | **Deliberate.** The `raw/` tree is protected for everyone; the rest of the vault is treated as writable, which is *weaker* than the original for headless callers. A task contract with `denied_paths: ["/path/to/wiki/**"]` restores it explicitly (implemented: `TASK_CONTRACT_DENIED_PATH`). |
| G-19 | `workflow` tool dispatch is not gated by default | The contract names only `spawn_teammate`, `subagent`, `subagent_fork`; `workflow` fans out to many subagents, but gating it by default would block the Lead's own orchestration | Routed to the checker but allowed unless `DSH_TEAM_GATE_WORKFLOW=1`. |
| G-20 | PostToolUse completion is observability only | A `PostToolUse` deny blocks the *result*, not the already-executed side effect | Deliberate: Bookkeeping must never corrupt an otherwise-valid tool result. |
| G-21 | `TRUNCATE`/`DROP` inside a heredoc that spans unusual quoting, or non-PostgreSQL/MySQL dialects | Regex over the command string | Low; `DROP DATABASE`, `DROP TABLE`, `TRUNCATE [TABLE] <name>`, `dropdb`, `mysqladmin drop`, `dropDatabase()` are covered. |
| G-22 | Pre-existing secret files are still *readable* (only writes are policed) | The contract scopes this layer to writes/edits and destructive commands | Reads of `.env` are explicitly allowed (test `o2`) — that matches the original, which never gated reads. |

---

## 4. Original test suite → port coverage

| `policy.test.ts` case | Original expectation | Port equivalent |
|---|---|---|
| "allows agent git commits and pushes" | `git commit`, `git push`, `git add` → `undefined` | **Inverted for commit/push**: tests `f`, `g` expect BLOCK. `git add` still allowed — test `k4`. |
| "blocks production deployment commands" | `kubectl apply -f deploy/prod.yaml` → block | Test `g4` (exit 2, `DEPLOY_NO_AUTH`), plus `g5`/`g6`. |
| "blocks secret and protected-path writes" | `/repo/.env`, `/repo/.gitlab-ci.yml`, `/Users/lmqhx/wiki/raw/source.md` → block | Tests `b`/`e` (`.env`), `e6` (`.github/workflows`) / `e7` (Dockerfile) extend the `.gitlab-ci` case, `e9` (vault `raw/`). |
| "blocks headless subagents from writing the knowledge vault" | `write` + `edit patch` under `/Users/lmqhx/wiki` blocked when `hasUi === false`; allowed when `true`; `/repo/src/app.ts` allowed | `raw/` tree: test `e9` (all callers). The `hasUi` discriminator is not reproducible (G-18). `/repo/src/app.ts` → test `a`. |
| "allows ordinary implementation commands and example configuration" | `bun test`; `.env.example`; `/repo/src/app.ts` | `bun test` → test `k1`-family; `/repo/src/app.ts` → test `a`; **`.env.example` now BLOCKS by default** (O-6) unless `DSH_TEAM_ALLOW_ENV_TEMPLATES=1`. |

---

## 5. 平台能力限制 — 现场验收（live acceptance）实测更新

本节记录 **2026-10-13 在运行中的 DeepSeekHarness 桌面进程内**执行端到端验收时实测到的
平台事实；它们修改了本包早期版本（WS-C 交付时）的假设。原始证据见
`evidence/live-hook-firing.txt`。

| # | 事实 | 早期假设 | 实测结论 |
|---|---|---|---|
| L-1 | 追加 profile patch 后**是否需要重启** | 需要重启（"config 只在进程启动时读取一次"） | **不需要重启**。追加 `insert: hooks-claude-code` 后，运行中的桌面进程即开始执行钩子（`bash`、`spawn_teammate` 均被真实拦截）。推断 desktop profile 的插件管理器/HMR 在感知 patch 变化后重新挂载。 |
| L-2 | `hooks.json`（`configPath`）的热更新 | 每次调用重新读取 | **插件挂载时读取一次**。安装后对 `hooks.json` 的**后续修改不会生效**，除非重新加载 profile。 |
| L-3 | `policy_check.js` / `ledger.js`（程序体）的热更新 | — | **每次工具调用立即生效**（钩子进程每次重新 spawn 并重新读取文件）。因此策略逻辑的迭代不需要重启，配置的迭代需要。 |
| L-4 | **钩子进程的写权限** | 假定可写 `~/.dsh/team/ledger/…` | **只读沙箱**。实测（钩子进程内探针，cwd=会话工作区，uid=501）：`/tmp`、`/private/tmp`、`$TMPDIR` **可写**；会话工作区与 `~/.dsh` **EPERM**。因此"由钩子强制写入台账"**平台不可复刻**。 |
| L-5 | 记账协议的落地方式 | 钩子写 `dispatch` 行后放行 | **改为"Lead 预写 + 钩子只读校验"**：主 Agent 用可写工具调用 `ledger.js --dispatch` 追加记录，钩子校验存在"未消费的匹配记录"才放行，否则 `LEDGER_RECORD_MISSING`（exit 2）。强制点仍在钩子；只把写者从钩子移到主 Agent。PostToolUse 不再写 `complete`，只提示待消费记录。 |
| L-6 | 组合校验（`--dump-config`）能否代表运行期行为 | 认为组合校验即可代表运行期 | 组合校验只能证明**插件被挂载、配置被接受**，不能证明钩子进程的运行时沙箱。L-4 只有活体触发才能发现。 |
| L-7 | 任务合同的 `allowed_paths` 是否收窄工作区内部路径 | 认为写路径白名单可在工作区内生效 | **不收窄**。`allowed_paths` 只**增加**工作区外的可写路径；工作区内部的白名单效果必须用 `denied_paths`（`TASK_CONTRACT_DENIED_PATH`）。只写 `allowed_paths` 时 `qa` 写 `src/` 仍 exit 0（已实测）。 |
| L-8 | 删除命令的粒度 | — | 实测生效：递归强制删除（`-rf`）一个 `/tmp` 下目录被 `RM_RECURSIVE_FORCE` 直接拒绝且无授权可解锁；同目录改用具名、非强制的递归删除则**放行**。分类按语义而非"一律拒绝删除"。 |
| L-9 | **文本分析的假阳性** | 只记录了"漏报"风险（G-14…G-17） | 现场还观察到**误报**：一条 `cat >> file <<EOF … EOF` 的 heredoc 命令，因**正文**里含递归强制删除字样而被 `RM_RECURSIVE_FORCE` 整条拒绝——命令本身并不执行删除。这是"对命令字符串做文本分析"的固有代价（无法区分 heredoc 正文与可执行片段）。影响：用 bash heredoc 写文档会被误拦，改用 `write`/`edit` 文件工具即可。**未修复**——修它需要真正的 shell 解析器，超出本层范围。 |
| L-10 | 派发的 `role` 从哪来 | 以为由派发提示词或任务合同指定 | **取自 teammate 名**。钩子把 `spawn_teammate` 的目标名当作 `role` 去匹配授权与台账。实测：为 `backend` 预写/授权后，以 `backend-fix` 为名派发被 `DISPATCH_UNAUTHORIZED` 拒绝。→ `--role`、`authorizations.json.role` 必须**等于 teammate 名**。 |
| L-11 | **`send_message` 续跑成员是否受门控** | 认为"重新派活给成员"都会被记账门拦住 | **不受门控**。钩子的派发匹配器只含 `spawn_teammate\|subagent\|subagent_fork`（+可选 `workflow`），**不含 `send_message`**。因此"把新任务发给一个已存在但空闲的成员"这条路径**绕过了记账强制**。本包的处理：仍按合同**预写**台账记录（seq 13 以 `--tool send_message` 记录），但必须承认**这一条靠自律而非工具强制**。→ `DSH_TEAM_GATE_DISPATCH` 若能扩展匹配 `send_message` 才可闭合；未实现。 |
| L-12 | **台账路径被 `$PWD` 钉死（真实缺陷，已修）** | 以为"Lead 预写 + 钩子校验"在任意 cwd 都成立 | **不成立**。`hooks.json` 的每条命令里写着 `DSH_TEAM_LEDGER="${DSH_TEAM_LEDGER:-$PWD/.dsh/team/ledger/agent-ledger.jsonl}"`，而 `ledger.js` 当时把该变量当作**硬短路**（设置即单一候选）。于是台账路径 = **钩子进程的 cwd**。之前 22 次派发能通过，**只是因为钩子 cwd 恰好是 `$HOME`**（`$HOME/.dsh/...` 正好等于真实台账）——**属巧合，不是设计正确**。cwd 变为会话工作区后，全部派发被误报 `LEDGER_RECORD_MISSING`。 |

#### L-12 的修复（2026-10-13，本机实测）

| 改动 | 内容 | 生效方式 |
|---|---|---|
| `hooks.json` | `$PWD/.dsh/...` → `${DSH_HOME:-$HOME/.dsh}/team/ledger/agent-ledger.jsonl`（绝对路径） | 配置文件在**插件挂载时读取一次** ⇒ 需重载 profile/重启 |
| `ledger.js` | 新增 `usableOverride()`：覆盖变量仍是**最高优先**，但**仅当其"等于 cwd 派生的工作区台账路径、且该文件不存在、且真实台账存在"时忽略之**（即只识别 L-12 这一种缺陷形状） | 程序体**每次调用重读** ⇒ **立即生效** |

**为什么判据要这么窄**：不能简单"路径不存在就回退"——那会让**策略测试**的沙箱 override
（指向一个尚未创建的临时目录）落到操作者的**真实台账**上。实测该误伤确实发生：
测试向 `~/.dsh/team/ledger/agent-ledger.jsonl` 追加了 **10 条 `sess-tests` 记录（seq 24–33）**，
其中含 5 条**未消费的 `dispatch`**，使 `--verify` 报 `ok:false`。

**处置（留证）**：原始 33 条完整备份于 `evidence/ledger-contamination-backup.jsonl`；
真实台账已复原为 23 条真实记录，`--verify` 恢复 `ok:true`（dispatch 12 / complete 11 / 无重复）。
⚠ 这是对"台账 append-only、永不改写"规则的**一次显式例外**，理由是：测试记录会让审计轨迹
**说谎**（把 12 次真实派发报成 20 次）。例外本身已在此登记，且被删除的内容完整留存。

**回归防护**：`policies/tests/run.js` 新增
① 沙箱台账目录与文件在 setup 阶段即创建；
② 一条 `(isolation)` 用例，断言测试前后**真实台账行数不变**（第 70 条用例）。
现状：**70 passed / 0 failed**，`bridge-probe` 43 passed。

**仍未闭合的部分**：`hooks.json` 的修复要等 profile 重载才生效；在此之前，**只靠 `ledger.js`
的 `usableOverride()` 兜底**（已实测：L-12 形状的输入现在放行，而真正缺记录的派发仍 `exit 2`）。

**因此本包不再声称**：「PreToolUse 钩子可强制写入台账」。该能力标记为**平台不可复刻**，
替代实现（L-5）已在运行中的实例上端到端验证通过。
