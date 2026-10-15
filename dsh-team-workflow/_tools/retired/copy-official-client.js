#!/usr/bin/env node
// ⛔ 已退役（2026-10-14）：本脚本生成的页头卡片与官方插件结构性冲突（slot id / locale ns /
// CSS 前缀三重撞车，SlotCore 对同 id 同优先级直接抛错），已整体移除。UI 归官方。
// 不要运行本脚本。原因、证据与「将来如何安全重做」见同目录 README.md。
/**
 * 生成 client.js —— 以官方 @deepseek-ai/dsh-experimental-client-ui-agent-team 的
 * 客户端 bundle 为**外壳**（样式表、面板、定位、交互、portal 全部原样保留），
 * 只把**内容层**换成资源包定义的 10 个角色与职责。
 *
 * 为什么这样切：官方那份的“成员 / 共享任务”是**通用**模型（任意 teammate + 通用任务板），
 * 而本工作流的实质是**特定的角色分工与明确产物**。外壳照搬，语义用我们自己的。
 *
 * 补丁全部列在下面；任一锚点对不上就报错退出，官方升级后能立刻发现。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inspector = join(here, 'inspect-dsh-checkout.js');
const pluginDir = join(here, '..', '..', 'dsh-team-plugin');
const target = join(pluginDir, 'client.js');

const OFFICIAL = '/dsh/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/lib/client.js';
const CSS_PREFIX = '_2tNPVa_';

let source = execFileSync(process.execPath, [inspector, 'get', OFFICIAL], { encoding: 'utf8' });
const applied = [];

/** 精确替换；锚点必须唯一命中。 */
function patch(label, from, to) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`补丁「${label}」锚点命中 ${count} 次（应为 1 次）`);
  source = source.split(from).join(to);
  applied.push(label);
}

/** 区间替换：从 startAnchor 到 endAnchor（不含）之间的内容整体换掉。 */
function replaceBetween(label, startAnchor, endAnchor, replacement) {
  const start = source.indexOf(startAnchor);
  if (start < 0) throw new Error(`补丁「${label}」找不到起点锚`);
  const end = source.indexOf(endAnchor, start);
  if (end < 0) throw new Error(`补丁「${label}」找不到终点锚`);
  source = source.slice(0, start) + replacement + source.slice(end);
  applied.push(label);
}

// ─────────────────── 读取资源包角色数据 ───────────────────
const roster = JSON.parse(readFileSync(join(pluginDir, 'roles.json'), 'utf8'));
if (roster.roles.length !== 10) throw new Error(`roles.json 角色数为 ${roster.roles.length}，应为 10`);

/** 只内联卡片要显示的字段，不带整段 instruction，避免体积膨胀。 */
const inlineRoles = roster.roles.map((role) => ({
  id: role.id,
  title: role.title,
  duty: role.duty,
  outputs: role.outputs,
  boundaries: role.boundaries,
  tools: role.tools,
  writable: role.writable,
  autoloadSkills: role.autoloadSkills,
  danglingSkills: role.danglingSkills,
}));

// ─────────────────── 补丁 1-3：身份与名字 ───────────────────
patch('模块 id', 'id: "@deepseek-ai/dsh-experimental-client-ui-agent-team",', 'id: "@local/dsh-team-workflow",');
patch('样式表 tagId', 'const tagId = "@deepseek-ai/dsh-experimental-client-ui-agent-team/TeamAction.module.css";',
  'const tagId = "@local/dsh-team-workflow/TeamAction.module.css";');
patch('触发器中文文案', 'trigger: "智能体团队"', 'trigger: "Agent 团队工作流"');
patch('触发器英文文案', 'trigger: "Agent Team"', 'trigger: "Agent Team Workflow"');

// ─────────────────── 补丁 4：中文字典 ───────────────────
patch('中文字典·分组名', 'roster: "成员",', [
  'roster: "角色分工",',
  'outputs: "产物",',
  'boundaries: "边界",',
  'capability: "能力",',
  'writable: "可写",',
  'readonly: "只读",',
  'dangling: "悬空技能（已移出自动加载）",',
].join('\n\t\t\t'));

patch('中文字典·空任务段', 'empty: "暂无共享任务，可以通过对话创建",',
  'empty: "工件链：PRD → ADR（仅持久决策时）→ Tech Spec → 实施计划 → Test Spec → QA 验收报告。按需创建角色，不常驻。",');

// ─────────────────── 补丁 5：角色数据 + 数据来源 ───────────────────
patch('数据来源', 'const team = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);',
  'const team = workflowRoster();');

patch('角色数据注入', '\t\tfunction TeamAction({', [
  '\t\t/**',
  '\t\t * 本工作流的角色名册——来自资源包 sources/omp/agents/*.md（经 roles.json 内联），',
  '\t\t * 不是通用的“任意成员”列表。model 别名只作角色映射，不含凭据。',
  '\t\t */',
  `\t\tconst WORKFLOW_ROLES = ${JSON.stringify(inlineRoles)};`,
  '\t\t/** 把角色名册适配成官方卡片期望的 team 形状。任务段留空，由工件链说明替代。 */',
  '\t\tfunction workflowRoster() {',
  '\t\t return {',
  '\t\t  members: WORKFLOW_ROLES.map((role) => ({',
  '\t\t   id: role.id,',
  '\t\t   name: role.title,',
  '\t\t   duty: role.duty,',
  '\t\t   outputs: role.outputs,',
  '\t\t   boundaries: role.boundaries,',
  '\t\t   tools: role.tools,',
  '\t\t   writable: role.writable,',
  '\t\t   autoloadSkills: role.autoloadSkills,',
  '\t\t   danglingSkills: role.danglingSkills,',
  '\t\t   phase: "active"',
  '\t\t  })),',
  '\t\t  tasks: []',
  '\t\t };',
  '\t\t}',
  '\t\tfunction TeamAction({',
].join('\n'));

// ─────────────────── 补丁 6：成员行 → 角色行 ───────────────────
const roleRow = [
  '\t\t/**',
  '\t\t * 角色行：展示该角色的职责、产物、边界、能力与技能。',
  '\t\t * 沿用官方 .member 卡片类与视觉；用 disabled 按钮取 .member:disabled 的默认光标，',
  '\t\t * 因为没有“打开成员会话”这种导航动作（角色按需实例化，不是常驻会话）。',
  '\t\t */',
  '\t\tfunction TeamMemberRow({ member, t }) {',
  '\t\t const jsx = react_jsx_runtime.jsx;',
  '\t\t const jsxs = react_jsx_runtime.jsxs;',
  '\t\t const css = TeamAction_module_css_default;',
  '\t\t const P = _deepseek_ai_dsh_client_ui_primitives;',
  '\t\t const dangling = member.danglingSkills ?? [];',
  '\t\t return jsx(P.Tooltip, {',
  '\t\t  label: "技能：" + member.autoloadSkills.join("、"),',
  '\t\t  side: "bottom",',
  '\t\t  gap: 4,',
  '\t\t  children: jsxs("button", {',
  '\t\t   type: "button",',
  '\t\t   disabled: true,',
  '\t\t   className: css.member,',
  '\t\t   children: [jsx("span", {',
  '\t\t    className: css.memberDot,',
  '\t\t    children: jsx(P.IconUserOutlineRegular, { size: 14, className: css.inactiveIcon })',
  '\t\t   }), jsxs("span", {',
  '\t\t   className: css.memberText,',
  '\t\t   children: [',
  '\t\t    jsxs("span", { className: css.memberName, children: [',
  '\t\t     jsx("span", { className: css.memberNameText, children: member.name }),',
  '\t\t     jsx(P.Tag, { tone: "info", className: css.currentTag, children: member.id })',
  '\t\t    ] }),',
  '\t\t    jsx("small", { className: css.roleDuty, children: member.duty }),',
  '\t\t    jsxs("small", { className: css.roleLine, children: [',
  '\t\t     jsx("b", { className: css.roleLabel, children: t("outputs") }),',
  '\t\t     member.outputs.join(" · ")',
  '\t\t    ] }),',
  '\t\t    jsxs("small", { className: css.roleLine, children: [',
  '\t\t     jsx("b", { className: css.roleLabel, children: t("boundaries") }),',
  '\t\t     member.boundaries',
  '\t\t    ] }),',
  '\t\t    jsxs("small", { className: css.roleLine, children: [',
  '\t\t     jsx("b", { className: css.roleLabel, children: t("capability") }),',
  '\t\t     (member.writable ? t("writable") : t("readonly")) + " · " + member.tools.join(", ")',
  '\t\t      + " · " + member.autoloadSkills.length + " 技能"',
  '\t\t    ] }),',
  '\t\t    dangling.length > 0 && jsx("small", { className: css.diagnostic, children:',
  '\t\t     "⚠ " + t("dangling") + "：" + dangling.join("、") })',
  '\t\t   ]',
  '\t\t  })]',
  '\t\t  })',
  '\t\t });',
  '\t\t}',
  '',
].join('\n');

replaceBetween(
  '角色行替换',
  '\t\tfunction TeamMemberRow({',
  '\t\t/** Task card with a two-line description clamp expanded from a toggle in the meta row. */',
  roleRow,
);

// ─────────────────── 补丁 7：附加样式 ───────────────────
// 官方 .roster 的两列网格、.member 卡片、.panel 一律不改。
// 只需要两条：让角色文本换行（官方 small 是 nowrap+ellipsis，而我们的文案更长），
// 以及让 memberText 占满剩余宽度。
const roleCss = [
  `.${CSS_PREFIX}memberText{flex:1}`,
  `.${CSS_PREFIX}member .${CSS_PREFIX}roleDuty,.${CSS_PREFIX}member .${CSS_PREFIX}roleLine{white-space:normal;overflow:visible;text-overflow:clip;line-height:16px}`,
  `.${CSS_PREFIX}roleDuty{color:var(--dsw-alias-label-secondary)}`,
  `.${CSS_PREFIX}roleLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}`,
].join('');

patch('附加样式注入', '\t\tconst tagId = ', `\t\tconst ROLE_CSS = ${JSON.stringify(roleCss)};\n\t\tconst tagId = `);
patch('附加样式生效', 'tag.textContent = css;', 'tag.textContent = css + ROLE_CSS;');

// ─────────────────── 文件头 ───────────────────
const header = `/*
 * 本文件**不是重新实现**：外壳逐字取自官方
 * @deepseek-ai/dsh-experimental-client-ui-agent-team 的客户端 bundle
 * （官方完整样式表、面板、portal、useAnchoredPosition 定位、悬停展开、Esc 关闭、
 *  aria/role、中英文案 全部原样保留）。
 *
 * 改动的只有**内容层**，因为本工作流的实质是「特定角色与明确产物」，
 * 而官方那套是通用的「任意成员 + 通用任务板」：
 *
 *   A. 数据来源：官方读 Lead Session 的 agentTeam 投影；
 *      这里换成资源包 sources/omp/agents/*.md 定义的 10 个角色（经 roles.json 内联）。
 *   B. 角色行：官方 TeamMemberRow 展示 名称/运行状态/模型；
 *      这里改为展示 职责 / 产物 / 边界 / 能力 / 技能，并显式标出悬空技能。
 *
 * 由 _tools/copy-official-client.js 自动生成，可重复执行；锚点对不上会报错而不是静默出错。
 */
`;
source = header + source;

writeFileSync(target, source);
console.log(`已生成 ${target}`);
console.log(`角色数: ${inlineRoles.length}`);
console.log(`补丁(${applied.length}): ${applied.join(' / ')}`);
