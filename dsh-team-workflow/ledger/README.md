# DSH Team Agent-Usage Ledger

Append-only accounting of agent/teammate dispatches, ported from the OMP
`agent-usage-ledger` skill onto DeepSeekHarness.

| | |
|---|---|
| **Ledger** | `~/.dsh/team/ledger/agent-ledger.jsonl` |
| **Override** | `DSH_TEAM_LEDGER=<path>` |
| **Writer** | `policies/ledger.js` (required by `policies/policy_check.js`) |
| **Verify** | `node policies/ledger.js --verify` |

Only the **path** changed from the source skill
(`~/.omp/agent/usage/authorized/agent-ledger.jsonl`). The field names and their
semantics are the source skill's.

**The ledger is evidence, not approval.** Reports derived from it carry the
skill's accuracy caveat: counts depend on the hook writing a record on every
dispatch. It is **never** rewritten, truncated, reordered or deduped — appends
only.

---

## Why the main Agent writes it and the hook only verifies

The OMP skill was a *procedure* the main Agent had to remember to follow. On DSH
the protocol is enforced structurally, but **not** by having the hook write it:
measured on 2026-10-13, the hook subprocess runs in a **read-only sandbox**
(`EPERM` for the session workspace and `~/.dsh`; only `/tmp` and `$TMPDIR` are
writable), so it cannot append to any persistent ledger. See
`../policies/ACTIVATION.md` §4b and `../evidence/live-hook-firing.txt`.

The split that preserves the control:

1. **The main Agent appends the pre-dispatch line** with an ordinary writable tool call.
2. The hook **reads** the ledger and blocks the dispatch with `LEDGER_RECORD_MISSING`
   unless a matching **unconsumed** record exists:
   `event:"dispatch"` + `status:"authorized"` + same `role` + `scope` covering the
   contract's declared scope + no `complete` record carrying the same `task_id`.
3. The Agent writes the `complete` record after the dispatch, which consumes it.

A dispatch blocked for want of an authorization record or a ledger record never runs,
so the line count is still a control — it is just the Agent, not the hook, that moves it.

```bash
node ~/.dsh/team/policies/ledger.js --dispatch --role <role> \
  --scope "<path>[:<path>]" --authorization <AUTH-id> \
  --session "$DSH_SESSION_ID" --tool spawn_teammate
node ~/.dsh/team/policies/ledger.js --complete --task-id '<printed id>'
node ~/.dsh/team/policies/ledger.js --verify
```

**Residual risk:** a forgotten `--complete` leaves the record reusable.

---

## Record schema

One JSON object per line. The first six fields are exactly the source skill's.

| Field | Type | Meaning (source skill semantics) |
|---|---|---|
| `ts` | number | `Date.now()` — unix milliseconds at write time. |
| `role` | string | Exact role from the registry, or the teammate name for `spawn_teammate`. Default `task` when no explicit role is given. |
| `task_id` | string | Agent/job id if known, else a unique identifier. Under DSH the hook cannot know the harness `tool_use_id` before the call runs, so the pre-dispatch record carries a **writer-generated id** (`<session>#cli-<ts>-<rand>`) and the `complete` record repeats it verbatim, so the pair joins and consumption is observable. |
| `batch_id` | string | The `task[]` batch this record belongs to; equals `task_id` for single spawns. |
| `session` | string | The DSH session id the dispatch belongs to. |
| `source` | string | Literal `agent-usage-ledger`. |

Additive DSH fields (present on both record kinds):

| Field | Type | Meaning |
|---|---|---|
| `seq` | number | 1-based line number. The append-only ordering key; `--verify` requires `seq === line index`. |
| `event` | `"dispatch"` \| `"complete"` | Which record kind this is. |
| `tool` | string | The DSH tool the record belongs to (`spawn_teammate`, `subagent`, `subagent_fork`, `workflow`). |
| `tool_use_id` | string \| null | The harness tool-call id from the hook payload. |

Dispatch-only fields:

| Field | Type | Meaning |
|---|---|---|
| `scope` | string[] | The write scopes the dispatch was authorized for (the tool input's `write_scopes`, else the task contract's `allowed_paths`). |
| `authorization_id` | string | The `id` of the authorization record that permitted the dispatch. |
| `authorization_origin` | `"store"` \| `"payload"` | Where that record came from. `store` = `~/.dsh/team/authorizations.json` (human/Lead-issued); `payload` = carried inside the tool input (self-asserted — audit these). |
| `status` | string | `authorized` at pre-dispatch time. |

Completion-only fields:

| Field | Type | Meaning |
|---|---|---|
| `dispatch_task_id` | string | The `task_id` of the paired dispatch record. |
| `status` | string | `completed`. |
| `note` | string | First 200 characters of the tool response (observability). |

### Examples

```json
{"ts":1760000000123,"role":"backend","task_id":"sess-abc#call_07","batch_id":"sess-abc#call_07","session":"sess-abc","source":"agent-usage-ledger","seq":1,"event":"dispatch","tool":"spawn_teammate","tool_use_id":"call_07","scope":["src/api/**"],"authorization_id":"AUTH-2026-1013-1","authorization_origin":"store","status":"authorized"}
{"ts":1760000001456,"role":"backend","task_id":"sess-abc#call_07","batch_id":"sess-abc#call_07","session":"sess-abc","source":"agent-usage-ledger","seq":2,"event":"complete","tool":"spawn_teammate","tool_use_id":"call_07","dispatch_task_id":"sess-abc#call_07","status":"completed","note":"teammate backend started"}
```

---

## Pre-dispatch protocol

1. **Before** dispatching, the Lead issues exactly one authorization record per
   role+scope (see below) into `~/.dsh/team/authorizations.json`.
2. The Lead calls the dispatch tool (`spawn_teammate` / `subagent` /
   `subagent_fork`).
3. The `PreToolUse` hook resolves the authorization. On success it appends
   **one** `event:"dispatch"` line and exits 0. On failure it exits 2 with
   `DISPATCH_UNAUTHORIZED` (or `LEDGER_WRITE_FAILED`) and **no line is written**.
4. After the tool returns, the `PostToolUse` hook appends **one**
   `event:"complete"` line carrying the same `task_id`. This is observability
   only — it can never block.

> Historical dispatches cannot be backfilled and no record may be fabricated.
> Do not use this ledger to write to any path other than the ledger itself.

### Authorization record (`~/.dsh/team/authorizations.json`)

A JSON **array** of records. `type` selects the rule family.

```json
[
  {
    "id": "AUTH-2026-1013-1",
    "type": "dispatch",
    "role": "backend",
    "scope": ["/abs/path/to/workspace/src/api/**"],
    "issued_by": "lead",
    "issued_at": 1760000000000,
    "expires_at": null,
    "reason": "WS-3 API implementation"
  },
  {
    "id": "AUTH-2026-1013-2",
    "type": "docker_delete",
    "resources": ["3f2a1b0c9d8e"],
    "issued_by": "user",
    "issued_at": 1760000000000,
    "reason": "approved single container removal after manifest review"
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Non-empty string. Recorded as `authorization_id`. |
| `type` | yes | `dispatch`, `docker_delete`, `db_destructive`, `deploy`, `vcs_publish`, `package_publish`, `release_publish`. |
| `issued_by` | yes | Non-empty string. `agent`, `self`, `model`, `assistant`, `subagent`, `teammate`, `claude`, `llm`, `ai`, `bot`, `hook`, `tool` are **rejected as self-issuance**. |
| `expires_at` | no | Unix ms. Absent/null = no expiry; a past value invalidates the record. |
| `role` | dispatch only | Must equal the dispatch role (for `spawn_teammate`, the teammate `name`). Wildcards rejected. |
| `scope` | dispatch only | Non-empty string array of path prefixes. A trailing `/**` marks a tree; any other wildcard character invalidates the record. Must cover the requested scopes, or the session workspace when no scope is declared. |
| `resources` | resource types | Exact ids/names. `sha256:` prefixes are ignored; a `resources` entry that is a wildcard invalidates the record. An abbreviated id of ≥12 characters may prefix-match a full id; anything shorter must match exactly. |
| `tool` | no | Restrict the record to one tool name. |
| `command_sha256` | no | Hex SHA-256 of the exact command string. Binds the grant to one command text. |
| `command` | no | Exact command string alternative to `command_sha256`. |

**Prune, wildcard and blanket forms are blocked outright and no authorization
can unlock them**: `docker prune`, `docker system/image/container/volume/builder/network prune`,
`docker compose down -v|--rmi|--remove-orphans`, `docker rm $(…)`, `TRUNCATE`
with no table name, `dropDatabase()`, and `rm -rf` with a wildcard, `~`, `/` or
an out-of-workspace target.

---

## Verify mode

```bash
node policies/ledger.js --verify
```

Checks, and prints one machine-readable JSON line:

- every non-empty line parses to a JSON object (`malformed_lines`)
- `seq === line index`, 1..N, no gaps or repeats (`seq_issues`, `max_seq`)
- `ts` never decreases (`ts_issues`)
- no duplicate dispatch `task_id` (`duplicate_dispatch_ids`)
- `source === "agent-usage-ledger"` (`bad_source`) and `event` is known (`unknown_event`)

Exit code 0 when `ok:true`, 1 otherwise. **Verify never writes.**

```json
{"ok":true,"tool":"dsh-team-ledger-verify","path":"/Users/…/agent-ledger.jsonl","exists":true,"lines":2,"records":2,"dispatch_records":1,"complete_records":1,"max_seq":2,"malformed_lines":[],"seq_issues":[],"ts_issues":[],"duplicate_dispatch_ids":[],"bad_source":[],"unknown_event":[]}
```

---

## Constraints

- **One writer.** Atomic single `>>` appends, no locking. The bridge runs hooks
  serially, so concurrent writers are not expected; if one occurs, `--verify`
  reports the damage instead of the ledger silently rewriting itself.
- **Append-only, forever.** Never rewrite, reorder or dedupe this file — a
  correction is a new record, not an edit.
- **`task_id` is not the harness agent id.** At pre-dispatch time the agent does
  not exist yet; the composite `session#tool_use_id` is the honest identifier.
- **The ledger does not prove the work happened.** It records that a dispatch
  was authorized and attempted. Pair it with the team task board for outcomes.
