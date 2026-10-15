---
name: agent-usage-ledger
description: Records per-role Agent invocation counts into an append-only JSONL ledger, without modifying the harness. The main Agent calls this skill BEFORE every subagent spawn (pre-dispatch), appending one record per spawn batch. Use when dispatching background subagents and role-level invocation counts must be tracked.
whenToUse: Use before every subagent dispatch by the main Agent (pre-dispatch) and whenever role-level invocation counts must be tracked across dispatch batches.
---

# Agent Usage Ledger

Pure-skill, append-only accounting of Agent role invocations. **No harness modification.**

## Role registry (complete — 15 roles)

| role | type |
|---|---|
| `task` | general purpose |
| `scout` | read-only research |
| `architect` | read-only architecture |
| `backend` | implementation |
| `frontend` | implementation |
| `harness` | implementation |
| `devops` | operations |
| `pm` | read-only product |
| `qa` | read-only testing |
| `code-review` | read-only review |
| `compliance` | read-only audit |
| `security-reviewer` | read-only security |
| `quota-control` | read-only quota |
| `reviewer` | review specialist |
| `sonic` | mechanical |

Spawning without an explicit role → record `task`.

## Ledger location

- Ledger: `~/.dsh/team/ledger/agent-ledger.jsonl`
- Append-only; one JSON object per line. NEVER rewrite or dedupe this file.

## Protocol — call BEFORE each dispatch

**You (the main Agent) must write the record yourself with an ordinary writable tool call.**
On DSH the `PreToolUse` hook process runs in a read-only sandbox (measured: `EPERM` for the
session workspace and `~/.dsh`; only `/tmp` and `$TMPDIR` are writable), so the hook cannot
append to the ledger. The hook instead **verifies**: a dispatch is refused with
`LEDGER_RECORD_MISSING` unless an *unconsumed* matching pre-dispatch record already exists.

Use the installed writer (it assigns `seq` and prints the record):

```bash
node ~/.dsh/team/policies/ledger.js --dispatch \
  --role <role> --scope "<allowed_path>[:<path>...]" \
  --authorization <AUTH-id> --session "$DSH_SESSION_ID" --tool spawn_teammate
```

Then dispatch, then consume the record so it cannot authorise a second dispatch:

```bash
node ~/.dsh/team/policies/ledger.js --complete --task-id '<id printed above>'
node ~/.dsh/team/policies/ledger.js --verify
```

Raw line format (what the writer appends):

```json
{"ts": <unix_ms>, "role": "<role>", "task_id": "<id>", "batch_id": "<id>", "session": "<session>", "source": "agent-usage-ledger", "seq": <n>, "event": "dispatch", "tool": "spawn_teammate", "scope": ["<path>"], "authorization_id": "<AUTH-id>", "status": "authorized"}
```

- `ts`: `Date.now()` (unix ms)
- `role`: exact role from the registry (default `task` if the role is omitted)
- `task_id`: agent/job id if known, else unique identifier; the hook cannot know the harness tool-use id in advance, so a CLI-generated id is used and the `complete` record repeats it
- `batch_id`: the dispatch batch id this record belongs to (may equal task_id for single spawns)
- `session`: current session identifier
- `source`: literal `agent-usage-ledger`
- `seq`: assigned by the writer from the current line count (append-only ordering key)
- `status`: `authorized`; the matching `complete` record marks the grant consumed

Atomic append — single `>>` write, no locking needed (one writer: the main Agent).

## Constraints

- The ledger is evidence, not approval. Reports derived from it carry the accuracy caveat: counts depend on the main Agent calling this skill on every dispatch.
- Do not use this skill to write to any path other than the authorized ledger.
- Historical dispatches predating this skill cannot be backfilled; do not fabricate records.
- **Known residual risk:** if you forget `--complete`, the record stays *unconsumed* and can authorise another dispatch of the same role+scope. Reconcile with `--verify` and review outstanding records at the end of a task.