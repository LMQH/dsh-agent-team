#!/usr/bin/env node
'use strict';
/**
 * DSH Team Policy — bridge-mapping probe.
 *
 *   node policies/tests/bridge-probe.js
 *
 * This closes the gap between "policy_check.js exits 2" and "the harness denies
 * the tool call". It loads the SHIPPED bridge code straight out of the installed
 * application bundle:
 *
 *   - `@deepseek-ai/dsh-hook-protocol/lib/index.js`   (zero imports; imported as-is)
 *   - `@deepseek-ai/dsh-hooks-claude-code/lib/index.js` config region
 *     (`//#region lib/types/config.js` … `//#endregion`), re-emitted verbatim as
 *     an ES module so the shipped `parseClaudeCodeConfig` runs unmodified.
 *
 * It then proves, against policies/hooks.json:
 *   1. the shipped parser accepts the config (no invalid-matcher SyntaxError);
 *   2. the configured matchers select exactly the intended real DSH tool names,
 *      and that a word-and-pipe matcher is LITERAL, not a regex;
 *   3. a real blocking hook run (exit 2) folds to decision `deny` with the hook's
 *      stderr as the reason — i.e. the tool call is really rejected;
 *   4. a real allowing hook run (exit 0) folds to decision `none`;
 *   5. a crashing hook (exit 1) folds to decision `none` — the fail-open hazard
 *      that motivates the fail-closed design of policy_check.js.
 *
 * Exit 0 when every assertion holds, 1 otherwise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const POLICIES_DIR = path.resolve(__dirname, '..');
const HOOKS_JSON = path.join(POLICIES_DIR, 'hooks.json');
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const WORKSPACE = '/Users/maxwell/workspace/code_space/agent-team-workflow';

// ---------------------------------------------------------------------------
// Minimal asar reader (same layout the Electron asar format documents)
// ---------------------------------------------------------------------------
function readAsarEntries(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const pickleSize = head.readUInt32LE(4);
  const stringSize = head.readUInt32LE(12);
  const headerBuf = Buffer.alloc(stringSize);
  fs.readSync(fd, headerBuf, 0, stringSize, 16);
  const header = JSON.parse(headerBuf.toString('utf8'));
  const base = 8 + pickleSize;
  const entries = [];
  (function walk(node, prefix) {
    for (const [key, value] of Object.entries(node.files || {})) {
      const next = prefix + '/' + key;
      if (value.files) walk(value, next);
      else entries.push({ path: next, size: value.size, offset: Number(value.offset) });
    }
  })(header, '');
  return {
    find(suffix) {
      const hit = entries.find((e) => e.path.endsWith(suffix));
      if (!hit) throw new Error(`asar: ${suffix} not found`);
      const buf = Buffer.alloc(hit.size);
      fs.readSync(fd, buf, 0, hit.size, base + hit.offset);
      return buf.toString('utf8');
    },
    close() {
      fs.closeSync(fd);
    }
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
const failures = [];
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  const ok = Boolean(condition);
  if (!ok) failures.push(label);
  process.stdout.write(`  ${ok ? 'ok  ' : 'BAD '} ${label}${detail !== undefined && !ok ? `  -> ${detail}` : ''}\n`);
}

function section(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function runHookCommand(command, payload, env) {
  const result = spawnSync('bash', ['-c', command], {
    input: JSON.stringify(payload) + '\n',
    encoding: 'utf8',
    cwd: WORKSPACE,
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE, ...(env || {}) },
    timeout: 30000
  });
  return {
    exitCode: result.status === null ? undefined : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

async function main() {
  const asar = readAsarEntries(ASAR);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-probe-'));
  const protocolSource = asar.find('/@deepseek-ai/dsh-hook-protocol/lib/index.js');
  const claudeSource = asar.find('/@deepseek-ai/dsh-hooks-claude-code/lib/index.js');
  asar.close();

  const protocolFile = path.join(scratch, 'hook-protocol.mjs');
  fs.writeFileSync(protocolFile, protocolSource, 'utf8');
  const protocol = await import(pathToFileURL(protocolFile).href);

  const start = claudeSource.indexOf('//#region lib/types/config.js');
  const end = claudeSource.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw new Error('hooks-claude-code: config region markers not found in the shipped bundle');
  const configRegion = claudeSource.slice(start, end);
  const configModuleFile = path.join(scratch, 'claude-config.mjs');
  fs.writeFileSync(
    configModuleFile,
    `import { matcherDiagnostic } from ${JSON.stringify(pathToFileURL(protocolFile).href)};\n` +
      configRegion +
      '\nexport { parseClaudeCodeConfig, CLAUDE_EVENTS };\n',
    'utf8'
  );
  const { parseClaudeCodeConfig } = await import(pathToFileURL(configModuleFile).href);

  process.stdout.write(`shipped hook-protocol  : @deepseek-ai/dsh-hook-protocol (${protocolSource.length} bytes)\n`);
  process.stdout.write(`shipped config region  : @deepseek-ai/dsh-hooks-claude-code (${configRegion.length} bytes)\n`);
  process.stdout.write(`hooks.json             : ${HOOKS_JSON}\n`);
  process.stdout.write(`scratch                : ${scratch}\n`);

  // -------------------------------------------------------------------------
  section('1. the shipped parser accepts policies/hooks.json');
  const rawConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  let parsed;
  let parseError = null;
  try {
    parsed = parseClaudeCodeConfig(rawConfig, { projectDir: WORKSPACE });
  } catch (error) {
    parseError = error;
  }
  check('parseClaudeCodeConfig does not throw (no invalid-matcher SyntaxError)', parseError === null, parseError && parseError.message);
  const config = parsed ? parsed.config : {};
  check('no non-command hooks were skipped', parsed && parsed.skipped.length === 0, parsed && JSON.stringify(parsed.skipped));
  check('PreToolUse groups === 3', Array.isArray(config.PreToolUse) && config.PreToolUse.length === 3, config.PreToolUse && config.PreToolUse.length);
  check('PostToolUse groups === 1', Array.isArray(config.PostToolUse) && config.PostToolUse.length === 1, config.PostToolUse && config.PostToolUse.length);
  check('no Stop hook is configured (Stop-free, per the contract)', config.Stop === undefined);
  const allHooks = [...(config.PreToolUse || []), ...(config.PostToolUse || [])].flatMap((g) => g.hooks);
  check('every hook is a command hook with a timeout', allHooks.every((h) => h.command && typeof h.timeoutSec === 'number'), JSON.stringify(allHooks.map((h) => h.timeoutSec)));
  check('every hook timeout is a sane 10s', allHooks.every((h) => h.timeoutSec === 10), JSON.stringify(allHooks.map((h) => h.timeoutSec)));
  check(
    'every matcher passes the shipped matcherDiagnostic (accepted as a valid claude-code matcher)',
    (config.PreToolUse || []).concat(config.PostToolUse || []).every((g) => protocol.matcherDiagnostic(g.matcher, 'claude-code') === undefined)
  );

  // -------------------------------------------------------------------------
  section('2. matchers select the real DSH tool names');
  const preGroups = config.PreToolUse || [];
  const routed = (toolName) => preGroups.filter((g) => protocol.matchesMatcher(g.matcher, toolName, 'claude-code')).map((g) => g.matcher);
  const expectations = [
    ['write', 1], ['edit', 1], ['str_replace_editor', 1],
    ['bash', 1],
    ['spawn_teammate', 1], ['subagent', 1], ['subagent_fork', 1], ['workflow', 1],
    ['read', 0], ['read_image', 0], ['glob', 0], ['grep', 0],
    ['send_message', 0], ['list_agents', 0], ['wait_agent', 0], ['interrupt_agent', 0],
    ['team_task_create', 0], ['team_task_list', 0], ['team_task_get', 0], ['team_task_update', 0],
    ['todo_write', 0], ['present', 0], ['ask_user_question', 0]
  ];
  for (const [toolName, expected] of expectations) {
    const hit = routed(toolName);
    check(`matcher routing for "${toolName}" -> ${expected} group(s)`, hit.length === expected, JSON.stringify(hit));
  }
  check(
    'a word-and-pipe matcher is LITERAL: "write|edit|str_replace_editor" does not match "writer"',
    !protocol.matchesMatcher('write|edit|str_replace_editor', 'writer', 'claude-code')
  );
  check(
    'a word-and-pipe matcher is LITERAL: "spawn_teammate|subagent" does not match "spawn_teammate_extra"',
    !protocol.matchesMatcher('spawn_teammate|subagent', 'spawn_teammate_extra', 'claude-code')
  );
  check(
    'a non-word matcher IS a regex: "subagent.*" matches "subagent_fork"',
    protocol.matchesMatcher('subagent.*', 'subagent_fork', 'claude-code') === true
  );

  // -------------------------------------------------------------------------
  section('3. a blocking hook run folds to decision "deny"');
  const scratchLedger = path.join(scratch, 'ledger.jsonl');
  const hookEnv = {
    DSH_TEAM_LEDGER: scratchLedger,
    DSH_TEAM_WORKSPACE: WORKSPACE,
    DSH_TEAM_AUTHORIZATIONS: path.join(scratch, 'authorizations.json'),
    DSH_TEAM_TASK_CONTRACT: path.join(scratch, 'task-contract.json')
  };
  const writeGroup = preGroups.find((g) => protocol.matchesMatcher(g.matcher, 'write', 'claude-code'));
  const writeCommand = writeGroup.hooks[0].command;

  const blockedPayload = {
    session_id: 'bridge-probe',
    transcript_path: '',
    cwd: WORKSPACE,
    hook_event_name: 'PreToolUse',
    tool_name: 'write',
    tool_input: { file_path: path.join(WORKSPACE, '.env'), content: 'SECRET=1\n' },
    tool_use_id: 'tu-probe-block'
  };
  const blockedRun = runHookCommand(writeCommand, blockedPayload, hookEnv);
  process.stdout.write(`  hook exit=${blockedRun.exitCode}\n`);
  process.stdout.write(`  hook stderr=${blockedRun.stderr.trim()}\n`);
  const blockedOut = protocol.parseHookOutput(blockedRun.exitCode, blockedRun.stdout, blockedRun.stderr, 'PreToolUse');
  const blockedMerged = protocol.mergeHookOutputs([blockedOut]);
  check('exit code 2 -> parsed decision === "block"', blockedOut.decision === 'block', JSON.stringify(blockedOut));
  check('merged decision === "deny" (the harness denies the tool call)', blockedMerged.decision === 'deny', JSON.stringify(blockedMerged));
  check('merged reason is the hook stderr verbatim', blockedMerged.reason === blockedRun.stderr.trim(), JSON.stringify(blockedMerged.reason));
  let reasonBody = null;
  try {
    reasonBody = JSON.parse(blockedMerged.reason.slice('DSH-POLICY-DENY '.length));
  } catch (_error) {
    reasonBody = null;
  }
  check('the merged reason carries the machine-readable code SECRET_ENV', reasonBody !== null && reasonBody.code === 'SECRET_ENV', JSON.stringify(reasonBody));

  // -------------------------------------------------------------------------
  section('4. an allowing hook run folds to decision "none" (tool proceeds)');
  const allowedPayload = {
    ...blockedPayload,
    tool_input: { file_path: path.join(WORKSPACE, 'dsh-team-workflow', 'README-probe.tmp'), content: 'x\n' },
    tool_use_id: 'tu-probe-allow'
  };
  const allowedRun = runHookCommand(writeCommand, allowedPayload, hookEnv);
  const allowedOut = protocol.parseHookOutput(allowedRun.exitCode, allowedRun.stdout, allowedRun.stderr, 'PreToolUse');
  const allowedMerged = protocol.mergeHookOutputs([allowedOut]);
  check('allowed hook exit code === 0', allowedRun.exitCode === 0, String(allowedRun.exitCode));
  check('merged decision === "none" (no hook objected)', allowedMerged.decision === 'none', JSON.stringify(allowedMerged));

  // -------------------------------------------------------------------------
  section('5. fail-open hazard: a crashing hook is NON-blocking');
  const crashCommand = 'exit 1';
  const crashRun = runHookCommand(crashCommand, blockedPayload, hookEnv);
  const crashOut = protocol.parseHookOutput(crashRun.exitCode, crashRun.stdout, crashRun.stderr, 'PreToolUse');
  const crashMerged = protocol.mergeHookOutputs([crashOut]);
  check('exit code 1 -> no decision field', crashOut.decision === undefined, JSON.stringify(crashOut));
  check('merged decision === "none" -> the tool WOULD PROCEED (fail-open)', crashMerged.decision === 'none', JSON.stringify(crashMerged));
  const missingHit = spawnSync('bash', ['-c', 'exit 127'], { encoding: 'utf8' });
  const missingOut = protocol.parseHookOutput(missingHit.status, '', '', 'PreToolUse');
  check('a missing/failed hook binary is likewise non-blocking', protocol.mergeHookOutputs([missingOut]).decision === 'none');

  // -------------------------------------------------------------------------
  section('SUMMARY');
  process.stdout.write(`${checks - failures.length} passed, ${failures.length} failed, ${checks} total\n`);
  for (const f of failures) process.stdout.write(`FAILED: ${f}\n`);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`bridge-probe fatal: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
