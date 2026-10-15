#!/usr/bin/env node
/**
 * 前置条件自检：官方 Agent Teams 层到底有没有挂上。
 *
 * 为什么需要这个工具（2026-10-14 实测教训）：
 *   用户报「成员 Agent 看不到运行状态」，查到最后根因**不在卡片**，而在配置——
 *   官方 `@deepseek-ai/dsh-experimental-agent-team-profile` 是**互斥**设计：
 *       tool-subagent / tool-subagent-fork  disabled: true
 *       insert: tool-agent-team            ← spawn_teammate
 *   也就是「要么有 subagent，要么有 spawn_teammate」。这层没挂 ⇒ 没有派发工具 ⇒
 *   成员永远建不出来 ⇒ `agentTeam` 投影永远为空 ⇒ 任何卡片都无从显示状态。
 *
 * 本工具**只读**，不改任何配置。它检查的是 desktop profile 的解析结果：
 *   ~/.dsh/profiles/desktop/package.json   的 dsh.profile.bundles（权威写入者是 GUI 插件管理器）
 *   ~/.dsh/profiles/desktop/cordis.yml     解析后的实际装载清单
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');
const PROFILE = process.env.DSH_TEAM_PROFILE_DIR || join(HOME, 'profiles', 'desktop');
const TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const pkgText = read(join(PROFILE, 'package.json'));
const cordisText = read(join(PROFILE, 'cordis.yml'));

const rows = [];
const add = (label, ok, detail) => rows.push({ label, ok, detail });

let bundles = [];
if (pkgText === null) add('profile package.json 可读', false, join(PROFILE, 'package.json') + ' 不存在');
else {
  try {
    bundles = JSON.parse(pkgText).dsh?.profile?.bundles ?? [];
    add('profile package.json 可读', true, `${bundles.length} 个 bundle`);
  } catch (error) {
    add('profile package.json 可读', false, String(error.message).slice(0, 90));
  }
}

add('官方 Agent Teams bundle 在列表里', bundles.includes(TEAM_BUNDLE),
  bundles.includes(TEAM_BUNDLE) ? TEAM_BUNDLE : `缺少 ${TEAM_BUNDLE}（GUI 插件管理里启用「智能体团队」）`);
add('本插件 bundle 在列表里', bundles.includes('@local/dsh-team-workflow'),
  bundles.includes('@local/dsh-team-workflow') ? '@local/dsh-team-workflow' : '缺少本插件 bundle');

if (cordisText === null) add('解析后的 cordis.yml 可读', false, join(PROFILE, 'cordis.yml') + ' 不存在');
else {
  const has = (needle) => cordisText.includes(needle);
  add('解析后装载了 tool-agent-team（spawn_teammate 的来源）', has('tool-agent-team'),
    has('tool-agent-team') ? '在' : '不在——没有它就没有派发工具，成员建不出来');
  add('解析后装载了 client-ui-agent-team（官方卡片）', has('client-ui-agent-team'),
    has('client-ui-agent-team') ? '在' : '不在——官方卡片不在，本插件会按 C1 接管');
  add('解析后装载了本插件', has('@local/dsh-team-workflow'),
    has('@local/dsh-team-workflow') ? '在（第 ' + (cordisText.slice(0, cordisText.indexOf('@local/dsh-team-workflow')).split('\n').length) + ' 行附近）' : '不在');
  // 互斥关系：两个都在，说明官方那层的 disabled 补丁没生效
  const bothSubagent = has('tool-subagent') && has('tool-agent-team');
  add('互斥关系正常（不同时存在 subagent 与 spawn_teammate）', !bothSubagent,
    bothSubagent ? '两个都在：官方层的 disabled 补丁疑似没生效' : '正常');
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
const failed = rows.filter((r) => !r.ok).length;
console.log('Agent Teams 层前置条件自检（只读）');
console.log('profile:', PROFILE);
console.log('-'.repeat(78));
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.label, 46)} ${r.detail}`);
console.log('-'.repeat(78));
console.log(failed === 0
  ? '全部满足：派发工具与两张卡片的前置条件都在。'
  : `${failed} 项未满足：在这个状态下，「成员运行状态」不可能出现——先解决上面 FAIL 的那几项。`);
process.exit(failed === 0 ? 0 : 1);
