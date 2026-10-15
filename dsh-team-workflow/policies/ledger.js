#!/usr/bin/env node
'use strict';
/**
 * DSH Team Ledger — append-only JSONL agent-usage ledger.
 *
 * Port of the OMP `agent-usage-ledger` skill protocol onto DeepSeekHarness.
 * Field names and semantics are the source skill's; only the ledger PATH is
 * remapped (OMP wrote to `~/.omp/agent/usage/authorized/agent-ledger.jsonl`,
 * DSH writes to `~/.dsh/team/ledger/agent-ledger.jsonl`).
 *
 * Source protocol record (agent-usage-ledger/SKILL.md):
 *   {"ts": <unix_ms>, "role": "<role>", "task_id": "<id>", "batch_id": "<id>",
 *    "session": "<session>", "source": "agent-usage-ledger"}
 *
 * Additive fields on every DSH record (the six source fields are always present
 * and keep their meaning):
 *   seq  1-based line number; the append-only ordering key.
 *   event  "dispatch" (written BEFORE the tool runs) | "complete" (PostToolUse).
 *   tool   the DSH tool name the record belongs to (spawn_teammate, subagent, ...).
 *
 * HARD RULES
 *   - append only: this module never rewrites, truncates, reorders or dedupes.
 *   - no locking: one writer (the Lead / the policy hook) is assumed.
 *   - no dependency beyond the Node standard library.
 *
 * CLI
 *   node ledger.js --verify     print a machine-readable integrity report
 *   node ledger.js --path       print the resolved ledger path
 *   node ledger.js              print usage
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RECORD_SOURCE = 'agent-usage-ledger';
const DEFAULT_LEDGER = path.join(os.homedir(), '.dsh', 'team', 'ledger', 'agent-ledger.jsonl');

/**
 * Ledger path candidates, in priority order.
 *
 * Why a fallback exists (measured on this platform, 2026-10-13):
 * the PreToolUse hook process is spawned by the harness inside the OS sandbox
 * that was in force when the application launched. With the default
 * `workspace-write` launch the hook may write only inside the session
 * workspace, so appending to `~/.dsh/team/ledger/agent-ledger.jsonl` fails with
 * `EPERM`. The dispatch is then refused (`LEDGER_WRITE_FAILED`) *before* it runs,
 * which is fail-closed and therefore safe, but it also makes every dispatch
 * impossible. Falling back to a workspace-scoped ledger keeps the audit trail
 * writable and the control meaningful; the record marks the fallback so the
 * relocation is visible in `--verify`.
 *
 * `DSH_TEAM_LEDGER` remains authoritative and disables the fallback entirely.
 */
const WORKSPACE_LEDGER_REL = path.join('.dsh', 'team', 'ledger', 'agent-ledger.jsonl');

/**
 * The `DSH_TEAM_LEDGER` override, but only when it is *usable*.
 *
 * Measured defect (2026-10-13, `GAP-ANALYSIS.md` L-12): the hook command sets
 * `DSH_TEAM_LEDGER="$PWD/.dsh/team/ledger/agent-ledger.jsonl"`. When the
 * override was a hard short-circuit, the dispatch gate silently pointed at a
 * non-existent path unless the hook's cwd happened to be `$HOME` (where
 * `$HOME/.dsh/...` coincides with the real ledger), producing spurious
 * `LEDGER_RECORD_MISSING` denials.
 *
 * Rule: honour the override when its PARENT DIRECTORY exists — that keeps
 * deliberate overrides (tests, per-project ledgers) authoritative and lets the
 * file be created there. Skip it when the parent directory is missing, which is
 * unambiguously a bad path, and fall through to the real ledger.
 */
function usableOverride() {
  const raw = process.env.DSH_TEAM_LEDGER;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const resolved = path.resolve(raw.trim());
  // Defect workaround (measured 2026-10-13, GAP-ANALYSIS L-12).
  // hooks.json derives the ledger from $PWD: "${DSH_TEAM_LEDGER:-$PWD/.dsh/...}".
  // That is only correct when the hook's cwd happens to be $HOME. Detect exactly
  // that shape -- the cwd-derived workspace ledger, absent, while the real ledger
  // exists -- and ignore it, falling through to the real ledger.
  //
  // This is deliberately narrow: a *deliberate* override (the policy test suite,
  // or a per-project ledger) points somewhere that is not <cwd>/.dsh, so it is
  // still honoured and test isolation is preserved.
  const cwdDerived = path.resolve(process.cwd(), WORKSPACE_LEDGER_REL);
  if (resolved === cwdDerived && !fs.existsSync(resolved) && fs.existsSync(DEFAULT_LEDGER)) return null;
  return resolved;
}

/**
 * Candidate ledgers, in priority order.
 *
 * A *usable* `DSH_TEAM_LEDGER` override is authoritative and yields a single
 * candidate — that keeps `--verify` unambiguous and preserves test isolation.
 * Only when the override is unusable (the L-12 defect shape) do we fall through
 * to the real ledger and then a workspace-scoped ledger.
 */
function ledgerCandidates() {
  const override = usableOverride();
  if (override !== null) return [override];
  const list = [DEFAULT_LEDGER];
  const workspaceScoped = path.resolve(process.cwd(), WORKSPACE_LEDGER_REL);
  if (!list.includes(workspaceScoped)) list.push(workspaceScoped);
  return list;
}

/** The path `--verify`/`--path` operate on: first candidate that exists, else the primary. */
function resolveLedgerPath() {
  const override = usableOverride();
  if (override !== null) return override;          // deliberate override wins outright
  for (const file of ledgerCandidates()) {
    try {
      fs.accessSync(file, fs.constants.F_OK);
      return file;
    } catch (error) {
      continue;
    }
  }
  return DEFAULT_LEDGER;
}

/** Every candidate that currently exists (used by --verify to report the whole picture). */
function existingLedgerPaths() {
  const out = [];
  for (const file of ledgerCandidates()) {
    try {
      fs.accessSync(file, fs.constants.F_OK);
      out.push(file);
    } catch (error) {
      continue;
    }
  }
  return out;
}

function ensureParentDir(file) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
}

/** Count existing records (non-empty lines) without rewriting anything. */
function countLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return 0;
    throw error;
  }
  if (text === '') return 0;
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Append one record. `fields` supplies the source-protocol values plus the
 * additive DSH fields; `seq` is assigned here from the current line count.
 * @returns {object} the exact record written.
 */
function appendRecord(fields) {
  const candidates = ledgerCandidates();
  const failures = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index];
    try {
      ensureParentDir(file);
      const seq = countLines(file) + 1;
      const record = {
        ts: typeof fields.ts === 'number' ? fields.ts : Date.now(),
        role: fields.role,
        task_id: fields.task_id,
        batch_id: fields.batch_id,
        session: fields.session,
        source: RECORD_SOURCE,
        seq,
        event: fields.event,
        tool: fields.tool
      };
      if (fields.tool_use_id !== undefined) record.tool_use_id = fields.tool_use_id;
      if (fields.scope !== undefined) record.scope = fields.scope;
      if (fields.authorization_id !== undefined) record.authorization_id = fields.authorization_id;
      if (fields.authorization_origin !== undefined) record.authorization_origin = fields.authorization_origin;
      if (fields.status !== undefined) record.status = fields.status;
      if (fields.duration_ms !== undefined) record.duration_ms = fields.duration_ms;
      if (fields.dispatch_task_id !== undefined) record.dispatch_task_id = fields.dispatch_task_id;
      if (fields.note !== undefined) record.note = fields.note;
      record.ledger_path = file;
      if (index > 0) record.ledger_fallback = true;
      // Single atomic-ish append: one line, flag "a", no read-modify-write of content.
      fs.appendFileSync(file, JSON.stringify(record) + '\n', { encoding: 'utf8', flag: 'a' });
      return record;
    } catch (error) {
      const code = error && error.code ? error.code : 'ERROR';
      failures.push(`${file} (${code})`);
      continue;
    }
  }
  const failure = new Error(
    `the ledger append failed for every candidate: ${failures.join(', ')}. ` +
      'Set DSH_TEAM_LEDGER to a path the hook process can write.'
  );
  failure.code = 'LEDGER_APPEND_FAILED';
  throw failure;
}

/** Pre-dispatch record — must be written BEFORE the dispatch tool runs. */
function appendDispatch(fields) {
  return appendRecord({ ...fields, event: 'dispatch' });
}

/** PostToolUse completion record — a distinct, additive line for the same task_id. */
function appendComplete(fields) {
  return appendRecord({ ...fields, event: 'complete' });
}

/** Parse every record; malformed lines are reported, never dropped from disk. */
function readAll(explicitFile) {
  const file = typeof explicitFile === 'string' && explicitFile !== '' ? explicitFile : resolveLedgerPath();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { file, exists: false, entries: [], malformed: [] };
    throw error;
  }
  const entries = [];
  const malformed = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      malformed.push({ line: i + 1, error: String(error && error.message ? error.message : error) });
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      malformed.push({ line: i + 1, error: 'record is not a JSON object' });
      continue;
    }
    entries.push({ line: i + 1, record: parsed });
  }
  return { file, exists: true, entries, malformed };
}

/**
 * Append-only integrity check.
 *  - every non-empty line is a JSON object
 *  - `seq` is 1..N with no gaps or repeats (monotonic append ordering)
 *  - `ts` never goes backwards
 *  - no duplicate dispatch `task_id`
 *  - `source` is the literal `agent-usage-ledger`
 */
function verify() {
  // Verify every candidate that exists, so a workspace fallback is never invisible.
  const paths = existingLedgerPaths();
  const targets = paths.length > 0 ? paths : [resolveLedgerPath()];
  const reports = targets.map((target) => verifyOne(target));
  const result = reports[0];
  result.candidate_paths = ledgerCandidates();
  result.verifying = targets;
  if (reports.length > 1) {
    result.files = reports;
    result.ok = reports.every((r) => r.ok);
  }
  return result;
}

function verifyOne(file) {
  const { exists, entries, malformed } = readAll(file);
  const result = {
    ok: true,
    tool: 'dsh-team-ledger-verify',
    path: file,
    exists,
    lines: entries.length,
    records: entries.length,
    dispatch_records: 0,
    complete_records: 0,
    max_seq: 0,
    malformed_lines: malformed,
    seq_issues: [],
    ts_issues: [],
    duplicate_dispatch_ids: [],
    bad_source: [],
    unknown_event: []
  };
  const seenTaskIds = new Map();
  let previousTs = null;
  for (let i = 0; i < entries.length; i += 1) {
    const { line, record } = entries[i];
    const expectedSeq = i + 1;
    if (record.seq !== expectedSeq) {
      result.seq_issues.push({ line, expected: expectedSeq, observed: record.seq === undefined ? null : record.seq });
    } else {
      result.max_seq = record.seq;
    }
    if (typeof record.ts === 'number') {
      if (previousTs !== null && record.ts < previousTs) result.ts_issues.push({ line, previous: previousTs, observed: record.ts });
      previousTs = record.ts;
    } else {
      result.ts_issues.push({ line, previous: previousTs, observed: record.ts === undefined ? null : record.ts });
    }
    if (record.source !== RECORD_SOURCE) result.bad_source.push({ line, observed: record.source === undefined ? null : record.source });
    if (record.event === 'dispatch') {
      result.dispatch_records += 1;
      const id = record.task_id;
      if (typeof id === 'string' && id !== '') {
        if (seenTaskIds.has(id)) result.duplicate_dispatch_ids.push({ line, task_id: id, first_line: seenTaskIds.get(id) });
        else seenTaskIds.set(id, line);
      } else {
        result.duplicate_dispatch_ids.push({ line, task_id: null, first_line: null });
      }
    } else if (record.event === 'complete') {
      result.complete_records += 1;
    } else {
      result.unknown_event.push({ line, observed: record.event === undefined ? null : record.event });
    }
  }
  result.ok =
    malformed.length === 0 &&
    result.seq_issues.length === 0 &&
    result.ts_issues.length === 0 &&
    result.duplicate_dispatch_ids.length === 0 &&
    result.bad_source.length === 0 &&
    result.unknown_event.length === 0;
  return result;
}

module.exports = {
  RECORD_SOURCE,
  DEFAULT_LEDGER,
  resolveLedgerPath,
  appendRecord,
  appendDispatch,
  appendComplete,
  readAll,
  verify
};

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) {
    const result = verify();
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.ok ? 0 : 1);
  }
  if (argv.includes('--path')) {
    process.stdout.write(resolveLedgerPath() + '\n');
    process.exit(0);
  }
  if (argv.includes('--dispatch') || argv.includes('--complete')) {
    const complete = argv.includes('--complete');
    const role = argValue(argv, '--role') || 'task';
    const session = argValue(argv, '--session') || 'cli';
    const tool = argValue(argv, '--tool') || (complete ? '<unknown>' : 'spawn_teammate');
    const scopeRaw = argValue(argv, '--scope');
    const scope = scopeRaw === null ? [] : scopeRaw.split(':').map((s) => s.trim()).filter((s) => s !== '');
    const authorization = argValue(argv, '--authorization');
    let taskId = argValue(argv, '--task-id');
    try {
      if (complete) {
        if (taskId === null) {
          process.stderr.write('ledger: --complete requires --task-id <the id printed by --dispatch>\n');
          process.exit(2);
        }
        const record = appendComplete({
          role,
          task_id: taskId,
          batch_id: argValue(argv, '--batch') || taskId,
          session,
          tool,
          status: 'completed',
          note: argValue(argv, '--note') || undefined
        });
        process.stdout.write(JSON.stringify(record) + '\n');
        process.exit(0);
      }
      if (taskId === null) {
        taskId = `${session}#cli-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      }
      const record = appendDispatch({
        role,
        task_id: taskId,
        batch_id: argValue(argv, '--batch') || taskId,
        session,
        tool,
        scope,
        authorization_id: authorization === null ? undefined : authorization,
        authorization_origin: authorization === null ? 'payload' : 'store',
        status: 'authorized'
      });
      process.stdout.write(JSON.stringify(record) + '\n');
      process.exit(0);
    } catch (error) {
      process.stderr.write(`ledger: append failed: ${String(error && error.message ? error.message : error)}\n`);
      process.exit(1);
    }
  }
  process.stderr.write(
    'dsh team ledger\n' +
      '  node ledger.js --verify   print machine-readable append-only integrity report\n' +
      '  node ledger.js --path     print the resolved ledger path\n' +
      '  node ledger.js --dispatch --role <role> --scope <p1:p2> --authorization <AUTH-id> [--session <id>] [--tool <name>]\n' +
      '  node ledger.js --complete --task-id <id> [--role <role>] [--session <id>] [--note <text>]\n' +
      '  env DSH_TEAM_LEDGER=<path> override the ledger path\n' +
      '  path: ' + resolveLedgerPath() + '\n'
  );
  process.exit(0);
}

if (require.main === module) main();
