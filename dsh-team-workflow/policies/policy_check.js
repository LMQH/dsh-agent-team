#!/usr/bin/env node
'use strict';
/**
 * DSH Team Policy — PreToolUse / PostToolUse decision program for
 * `@deepseek-ai/dsh-hooks-claude-code`.
 *
 * WIRE CONTRACT (verified against the shipped package source)
 *   stdin : {"session_id","transcript_path","cwd","hook_event_name",
 *            "tool_name","tool_input", ["tool_use_id"]}
 *   exit 0 : allow. nothing else is required.
 *   exit 2 : BLOCK. stderr becomes the model-visible reason.
 *   any other non-zero exit (or a crash) is a NON-BLOCKING bridge failure and
 *   the tool proceeds — which is why every path here is fail-closed.
 *
 * Reason format (one line, machine-readable and human-readable):
 *   DSH-POLICY-DENY {"code":"...","tool":"...","rule":"...","target":...,"auth":...,"reason":"..."}
 *
 * Dependency-free Node (stdlib only). Companion module: ./ledger.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ledger = require('./ledger.js');

// ---------------------------------------------------------------------------
// Constants / configuration
// ---------------------------------------------------------------------------

const HOME = os.homedir();

/** Tools that mutate the filesystem. */
const MUTATING_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'notebook_edit', 'apply_patch']);
/** Tools that run arbitrary shell commands. */
const SHELL_TOOLS = new Set(['bash', 'shell', 'pwsh', 'powershell']);
/** Tools that dispatch subagents / teammates. */
const DISPATCH_TOOLS = new Set(['spawn_teammate', 'subagent', 'subagent_fork', 'workflow']);
/** Dispatch tools that are always gated (the three required by the contract). */
const ALWAYS_GATED_DISPATCH = new Set(['spawn_teammate', 'subagent', 'subagent_fork']);

const SELF_ISSUERS = new Set([
  'agent', 'self', 'model', 'assistant', 'subagent', 'teammate', 'claude', 'llm', 'ai', 'bot', 'hook', 'tool'
]);

const CREDENTIAL_DIRS = new Set(['credentials', '.credentials', 'credentials.d', 'secrets', '.secrets']);

const ENV_TEMPLATE_BASENAMES = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);

const SQL_DROP_DATABASE = /\bDROP\s+DATABASE\s+(?:IF\s+EXISTS\s+)?(["'`\[]?)([A-Za-z0-9_.$-]+)/i;
const SQL_DROP_TABLE = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(["'`\[]?)([A-Za-z0-9_.$-]+)/i;
const SQL_TRUNCATE = /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(["'`\[]?)([A-Za-z0-9_.$-]+)/i;

// ---------------------------------------------------------------------------
// Decision helpers
// ---------------------------------------------------------------------------

/** Emit a machine-readable denial on stderr and exit 2 (BLOCK). */
function deny(code, detail) {
  const body = {
    code,
    tool: detail.tool === undefined ? null : detail.tool,
    rule: detail.rule === undefined ? null : detail.rule,
    target: detail.target === undefined || detail.target === null ? null : String(detail.target).slice(0, 600),
    auth: detail.auth === undefined ? null : detail.auth,
    reason: detail.reason
  };
  process.stderr.write('DSH-POLICY-DENY ' + JSON.stringify(body) + '\n');
  process.exit(2);
}

function malformed(rule, reason) {
  deny('MALFORMED_INPUT', { tool: null, rule, target: null, reason });
}

/**
 * Ask the human to approve this exact call, through the platform's native
 * approval channel. Emits the documented PreToolUse decision on stdout and
 * exits 0; the harness routes it to `dsh-user-approval`, which fails closed
 * (`unavailable`) when no answerer can decide, and records every request and
 * outcome in the session audit log.
 *
 * Use `ask` when the action is explicit, enumerable and has a real rollback
 * (deploy to a named environment, delete a named container, publish a named
 * package): the human can decide in the moment, and their approval IS the
 * authorization record. Use `deny` when the action is irreversible or its
 * impact cannot be enumerated (prune, wildcard removal, unnamed drop) —
 * there, approval would not be safe either.
 */
function ask(code, detail) {
  const body = {
    code,
    tool: detail.tool === undefined ? null : detail.tool,
    rule: detail.rule === undefined ? null : detail.rule,
    target: detail.target === undefined || detail.target === null ? null : String(detail.target).slice(0, 600),
    auth: detail.auth === undefined ? null : detail.auth,
    reason: detail.reason
  };
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'DSH-POLICY-ASK ' + JSON.stringify(body)
      }
    }) + '\n'
  );
  process.exit(0);
}

/**
 * Allow the tool. Configuration warnings (an unreadable or malformed
 * authorization store / task contract) are surfaced on stderr here instead of
 * being swallowed; on an allow the bridge records stderr but takes no decision
 * from it, so this can never change the outcome.
 */
function allow(ctx) {
  if (ctx && Array.isArray(ctx.warnings) && ctx.warnings.length > 0) {
    process.stderr.write('DSH-POLICY-WARN ' + JSON.stringify({ rule: 'config.unreadable', warnings: ctx.warnings }) + '\n');
  }
  if (ctx && Array.isArray(ctx.notes) && ctx.notes.length > 0) {
    process.stderr.write('DSH-POLICY-NOTE ' + JSON.stringify({ notes: ctx.notes }) + '\n');
  }
  process.exit(0);
}

/** Non-blocking observability line (exit code is decided by allow/deny). */
function note(ctx, message) {
  if (ctx && Array.isArray(ctx.notes)) ctx.notes.push(message);
}


// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

/** Expand `~`, resolve relative-to-cwd, and normalise `..` lexically. */
function resolveUserPath(raw, cwd) {
  let p = String(raw).trim();
  if (p === '~') p = HOME;
  else if (p.startsWith('~/') || p.startsWith('~' + path.sep)) p = path.join(HOME, p.slice(2));
  if (!path.isAbsolute(p)) p = path.resolve(cwd || process.cwd(), p);
  return path.normalize(p);
}

/**
 * Resolve REAL symlinks on the deepest existing ancestor, then re-attach the
 * non-existent tail. This is the defence the original OMP interceptor lacked.
 */
function realpathDeepest(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length > 0 ? path.join(real, ...tail) : real;
    } catch (_error) {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** True when `child` is `parent` itself or lies underneath it. */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathSegments(p) {
  return p.split('/').filter((s) => s !== '');
}

function baseName(p) {
  const b = path.basename(p);
  return b === '' ? p : b;
}

// ---------------------------------------------------------------------------
// Environment / contract
// ---------------------------------------------------------------------------

function envList(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(path.delimiter === ';' ? ';' : ':').map((s) => s.trim()).filter((s) => s !== '');
}

function contractPath() {
  const raw = process.env.DSH_TEAM_TASK_CONTRACT;
  if (typeof raw === 'string' && raw.trim() !== '') return path.resolve(raw.trim());
  return path.join(HOME, '.dsh', 'team', 'task-contract.json');
}

function authorizationsPath() {
  const raw = process.env.DSH_TEAM_AUTHORIZATIONS;
  if (typeof raw === 'string' && raw.trim() !== '') return path.resolve(raw.trim());
  return path.join(HOME, '.dsh', 'team', 'authorizations.json');
}

/** Path to the three-tier route declaration (Fast / Standard / Deep). */
function routePath() {
  const raw = process.env.DSH_TEAM_ROUTE;
  if (typeof raw === 'string' && raw.trim() !== '') return path.resolve(raw.trim());
  return path.join(HOME, '.dsh', 'team', 'route.json');
}

const ROUTE_TIERS = new Set(['fast', 'standard', 'deep']);

/**
 * Read the declared three-tier route. A missing, unreadable or malformed
 * declaration means "standard" — the default route. It is never an error and
 * never a block: the route is a declaration about which process gates apply,
 * not a latch that can fail closed.
 */
function readRoute() {
  const file = routePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tier = typeof parsed.tier === 'string' ? parsed.tier.trim().toLowerCase() : '';
    if (ROUTE_TIERS.has(tier)) {
      const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
      return { tier, file, reason };
    }
  } catch (_error) {
    // no declaration / unreadable / malformed JSON -> default route
  }
  return { tier: 'standard', file, reason: '' };
}

/**
 * Best-effort pre-dispatch ledger append, performed by the hook itself.
 *
 * The older design required the main Agent to append a pre-dispatch line with a
 * separate tool call and refused the dispatch if it had not. That manual step
 * was friction with no safety value: the writer is not the control, and the
 * control (this hook) is unchanged by moving the writer here. `appendRecord`
 * falls back across candidate ledger paths, so this usually succeeds even when
 * the hook sandbox blocks the primary path.
 *
 * A failure to record must never stop a dispatch, so failures are reported and
 * the call proceeds.
 *
 * @returns {{ok:boolean, detail:string}}
 */
function tryAppendLedger(info, match, toolName, route) {
  const scope = info.scope.length > 0 ? info.scope : [];
  const authorizationId = match && match.record ? match.record.id : undefined;
  const taskId = `${info.session}#hook-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const record = ledger.appendDispatch({
      role: info.role,
      task_id: taskId,
      batch_id: taskId,
      session: info.session,
      tool: toolName,
      scope,
      authorization_id: authorizationId,
      authorization_origin: authorizationId === undefined ? 'payload' : 'store',
      status: 'authorized',
      note: `route=${route.tier}`
    });
    return {
      ok: true,
      detail: `ledger pre-dispatch record ${record.task_id} (seq ${record.seq}) appended by the hook; route=${route.tier}`
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        `ledger append FAILED (${String(error && error.message ? error.message : error)}); the dispatch was allowed anyway. ` +
        'Record it manually if the count matters: ' +
        `node ${path.join(__dirname, 'ledger.js')} --dispatch --role ${info.role} --scope ${scope.join(':') || '<path>'}`
    };
  }
}

function loadJsonFile(file, warnings) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    warnings.push(`${file}: ${String(error && error.message ? error.message : error)}`);
    return undefined; // present but unreadable/malformed
  }
}

/**
 * Build the evaluation context: resolved workspace roots, task contract,
 * vault roots and any config warnings.
 */
function buildContext(payload) {
  const warnings = [];
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() !== '' ? path.resolve(payload.cwd) : process.cwd();

  const contractRaw = loadJsonFile(contractPath(), warnings);
  let contract = contractRaw && typeof contractRaw === 'object' && !Array.isArray(contractRaw) ? { ...contractRaw } : {};
  const inline = payload.task_contract || payload.taskContract;
  if (inline && typeof inline === 'object' && !Array.isArray(inline)) contract = { ...contract, ...inline };

  const contractWorkspace =
    typeof contract.workspace === 'string' && contract.workspace.trim() !== ''
      ? resolveUserPath(contract.workspace, cwd)
      : null;

  const envRoots = envList('DSH_TEAM_WORKSPACE').map((r) => resolveUserPath(r, cwd));
  const baseRoots = envRoots.length > 0 ? envRoots : [cwd];
  if (contractWorkspace !== null) baseRoots.push(contractWorkspace);

  const rootStrings = new Set();
  const roots = [];
  for (const r of baseRoots) {
    const key = r.replace(/\/+$/, '') || '/';
    if (rootStrings.has(key)) continue;
    rootStrings.add(key);
    roots.push(key);
  }

  const allowedPaths = [];
  const allowedRaw = Array.isArray(contract.allowed_paths) ? contract.allowed_paths : [];
  for (const entry of allowedRaw) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const anchor = contractWorkspace !== null ? contractWorkspace : cwd;
    allowedPaths.push(resolveUserPath(entry, anchor).replace(/\/+$/, '') || '/');
  }

  const deniedPaths = [];
  const deniedRaw = Array.isArray(contract.denied_paths) ? contract.denied_paths : [];
  for (const entry of deniedRaw) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const anchor = contractWorkspace !== null ? contractWorkspace : cwd;
    deniedPaths.push(resolveUserPath(entry, anchor).replace(/\/+$/, '') || '/');
  }

  const vaultRoots = envList('DSH_TEAM_VAULT_ROOTS').map((r) => resolveUserPath(r, cwd).replace(/\/+$/, '') || '/');

  return {
    cwd,
    contract,
    contractWorkspace,
    roots,
    rootsReal: roots.map(realpathDeepest),
    allowedPaths,
    allowedPathsReal: allowedPaths.map(realpathDeepest),
    deniedPaths,
    deniedPathsReal: deniedPaths.map(realpathDeepest),
    vaultRoots,
    vaultRootsReal: vaultRoots.map(realpathDeepest),
    // Read the authorization sources eagerly so a malformed store/contract is
    // reported on every allowed call, not only on the gated ones.
    authorizations: collectAuthorizations(payload, warnings),
    warnings,
    notes: []
  };
}

// ---------------------------------------------------------------------------
// Protected-path analysis (always block, even inside the workspace)
// ---------------------------------------------------------------------------

/** @returns {{code:string, rule:string, reason:string}|null} */
function protectedPath(resolved, ctx) {
  const b = baseName(resolved);
  const segs = pathSegments(resolved);

  if (b === '.env' || b.startsWith('.env.')) {
    // Templates are documentation, not secrets, so they pass by default. A
    // project can still lock them with DSH_TEAM_LOCK_ENV_TEMPLATES=1.
    const isTemplate = ENV_TEMPLATE_BASENAMES.has(b.toLowerCase());
    const lockTemplates = process.env.DSH_TEAM_LOCK_ENV_TEMPLATES === '1';
    if (!isTemplate || lockTemplates) {
      return {
        code: 'SECRET_ENV',
        rule: 'secret.env-file',
        reason:
          `Refusing to write the secret-bearing environment file "${b}". ` +
          'Write a documented template instead (.env.example / .env.sample / .env.template / .env.dist), ' +
          'or have the human edit the real file outside the agent.'
      };
    }
  }

  if (/\.pem$/i.test(b) || /\.key$/i.test(b)) {
    return {
      code: 'SECRET_KEY_FILE',
      rule: 'secret.key-material',
      reason: `Refusing to write key material "${b}" (*.pem / *.key are always blocked).`
    };
  }

  if (/^id_(rsa|dsa|ecdsa|ed25519)/i.test(b)) {
    return {
      code: 'SECRET_SSH_KEY',
      rule: 'secret.ssh-private-key',
      reason: `Refusing to write SSH private key "${b}" (id_rsa* and sibling private-key names are always blocked).`
    };
  }

  if (b === '.credentials.yaml' || b === '.credentials.yml' || b === 'credentials.yaml') {
    return {
      code: 'SECRET_CREDENTIALS_FILE',
      rule: 'secret.credentials-file',
      reason: `Refusing to write credential store "${b}" (~/.dsh/.credentials.yaml and equivalents are always blocked).`
    };
  }

  for (const seg of segs) {
    if (CREDENTIAL_DIRS.has(seg.toLowerCase())) {
      return {
        code: 'SECRET_DIRECTORY',
        rule: 'secret.credentials-directory',
        reason: `Refusing to write inside the credentials/secret directory "${seg}".`
      };
    }
  }

  for (const dir of [path.join(HOME, '.ssh'), path.join(HOME, '.aws'), path.join(HOME, '.gnupg'), path.join(HOME, '.kube')]) {
    if (isInside(resolved, dir)) {
      return {
        code: 'SECRET_HOME_DIR',
        rule: 'secret.home-directory',
        reason: `Refusing to write inside "${dir}" (credential home directory is always blocked).`
      };
    }
  }

  if (isInside(resolved, path.join(HOME, '.dsh')) && /^\.credentials\./.test(b)) {
    return {
      code: 'SECRET_DSH_CREDENTIALS',
      rule: 'secret.dsh-credentials',
      reason: 'Refusing to write DSH credential material.'
    };
  }

  // Deliberately NOT gated here (removed 2026-10-14, see 分析-三级管道与门控.md §5.3):
  //   - CI/CD and container build FILENAMES: Dockerfile, Dockerfile.*,
  //     docker-compose*.yml, compose.yml, Jenkinsfile, .travis.yml,
  //     azure-pipelines.yml, bitbucket-pipelines.yml, .gitlab-ci.yml,
  //     .github/workflows/**, .circleci/, .gitlab/
  //   - DIRECTORY names: any segment named deploy/, k8s/ or kubernetes/
  //   - vault raw/ trees (no vault is configured on this host)
  // Rationale: judging permission by a file or directory NAME locks ordinary
  // development work, and a rule that blocks normal work gets the whole policy
  // layer switched off — taking the rules that actually matter with it. What
  // stays gated is the ACTION (destructive / publishing), never the name.

  return null;
}

// ---------------------------------------------------------------------------
// Authorizations
// ---------------------------------------------------------------------------

function authTypeOf(record) {
  const value = record.type !== undefined ? record.type : record.action !== undefined ? record.action : record.kind;
  return typeof value === 'string' ? value : null;
}

function stripDigest(value) {
  return String(value).replace(/^sha256:/i, '');
}

function resourceCovers(authorized, requested) {
  const a = stripDigest(authorized).toLowerCase();
  const r = stripDigest(requested).toLowerCase();
  if (a === r) return true;
  if (r.length >= 12 && a.startsWith(r)) return true;
  return false;
}

function hasWildcard(value) {
  return /[*?[\]$`{}]/.test(String(value));
}

function isValidAuthorization(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.id !== 'string' || record.id.trim() === '') return false;
  if (typeof record.issued_by !== 'string' || record.issued_by.trim() === '') return false;
  if (SELF_ISSUERS.has(record.issued_by.trim().toLowerCase())) return false;
  if (record.expires_at !== undefined && record.expires_at !== null) {
    if (typeof record.expires_at !== 'number' || !Number.isFinite(record.expires_at)) return false;
    if (record.expires_at <= Date.now()) return false;
  }
  if (record.resources !== undefined && record.resources !== null) {
    if (!Array.isArray(record.resources)) return false;
    for (const r of record.resources) {
      if (typeof r !== 'string' || r.trim() === '') return false;
      if (hasWildcard(r)) return false; // wildcard authorization is not authorization
    }
  }
  return true;
}

function pushRecords(target, value, origin) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) target.push({ record: item, origin });
    }
    return;
  }
  if (value && typeof value === 'object') target.push({ record: value, origin });
}

/**
 * Collect candidate authorization records: those carried by the payload
 * (origin "payload") and those issued through the Lead's store (origin "store").
 */
function collectAuthorizations(payload, warnings) {
  const found = [];
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  pushRecords(found, input.authorization, 'payload');
  pushRecords(found, input.authorizations, 'payload');
  pushRecords(found, payload.authorization, 'payload');
  pushRecords(found, payload.authorizations, 'payload');
  const store = loadJsonFile(authorizationsPath(), warnings);
  if (Array.isArray(store)) pushRecords(found, store, 'store');
  else if (store && typeof store === 'object') {
    pushRecords(found, store.authorizations, 'store');
    pushRecords(found, store.records, 'store');
  }
  return found;
}

/** Resource-scoped authorization (docker/db destructive operations). */
function findResourceAuthorization(candidates, finding, commandText, toolName) {
  const sha = crypto.createHash('sha256').update(commandText, 'utf8').digest('hex');
  for (const { record, origin } of candidates) {
    if (!isValidAuthorization(record)) continue;
    if (authTypeOf(record) !== finding.authType) continue;
    if (typeof record.tool === 'string' && record.tool !== toolName) continue;
    if (record.command_sha256 !== undefined && record.command_sha256 !== null) {
      if (typeof record.command_sha256 !== 'string') continue;
      if (record.command_sha256.toLowerCase() !== sha) continue;
    }
    if (record.command !== undefined && record.command !== null) {
      if (typeof record.command !== 'string' || record.command !== commandText) continue;
    }
    if (finding.resources.length > 0) {
      const resources = Array.isArray(record.resources) ? record.resources : [];
      if (resources.length === 0) continue;
      if (!finding.resources.every((req) => resources.some((r) => resourceCovers(r, req)))) continue;
    }
    return { record, origin };
  }
  return null;
}

function normalizeScope(entry, cwd) {
  let value = String(entry).trim();
  const glob = value.endsWith('/**');
  if (glob) value = value.slice(0, -3);
  const abs = resolveUserPath(value, cwd).replace(/\/+$/, '') || '/';
  return { abs, glob };
}

function scopeCovers(authorized, requested, cwd) {
  const a = normalizeScope(authorized, cwd);
  const r = normalizeScope(requested, cwd);
  if (a.abs === r.abs) return true;
  return isInside(r.abs, a.abs);
}

/** Dispatch-scoped authorization (role + scope). */
function findDispatchAuthorization(candidates, toolName, info, ctx) {
  const requested = info.scope.length > 0 ? info.scope : ctx.allowedPaths;
  for (const { record, origin } of candidates) {
    if (!isValidAuthorization(record)) continue;
    if (authTypeOf(record) !== 'dispatch') continue;
    if (typeof record.tool === 'string' && record.tool !== toolName) continue;
    if (typeof record.role !== 'string' || record.role.trim() === '') continue;
    if (record.role.trim().toLowerCase() !== info.role.toLowerCase()) continue;
    if (hasWildcard(record.role)) continue;
    const scope = Array.isArray(record.scope) ? record.scope.filter((s) => typeof s === 'string' && s.trim() !== '') : [];
    if (scope.length === 0) continue;
    for (const entry of scope) {
      if (hasWildcard(entry) && !/\/\*\*$/.test(entry)) continue;
    }
    if (requested.length > 0) {
      const covered = requested.every((req) => scope.some((auth) => scopeCovers(auth, req, ctx.cwd)));
      if (!covered) continue;
    } else {
      // No declared task scope: the grant must at least cover the session workspace.
      const covered = ctx.roots.every((root) => scope.some((auth) => scopeCovers(auth, root, ctx.cwd)));
      if (!covered) continue;
    }
    return { record, origin };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bash analysis
// ---------------------------------------------------------------------------

/** Split on unquoted `;`, `&&`, `||`, `|`, newline. */
function splitTopLevel(command) {
  const segs = [];
  let cur = '';
  let quote = null;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        cur += ch + command[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      cur += ch + command[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === ';') {
      segs.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      segs.push(cur);
      cur = '';
      i += 2;
      continue;
    }
    if (ch === '|' || ch === '&') {
      segs.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter((s) => s !== '');
}

/** Extract `$(...)` and backtick command substitutions so their payloads are also analysed. */
function extractSubstitutions(command) {
  const out = [];
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      i = end < 0 ? command.length : end + 1;
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      let depth = 1;
      let k = i + 2;
      while (k < command.length && depth > 0) {
        if (command[k] === '(') depth += 1;
        else if (command[k] === ')') depth -= 1;
        k += 1;
      }
      out.push(command.slice(i + 2, k - 1));
      i = k;
      continue;
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1);
      if (end < 0) {
        i = command.length;
        continue;
      }
      out.push(command.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

function allSegments(command, depth) {
  const level = depth === undefined ? 0 : depth;
  const out = splitTopLevel(command);
  if (level < 4) {
    for (const sub of extractSubstitutions(command)) out.push(...allSegments(sub, level + 1));
  }
  return out;
}

function tokenize(segment) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        cur += segment[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || cur !== '') out.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started || cur !== '') out.push(cur);
  return out;
}

function firstNonFlag(args) {
  for (const a of args) {
    if (!a.startsWith('-')) return a;
  }
  return null;
}

function needsAuth(authType, code, rule, resources, reason) {
  return { kind: 'needs_auth', authType, code, rule, resources, reason };
}

function outright(code, rule, reason) {
  return { kind: 'outright', code, rule, reason };
}

/** Classify docker/podman removal targets: outright on wildcard/dynamic, else named. */
function classifyRemovalTargets(targets, rule) {
  if (targets.length === 0) {
    return { outright: true, reason: 'no explicit resource was named (bare removal)' };
  }
  for (const t of targets) {
    if (t === '' || hasWildcard(t)) {
      return { outright: true, reason: `wildcard or dynamic resource selector "${t}"` };
    }
  }
  return { outright: false, resources: targets };
}

function hasRemoteTarget(args) {
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(a)) return true;
    if (/^[A-Za-z0-9._-]+:/.test(a) && !/^[A-Za-z]:[\\/]/.test(a) && !a.includes('/')) return true;
    if (/^[A-Za-z0-9._-]+:.*/.test(a) && !/^[A-Za-z]:[\\/]/.test(a)) return true;
  }
  return false;
}

/** Transparent wrappers that run another command. */
const WRAPPERS = new Set(['sudo', 'doas', 'nohup', 'time', 'nice', 'command', 'builtin', 'exec', 'env']);

/**
 * Wrapper options that consume the NEXT argument. Without this, `sudo -u
 * postgres psql -c ...` resolves its command to `postgres` and every rule below
 * silently misses — the same evasion for `sudo -u root kubectl apply`.
 */
const WRAPPER_VALUE_FLAGS = {
  sudo: ['-u', '-g', '-p', '-C', '-h', '-r', '-t', '-U', '--user', '--group', '--prompt', '--chdir', '--host', '--role', '--type', '--close-from'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'],
  nice: ['-n', '--adjustment'],
  time: ['-o', '-f', '--output', '--format'],
  command: ['-p', '-v', '-V']
};

/**
 * Strip `VAR=` prefixes and transparent wrappers (`sudo`, `env`, `nohup`, ...)
 * to find the command that will actually run. Returns null when nothing
 * executable remains.
 */
function resolveCommand(words) {
  const argv = words.slice();
  while (argv.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv.shift();

  let guard = 0;
  while (argv.length > 0 && guard < 8) {
    guard += 1;
    const wrapper = path.basename(argv[0]);
    if (WRAPPERS.has(wrapper)) {
      argv.shift();
      const valueFlags = WRAPPER_VALUE_FLAGS[wrapper] || [];
      while (argv.length > 0 && argv[0].startsWith('-')) {
        const flag = argv[0];
        argv.shift();
        if (valueFlags.includes(flag) && argv.length > 0) argv.shift();
      }
      while (argv.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv.shift();
      continue;
    }
    break;
  }
  if (argv.length === 0) return null;
  return { cmd: path.basename(argv[0]), args: argv.slice(1) };
}

function analyzeWords(words, ctx) {
  const findings = [];
  const resolved = resolveCommand(words);
  if (resolved === null) return findings;
  const { cmd, args } = resolved;

  // --- VCS / publish -------------------------------------------------------
  // `git commit` / `git push` are deliberately NOT gated. The source pack
  // removed that interception on 2026-09-16 (its extension/index.ts lines 8-9)
  // and moved it to process gating, because a tool-layer block pushes the
  // model into rephrasing rather than asking the human — and git is a
  // recoverable operation (reflog / remote), unlike the destructive commands
  // that stay gated below. Committing and pushing still require explicit user
  // authorization; that lives in AGENTS.md, not here.
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd)) {
    const positionals = args.filter((a) => !a.startsWith('-'));
    if (positionals[0] === 'publish' || (positionals[0] === 'npm' && positionals[1] === 'publish')) {
      findings.push(
        needsAuth(
          'package_publish',
          'PACKAGE_PUBLISH_NO_AUTH',
          'npm.publish',
          [],
          `Refusing "${cmd} publish": publishing a package is an irreversible release action and needs an exact authorization record (type "package_publish").`
        )
      );
    }
  }
  if (cmd === 'gh') {
    const positionals = args.filter((a) => !a.startsWith('-'));
    if (positionals[0] === 'release') {
      findings.push(
        needsAuth(
          'release_publish',
          'RELEASE_PUBLISH_NO_AUTH',
          'gh.release',
          [],
          'Refusing "gh release": publishing a release needs an exact authorization record (type "release_publish").'
        )
      );
    }
  }

  // --- deploy --------------------------------------------------------------
  if (cmd === 'kubectl') {
    const sub = firstNonFlag(args);
    if (['apply', 'delete', 'create', 'replace', 'patch', 'scale', 'rollout', 'drain', 'cordon', 'uncordon', 'edit'].includes(sub)) {
      findings.push(
        needsAuth('deploy', 'DEPLOY_NO_AUTH', `kubectl.${sub}`, [], `Refusing "kubectl ${sub}": cluster mutation needs an exact authorization record (type "deploy").`)
      );
    }
  }
  if (cmd === 'terraform') {
    const sub = firstNonFlag(args);
    if (sub === 'apply' || sub === 'destroy' || sub === 'import' || sub === 'taint') {
      findings.push(
        needsAuth('deploy', 'DEPLOY_NO_AUTH', `terraform.${sub}`, [], `Refusing "terraform ${sub}": infrastructure mutation needs an exact authorization record (type "deploy").`)
      );
    }
  }
  if (cmd === 'helm') {
    const sub = firstNonFlag(args);
    if (['upgrade', 'install', 'uninstall', 'rollback', 'delete'].includes(sub)) {
      findings.push(
        needsAuth('deploy', 'DEPLOY_NO_AUTH', `helm.${sub}`, [], `Refusing "helm ${sub}": release mutation needs an exact authorization record (type "deploy").`)
      );
    }
  }
  if (cmd === 'fly') {
    const positionals = args.filter((a) => !a.startsWith('-'));
    if (positionals[0] === 'deploy' || positionals[0] === 'destroy' || (positionals[0] === 'apps' && positionals[1] === 'destroy')) {
      findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', 'fly.deploy', [], 'Refusing "fly deploy/destroy": production deploy needs an exact authorization record (type "deploy").'));
    }
  }
  if (cmd === 'heroku') {
    const positionals = args.filter((a) => !a.startsWith('-'));
    const sub = positionals[0] || '';
    if (/^(deploy|destroy|pipelines:promote|container:release|addons:destroy|ps:scale|config:set|releases:rollback|apps:destroy)/.test(sub)) {
      findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', `heroku.${sub}`, [], 'Refusing the Heroku mutation: it needs an exact authorization record (type "deploy").'));
    }
  }
  if (cmd === 'scp') {
    findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', 'scp', [], 'Refusing "scp": copying artifacts to a remote host needs an exact authorization record (type "deploy").'));
  }
  if (cmd === 'rsync' && hasRemoteTarget(args)) {
    findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', 'rsync.remote', [], 'Refusing "rsync" to a remote target: it needs an exact authorization record (type "deploy").'));
  }

  // --- docker / compose ----------------------------------------------------
  if (cmd === 'docker' || cmd === 'podman' || cmd === 'nerdctl' || cmd === 'docker-compose') {
    const positionals = args.filter((a) => !a.startsWith('-'));
    const verb = positionals[0];
    const sub = cmd === 'docker-compose' ? undefined : positionals[1];

    const isPruneHead = cmd !== 'docker-compose' && verb === 'prune';
    const isPruneGroup =
      cmd !== 'docker-compose' && ['system', 'image', 'container', 'volume', 'builder', 'network'].includes(verb) && sub === 'prune';
    if (isPruneHead || isPruneGroup) {
      findings.push(
        outright(
          'DOCKER_PRUNE',
          'docker.prune',
          `Refusing "${cmd} ${positionals.slice(0, 2).join(' ')}": prune/wildcard cleanup removes unenumerated resources and is blocked outright (no authorization accepted). ` +
            'Present a per-item manifest and delete named resources one at a time.'
        )
      );
      return findings;
    }

    const removalGroups = [
      { head: 'rm', rest: 1 },
      { head: 'rmi', rest: 1 },
      { head: 'image', sub: 'rm', rest: 2 },
      { head: 'container', sub: 'rm', rest: 2 },
      { head: 'volume', sub: 'rm', rest: 2 },
      { head: 'network', sub: 'rm', rest: 2 }
    ];
    for (const group of removalGroups) {
      const matches =
        (group.sub === undefined && verb === group.head) || (group.sub !== undefined && verb === group.head && sub === group.sub);
      if (!matches) continue;
      const targets = positionals.slice(group.rest);
      const verdict = classifyRemovalTargets(targets, `docker.${group.head}${group.sub ? '.' + group.sub : ''}`);
      if (verdict.outright) {
        findings.push(
          outright(
            'DOCKER_REMOVE_UNSCOPED',
            `docker.${group.head}`,
            `Refusing "${cmd} ${positionals.slice(0, 3).join(' ')}": ${verdict.reason}. Removal must name every resource explicitly; wildcard/prune forms are blocked outright.`
          )
        );
      } else {
        findings.push(
          needsAuth(
            'docker_delete',
            'RESOURCE_DELETE_NO_AUTH',
            `docker.${group.head}`,
            verdict.resources,
            `Refusing "${cmd} ${group.head} ${verdict.resources.join(' ')}": deleting Docker resources needs an exact authorization record (type "docker_delete") naming ${verdict.resources.join(', ')}.`
          )
        );
      }
      return findings;
    }

    if (verb === 'push') {
      findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', 'docker.push', [], 'Refusing "docker push": publishing an image needs an exact authorization record (type "deploy").'));
      return findings;
    }

    const isUp = (cmd === 'docker-compose' && verb === 'up') || (cmd !== 'docker-compose' && verb === 'compose' && sub === 'up');
    if (isUp) {
      findings.push(needsAuth('deploy', 'DEPLOY_NO_AUTH', 'docker.compose.up', [], 'Refusing "docker compose up": starting the deployed stack needs an exact authorization record (type "deploy").'));
      return findings;
    }

    const isDown = (cmd === 'docker-compose' && verb === 'down') || (cmd !== 'docker-compose' && verb === 'compose' && sub === 'down');
    if (isDown) {
      const raw = args;
      const blanket = raw.some((a) => a === '-v' || a === '--volumes' || a === '--remove-orphans' || a === '--rmi' || a.startsWith('--rmi='));
      if (blanket) {
        findings.push(
          outright(
            'DOCKER_COMPOSE_BLANKET_DOWN',
            'docker.compose.down.volumes',
            'Refusing "docker compose down -v/--rmi/--remove-orphans": blanket project teardown removes unenumerated volumes and images. Enumerate and delete named resources instead.'
          )
        );
      } else {
        const project = positionals.slice(cmd === 'docker-compose' ? 1 : 2).filter((p) => p !== 'down');
        findings.push(
          needsAuth(
            'docker_delete',
            'RESOURCE_DELETE_NO_AUTH',
            'docker.compose.down',
            project,
            `Refusing "docker compose down ${project.join(' ')}": stopping and removing a compose project needs an exact authorization record (type "docker_delete") naming the project.`
          )
        );
      }
      return findings;
    }
    return findings;
  }

  // --- databases -----------------------------------------------------------
  if (cmd === 'dropdb') {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) {
      findings.push(outright('DB_DESTRUCTIVE_UNSCOPED', 'db.dropdb', 'Refusing "dropdb" without a database name (unnamed destructive form).'));
    } else {
      findings.push(
        needsAuth('db_destructive', 'DB_DESTRUCTIVE_NO_AUTH', 'db.dropdb', targets, `Refusing "dropdb ${targets.join(' ')}": dropping a database needs an exact authorization record (type "db_destructive") naming ${targets.join(', ')}.`)
      );
    }
  }
  if (cmd === 'mysqladmin') {
    const positionals = args.filter((a) => !a.startsWith('-'));
    if (positionals[0] === 'drop') {
      const targets = positionals.slice(1);
      if (targets.length === 0) findings.push(outright('DB_DESTRUCTIVE_UNSCOPED', 'db.mysqladmin.drop', 'Refusing "mysqladmin drop" without a database name.'));
      else findings.push(needsAuth('db_destructive', 'DB_DESTRUCTIVE_NO_AUTH', 'db.mysqladmin.drop', targets, `Refusing "mysqladmin drop ${targets.join(' ')}": it needs an exact authorization record (type "db_destructive").`));
    }
  }

  // --- rm -rf --------------------------------------------------------------
  if (cmd === 'rm') {
    const flags = args.filter((a) => a.startsWith('-'));
    const recursive = flags.some((f) => /^-[A-Za-z]*[rR]/.test(f) || f === '--recursive');
    const force = flags.some((f) => /^-[A-Za-z]*f/.test(f) || f === '--force');
    if (recursive && force) {
      const targets = args.filter((a) => !a.startsWith('-'));
      let unsafe = targets.length === 0;
      let unsafeTarget = targets[0];
      for (const t of targets) {
        if (t === '/' || t === '~' || t === '.' || t === '..' || hasWildcard(t)) {
          unsafe = true;
          unsafeTarget = t;
          break;
        }
        const abs = resolveUserPath(t, ctx.cwd);
        const absReal = realpathDeepest(abs);
        if (abs === '/' || absReal === '/' || abs === HOME) {
          unsafe = true;
          unsafeTarget = t;
          break;
        }
        const inside = ctx.rootsReal.some((r) => isInside(absReal, r));
        if (!inside) {
          unsafe = true;
          unsafeTarget = t;
          break;
        }
      }
      if (unsafe) {
        findings.push(
          outright(
            'RM_RECURSIVE_FORCE',
            'bash.rm-rf',
            `Refusing "rm -rf ${unsafeTarget === undefined ? '' : unsafeTarget}": recursive force deletion outside the session workspace (or with a wildcard/home/root target) is irreversible and blocked outright.`
          )
        );
      }
    }
  }

  return findings;
}

function analyzeRawSql(command) {
  const findings = [];
  const matchDb = SQL_DROP_DATABASE.exec(command);
  if (matchDb) {
    findings.push(
      needsAuth('db_destructive', 'DB_DESTRUCTIVE_NO_AUTH', 'sql.drop-database', [matchDb[2]], `Refusing "DROP DATABASE ${matchDb[2]}": an exact authorization record (type "db_destructive") naming ${matchDb[2]} is required.`)
    );
  }
  const matchTable = SQL_DROP_TABLE.exec(command);
  if (matchTable) {
    findings.push(
      needsAuth('db_destructive', 'DB_DESTRUCTIVE_NO_AUTH', 'sql.drop-table', [matchTable[2]], `Refusing "DROP TABLE ${matchTable[2]}": an exact authorization record (type "db_destructive") naming ${matchTable[2]} is required.`)
    );
  }
  const matchTruncate = SQL_TRUNCATE.exec(command);
  if (matchTruncate) {
    findings.push(
      needsAuth('db_destructive', 'DB_DESTRUCTIVE_NO_AUTH', 'sql.truncate', [matchTruncate[2]], `Refusing "TRUNCATE ${matchTruncate[2]}": an exact authorization record (type "db_destructive") naming ${matchTruncate[2]} is required.`)
    );
  }
  if (/\bTRUNCATE\s*(?:;\s*|$|["'`])/im.test(command) && !matchTruncate) {
    findings.push(outright('DB_DESTRUCTIVE_UNSCOPED', 'sql.truncate-unnamed', 'Refusing an unnamed TRUNCATE (blanket table wipe): enumerate the tables explicitly.'));
  }
  if (/\bdropDatabase\s*\(\s*\)/.test(command)) {
    findings.push(outright('DB_DESTRUCTIVE_UNSCOPED', 'db.mongo.dropDatabase', 'Refusing dropDatabase(): an unnamed whole-database wipe is blocked outright.'));
  }
  return findings;
}

function analyzeCommand(command, ctx) {
  const findings = [];
  for (const segment of allSegments(command)) {
    const words = tokenize(segment);
    if (words.length === 0) continue;
    findings.push(...analyzeWords(words, ctx));
  }
  // Raw-SQL parsing runs ONLY when a database client is actually invoked.
  //
  // Matching SQL keywords anywhere in a command line is name-based gating of
  // exactly the kind removed on 2026-10-14: it fired on this very repository
  // while its own design document was being written (a heredoc containing the
  // word TRUNCATE was refused), and it would equally fire on `grep TRUNCATE`,
  // `echo "DROP TABLE x"`, or any migration file being catted into place.
  // Mentioning SQL is not running SQL.
  if (invokesDatabaseClient(command)) findings.push(...analyzeRawSql(command));
  return findings;
}

/** Database clients whose command text is worth parsing for destructive SQL. */
const DB_CLIENTS = new Set([
  'psql', 'pgcli', 'mysql', 'mariadb', 'mycli', 'mysqladmin',
  'sqlite3', 'duckdb', 'mongo', 'mongosh', 'mongoimport',
  'clickhouse-client', 'cqlsh', 'sqlcmd', 'cockroach', 'influx'
]);

/** True only when some segment of the command actually runs a database client. */
function invokesDatabaseClient(command) {
  for (const segment of allSegments(command)) {
    const resolved = resolveCommand(tokenize(segment));
    if (resolved !== null && DB_CLIENTS.has(resolved.cmd)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dispatch bookkeeping
// ---------------------------------------------------------------------------

function sessionId(payload) {
  return typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : '<no-session>';
}

function dispatchInfo(toolName, input, payload) {
  const toolUseId = typeof payload.tool_use_id === 'string' && payload.tool_use_id !== '' ? payload.tool_use_id : null;
  const session = sessionId(payload);
  let role = 'task';
  if (toolName === 'spawn_teammate') {
    if (typeof input.name === 'string' && input.name.trim() !== '') role = input.name.trim();
  } else if (toolName === 'subagent' || toolName === 'subagent_fork') {
    if (typeof input.role === 'string' && input.role.trim() !== '') role = input.role.trim();
    else if (typeof input.agent === 'string' && input.agent.trim() !== '') role = input.agent.trim();
    else role = 'task';
  } else if (toolName === 'workflow') {
    role = typeof input.role === 'string' && input.role.trim() !== '' ? input.role.trim() : 'workflow';
  } else if (typeof input.role === 'string' && input.role.trim() !== '') {
    role = input.role.trim();
  }
  const scope = Array.isArray(input.write_scopes) ? input.write_scopes.filter((s) => typeof s === 'string' && s.trim() !== '') : [];
  const taskId = toolUseId !== null ? `${session}#${toolUseId}` : `${session}#${toolName}#${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  const batchId = typeof input.batch_id === 'string' && input.batch_id !== '' ? input.batch_id : taskId;
  return { role, scope, taskId, batchId, session, toolUseId };
}

// ---------------------------------------------------------------------------
// Pre / Post handlers
// ---------------------------------------------------------------------------

function handlePre(payload) {
  const toolName = payload.tool_name;
  if (typeof toolName !== 'string' || toolName.trim() === '') {
    malformed('input.tool_name', 'Refusing to run: the hook payload carried no tool_name, so the policy cannot classify the call.');
  }
  const rawInput = payload.tool_input;
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  const ctx = buildContext(payload);

  if (SHELL_TOOLS.has(toolName)) {
    const command = typeof input.command === 'string' ? input.command : '';
    if (command.trim() === '') {
      malformed('input.command', `Refusing "${toolName}": the payload carried no command string, so the policy cannot classify it.`);
    }
    const findings = analyzeCommand(command, ctx);
    const blocking = findings.find((f) => f.kind === 'outright');
    if (blocking) {
      deny(blocking.code, { tool: toolName, rule: blocking.rule, target: command, reason: blocking.reason });
    }
    const gated = findings.filter((f) => f.kind === 'needs_auth');
    if (gated.length > 0) {
      const candidates = ctx.authorizations;
      for (const finding of gated) {
        const match = findResourceAuthorization(candidates, finding, command, toolName);
        if (!match) {
          // Explicit, enumerable, externally visible action with no standing
          // pre-authorization: ask the human in the moment instead of refusing.
          // Their approval IS the authorization, and the platform records the
          // request and the outcome in the session audit log for us.
          ask(finding.code, {
            tool: toolName,
            rule: finding.rule,
            target: command,
            auth: finding.authType,
            reason: `${finding.reason} No standing record was found in the payload or in ${authorizationsPath()}, so this specific call needs your approval now.`
          });
        }
      }
    }
    allow(ctx);
  }

  if (MUTATING_TOOLS.has(toolName)) {
    const rawPath = mutationPath(toolName, input);
    if (rawPath === null) {
      deny('PATH_ARGUMENT_MISSING', {
        tool: toolName,
        rule: 'path.missing',
        target: null,
        reason:
          `Refusing "${toolName}": no file path could be read from the tool input ` +
          '(recognised keys: file_path, path, file, filePath, patch). Fail-closed because an unverifiable write cannot be allowed.'
      });
    }
    const lexical = resolveUserPath(rawPath, ctx.cwd);
    const real = realpathDeepest(lexical);

    for (const candidate of [lexical, real]) {
      const hit = protectedPath(candidate, ctx);
      if (hit) {
        deny(hit.code, { tool: toolName, rule: hit.rule, target: rawPath, reason: hit.reason + ` (resolved: ${real})` });
      }
    }

    for (const dir of ctx.deniedPathsReal) {
      if (isInside(real, dir)) {
        deny('TASK_CONTRACT_DENIED_PATH', {
          tool: toolName,
          rule: 'contract.denied_path',
          target: rawPath,
          reason: `Refusing to write ${rawPath}: the active task contract explicitly denies ${dir}.`
        });
      }
    }

    let allowed = false;
    for (let i = 0; i < ctx.rootsReal.length; i += 1) {
      if (isInside(lexical, ctx.roots[i]) && isInside(real, ctx.rootsReal[i])) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      for (const allowedPath of ctx.allowedPathsReal) {
        if (isInside(real, allowedPath)) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) {
      deny('OUTSIDE_WORKSPACE', {
        tool: toolName,
        rule: 'workspace.containment',
        target: rawPath,
        reason:
          `Refusing to write "${rawPath}" (resolved: ${real}): it is outside the session workspace ` +
          `[${ctx.roots.join(', ')}]${ctx.allowedPaths.length > 0 ? ` and outside the task contract's allowed paths [${ctx.allowedPaths.join(', ')}]` : ' and the active task contract declares no allowed path covering it'}.`
      });
    }
    allow(ctx);
  }

  if (DISPATCH_TOOLS.has(toolName)) {
    const info = dispatchInfo(toolName, input, payload);
    const route = readRoute();

    // --- Three-tier pipeline ------------------------------------------------
    // The tool layer cannot see "did you write a Test Spec first" or "was this
    // QA independent"; those are process gates and stay declarative in
    // AGENTS.md. The ONE route rule that IS enforceable from a tool call is
    // this one: "fast" is defined as the main Agent working alone, so
    // dispatching under a declared fast route contradicts the declaration
    // itself. Ask rather than deny, because the right answer is usually "yes,
    // upgrade the route" — exactly the upgrade the workflow demands when risk
    // grows mid-task.
    if (route.tier === 'fast') {
      ask('ROUTE_FAST_DISPATCH', {
        tool: toolName,
        rule: 'route.fast-dispatch',
        target: info.role,
        auth: null,
        reason:
          `The route is declared "fast" (${route.file}${route.reason ? `, reason: ${route.reason}` : ''}) but this call dispatches role "${info.role}". ` +
          'Fast means the main Agent works alone and must not stand in for independent QA. ' +
          'Approve only if you are upgrading the route: then record it with `/team route standard <reason>` so the ledger shows the new route.'
      });
    }

    const gated = ALWAYS_GATED_DISPATCH.has(toolName) || process.env.DSH_TEAM_GATE_WORKFLOW === '1';
    if (gated) {
      const match = findDispatchAuthorization(ctx.authorizations, toolName, info, ctx);
      if (!match) {
        // No standing dispatch authorization. Ask in the moment instead of
        // refusing: requiring every dispatch to be pre-declared in a JSON file
        // was exactly the kind of friction that gets a policy layer switched
        // off wholesale. A standing record still short-circuits the question.
        ask('DISPATCH_UNAUTHORIZED', {
          tool: toolName,
          rule: 'dispatch.authorization',
          target: info.role,
          auth: 'dispatch',
          reason:
            `No standing dispatch authorization covers role "${info.role}". ` +
            'Approve to authorize this dispatch now — the platform records the request and its outcome in the session audit log. ' +
            `To stop being asked, add {"type":"dispatch","role":"${info.role}","scope":["<allowed path prefix>"],"issued_by":"<human>","id":"AUTH-..."} to ${authorizationsPath()}.`
        });
      }
      // Ledger: record, never block (see tryAppendLedger).
      note(ctx, tryAppendLedger(info, match, toolName, route).detail);
    }
    allow(ctx);
  }

  // Unknown tool: allow only when it is not in a mutating set. Any tool the
  // policy has not classified is non-mutating by construction, because every
  // mutating/shell/dispatch tool name is enumerated above.
  allow(ctx);
}

function mutationPath(toolName, input) {
  for (const key of ['file_path', 'path', 'file', 'filePath']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  if (typeof input.patch === 'string') {
    const match = /^\[([^#\]\r\n]+)#/m.exec(input.patch);
    if (match) return match[1];
  }
  return null;
}

function handlePost(payload) {
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (!DISPATCH_TOOLS.has(toolName)) process.exit(0);
  // Observability only: PostToolUse never blocks a completed tool call, and a
  // bookkeeping failure is reported, never escalated.
  const route = readRoute();
  const rawInput = payload.tool_input;
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  try {
    const info = dispatchInfo(toolName, input, payload);
    const read = ledger.readAll();
    const completeIds = new Set(
      read.entries.filter(({ record }) => record && record.event === 'complete').map(({ record }) => record.task_id)
    );
    const outstanding = read.entries
      .filter(({ record }) => record && record.event === 'dispatch' && record.role === info.role && !completeIds.has(record.task_id))
      .map(({ record }) => record);

    if (outstanding.length === 0) {
      process.stderr.write(
        'DSH-POLICY-NOTE ' +
          JSON.stringify({
            rule: 'ledger.complete',
            message: `${toolName} for role "${info.role}" finished; no outstanding dispatch record to consume.`,
            ledger: read.file
          }) +
          '\n'
      );
      process.exit(0);
    }

    // The hook closes its own record, so the ledger stays self-maintaining and
    // the workflow never depends on a manual `ledger.js --complete` step.
    const target = outstanding[outstanding.length - 1];
    const written = ledger.appendComplete({
      role: info.role,
      task_id: target.task_id,
      session: info.session,
      tool: toolName,
      status: 'completed',
      note: `route=${route.tier}`
    });
    process.stderr.write(
      'DSH-POLICY-NOTE ' +
        JSON.stringify({
          rule: 'ledger.complete',
          message: `${toolName} for role "${info.role}" finished; appended completion ${written.task_id} (seq ${written.seq})`,
          ledger: read.file
        }) +
        '\n'
    );
  } catch (error) {
    process.stderr.write(`DSH-LEDGER-WARN ${JSON.stringify({ rule: 'ledger.complete', message: String(error && error.message ? error.message : error) })}\n`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const forcePost = process.argv.includes('--post');
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_error) {
    raw = '';
  }
  if (raw.trim() === '') {
    malformed('stdin.empty', 'Refusing to run: the policy hook received empty stdin, so it cannot classify the call. Fail-closed by design (a crash would be a non-blocking bridge failure and the tool would proceed).');
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    malformed('stdin.not-json', `Refusing to run: the policy hook received malformed JSON on stdin (${String(error && error.message ? error.message : error)}). Fail-closed by design.`);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    malformed('stdin.not-object', 'Refusing to run: the policy hook stdin payload was not a JSON object. Fail-closed by design.');
  }
  const event = forcePost ? 'PostToolUse' : typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'PreToolUse';
  if (event === 'PostToolUse') return handlePost(payload);
  if (event !== 'PreToolUse') return process.exit(0); // events this program does not police
  return handlePre(payload);
}

try {
  main();
} catch (error) {
  // Last-resort fail-closed guard: an uncaught throw would exit non-2 and the
  // bridge would treat it as a non-blocking failure, letting the tool proceed.
  deny('POLICY_INTERNAL_ERROR', {
    tool: null,
    rule: 'internal.uncaught',
    target: null,
    reason: `Refusing to run: the policy program threw ${String(error && error.stack ? error.stack.split('\n')[0] : error)}. Fail-closed by design.`
  });
}
