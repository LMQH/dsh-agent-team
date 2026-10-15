# ACTIVATION — mounting the DSH team policy hook layer

Owner: **Lead** (WS-C delivers the artifacts; installation into `~/.dsh` is the Lead's call).
Audience: the human operator who installs this on the machine.

> ## ⚠ 2026-10-14 — this document is partially superseded
>
> The layer was **switched off** on 2026-10-14 (its rules judged permission by
> file and directory *names*, which locked ordinary work), then **rebuilt as a
> minimal version and switched back on the same day**. Sections below that
> describe the old behaviour are stale. What changed:
>
> | Old claim in this file | Current behaviour |
> |---|---|
> | `exit 0` allow / `exit 2` block only | also emits `hookSpecificOutput.permissionDecision: "ask"` → native human approval |
> | "the hook runs **read-only**, the main Agent must pre-write the ledger" | **wrong now**: the hook appends the pre-dispatch record itself, and the completion record on `PostToolUse`. A failed write warns and never blocks |
> | `LEDGER_RECORD_MISSING` refuses an unrecorded dispatch | **removed**; the manual pre-write step is gone |
> | `DISPATCH_UNAUTHORIZED` / `RESOURCE_DELETE_NO_AUTH` / `DEPLOY_NO_AUTH` refuse | now **`ask`** the human |
> | `CI_CD_CONFIG` protects Dockerfile / docker-compose / CI files | **removed** — those are ordinary development files |
> | `PROTECTED_DEPLOY_PATH` protects any `deploy/` or `k8s/` segment | **removed** |
> | `VAULT_RAW_IMMUTABLE` protects vault `raw/` | **removed** (no vault is configured here) |
> | `VCS_PUBLISH_NO_AUTH` blocks `git commit` / `git push` | **removed**, matching the source pack's own 2026-09-16 decision |
>
> Still current below: the mount procedure, the fail-closed contract, the wire
> format, and the file-sandbox layering.
>
> Authoritative design record and rationale:
> `../分析-三级管道与门控.md` §5 (why the old rules were removed) and §11
> (what was implemented, with evidence).

---

## 0. What this layer is

Two dependency-free Node programs behind the shipped Claude Code hook bridge
`@deepseek-ai/dsh-hooks-claude-code`:

| File | Role |
|---|---|
| `policies/hooks.json` | Claude Code `hooks.json` event→matcher→command map. Read **once at process start**. |
| `policies/policy_check.js` | `PreToolUse` decision program (`allow` / `deny` / **`ask`**) **and** `PostToolUse` ledger completion writer. |
| `policies/ledger.js` | Append-only JSONL ledger + `--verify`. Required by `policy_check.js`. |
| `policies/mount.patch.yml` | The exact profile patch entry. |

The file sandbox (`read-only` / `workspace-write` / `danger-full-access`) is a
**separate, OS-level second layer**. Hooks run *before* it and are not a
replacement for it.

---

## 1. Install (3 steps)

```bash
# 1. Back up the profile patch layer.
cp ~/.dsh/profiles/desktop/cordis.patch.yml \
   ~/.dsh/profiles/desktop/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M%S)

# 2. Put the hook config where the mount entry points.
mkdir -p ~/.dsh/team
cp /Users/maxwell/workspace/code_space/agent-team-workflow/dsh-team-workflow/policies/hooks.json \
   ~/.dsh/team/hooks.json

# 3. Append the mount entry to the TOP-LEVEL YAML ARRAY of the profile patch file.
cat /Users/maxwell/workspace/code_space/agent-team-workflow/dsh-team-workflow/policies/mount.patch.yml \
  >> ~/.dsh/profiles/desktop/cordis.patch.yml
```

Then **restart the DSH process**. The config is read once at startup
(`readFileSync` inside the plugin's `apply`); there is no reload.

> The `hooks.json` command strings already point at
> `/Users/maxwell/workspace/code_space/agent-team-workflow/dsh-team-workflow/policies/policy_check.js`,
> so no copy of the programs is needed. Only the **config** is copied to
> `~/.dsh/team/hooks.json`.

### The exact mount entry

```yaml
- insert:
    - id: hooks-claude-code
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: /Users/maxwell/.dsh/team/hooks.json
        projectDir: /Users/maxwell/workspace/code_space/agent-team-workflow
        defaultTimeoutMs: 10000
```

> **`insert:` is required.** The profile patch layer is a *patch list*: an entry
> addressed by a bare `- id:` **overrides an entry that already exists** in the
> composed profile. `hooks-claude-code` ships in no bundle, so a bare-id entry is
> rejected at boot with
>
> ```
> dsh: [.../patch.yml] patch: entry "hooks-claude-code" not found
> ```
>
> and nothing is mounted. `- insert:` appends a new entry instead. Both the
> positive and the negative result are in `evidence/policy-mount-check.txt`.

---

## 2. Rollback

```bash
# Restore the backup taken in step 1 (replace with the actual timestamp).
cp ~/.dsh/profiles/desktop/cordis.patch.yml.bak-YYYYMMDD-HHMMSS \
   ~/.dsh/profiles/desktop/cordis.patch.yml

# Optionally remove the hook config too.
rm -f ~/.dsh/team/hooks.json
```

Restart DSH. With the patch gone the plugin is not mounted and no hook runs.

To disable **only the hooks** while keeping the mount, point the entry at an
empty config (`{"hooks":{}}`) or delete `~/.dsh/team/hooks.json` — the plugin
catches the read failure, logs
`hooks-claude-code: could not load hook config "..." — no hooks registered`,
and the agent boots normally. That failure mode is itself fail-open: a typo in
`configPath` silently disables every rule, so **always confirm the hooks ran**
(see §4).

---

## 3. Composition check (no restart, no live profile needed)

The `desktop` profile **cannot be booted from the CLI** — the Electron app owns
it ("managed exclusively by the Electron application"). Validate composition
with a **disposable** profile instead:

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

"$DSH" --profile ws-c-probe --from-default-profile headless      # creates ~/.dsh/profiles/ws-c-probe
"$DSH" --profile ws-c-probe --patch <path>/policies/mount.patch.yml --dump-config
```

Expected: exit 0, and the composed tree ends with

```yaml
- id: hooks-claude-code
  name: '@deepseek-ai/dsh-hooks-claude-code'
  config:
    configPath: /Users/maxwell/.dsh/team/hooks.json
    projectDir: /Users/maxwell/workspace/code_space/agent-team-workflow
    defaultTimeoutMs: 10000
```

Clean up:

```bash
rm -rf /Users/maxwell/.dsh/profiles/ws-c-probe    # verify the path first
```

`--dump-config` validates **composition only**. It does not run the plugin's
`apply`, so it does not prove your `hooks.json` parses. For that, run
`node policies/tests/bridge-probe.js`, which loads the shipped
`parseClaudeCodeConfig` and `dsh-hook-protocol` codec straight out of
`app.asar` and exercises the real config and the real hook processes.

---

## 4. Confirming the hooks actually fire

The bridge appends a durable `hook/invoked` + `hook/result` pair to the session
log for every matched mid-turn hook. A session log line named `hook/result`
whose `decision` is `deny` and whose `exitCode` is `2` is the proof that a hook
blocked something. If you see no `hook/*` events after a tool call, the bridge
is not mounted (or `configPath` is wrong) — do not assume the policy is active.

**Measured 2026-10-13 on the live desktop instance (see `evidence/live-hook-firing.txt`):**

- The mount takes effect **without a restart** — a running desktop process began
  enforcing the hooks immediately after the patch entry was appended.
- `bash`, `write`/`edit` and `spawn_teammate` were all observed being blocked by the
  real hook, with the `DSH-POLICY-DENY` line returned **as the tool result**.
- `hooks.json` edits made *after* the plugin was mounted do **not** take effect until
  the profile is reloaded; `policy_check.js` / `ledger.js` edits take effect on the
  next call (the program is re-read every invocation).

Cheap independent check of the programs themselves:

```bash
cd /Users/maxwell/workspace/code_space/agent-team-workflow/dsh-team-workflow
node policies/tests/run.js           # 69 end-to-end cases
node policies/tests/bridge-probe.js  # 43 bridge-mapping cases
```

---

## 4b. The hook process is READ-ONLY — ledger protocol consequence

Measured inside the hook process itself (temporary probe, cwd = session workspace, uid 501):

| Path | Result |
|---|---|
| `/tmp/…`, `/private/tmp/…`, `$TMPDIR/…` | **writable** |
| the session workspace | `EPERM` |
| `~/.dsh/team/…` | `EPERM` |

So the hook **cannot append the pre-dispatch ledger line**, and "the hook writes the
ledger" is **platform-incapable (未复刻)**. The control was moved, not dropped:

1. **You (the main Agent) append the record first**, with an ordinary writable tool call:
   ```bash
   node ~/.dsh/team/policies/ledger.js --dispatch --role <role> \
     --scope "<path>[:<path>]" --authorization <AUTH-id> \
     --session "$DSH_SESSION_ID" --tool spawn_teammate
   ```
2. The hook **verifies** it. No unconsumed matching record → `LEDGER_RECORD_MISSING` (exit 2).
3. After the dispatch, consume it so it cannot authorise a second dispatch:
   ```bash
   node ~/.dsh/team/policies/ledger.js --complete --task-id '<id printed above>'
   node ~/.dsh/team/policies/ledger.js --verify
   ```

`PostToolUse` no longer writes a completion record; it prints a `DSH-POLICY-NOTE`
naming the record that still needs consuming.

> **Residual risk:** a forgotten `--complete` leaves the record unconsumed and therefore
> reusable. Reconcile outstanding records before declaring a task done.

`DSH_TEAM_LEDGER` overrides the path. When unset, `ledger.js` tries
`~/.dsh/team/ledger/agent-ledger.jsonl` and, if that is unwritable, falls back to
`<cwd>/.dsh/team/ledger/agent-ledger.jsonl`, marking the record `ledger_fallback: true`.

---

## 5. Residual risks (documented, not hidden)

| # | Risk | Detail | Mitigation / status |
|---|---|---|---|
| R1 | **Fail-open on crash** | Any non-zero exit other than `2`, or a spawn failure, is a *non-blocking* bridge failure and the tool proceeds. `parseHookOutput` only maps exit `2` to a block. | `policy_check.js` wraps `main()` in a last-resort `catch` that exits `2` with `POLICY_INTERNAL_ERROR`; malformed/empty stdin exits `2`. **Not covered:** the process being killed (timeout/SIGKILL) or `node` being unresolvable — both still fail open. |
| R2 | **Matcher is tool-name exact** | A claude-code matcher matching `^[A-Za-z0-9_\|]+$` is a literal `\|`-separated alternative list, **not** a regex. A typo (`writes`) or a renamed tool silently un-gates it. A matcher containing `*`/`.`/`^` is treated as a regex instead — do not mix the two styles in one matcher. | The routing table is asserted against the real DSH tool names in `bridge-probe.js` §2. Re-run it after any DSH upgrade that renames a tool. |
| R3 | **`updatedInput` unsupported** | The bridge logs and warns; the rewrite is ignored. The policy can block, never rewrite a command. | By design: `policy_check.js` never emits `updatedInput`. |
| R4 | **`allow` does not pre-approve** | Exit 0 / `permissionDecision:"allow"` does not bypass the sandbox or the approval layer. | `policy_check.js` exits 0 silently; it relies on other layers for approval. |
| R5 | **Payload-carried authorization is self-asserted** | The contract requires "the payload carries an exact, matching authorization record", so a model that can write `tool_input.authorization` can in principle author its own grant. Validity rejects wildcards, missing/expired grants, and self-issuer names (`agent`, `model`, `self`, …), and the ledger records `authorization_origin` (`payload` vs `store`) so the Lead can audit. | Prefer `~/.dsh/team/authorizations.json` (origin `store`, written by the human/Lead outside the agent). A `DSH_TEAM_STRICT_ISSUER`-style allow-list is **not** implemented. |
| R6 | **Shell analysis is textual** | `policy_check.js` analyses the command string. It cannot see inside a script file (`bash deploy.sh`, `psql -f wipe.sql`) or a dynamically built command (`eval`, a variable holding `git push`). Quotes, `&&`/`\|\|`/`;`/`\|` and `$(...)`/backtick substitutions *are* analysed. | Uncovered — see `GAP-ANALYSIS.md` rows G-14…G-17. Treat the hook as a guardrail, not a sandbox; keep the file sandbox enabled. |
| R7 | **Ledger write before dispatch is best-effort** | The hook appends the pre-dispatch line and blocks the dispatch if the append throws, but it cannot prove the dispatch *succeeded*; the PostToolUse completion record is observability only and never blocks. | `ledger.js --verify` reports seq monotonicity and duplicate dispatch ids. |
| R8 | **Single writer, no locking** | Concurrent hook processes could interleave a line. A torn line is reported as `malformed_lines` by `--verify` instead of being silently rewritten (the ledger is never rewritten or deduped). | Serial hook execution in the bridge makes this unlikely in practice. |
| R9 | **Relative paths run from the session workspace** | Hooks run with `cwd` = session workspace, and the bridge sets `CLAUDE_PROJECT_DIR`. `hooks.json` uses absolute paths, so this only matters for the configPath resolution (also absolute). | — |
| R10 | **A hook that hangs stalls the tool call** | Per-hook `timeout: 10` (seconds), plus `defaultTimeoutMs: 10000`. | Verified in `bridge-probe.js` §1. |

---

## 6. Environment knobs

| Variable | Default | Effect |
|---|---|---|
| `DSH_TEAM_LEDGER` | `~/.dsh/team/ledger/agent-ledger.jsonl` | Ledger path. |
| `DSH_TEAM_AUTHORIZATIONS` | `~/.dsh/team/authorizations.json` | Lead-issued authorization store (JSON array). |
| `DSH_TEAM_TASK_CONTRACT` | `~/.dsh/team/task-contract.json` | Active task contract. |
| `DSH_TEAM_WORKSPACE` | the payload `cwd` | `:`-separated workspace roots. |
| `DSH_TEAM_VAULT_ROOTS` | heuristic (`wiki`/`vault`/`obsidian` parent) | `:`-separated knowledge-vault roots whose `raw/` tree is immutable. |
| `DSH_TEAM_ALLOW_ENV_TEMPLATES` | unset (strict) | `1` re-permits `.env.example`/`.env.sample`/`.env.template`/`.env.dist`. |
| `DSH_TEAM_GATE_WORKFLOW` | unset (off) | `1` also gates the `workflow` tool as a dispatch tool. |
