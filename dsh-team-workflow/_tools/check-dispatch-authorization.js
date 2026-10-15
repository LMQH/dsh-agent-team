#!/usr/bin/env node
/**
 * 派发授权**空跑判定**工具 —— 不碰真实文件，不替你授权。
 *
 * 用途：在把一条 dispatch 授权写进 `~/.dsh/team/authorizations.json` **之前**，
 * 先用真实的策略程序（`policy_check.js`）判一遍，看到底会 allow 还是 ask。
 * 这样你写进去的是**验证过的形状**，不是猜的形状。
 *
 * 隔离手段（两道显式覆盖，都是策略程序自己支持的）：
 *   DSH_TEAM_AUTHORIZATIONS → 指向临时目录里的副本（真实文件只读）
 *   DSH_TEAM_LEDGER         → 指向临时目录（真实台账一个字节都不动）
 *
 * 这个工具**不会、也不能**替你授权：
 *   · 它不写真实 authorizations.json（只在临时副本上试）
 *   · 它自己不是授权来源（issued_by 必须是人类）
 *   · 真实生效仍然需要你本人把记录写进真实文件
 *
 * 用法：
 *   node _tools/check-dispatch-authorization.js <角色名> [--scope 路径1:路径2]
 *   node _tools/check-dispatch-authorization.js <角色名> --candidate   # 加一条候选记录再判一次
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');
const POLICY = join(HOME, 'team', 'policies', 'policy_check.js');
const REAL_AUTH = join(HOME, 'team', 'authorizations.json');
const CWD = process.env.DSH_TEAM_WORKSPACE || process.cwd();
const SESSION = process.env.DSH_SESSION_ID || 'session-dryrun';

const args = process.argv.slice(2);
const role = args.find((a) => !a.startsWith('--'));
const withCandidate = args.includes('--candidate');
const scopeArg = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : undefined;
const requestedScopeOverride = scopeArg === undefined ? [] : scopeArg.split(':').filter((s) => s !== '');

if (role === undefined) {
  console.error('用法：node _tools/check-dispatch-authorization.js <角色名> [--scope 路径1:路径2] [--candidate]');
  process.exit(64);
}

/**
 * 复刻策略程序自己算「这次派发要求授权覆盖哪些路径」的口径
 * （policy_check.js: buildContext 的 roots/allowedPaths + findDispatchAuthorization 的 requested）：
 *
 *   requested = 派发声明了 write_scopes ? write_scopes
 *             : 任务合同有 allowed_paths  ? allowed_paths（按 contract.workspace 解析）
 *             : 否则                      roots（= DSH_TEAM_WORKSPACE 或 payload.cwd，再加 contract.workspace）
 *
 * 这一步是本工具第一次没做对的地方：我原本猜 `${cwd}/**`，但实际生效的是一份**任务合同**，
 * 它的 allowed_paths 指着另一个目录，所以候选记录没被判为覆盖 → 仍然 ASK。
 */
const contractPath = process.env.DSH_TEAM_TASK_CONTRACT || join(HOME, 'team', 'task-contract.json');
const contract = (() => {
  try {
    const raw = JSON.parse(readFileSync(contractPath, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
})();
const contractWorkspace = typeof contract.workspace === 'string' && contract.workspace.trim() !== ''
  ? resolve(CWD, contract.workspace) : null;
const envRoots = process.env.DSH_TEAM_WORKSPACE
  ? process.env.DSH_TEAM_WORKSPACE.split(':').map((s) => s.trim()).filter((s) => s !== '')
  : [CWD];
const roots = [...new Set([...envRoots.map((r) => resolve(CWD, r)), ...(contractWorkspace !== null ? [contractWorkspace] : [])])]
  .map((r) => r.replace(/\/+$/, '') || '/');
const contractAllowed = (Array.isArray(contract.allowed_paths) ? contract.allowed_paths : [])
  .filter((e) => typeof e === 'string' && e.trim() !== '')
  .map((e) => (resolve(contractWorkspace ?? CWD, e).replace(/\/+$/, '') || '/'));
const requested = contractAllowed.length > 0 ? contractAllowed : roots;

const realRecords = (() => {
  const raw = JSON.parse(readFileSync(REAL_AUTH, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.authorizations ?? raw.records ?? []);
})();

/**
 * 候选记录：形状与真实文件里的历史记录一致。
 * `type: "dispatch"` 是**必需字段**——authTypeOf() 取 record.type ?? record.action ?? record.kind，
 * 少了它这条记录根本不会被当作 dispatch 授权考虑。
 * scope 必须覆盖上面算出的 requested 全集，所以直接按 requested 逐条生成 `/**`。
 */
const candidate = {
  id: 'AUTH-DRYRUN-ONLY',
  type: 'dispatch',
  role,
  scope: requestedScopeOverride.length > 0 ? requestedScopeOverride : requested.map((p) => `${p}/**`),
  issued_by: 'human:maxwell',
  note: '空跑用的候选记录——它只存在于临时目录，不在真实文件里',
};

/** 按当前（或加了候选的）授权集判一次。 */
function judge(records, label) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'dsh-auth-dryrun-'));
  mkdirSync(join(tmp, 'ledger'), { recursive: true });
  const authPath = join(tmp, 'authorizations.json');
  const ledgerPath = join(tmp, 'ledger', 'agent-ledger.jsonl');
  writeFileSync(authPath, JSON.stringify(records, null, 1));

  const payload = {
    session_id: SESSION,
    transcript_path: join(tmp, 'transcript.jsonl'),
    cwd: CWD,
    hook_event_name: 'PreToolUse',
    tool_name: 'spawn_teammate',
    tool_input: { name: role, prompt: '(空跑：不产生任何真实派发)' },
    tool_use_id: 'toolu_dryrun',
  };
  const result = spawnSync(process.execPath, [POLICY], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, DSH_TEAM_AUTHORIZATIONS: authPath, DSH_TEAM_LEDGER: ledgerPath },
  });

  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const decision = out.includes('DSH-POLICY-DENY') ? 'DENY'
    : out.includes('DSH-POLICY-ASK') ? 'ASK（=需要人工审批；本会话审批已禁用 → 实际等于拒绝）'
    : result.status === 0 ? 'ALLOW' : `EXIT ${result.status}`;
  const reason = out.split('\n').filter((l) => l.includes('DSH-POLICY-') || l.includes('permissionDecision')).join('\n');

  console.log(`\n──── ${label} ────`);
  console.log(`  台账写入：${ledgerPath.includes('dryrun') ? '临时目录（真实台账未触碰）' : '未知'}`);
  console.log(`  判定：${decision}（exit ${result.status}）`);
  if (reason !== '') console.log(reason.split('\n').map((l) => '  ' + l).join('\n'));
  const wroteLedger = spawnSync('test', ['-f', ledgerPath]).status === 0;
  console.log(`  是否落台账：${wroteLedger ? '是（临时台账，已被隔离）' : '否'}`);
  return decision;
}

console.log(`策略程序：${POLICY}`);
console.log(`会话：${SESSION}`);
console.log(`工作目录：${CWD}`);
console.log(`任务合同：${contractPath}${existsSync(contractPath) ? '' : '（不存在）'}`);
console.log(`  合同 workspace：${contractWorkspace ?? '（无）'}`);
console.log(`  合同 allowed_paths：${contractAllowed.length > 0 ? contractAllowed.join(', ') : '（无）'}`);
console.log(`策略眼里的 roots：${roots.join(', ')}`);
console.log(`→ 派发要求授权覆盖的集合（requested）：${requested.join(', ')}`);
console.log(`角色：${role}；派发声明 write_scopes：${requestedScopeOverride.length > 0 ? requestedScopeOverride.join(', ') : '（无）'}`);
console.log(`真实授权文件：${REAL_AUTH}（共 ${realRecords.length} 条；本工具只读它）`);

const now = judge(realRecords, '现状：用真实授权文件里的记录判定');

let withCand = '（未测试）';
if (withCandidate) {
  withCand = judge([...realRecords, candidate], '加一条候选记录后判定');
}

console.log('\n──── 结论 ────');
console.log(`  现状判定：${now}`);
if (withCandidate) console.log(`  候选记录判定：${withCand}`);
console.log('\n如果候选记录那一次是 ALLOW，说明下面这条写进真实文件即可生效（id 自取，issued_by 必须是你本人）：');
console.log(JSON.stringify({ ...candidate, id: `AUTH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-006`, note: undefined }, (k, v) => (v === undefined ? undefined : v), 2));
console.log('\n注意：spawn_teammate 没有 write_scopes 入参，所以策略层要求授权覆盖**任务合同的 allowed_paths 全集**');
console.log('      （上例按 requested 逐条生成 /**）。想收窄，就只能先把任务合同写准。');
console.log('      真实生效仍需你本人把记录写进上面的真实授权文件——本工具不会代写。');
