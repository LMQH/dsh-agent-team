#!/usr/bin/env node
/**
 * 把你签发的预授权记录合并进真实授权文件。
 *
 * 这个脚本**不能替你签发**：它要求每条记录的 `issued_by` 非空、且不是自签身份
 * （agent/self/model/... 一律拒绝——那份名单直接从策略程序源码里读出来，避免与它漂移）。
 * 你填上签发人，等于你确认了这些记录的内容；脚本只负责校验、备份、去重追加、并立刻验证结果。
 *
 * 用法：
 *   node _tools/apply-authorizations.js --dry-run   # 只看会追加什么，不写文件
 *   node _tools/apply-authorizations.js             # 校验通过后追加（先自动备份）
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');
const POLICY = join(HOME, 'team', 'policies', 'policy_check.js');
const REAL = join(HOME, 'team', 'authorizations.json');
const DRAFT = join(here, '..', '预授权记录-draft.json');
const dryRun = process.argv.includes('--dry-run');

/** 自签身份名单：直接从策略程序源码里取，取不到才回退到硬编码。 */
function selfIssuers() {
  try {
    const src = readFileSync(POLICY, 'utf8');
    const block = /const SELF_ISSUERS = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (block !== null) {
      const names = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (names.length > 0) return new Set(names);
    }
  } catch { /* 回退 */ }
  return new Set(['agent', 'self', 'model', 'assistant', 'subagent', 'teammate', 'claude', 'llm', 'ai', 'bot', 'hook', 'tool']);
}

const SELF = selfIssuers();
const hasWildcard = (v) => /[*?[\]$`{}]/.test(String(v));

function validate(record, index) {
  const at = `第 ${index + 1} 条`;
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return `${at}：不是对象`;
  if (typeof record.id !== 'string' || record.id.trim() === '') return `${at}：id 缺失或为空`;
  if (record.type !== 'dispatch') return `${at}（${record.id}）：type 必须是 "dispatch"（策略程序靠 authTypeOf 判定，缺了就完全不生效）`;
  if (typeof record.role !== 'string' || record.role.trim() === '') return `${at}（${record.id}）：role 缺失或为空`;
  if (hasWildcard(record.role)) return `${at}（${record.id}）：role 不允许通配（策略层 authTypeOf/role 匹配是精确比较）`;
  if (!Array.isArray(record.scope) || record.scope.length === 0) return `${at}（${record.id}）：scope 必须是非空数组`;
  for (const s of record.scope) {
    if (typeof s !== 'string' || s.trim() === '') return `${at}（${record.id}）：scope 里有空项`;
    if (hasWildcard(s) && !/\/\*\*$/.test(s)) return `${at}（${record.id}）：scope 项 "${s}" 的通配只能用结尾的 /**`;
  }
  if (typeof record.issued_by !== 'string' || record.issued_by.trim() === '') {
    return `${at}（${record.id}）：**未签发**——issued_by 为空。请填上你自己的标识（例如 human:maxwell）后才生效`;
  }
  if (SELF.has(record.issued_by.trim().toLowerCase())) {
    return `${at}（${record.id}）：issued_by "${record.issued_by}" 是自签身份（策略程序会直接判为无效记录）`;
  }
  return null;
}

const draft = JSON.parse(readFileSync(DRAFT, 'utf8'));
if (!Array.isArray(draft)) {
  console.error(`✗ ${DRAFT} 顶层必须是数组（与真实授权文件同形状）`);
  process.exit(1);
}

const problems = draft.map((r, i) => validate(r, i)).filter((p) => p !== null);
if (problems.length > 0) {
  console.error(`✗ 草稿未通过校验，一条都不会写入：\n  · ${problems.join('\n  · ')}`);
  console.error(`\n请编辑：${DRAFT}`);
  process.exit(1);
}

const ids = draft.map((r) => r.id);
if (new Set(ids).size !== ids.length) {
  console.error('✗ 草稿里有重复 id');
  process.exit(1);
}

const real = JSON.parse(readFileSync(REAL, 'utf8'));
if (!Array.isArray(real)) {
  console.error(`✗ ${REAL} 顶层不是数组，本脚本不处理这种形状`);
  process.exit(1);
}
const existing = new Set(real.map((r) => r.id));
const toAdd = draft.filter((r) => !existing.has(r.id));
const skipped = draft.filter((r) => existing.has(r.id));

console.log(`草稿：${DRAFT}（${draft.length} 条，签发人 ${[...new Set(draft.map((r) => r.issued_by))].join('/')}）`);
console.log(`真实：${REAL}（现有 ${real.length} 条）`);
if (skipped.length > 0) console.log(`按 id 跳过已存在：${skipped.map((r) => r.id).join(', ')}`);
console.log(`\n将追加 ${toAdd.length} 条：`);
for (const r of toAdd) console.log(`  + ${r.id}  role=${r.role}  scope=${r.scope.join(' , ')}`);

if (toAdd.length === 0) {
  console.log('\n没有需要追加的记录。');
  process.exit(0);
}
if (dryRun) {
  console.log('\n--dry-run：未写入任何文件。');
  process.exit(0);
}

const backup = `${REAL}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(REAL, backup);
if (!existsSync(backup)) {
  console.error('✗ 备份失败，已中止（不冒无备份写入的风险）');
  process.exit(1);
}
writeFileSync(REAL, JSON.stringify([...real, ...toAdd], null, 2) + '\n');
console.log(`\n已写入 ${REAL}（现在 ${real.length + toAdd.length} 条）；备份：${backup}`);

console.log('\n用真实策略程序逐条复核：');
for (const r of toAdd) {
  const out = spawnSync(process.execPath, [join(here, 'check-dispatch-authorization.js'), r.role], { encoding: 'utf8' });
  const verdict = /现状判定：([^\n]+)/.exec(out.stdout ?? '');
  console.log(`  ${r.role.padEnd(14)} ${verdict === null ? '（复核失败，请手工跑一次）' : verdict[1]}`);
}
console.log('\n注意：真实的 spawn_teammate 调用能否端到端跑通，只有真派一次才知道（策略钩子层已判定为 ALLOW）。');
