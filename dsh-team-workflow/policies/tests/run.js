#!/usr/bin/env node
'use strict';
/**
 * DSH Team Policy — end-to-end test suite.
 *
 *   node policies/tests/run.js
 *
 * Every case spawns the REAL `policies/policy_check.js` child process with a
 * REAL hook payload on stdin and asserts on the REAL exit code and the REAL
 * stderr. Nothing here calls an internal function.
 *
 * Exit code: 0 when every case passes, 1 otherwise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const POLICIES_DIR = path.resolve(__dirname, '..');
const CHECKER = path.join(POLICIES_DIR, 'policy_check.js');
const LEDGER = path.join(POLICIES_DIR, 'ledger.js');

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-tests-'));
const WORKSPACE = path.join(ROOT, 'workspace');
const OUTSIDE = path.join(ROOT, 'outside');
const LEDGER_PATH = path.join(ROOT, 'ledger', 'agent-ledger.jsonl');
const AUTH_PATH = path.join(ROOT, 'authorizations.json');
const CONTRACT_PATH = path.join(ROOT, 'task-contract.json');
const ROUTE_PATH = path.join(ROOT, 'route.json');

// Baseline for the isolation guard at the end of the run.
const REAL_LEDGER_LINES_AT_START = (() => {
  const file = path.join(os.homedir(), '.dsh', 'team', 'ledger', 'agent-ledger.jsonl');
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  } catch (_error) {
    return -1; // absent: still a valid, stable state
  }
})();

fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true });
// Create the sandbox ledger's parent dir AND file up front. Without this the
// override points at a non-existent directory, and any code path that falls back
// to the default ledger would append TEST records to the operator's REAL ledger.
// That actually happened on 2026-10-13 (10 records, seq 24-33; see GAP-ANALYSIS
// L-12). The assertion further down guards against a regression.
fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
fs.writeFileSync(LEDGER_PATH, '', 'utf8');

// Fixtures used by the path cases.
fs.writeFileSync(path.join(WORKSPACE, '.env'), 'SECRET=1\n', 'utf8');
fs.writeFileSync(path.join(OUTSIDE, '.env'), 'SECRET=2\n', 'utf8');
// (d) a symlink whose REAL target is the protected .env file.
fs.symlinkSync(path.join(WORKSPACE, '.env'), path.join(WORKSPACE, 'link-to-env'));
// A control: a symlink to an ordinary file, which must stay allowed.
fs.writeFileSync(path.join(WORKSPACE, 'src', 'ok.js'), '// ok\n', 'utf8');
fs.symlinkSync(path.join(WORKSPACE, 'src', 'ok.js'), path.join(WORKSPACE, 'link-to-ok'));

const CHILD_ENV = {
  ...process.env,
  DSH_TEAM_LEDGER: LEDGER_PATH,
  DSH_TEAM_AUTHORIZATIONS: AUTH_PATH,
  DSH_TEAM_TASK_CONTRACT: CONTRACT_PATH,
  DSH_TEAM_WORKSPACE: WORKSPACE,
  DSH_TEAM_ROUTE: ROUTE_PATH
};

let toolUseCounter = 0;
function nextToolUseId() {
  toolUseCounter += 1;
  return `tu-${toolUseCounter}`;
}

function payload(toolName, toolInput, overrides) {
  const extra = overrides || {};
  return {
    session_id: extra.session_id || 'sess-tests',
    transcript_path: '',
    cwd: extra.cwd || WORKSPACE,
    hook_event_name: extra.event || 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: extra.tool_use_id || nextToolUseId(),
    ...(extra.tool_response !== undefined ? { tool_response: extra.tool_response } : {})
  };
}

/** Run the real checker as a child process. `raw` bypasses JSON.stringify (malformed case). */
function runChecker(body, options) {
  const opts = options || {};
  const input = opts.raw !== undefined ? opts.raw : JSON.stringify(body);
  const args = [CHECKER];
  if (opts.post === true) args.push('--post');
  const result = spawnSync(process.execPath, args, {
    input,
    encoding: 'utf8',
    cwd: opts.cwd || WORKSPACE,
    env: { ...CHILD_ENV, ...(opts.env || {}) },
    timeout: 30000
  });
  return {
    exit: result.status === null ? `null(signal=${result.signal})` : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message) : null
  };
}

function runLedger(args) {
  const result = spawnSync(process.execPath, [LEDGER, ...args], {
    encoding: 'utf8',
    cwd: WORKSPACE,
    env: CHILD_ENV,
    timeout: 30000
  });
  return { exit: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function ledgerLines() {
  try {
    return fs
      .readFileSync(LEDGER_PATH, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function readDeny(stderr) {
  const line = stderr.split('\n').find((l) => l.startsWith('DSH-POLICY-DENY '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('DSH-POLICY-DENY '.length));
  } catch (_error) {
    return null;
  }
}

/**
 * Write a pre-dispatch ledger record the way the main Agent must (an ordinary
 * writable tool call), because the hook process itself is sandboxed read-only.
 */
function ledgerDispatch(taskId, role, scope) {
  return runLedger(['--dispatch', '--role', role, '--scope', scope, '--session', 'sess-tests', '--tool', 'spawn_teammate', '--task-id', taskId]);
}

function ledgerComplete(taskId) {
  return runLedger(['--complete', '--task-id', taskId, '--session', 'sess-tests', '--tool', 'spawn_teammate']);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const results = [];
let passed = 0;
let failed = 0;

function heading(text) {
  process.stdout.write(`\n=== ${text} ===\n`);
}

function test(id, description, body, options, expectations) {
  const observed = runChecker(body, options);
  const deny = readDeny(observed.stderr);
  const checks = [];
  const inputLine = options && options.raw !== undefined ? options.raw : JSON.stringify(body);

  for (const expectation of expectations) {
    checks.push({ label: expectation.label, ok: expectation.ok(observed, deny) });
  }
  const ok = checks.every((c) => c.ok);
  if (ok) passed += 1;
  else failed += 1;
  results.push({ id, description, ok });

  process.stdout.write(`[${ok ? 'PASS' : 'FAIL'}] (${id}) ${description}\n`);
  process.stdout.write(`       input    : ${inputLine}\n`);
  process.stdout.write(`       observed : exit=${observed.exit}${observed.error ? ` spawnError=${observed.error}` : ''}\n`);
  if (observed.stderr.trim() !== '') process.stdout.write(`       stderr   : ${observed.stderr.trim().split('\n')[0]}\n`);
  else process.stdout.write('       stderr   : <empty>\n');
  for (const check of checks) {
    process.stdout.write(`       ${check.ok ? 'ok  ' : 'BAD '} ${check.label}\n`);
  }
  return { observed, deny };
}

function expectExit(code) {
  return { label: `exit code === ${code}`, ok: (observed) => observed.exit === code };
}
function expectCode(code) {
  return { label: `deny code === ${code}`, ok: (_observed, deny) => deny !== null && deny.code === code };
}
function expectAuth(type) {
  return { label: `deny auth type === ${type}`, ok: (_observed, deny) => deny !== null && deny.auth === type };
}
function expectNoStdoutJson() {
  return { label: 'stdout carries no decision JSON', ok: (observed) => observed.stdout.trim() === '' };
}

/** Decode a PreToolUse "ask" decision from stdout, or null when absent. */
function readAsk(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch (_error) {
    return null;
  }
  const hso = parsed && parsed.hookSpecificOutput;
  if (!hso || hso.hookEventName !== 'PreToolUse' || hso.permissionDecision !== 'ask') return null;
  const reason = String(hso.permissionDecisionReason || '');
  const brace = reason.indexOf('{');
  let body = null;
  if (brace >= 0) {
    try {
      body = JSON.parse(reason.slice(brace));
    } catch (_error) {
      body = null;
    }
  }
  return { code: body && body.code, body, raw: hso.permissionDecisionReason };
}
/** The call must be routed to the human approval channel with this code. */
function expectAsk(code) {
  return {
    label: 'permissionDecision === "ask" with code ' + code,
    ok: (observed) => {
      const a = readAsk(observed.stdout);
      return a !== null && a.code === code;
    }
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

heading('ALLOWED — ordinary workspace writes');
test(
  'a',
  'workspace write PASS',
  payload('write', { file_path: path.join(WORKSPACE, 'src', 'app.js'), content: 'export {};\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'a2',
  'workspace edit PASS (relative path, resolved against cwd)',
  payload('edit', { file_path: 'src/ok.js', old_string: '// ok', new_string: '// still ok' }),
  {},
  [expectExit(0)]
);
test(
  'a3',
  'workspace write through a benign symlink PASS',
  payload('write', { file_path: path.join(WORKSPACE, 'link-to-ok'), content: '// via link\n' }),
  {},
  [expectExit(0)]
);

heading('BLOCKED — secret-bearing paths');
test('b', '.env write BLOCK', payload('write', { file_path: path.join(WORKSPACE, '.env'), content: 'A=1\n' }), {}, [
  expectExit(2),
  expectCode('SECRET_ENV')
]);
test(
  'c',
  '.env via `..` traversal BLOCK',
  payload('write', { file_path: path.join(WORKSPACE, '..', 'outside', '.env'), content: 'A=1\n' }),
  {},
  [expectExit(2), expectCode('SECRET_ENV')]
);
test(
  'd',
  '.env via a symlink BLOCK',
  payload('write', { file_path: path.join(WORKSPACE, 'link-to-env'), content: 'A=1\n' }),
  {},
  [expectExit(2), expectCode('SECRET_ENV')]
);
test(
  'e',
  '.env via an absolute path outside allowed paths BLOCK',
  payload('write', { file_path: path.join(OUTSIDE, '.env'), content: 'A=1\n' }),
  {},
  [expectExit(2), expectCode('SECRET_ENV')]
);
test(
  'e2',
  'ordinary absolute path outside the workspace BLOCK (containment)',
  payload('write', { file_path: path.join(OUTSIDE, 'notes.txt'), content: 'x\n' }),
  {},
  [expectExit(2), expectCode('OUTSIDE_WORKSPACE')]
);
test(
  'e3',
  'absolute ~/.ssh key path BLOCK',
  payload('write', { file_path: '~/.ssh/config', content: 'Host *\n' }),
  {},
  [expectExit(2), expectCode('SECRET_HOME_DIR')]
);
test(
  'e4',
  'id_rsa* BLOCK',
  payload('write', { file_path: path.join(WORKSPACE, 'id_rsa'), content: 'k\n' }),
  {},
  [expectExit(2), expectCode('SECRET_SSH_KEY')]
);
test(
  'e5',
  'credentials directory BLOCK',
  payload('write', { file_path: path.join(WORKSPACE, 'credentials', 'prod.json'), content: '{}\n' }),
  {},
  [expectExit(2), expectCode('SECRET_DIRECTORY')]
);
test(
  'e6',
  '.github/workflows ALLOW (name-based CI gating removed 2026-10-14)',
  payload('write', { file_path: path.join(WORKSPACE, '.github', 'workflows', 'ci.yml'), content: 'on: push\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'e7',
  'Dockerfile ALLOW (a container build file is ordinary development work)',
  payload('write', { file_path: path.join(WORKSPACE, 'Dockerfile'), content: 'FROM scratch\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'e7b',
  'docker-compose.yml ALLOW (same reason)',
  payload('write', { file_path: path.join(WORKSPACE, 'docker-compose.yml'), content: 'services: {}\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'e8',
  'deploy/k8s/** ALLOW (directory-name gating removed 2026-10-14)',
  payload('write', { file_path: path.join(WORKSPACE, 'deploy', 'k8s', 'prod.yaml'), content: 'kind: Pod\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'e9',
  'notes/raw/** inside the workspace ALLOW (vault gating removed; no vault is configured)',
  payload('write', { file_path: path.join(WORKSPACE, 'notes', 'raw', 'source.md'), content: 'x\n' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);

heading('BLOCKED — publish / deploy / destructive shell');
test('f', 'git commit ALLOW (pack removed tool-layer VCS interception 2026-09-16)', payload('bash', { command: "git commit -m 'feat: change'" }), {}, [expectExit(0), expectNoStdoutJson()]);
test('g', 'git push ALLOW (process-gated, not tool-gated)', payload('bash', { command: 'git push origin main' }), {}, [expectExit(0), expectNoStdoutJson()]);
test('g2', 'npm publish ASK the human (no standing authorization)', payload('bash', { command: 'npm publish --access public' }), {}, [expectExit(0), expectAsk('PACKAGE_PUBLISH_NO_AUTH')]);
test('g3', 'gh release ASK the human', payload('bash', { command: 'gh release create v1.0.0' }), {}, [expectExit(0), expectAsk('RELEASE_PUBLISH_NO_AUTH')]);
test('g4', 'kubectl apply ASK the human', payload('bash', { command: 'kubectl apply -f deploy/prod.yaml' }), {}, [expectExit(0), expectAsk('DEPLOY_NO_AUTH')]);
test('g5', 'docker compose up ASK the human', payload('bash', { command: 'docker compose up -d' }), {}, [expectExit(0), expectAsk('DEPLOY_NO_AUTH')]);
test('g6', 'rsync to a remote ASK the human', payload('bash', { command: 'rsync -av ./dist/ deploy@host:/srv/app/' }), {}, [expectExit(0), expectAsk('DEPLOY_NO_AUTH')]);
test('h', 'docker system prune BLOCK (outright)', payload('bash', { command: 'docker system prune -af --volumes' }), {}, [expectExit(2), expectCode('DOCKER_PRUNE')]);
test('h2', 'docker image prune BLOCK (outright)', payload('bash', { command: 'docker image prune -a' }), {}, [expectExit(2), expectCode('DOCKER_PRUNE')]);
test('h3', 'docker compose down -v BLOCK (outright)', payload('bash', { command: 'docker compose down -v' }), {}, [expectExit(2), expectCode('DOCKER_COMPOSE_BLANKET_DOWN')]);
test('h4', 'DROP DATABASE (named) ASK the human', payload('bash', { command: 'psql -c "DROP DATABASE customers"' }), {}, [expectExit(0), expectAsk('DB_DESTRUCTIVE_NO_AUTH')]);
test('h5', 'TRUNCATE (named table) ASK the human', payload('bash', { command: 'psql -c "TRUNCATE orders"' }), {}, [expectExit(0), expectAsk('DB_DESTRUCTIVE_NO_AUTH')]);
test('h6', 'rm -rf outside the workspace BLOCK (outright)', payload('bash', { command: 'rm -rf /Users/maxwell/Documents' }), {}, [expectExit(2), expectCode('RM_RECURSIVE_FORCE')]);
test('h7', 'git commit through `&&` ALLOW (no VCS rule left to smuggle past)', payload('bash', { command: "ls -la && git commit -m 'x'" }), {}, [expectExit(0), expectNoStdoutJson()]);
test('h8', 'git push through $(...) ALLOW', payload('bash', { command: 'echo $(git push origin main)' }), {}, [expectExit(0), expectNoStdoutJson()]);
test('h9', 'docker rm with a wildcard selector BLOCK (outright)', payload('bash', { command: 'docker rm $(docker ps -aq)' }), {}, [expectExit(2), expectCode('DOCKER_REMOVE_UNSCOPED')]);
// Mentioning SQL is not running SQL. These regressions exist because the raw-SQL
// rules used to match anywhere in the command line, and refused this very
// repository while its own design document was being written (2026-10-14).
test(
  'h10',
  'a heredoc that merely mentions TRUNCATE ALLOW (no database client invoked)',
  payload('bash', { command: "cat >> doc.md <<'EOF'\n未命名 TRUNCATE 会被拒\nEOF" }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'h11',
  'grep for DROP DATABASE ALLOW (no database client invoked)',
  payload('bash', { command: 'grep -rn "DROP DATABASE" ./docs' }),
  {},
  [expectExit(0), expectNoStdoutJson()]
);
test(
  'h12',
  'a client wrapped in sudo is still recognised (named TRUNCATE -> ASK)',
  payload('bash', { command: 'sudo -u postgres psql -c "TRUNCATE orders"' }),
  {},
  [expectExit(0), expectAsk('DB_DESTRUCTIVE_NO_AUTH')]
);
test(
  'h13',
  'a deploy wrapped in sudo is still recognised (the wrapper operand is not the command)',
  payload('bash', { command: 'sudo -u root kubectl apply -f prod.yaml' }),
  {},
  [expectExit(0), expectAsk('DEPLOY_NO_AUTH')]
);
test(
  'h14',
  'env with a value-taking flag still resolves the real command',
  payload('bash', { command: 'env -u AWS_PROFILE kubectl delete pod web-1' }),
  {},
  [expectExit(0), expectAsk('DEPLOY_NO_AUTH')]
);

heading('AUTHORIZATION — named resource deletion');
const NAMED_CONTAINER = '3f2a1b0c9d8e';
test('i', `named docker rm ${NAMED_CONTAINER} WITHOUT authorization ASK the human`, payload('bash', { command: `docker rm ${NAMED_CONTAINER}` }), {}, [
  expectExit(0),
  expectAsk('RESOURCE_DELETE_NO_AUTH'),
  {
    label: 'the ask carries the docker_delete auth type',
    ok: (observed) => {
      const a = readAsk(observed.stdout);
      return a !== null && a.body.auth === 'docker_delete';
    }
  }
]);
test(
  'j',
  `named docker rm ${NAMED_CONTAINER} WITH a matching authorization record ALLOW`,
  payload('bash', {
    command: `docker rm ${NAMED_CONTAINER}`,
    authorization: {
      id: 'AUTH-DOCKER-1',
      type: 'docker_delete',
      issued_by: 'user',
      issued_at: Date.now(),
      resources: [NAMED_CONTAINER],
      reason: 'approved single container removal after manifest review'
    }
  }),
  {},
  [expectExit(0)]
);
test(
  'j2',
  'named docker rm with a NON-matching authorization resource ASK the human',
  payload('bash', {
    command: `docker rm ${NAMED_CONTAINER}`,
    authorization: { id: 'AUTH-DOCKER-2', type: 'docker_delete', issued_by: 'user', resources: ['deadbeefdead'] }
  }),
  {},
  [expectExit(0), expectAsk('RESOURCE_DELETE_NO_AUTH')]
);
test(
  'j3',
  'docker rm with a WILDCARD authorization does NOT silently authorize: ASK the human',
  payload('bash', {
    command: `docker rm ${NAMED_CONTAINER}`,
    authorization: { id: 'AUTH-DOCKER-3', type: 'docker_delete', issued_by: 'user', resources: ['*'] }
  }),
  {},
  [expectExit(0), expectAsk('RESOURCE_DELETE_NO_AUTH')]
);
test(
  'j4',
  'docker system prune WITH a wildcard authorization still BLOCK (prune is outright)',
  payload('bash', {
    command: 'docker system prune -af',
    authorization: { id: 'AUTH-DOCKER-4', type: 'docker_delete', issued_by: 'user', resources: ['*'] }
  }),
  {},
  [expectExit(2), expectCode('DOCKER_PRUNE')]
);

heading('ALLOWED — ordinary shell');
test('k1', 'ls -la ALLOW', payload('bash', { command: 'ls -la' }), {}, [expectExit(0)]);
test('k2', 'cat package.json ALLOW', payload('bash', { command: 'cat package.json' }), {}, [expectExit(0)]);
test('k3', 'echo hello ALLOW', payload('bash', { command: 'echo hello' }), {}, [expectExit(0)]);
test('k4', 'git status ALLOW', payload('bash', { command: 'git status --short && git add -A' }), {}, [expectExit(0)]);
test('k5', 'rm -rf inside the workspace ALLOW', payload('bash', { command: 'rm -rf node_modules dist' }), {}, [expectExit(0)]);

heading('DISPATCH — authorization + pre-dispatch ledger');
fs.writeFileSync(AUTH_PATH, JSON.stringify([], null, 2), 'utf8');
const beforeBlocked = ledgerLines().length;
test(
  'l',
  'spawn_teammate WITHOUT a standing authorization ASKs the human and does not advance the ledger',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-dispatch-blocked' }),
  {},
  [
    expectExit(0),
    expectAsk('DISPATCH_UNAUTHORIZED'),
    {
      label: 'ledger line count unchanged while the dispatch waits for approval',
      ok: () => ledgerLines().length === beforeBlocked
    }
  ]
);

// Lead-issued dispatch grant covering the whole sandbox workspace.
fs.writeFileSync(
  AUTH_PATH,
  JSON.stringify(
    [
      {
        id: 'AUTH-DISPATCH-BACKEND',
        type: 'dispatch',
        role: 'backend',
        scope: [`${WORKSPACE}/**`],
        issued_by: 'lead',
        issued_at: Date.now(),
        reason: 'WS-C test grant'
      }
    ],
    null,
    2
  ),
  'utf8'
);
const beforeAllowed = ledgerLines().length;
test(
  'm',
  'spawn_teammate WITH a grant ALLOWs; the hook appends the pre-dispatch record itself',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-dispatch-allowed' }),
  {},
  [
    expectExit(0),
    expectNoStdoutJson(),
    { label: 'the hook appended exactly one dispatch record', ok: () => ledgerLines().length === beforeAllowed + 1 },
    {
      label: 'the appended record names the role and carries the route',
      ok: () => {
        const added = ledgerLines()[ledgerLines().length - 1];
        return added.event === 'dispatch' && added.role === 'backend' && String(added.note || '').includes('route=');
      }
    },
    {
      label: 'a DSH-POLICY-NOTE reports the append',
      ok: (result) => result.stderr.includes('DSH-POLICY-NOTE') && result.stderr.includes('appended by the hook')
    }
  ]
);
const PRE_ID = 'sess-tests#cli-predispatch';
ledgerDispatch(PRE_ID, 'backend', WORKSPACE);
test(
  'm1',
  'a hand-written pre-dispatch record is no longer required (the hook records every dispatch)',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-dispatch-allowed' }),
  {},
  [
    expectExit(0),
    {
      label: 'the hand-written record is still intact',
      ok: () => {
        const found = ledgerLines().filter((r) => r.event === 'dispatch' && r.task_id === PRE_ID);
        return found.length === 1 && found[0].role === 'backend';
      }
    },
    {
      label: 'the hook appended its own dispatch record as well',
      ok: () => ledgerLines().filter((r) => r.event === 'dispatch').length >= 2
    }
  ]
);
test(
  'm2',
  'spawn_teammate for a DIFFERENT role than the grant ASKs the human',
  payload('spawn_teammate', { name: 'devops', description: 'ship it', prompt: 'go' }),
  {},
  [expectExit(0), expectAsk('DISPATCH_UNAUTHORIZED')]
);
test(
  'm3',
  'subagent WITHOUT a record ASKs the human',
  payload('subagent', { description: 'research', prompt: 'look it up' }),
  {},
  [expectExit(0), expectAsk('DISPATCH_UNAUTHORIZED')]
);
// ---- Three-tier route ---------------------------------------------------
// The ledger consumption/role gate was removed together with the manual
// pre-dispatch step. What the tool layer DOES enforce about the route is the
// one thing it can actually see: a declared "fast" route cannot quietly turn
// into a dispatch, because "fast" means the main Agent works alone.
ledgerComplete(PRE_ID);
fs.writeFileSync(ROUTE_PATH, JSON.stringify({ tier: 'fast', reason: 'tiny typo fix', declared_at: Date.now() }), 'utf8');
test(
  'm4',
  'a declared "fast" route turning into a dispatch ASKs the human to upgrade the route',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-route-fast' }),
  {},
  [
    expectExit(0),
    expectAsk('ROUTE_FAST_DISPATCH'),
    {
      label: 'the ask quotes the declared reason',
      ok: (observed) => {
        const a = readAsk(observed.stdout);
        return a !== null && a.raw.includes('tiny typo fix');
      }
    }
  ]
);
fs.writeFileSync(ROUTE_PATH, JSON.stringify({ tier: 'deep', reason: 'cross-owner contract change', declared_at: Date.now() }), 'utf8');
test(
  'm5',
  'a declared "deep" route raises no route objection (standard/deep differ only in process gates)',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-route-deep' }),
  {},
  [
    expectExit(0),
    { label: 'no ask of any kind', ok: (observed) => readAsk(observed.stdout) === null }
  ]
);
fs.rmSync(ROUTE_PATH, { force: true });
test(
  'm5b',
  'with no route.json the route defaults to standard and never blocks',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-route-default' }),
  {},
  [expectExit(0)]
);
test(
  'm6',
  'PostToolUse appends the completion record itself so the ledger stays self-maintaining',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, {
    event: 'PostToolUse',
    tool_use_id: 'tu-dispatch-allowed',
    tool_response: 'teammate backend started'
  }),
  {},
  [
    expectExit(0),
    { label: 'the hook appended a completion record for the role', ok: () => ledgerLines().some((r) => r.event === 'complete' && r.role === 'backend') },
    {
      label: 'stderr reports the appended completion',
      ok: (result) => result.stderr.includes('DSH-POLICY-NOTE') && result.stderr.includes('ledger.complete') && result.stderr.includes('appended completion')
    }
  ]
);

heading('ROBUSTNESS — malformed input and unknown tools');
test('n', 'malformed (non-JSON) stdin BLOCK', {}, { raw: 'this is not json at all' }, [expectExit(2), expectCode('MALFORMED_INPUT')]);
test('n2', 'empty stdin BLOCK', {}, { raw: '' }, [expectExit(2), expectCode('MALFORMED_INPUT')]);
test('n3', 'JSON array stdin BLOCK', {}, { raw: '[1,2,3]' }, [expectExit(2), expectCode('MALFORMED_INPUT')]);
test('n4', 'payload without tool_name BLOCK', {}, { raw: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: WORKSPACE, tool_input: {} }) }, [expectExit(2), expectCode('MALFORMED_INPUT')]);
test('n5', 'write without any path argument BLOCK', payload('write', { content: 'x' }), {}, [expectExit(2), expectCode('PATH_ARGUMENT_MISSING')]);
test('o', 'unknown non-mutating tool ALLOW', payload('totally_unknown_tool', { anything: true }), {}, [expectExit(0)]);
test('o2', '`read` ALLOW', payload('read', { file_path: path.join(WORKSPACE, '.env') }), {}, [expectExit(0)]);
test('o3', '`glob` ALLOW', payload('glob', { pattern: '**/*.js' }), {}, [expectExit(0)]);

// A malformed Lead-issued store must be *reported*, not silently ignored. It is
// still fail-closed for anything that requires an authorization, so exit stays 0
// for an ordinary allowed command.
const BAD_AUTH = path.join(ROOT, 'authorizations-broken.json');
fs.writeFileSync(BAD_AUTH, '{ this is not json', 'utf8');
test(
  'o4',
  'allowed call with a MALFORMED authorization store ALLOWs but warns on stderr',
  payload('bash', { command: 'ls -la' }),
  { env: { DSH_TEAM_AUTHORIZATIONS: BAD_AUTH } },
  [
    expectExit(0),
    {
      label: 'stderr carries a DSH-POLICY-WARN config.unreadable',
      ok: (observed) => observed.stderr.startsWith('DSH-POLICY-WARN ') && observed.stderr.includes('config.unreadable')
    }
  ]
);
test(
  'o5',
  'an unreadable authorization store never silently authorizes: the call still goes to the human',
  payload('bash', { command: `docker rm ${NAMED_CONTAINER}` }),
  { env: { DSH_TEAM_AUTHORIZATIONS: BAD_AUTH } },
  [expectExit(0), expectAsk('RESOURCE_DELETE_NO_AUTH')]
);
fs.rmSync(BAD_AUTH, { force: true });
test('p1', 'team_task_create ALLOW', payload('team_task_create', { subject: 's', description: 'd', write_scopes: ['src/'] }), {}, [expectExit(0)]);
test('p2', 'team_task_update ALLOW', payload('team_task_update', { task_id: 't-1', status: 'in_progress', owner: 'backend' }), {}, [expectExit(0)]);
test('p3', 'interrupt_agent / list_agents ALLOW', payload('interrupt_agent', { target: 'backend' }), {}, [expectExit(0)]);

heading('TASK CONTRACT — explicit allowed / denied paths');
fs.writeFileSync(CONTRACT_PATH, JSON.stringify({ task_id: 'T-1', allowed_paths: [OUTSIDE] }), 'utf8');
// Scope check in the ledger gate: with a contract whose allowed path is OUTSIDE,
// a record scoped to WORKSPACE must not cover the dispatch, and one scoped to
// OUTSIDE must.
const AUTH_ORIGINAL = fs.readFileSync(AUTH_PATH, 'utf8');
fs.writeFileSync(
  AUTH_PATH,
  JSON.stringify([{ id: 'AUTH-DISPATCH-BACKEND', type: 'dispatch', role: 'backend', scope: [`${WORKSPACE}/**`, `${OUTSIDE}/**`], issued_by: 'lead', issued_at: Date.now(), reason: 'scope-gate case' }], null, 2),
  'utf8'
);
ledgerDispatch('sess-tests#cli-wrong-scope', 'backend', WORKSPACE);
test(
  'r0',
  'the removed ledger-scope gate no longer blocks a dispatch whose old record scope differed',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-scope-mismatch' }),
  {},
  [expectExit(0)]
);
ledgerDispatch('sess-tests#cli-right-scope', 'backend', OUTSIDE);
test(
  'r0b',
  'pre-dispatch record whose scope DOES cover the contract allowed path ALLOW',
  payload('spawn_teammate', { name: 'backend', description: 'implement the API', prompt: 'do the work' }, { tool_use_id: 'tu-scope-match' }),
  {},
  [expectExit(0)]
);
test(
  'r1',
  'write into a task-contract allowed_path OUTSIDE the workspace ALLOW',
  payload('write', { file_path: path.join(OUTSIDE, 'build-artifact.txt'), content: 'x\n' }),
  {},
  [expectExit(0)]
);
fs.writeFileSync(CONTRACT_PATH, JSON.stringify({ task_id: 'T-2', denied_paths: [path.join(WORKSPACE, 'vendor')] }), 'utf8');
test(
  'r2',
  'write inside a task-contract denied_path BLOCK',
  payload('write', { file_path: path.join(WORKSPACE, 'vendor', 'lib.js'), content: 'x\n' }),
  {},
  [expectExit(2), expectCode('TASK_CONTRACT_DENIED_PATH')]
);
fs.writeFileSync(AUTH_PATH, AUTH_ORIGINAL, 'utf8');
fs.writeFileSync(CONTRACT_PATH, JSON.stringify({}), "utf8");
test(
  'r3',
  '`..` traversal that stays inside the workspace ALLOW',
  payload('write', { file_path: path.join(WORKSPACE, 'src', '..', 'src', 'ok2.js'), content: 'x\n' }),
  {},
  [expectExit(0)]
);
fs.rmSync(CONTRACT_PATH, { force: true });
test(
  'r4',
  'no contract file at all -> default containment still applies',
  payload('write', { file_path: path.join(OUTSIDE, 'build-artifact.txt'), content: 'x\n' }),
  {},
  [expectExit(2), expectCode('OUTSIDE_WORKSPACE')]
);

heading('LEDGER — append-only verification');
const LEDGER_SIZE_BEFORE_VERIFY = fs.statSync(LEDGER_PATH).size;
const verify = runLedger(['--verify']);
const LEDGER_SIZE_AFTER_VERIFY = fs.statSync(LEDGER_PATH).size;
test(
  'q',
  'ledger --verify reports append-only integrity after the mixed pass',
  payload('read', { file_path: path.join(WORKSPACE, 'src', 'ok.js') }),
  {},
  [
    {
      label: `ledger --verify exit code === 0 (observed ${verify.exit})`,
      ok: () => verify.exit === 0
    },
    {
      label: 'verify report ok===true, seq monotonic, no duplicate dispatch ids',
      ok: () => {
        let report;
        try {
          report = JSON.parse(verify.stdout);
        } catch (_error) {
          return false;
        }
        return (
          report.ok === true &&
          report.seq_issues.length === 0 &&
          report.ts_issues.length === 0 &&
          report.duplicate_dispatch_ids.length === 0 &&
          report.malformed_lines.length === 0 &&
          report.dispatch_records >= 1 &&
          report.complete_records >= 1 &&
          report.max_seq === report.records
        );
      }
    },
    {
      label: 'verify is read-only (ledger byte length unchanged before/after)',
      ok: () => LEDGER_SIZE_AFTER_VERIFY === LEDGER_SIZE_BEFORE_VERIFY
    }
  ]
);
process.stdout.write(`       ledger --verify stdout: ${verify.stdout.trim()}\n`);

// ---------------------------------------------------------------------------
// Regression guard: the suite must never touch the operator's real ledger.
// Measured failure 2026-10-13 (GAP-ANALYSIS L-12): a fallback in ledger.js let
// the sandboxed run append 10 test records to ~/.dsh/team/ledger/agent-ledger.jsonl.
// ---------------------------------------------------------------------------

function defaultLedgerLineCount() {
  const file = path.join(os.homedir(), '.dsh', 'team', 'ledger', 'agent-ledger.jsonl');
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  } catch (_error) {
    return -1; // absent: still a valid, stable state
  }
}

test(
  'isolation',
  'the suite NEVER appends to the real ~/.dsh ledger (test records must stay in the sandbox)',
  () => {
    const now = defaultLedgerLineCount();
    if (now !== REAL_LEDGER_LINES_AT_START) {
      throw new Error(
        `real ledger line count changed during the run: ${REAL_LEDGER_LINES_AT_START} -> ${now}. ` +
        'Test isolation is broken; check ledger.js override resolution.'
      );
    }
    process.stdout.write(`       real ledger lines ${REAL_LEDGER_LINES_AT_START} -> ${now} (unchanged)\n`);
  },
  undefined,
  [{ label: 'real ledger untouched', ok: () => defaultLedgerLineCount() === REAL_LEDGER_LINES_AT_START }]
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

heading('SUMMARY');
process.stdout.write(`sandbox : ${ROOT}\n`);
process.stdout.write(`checker : ${CHECKER}\n`);
process.stdout.write(`ledger  : ${LEDGER_PATH} (${ledgerLines().length} records)\n`);
for (const r of results) {
  if (!r.ok) process.stdout.write(`FAILED (${r.id}) ${r.description}\n`);
}
process.stdout.write(`\n${passed} passed, ${failed} failed, ${results.length} total\n`);

if (process.env.DSH_TEAM_KEEP_TEST_SANDBOX !== '1') {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
