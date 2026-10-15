/**
 * C14 反证：每个新/改的断言都必须能红一次。
 *
 * 做法：把 dsh-team-plugin 与 dsh-team-workflow 复制到临时目录，在**副本**上逐个施加变异
 * （改生成器 → 重新生成 → 跑门），记录哪个门变红。仓库本体不动。
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = '/Users/maxwell/workspace/code_space/agent-team-workflow';
const root = mkdtempSync(join(tmpdir(), 'twf-red-'));
const PRISTINE = join(root, 'pristine');
const WORK = join(root, 'work');
for (const dir of [PRISTINE, WORK]) {
  cpSync(join(SRC, 'dsh-team-plugin'), join(dir, 'dsh-team-plugin'), { recursive: true });
  cpSync(join(SRC, 'dsh-team-workflow'), join(dir, 'dsh-team-workflow'), { recursive: true });
}
const BUILD = 'dsh-team-workflow/_tools/build-client.js';
const VERIFY = 'dsh-team-workflow/_tools/verify-acceptance.js';
const ZH = 'dsh-team-plugin/locale/zh.json';
const HOST = 'dsh-team-plugin/index.js';

const mutations = [
  {
    id: 'M1', what: '角色行加回「产物」行（C5.1 五项被破坏）', expect: '6f',
    file: BUILD,
    from: `  '\\t\\t    jsx("small", { className: css.roleDuty, children: member.duty })',`,
    to: `  '\\t\\t    jsx("small", { className: css.roleDuty, children: member.duty }),',\n  '\\t\\t    jsxs("small", { children: [jsx("b", { children: t("outputs") }), member.outputs.join(" · ")] })',`,
  },
  {
    id: 'M2', what: '悬停文案拼上技能（不再是官方原文）', expect: '6f',
    file: BUILD,
    from: `  '\\t\\t  label: t("open"),',`,
    to: `  '\\t\\t  label: t("open") + t("skills"),',`,
  },
  {
    id: 'M3', what: '任务板写死 tasks: [] 且不透传 failure', expect: '6f',
    file: BUILD,
    from: `  '\\t\\t  tasks: liveTeam && Array.isArray(liveTeam.tasks) ? liveTeam.tasks : [],',\n  '\\t\\t  // 投影报"持久化记录非法"时官方有失败横幅；以前没透传 failure，那条分支是死的。',\n  '\\t\\t  ...(liveTeam && liveTeam.failure !== void 0 ? { failure: liveTeam.failure } : {})',`,
    to: `  '\\t\\t  tasks: [],',`,
  },
  {
    id: 'M4', what: '状态卡片退回一行纯文字（className 用 notice）', expect: '6f',
    file: BUILD,
    from: `className: TeamAction_module_css_default.statusCard,`,
    to: `className: TeamAction_module_css_default.notice,`,
  },
  {
    id: 'M5', what: 'C20.3 回归：按钮不打开自有弹窗，改回直接跳官方插件管理页（用户报的那个 bug）', expect: '6f',
    file: BUILD,
    from: `onClick: () => setConfigOpen(true),\\n'`,
    to: `onClick: () => config.openManager(),\\n'`,
  },
  {
    id: 'M6', what: '详情区块不做 subject 门控（对任何页面都渲染）', expect: '6h',
    file: BUILD,
    from: `  '\\t\\t if (subject === void 0 || subject.kind !== "bundle" || subject.pkg === void 0',\n  '\\t\\t  || subject.pkg.name !== ' + JSON.stringify(MODULE_ID) + ') return null;',`,
    to: `  '\\t\\t if (false) return null;',`,
  },
  {
    id: 'M7', what: 'locale meta 塞回长描述（杂糅）', expect: '6h',
    file: ZH,
    from: `"description": "资源包 10 个开发角色的名册与能力边界（只读/可写），按需派发、不常驻。"`,
    to: `"description": "复刻 OMP 资源包的 10 个开发角色：职责、明确产物、能力边界（只读/可写）。由主 Agent 按需派发，角色不常驻。零依赖、无门控、无钩子。工件链：PRD → Tech Spec。"`,
  },
  {
    id: 'M8', what: '详情区块不再列出悬空技能', expect: '6h',
    file: BUILD,
    from: `  '\\t\\t  dangling.length > 0 && jsx("p", { className: css.detailWarn, children:',\n  '\\t\\t   "⚠ " + t("dangling") + "：" + dangling.map((role) => role.id + " → " + role.danglingSkills.join("、")).join("；") })',`,
    to: `  '\\t\\t  void dangling.length,',`,
  },
  {
    id: 'M9', what: '自有类名不进官方 class map（css.statusCard 变 undefined）', expect: '6f',
    file: BUILD,
    from: `  'statusCard', 'statusText', 'statusButton',`,
    to: `  'statusText', 'statusButton',`,
  },
  // ── C21（第三次裁决）新增：客户端弹窗 ──
  {
    id: 'M10', what: 'C21.1 回归：弹窗不用官方 Modal，改成自造 div 浮层', expect: '6i',
    file: BUILD,
    from: `return jsx(P.Modal, {`,
    to: `void P.Modal; return jsx("div", {`,
  },
  {
    id: 'M11', what: 'C21.2/C21.3 回归：弹窗不读作用域的值，永远显示默认值', expect: '6i',
    file: BUILD,
    from: `const values = view.value ?? CONFIG_DEFAULTS;`,
    to: `const values = CONFIG_DEFAULTS;`,
  },
  {
    id: 'M12', what: 'C21.3 回归：保存不写回宿主（单一真源断）', expect: '6i',
    file: BUILD,
    from: `save() { return model === void 0 ? void 0 : model.actions().save(); },`,
    to: `save() { return void 0; },`,
  },
  {
    id: 'M13', what: 'C21.2 回归：hideUnassignedRoles 不消费（未派发行照样显示）', expect: '6i',
    file: BUILD,
    from: `const configRows = configValues.hideUnassignedRoles === true`,
    to: `const configRows = false`,
  },
  {
    id: 'M14', what: 'C21.2 回归：showTaskBoard 不消费（关掉也照样渲染任务板）', expect: '6i',
    file: BUILD,
    from: `configValues.showTaskBoard !== false && (0, react_jsx_runtime.jsx)("section"`,
    to: `(configValues.showTaskBoard !== false || true) && (0, react_jsx_runtime.jsx)("section"`,
  },
  {
    id: 'M15', what: 'C21.2 回归：forceCompactPanel 不消费（强制紧凑无效）', expect: '6i',
    file: BUILD,
    from: `const compact = configValues.forceCompactPanel === true || (team`,
    to: `const compact = (configValues.forceCompactPanel === true && false) || (team`,
  },
  {
    id: 'M16', what: 'C21.1 回归：卡片树里不挂配置弹窗（按钮点了没反应）', expect: '6f',
    file: BUILD,
    from: `jsx)(TeamWorkflowConfigDialog, {`,
    to: `jsx)(react_jsx_runtime.Fragment, {`,
  },
  // ── C21 新增：宿主半 ──
  {
    id: 'M17', what: 'C21.3 回归：宿主半 routeGuard 去掉 .volatile()（官方设置服务改不动它）', expect: '6j',
    file: HOST,
    from: `  routeGuard: z.boolean().default(true).volatile(),`,
    to: `  routeGuard: z.boolean().default(true),`,
  },
  {
    id: 'M18', what: 'C21.2 回归：宿主半 disabledRoles 不消费（停用无效）', expect: '6j',
    file: HOST,
    from: `  const roles = all.filter((role) => !disabledRoles.includes(role.id));`,
    to: `  const roles = all;`,
  },
  {
    id: 'M19', what: 'C21.2 回归：宿主半 routeGuard=false 仍强制写明原因（配置不生效）', expect: '6j',
    file: HOST,
    from: `            if (reason === '' && cfg.routeGuard !== false) {`,
    to: `            if (reason === '') {`,
  },
  {
    id: 'M20', what: 'C21.3 回归：宿主半不关掉官方自动表单（两个入口写同一份配置）', expect: '6j',
    file: HOST,
    from: `    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));`,
    to: `    void child;`,
  },
  {
    id: 'M21', what: 'C20.3 回归：弹窗里的次级链接不调 openBundle（只剩降级路径）', expect: '6h',
    file: BUILD,
    from: `onClick: () => { if (config !== void 0 && typeof config.openManager === "function") config.openManager(); },`,
    to: `onClick: () => {},`,
  },
];

const run = (script, cwd) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

const rows = [];
for (const m of mutations) {
  // 每个变异都从**干净副本**开始：只还原自己那个文件会让上一个变异的改动泄漏进来，
  // 于是变红的门里混进与本次变异无关的项（2026-10-14 实测踩到过）。
  for (const file of [BUILD, VERIFY, ZH, HOST]) cpSync(join(PRISTINE, file), join(WORK, file));
  const path = join(WORK, m.file);
  const text = readFileSync(path, 'utf8');
  const hits = text.split(m.from).length - 1;
  if (hits !== 1) {
    rows.push({ ...m, actual: `变异锚点命中 ${hits} 次（应为 1）—— 反证无效`, red: '锚点失败' });
    continue;
  }
  writeFileSync(path, text.split(m.from).join(m.to));
  const gen = run(join(WORK, BUILD), WORK);
  if (gen.code !== 0) {
    rows.push({ ...m, actual: '生成器拒绝写盘（本身也是红）', red: '生成器' });
    continue;
  }
  const verify = run(join(WORK, VERIFY), WORK);
  const failed = [...verify.out.matchAll(/✗ \[([^\]]+)\]/g)].map((hit) => hit[1]);
  const summary = /自动核验：(\d+\/\d+) 通过/.exec(verify.out)?.[1] ?? '(无摘要)';
  rows.push({
    ...m,
    actual: `自动核验 ${summary}；变红的门：${failed.length === 0 ? '(没有门变红！)' : failed.join('/')}`,
    red: failed.join('/') || '无',
  });
}
cpSync(join(PRISTINE, BUILD), join(WORK, BUILD));
cpSync(join(PRISTINE, ZH), join(WORK, ZH));
cpSync(join(PRISTINE, HOST), join(WORK, HOST));

console.log(`临时目录：${root}\n`);
console.log('| 变异 | 预期变红 | 实际变红 | 结果 |');
console.log('|---|---|---|---|');
for (const row of rows) {
  const ok = row.red.split('/').includes(row.expect);
  console.log(`| ${row.id} ${row.what} | ${row.expect} | ${row.red} | ${ok ? '✓ 反证成立' : '✗ 反证失败'} |`);
  if (!ok) console.log(`   明细：${row.actual}`);
}
const bad = rows.filter((row) => !row.red.split('/').includes(row.expect));
console.log(`\n反证结论：${rows.length - bad.length}/${rows.length} 个变异精确命中预期门。`);
