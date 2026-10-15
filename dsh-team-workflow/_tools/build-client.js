#!/usr/bin/env node
/**
 * 生成 `dsh-team-plugin/client.js` —— 页头「Agent 团队工作流」卡片。
 *
 * 设计（2026-10-14 第二次返工后确定）：
 *   **外壳照搬官方，身份换成自己的，状态接上真实的。**
 *
 * 为什么这样切：
 *   用户要的是「参考官方插件的 UI 卡片」——官方那套紧凑的两列角色卡（状态点 + 名称 + 小字）
 *   就是被认可的观感。第一版照搬了外壳但沿用官方坐标，导致与官方结构性冲突（整页起不来）；
 *   第二版我自己另写了一套外观（每行三段文字的大卡片），虽然坐标干净了，却把外观改得面目全非。
 *   这一版把两件事分开：
 *     · 视觉层 = 官方客户端 bundle 的样式表与 DOM 结构（前缀重命名后原样保留）
 *     · 身份层 = 自己的 slot id / locale ns / CSS 前缀 / 模块 id
 *     · 内容层 = 资源包的 10 个角色（roles.json 内联），并接上 agentTeam 投影的实时状态
 *
 * 所有改动都是**精确锚点补丁**：任一锚点对不上就报错退出，官方升级后能立刻发现而不是静默出错。
 * 落盘前还有两道硬断言：产物里不得残留任何官方坐标，自有坐标必须齐全。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 身份常量（唯一真源；与 CONSTITUTION.md C3 逐条对应）──────────
const MODULE_ID = '@local/dsh-team-workflow';
const OFFICIAL_ID = '@deepseek-ai/dsh-experimental-client-ui-agent-team';
const SLOT_NAME = 'conversation.session.header.actions';

/**
 * C1（官方优先、本插件让位）采用**同槽位遮蔽**——用户 2026-10-14 裁决，宪法 C3 随之修订。
 *
 * 机制（真实 SlotCore 实测，见 _tools/probe-slot-shadowing.js）：
 *   conversation.session.header.actions 是 list 槽，`id` 决定「格子」，每个格子只渲染一个胜出者，
 *   胜出者按 (priority ?? 0) 升序取第一个。于是：
 *     · 同 id + 不同 priority → 不抛错，两条记录但只有官方（默认 0）渲染 → 本插件自动让位
 *     · 加载顺序无关（先注册本插件、后注册官方，官方照样胜出）
 *     · 官方缺席 → 本插件（priority 100）成为唯一胜出者 → 自动接管
 *     · 同 id + 同 priority → 抛 "already has an entry with id"
 *   最后那种情况用 try/catch 兜成「让位」。这一层兜底不能省：客户端 entry 一抛错，
 *   整个 Web GUI 会停在 "Failed to load plugins"（第一版实测过）。
 */
const OFFICIAL_SLOT_ID = 'agent-team';
const SHADOW_PRIORITY = 100;

const LOCALE_NS = 'dsh-team-workflow';
const CSS_PREFIX = '_twf_';
const OFFICIAL_CSS_PREFIX = '_2tNPVa_';
const ORDER = -20; // 与官方同序位：官方缺席时本插件正好补上它原来的位置

const here = dirname(fileURLToPath(import.meta.url));
const inspector = join(here, 'inspect-dsh-checkout.js');
const pluginDir = join(here, '..', '..', 'dsh-team-plugin');
const target = join(pluginDir, 'client.js');

const OFFICIAL = `/dsh/node_modules/${OFFICIAL_ID}/lib/client.js`;
let source = execFileSync(process.execPath, [inspector, 'get', OFFICIAL], { encoding: 'utf8' });
const applied = [];

/** 精确替换；锚点必须唯一命中。 */
function patch(label, from, to) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`补丁「${label}」锚点命中 ${count} 次（应为 1 次）：${JSON.stringify(from.slice(0, 70))}`);
  source = source.split(from).join(to);
  applied.push(label);
}

/** 全局重命名（允许多次命中，但必须至少命中 min 次）。 */
function renameAll(label, from, to, min) {
  const count = source.split(from).length - 1;
  if (count < min) throw new Error(`重命名「${label}」只命中 ${count} 次（至少应 ${min} 次）：${from}`);
  source = source.split(from).join(to);
  applied.push(`${label}×${count}`);
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

/** 区间替换（**连终点锚一起吃掉**）：整个语句要被重写时用这个。 */
function replaceInclusive(label, startAnchor, endAnchor, replacement) {
  const start = source.indexOf(startAnchor);
  if (start < 0) throw new Error(`补丁「${label}」找不到起点锚`);
  const end = source.indexOf(endAnchor, start);
  if (end < 0) throw new Error(`补丁「${label}」找不到终点锚`);
  source = source.slice(0, start) + replacement + source.slice(end + endAnchor.length);
  applied.push(label);
}

/** 在锚点前插入。 */
function insertBefore(label, anchor, text) {
  patch(label, anchor, text + anchor);
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
  danglingSkills: role.danglingSkills ?? [],
}));

// ────────── 补丁组 1：身份坐标 ──────────
// locale ns / CSS 前缀 / 模块 id 一律自有（同值会让官方与第二个 apply 相撞而抛错）；
// slot id 与 order **故意与官方相同**，这是 C1 同槽位遮蔽的前提——由 priority 决定谁渲染。
renameAll('包名', OFFICIAL_ID, MODULE_ID, 1);
renameAll('CSS 前缀', OFFICIAL_CSS_PREFIX, CSS_PREFIX, 60);
patch('locale 命名空间', 'const NS = "agent-team";', `const NS = ${JSON.stringify(LOCALE_NS)};`);
patch('effect 标签', '"client-ui-agent-team: dictionaries"', `${JSON.stringify(MODULE_ID + ': dictionaries')}`);
// 区域注释里带着官方构建机的绝对源码路径（含包名）。功能上无害，但它既泄露上游路径、
// 又会让「产物里不得出现 agent-team」这类扫描出现假阳性，所以归一化成自己的标识。
// 注意：产物里是字面的反斜杠+0（`\0dsh-css:`），所以这里必须写 `\\0`——
// 写成 `\0` 会变成 NUL 字符，锚点永远对不上。
renameAll('源映射区域注释', '\\0dsh-css:/Users/hrsonion/Developer/harness/dsh-macos-arm64/packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css.mjs',
  `\\0dsh-css:${MODULE_ID}/TeamAction.module.css`, 1);

// ────────── 补丁组 2：文案与角色词条 ──────────
patch('触发器中文', 'trigger: "智能体团队",', 'trigger: "Agent 团队工作流",');
patch('触发器英文', 'trigger: "Agent Team",', 'trigger: "Agent Team Workflow",');
patch('中文字典·角色词条', 'roster: "成员",', [
  'roster: "角色分工",',
  'outputs: "产物",',
  'boundaries: "边界",',
  'capability: "能力",',
  'writable: "可写",',
  'readonly: "只读",',
  'skills: "技能",',
  'dangling: "悬空技能（已移出自动加载）",',
  '"memberStatus.unassigned": "未派发",',
  '"pluginStatus": "本插件接管中 · 官方「智能体团队」未启用",',
  '"pluginManager": "打开插件管理",',
  '"detailTitle": "角色分工与能力边界",',
  '"detailNote": "卡片只显示运行状态与职责；完整的产物、边界、技能可加载性放在这里。工件链：PRD → ADR（仅持久决策时）→ Tech Spec → 实施计划 → Test Spec → QA 验收报告。",',
  // C21：自有配置弹窗（六项配置见 C21.2）
  '"configButton": "配置",',
  '"configTitle": "Agent 团队工作流 · 配置",',
  '"configClose": "关闭",',
  '"configHint": "改动经官方设置服务写回宿主并保存在当前 profile；默认值与改动前行为一致。",',
  '"configOpenManager": "在插件管理页中查看",',
  '"cfgDisabledRoles": "停用角色",',
  '"cfgDisabledRolesHint": "逗号分隔的角色 id；停用后 /team 名册与简报不再包含它们",',
  '"cfgAutoloadSkills": "派发简报附技能清单",',
  '"cfgRouteGuard": "强制写明路线触发原因",',
  '"cfgShowTaskBoard": "显示共享任务板",',
  '"cfgHideUnassignedRoles": "隐藏未派发角色",',
  '"cfgForceCompactPanel": "强制紧凑面板",',
  '"formSave": "保存",',
  '"formSaving": "保存中…",',
  '"formSaveFailed": "宿主拒绝了这次保存",',
  '"formReadOnly": "只读",',
  '"formUnavailable": "设置服务不可用",',
  '"formOverridden": "已覆盖",',
  '"formReset": "重置",',
  '"formInvalid": "无效",',
].join('\n\t\t\t'));
patch('英文字典·角色词条', 'roster: "Members",', [
  'roster: "Roles",',
  'outputs: "Outputs",',
  'boundaries: "Boundaries",',
  'capability: "Capability",',
  'writable: "writable",',
  'readonly: "read-only",',
  'skills: "skills",',
  'dangling: "Dangling skills (removed from autoload)",',
  '"memberStatus.unassigned": "Not dispatched",',
  '"pluginStatus": "This plugin is active · official Agent Team plugin not enabled",',
  '"pluginManager": "Open plugin manager",',
  '"detailTitle": "Role duties and capability boundaries",',
  '"detailNote": "The card shows running state and duty only; full deliverables, boundaries, and skill loadability live here. Artifact chain: PRD → ADR (persistent decisions only) → Tech Spec → implementation plan → Test Spec → QA acceptance report.",',
  // C21: self-owned config dialog (the six fields are C21.2)
  '"configButton": "Configure",',
  '"configTitle": "Agent Team Workflow · Configuration",',
  '"configClose": "Close",',
  '"configHint": "Changes are written back through the official settings service and stored in the current profile; defaults match the previous behavior.",',
  '"configOpenManager": "View in plugin manager",',
  '"cfgDisabledRoles": "Disabled roles",',
  '"cfgDisabledRolesHint": "Comma-separated role ids; disabled roles are dropped from /team roster and briefs",',
  '"cfgAutoloadSkills": "Attach skill list to dispatch briefs",',
  '"cfgRouteGuard": "Require a trigger reason for route declarations",',
  '"cfgShowTaskBoard": "Show shared task board",',
  '"cfgHideUnassignedRoles": "Hide undispatched roles",',
  '"cfgForceCompactPanel": "Force compact panel",',
  '"formSave": "Save",',
  '"formSaving": "Saving…",',
  '"formSaveFailed": "The host rejected this save",',
  '"formReadOnly": "Read-only",',
  '"formUnavailable": "Settings service unavailable",',
  '"formOverridden": "Overridden",',
  '"formReset": "Reset",',
  '"formInvalid": "Invalid",',
].join('\n\t\t\t'));
// 官方空态文案原样保留（C20.4：任务板借鉴官方设计，空态也用官方原文）。
// 工件链说明改挂在插件管理页详情区块的 detailNote 里（C20.2）。

// ────────── 补丁组 3：数据来源 = 角色名册 × 实时成员 ──────────
patch('角色数据注入', '\t\tfunction TeamAction({', [
  '\t\t/**',
  '\t\t * 本工作流的角色名册——来自资源包 sources/omp/agents/*.md（经 roles.json 内联）。',
  '\t\t * 不是通用的“任意成员”列表：角色按需实例化，不常驻。',
  '\t\t */',
  `\t\tconst WORKFLOW_ROLES = ${JSON.stringify(inlineRoles)};`,
  '\t\t/**',
  '\t\t * 把角色名册与 agentTeam 投影里的真实成员对齐。',
  '\t\t * 约定：成员名 = 角色 id（允许 qa-2 这类后缀）。理由见 README——策略层判定派发授权时',
  '\t\t * 也是按这个名字匹配的，两边用同一套命名才对得上。',
  '\t\t */',
  '\t\tfunction findLiveMember(members, roleId) {',
  '\t\t if (!Array.isArray(members)) return void 0;',
  '\t\t for (const candidate of members) {',
  '\t\t  if (candidate.name === roleId) return candidate;',
  '\t\t  if (typeof candidate.name === "string" && candidate.name.indexOf(roleId + "-") === 0) return candidate;',
  '\t\t }',
  '\t\t return void 0;',
  '\t\t}',
  '\t\t/** 官方卡片期望 { members, tasks } 形状；任务段留空，由工件链说明替代。 */',
  '\t\tfunction workflowRoster(liveTeam) {',
  '\t\t const liveMembers = liveTeam && Array.isArray(liveTeam.members) ? liveTeam.members : [];',
  '\t\t return {',
  '\t\t  members: WORKFLOW_ROLES.map((role) => {',
  '\t\t   const live = findLiveMember(liveMembers, role.id);',
  '\t\t   return {',
  '\t\t    id: role.id,',
  '\t\t    name: role.title,',
  '\t\t    duty: role.duty,',
  '\t\t    outputs: role.outputs,',
  '\t\t    boundaries: role.boundaries,',
  '\t\t    tools: role.tools,',
  '\t\t    writable: role.writable,',
  '\t\t    autoloadSkills: role.autoloadSkills,',
  '\t\t    danglingSkills: role.danglingSkills,',
  '\t\t    liveId: live === void 0 ? void 0 : live.id,',
  '\t\t    livePhase: live === void 0 ? void 0 : live.phase',
  '\t\t   };',
  '\t\t  }),',
  '\t\t  // C20.4：官方任务板的数据源——直接透传投影里的 tasks（用户 2026-10-14：任务板借鉴官方设计）。',
  '\t\t  // 以前写死 []，官方那套任务卡（两行截断展开、Owner/依赖/写入范围/数量徽标）永远不出现。',
  '\t\t  tasks: liveTeam && Array.isArray(liveTeam.tasks) ? liveTeam.tasks : [],',
  '\t\t  // 投影报"持久化记录非法"时官方有失败横幅；以前没透传 failure，那条分支是死的。',
  '\t\t  ...(liveTeam && liveTeam.failure !== void 0 ? { failure: liveTeam.failure } : {})',
  '\t\t };',
  '\t\t}',
  '\t\t/**',
  '\t\t * C21.2：配置的六个字段与默认值。**默认值必须等于改动前的行为**——配置功能本身',
  '\t\t * 不得改变任何现有行为（门 6f/6h 在默认值下必须与改前等价）。',
  '\t\t */',
  '\t\tconst CONFIG_FIELDS = ["disabledRoles", "autoloadSkills", "routeGuard", "showTaskBoard", "hideUnassignedRoles", "forceCompactPanel"];',
  '\t\tconst CONFIG_DEFAULTS = { disabledRoles: [], autoloadSkills: true, routeGuard: true, showTaskBoard: true, hideUnassignedRoles: false, forceCompactPanel: false };',
  '\t\t/** C21.3 降级：设置服务缺席时用这个视图（显示"不可写"，绝不抛错）。 */',
  '\t\tconst CONFIG_EMPTY_VIEW = { available: false, writable: false, dirty: false, invalid: false, saving: false, failed: false, value: CONFIG_DEFAULTS, fields: {} };',
  '\t\t/** 布尔字段的转换规格：Switch 用 edit(field, "true"/"false") 暂存。 */',
  '\t\tfunction configBooleanSpec(field) {',
  '\t\t return {',
  '\t\t  field,',
  '\t\t  format: (value) => value === true ? "true" : "false",',
  '\t\t  parse: (text) => text === "true" ? { kind: "set", value: true } : text === "false" ? { kind: "set", value: false } : void 0',
  '\t\t };',
  '\t\t}',
  '\t\t/** 角色 id 列表的转换规格：逗号/空白分隔；清空等于清除覆盖（恢复默认）。 */',
  '\t\tfunction configRolesSpec(field) {',
  '\t\t return {',
  '\t\t  field,',
  '\t\t  format: (value) => Array.isArray(value) ? value.join(", ") : "",',
  '\t\t  parse: (text) => {',
  '\t\t   const list = text.split(/[,，\\s]+/).filter(Boolean);',
  '\t\t   return list.length === 0 ? { kind: "clear" } : { kind: "set", value: list };',
  '\t\t  }',
  '\t\t };',
  '\t\t}',
  '\t\t/** C21.3：订阅官方设置表单；缺席或抛错时给兜底视图。 */',
  '\t\tfunction useConfigView(config) {',
  '\t\t const [view, setView] = (0, react.useState)(() => config !== void 0 && typeof config.snapshot === "function" ? config.snapshot() : CONFIG_EMPTY_VIEW);',
  '\t\t (0, react.useEffect)(() => {',
  '\t\t  if (config === void 0 || typeof config.subscribe !== "function") return void 0;',
  '\t\t  setView(config.snapshot());',
  '\t\t  return config.subscribe(() => { setView(config.snapshot()); });',
  '\t\t }, [config]);',
  '\t\t return view;',
  '\t\t}',
  '\t\tfunction TeamAction({',
].join('\n'));

patch('数据来源改为名册×投影',
  'const team = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);',
  '\t\t\tconst liveTeam = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);\n'
  + '\t\t\tconst team = workflowRoster(liveTeam);\n'
  + '\t\t\t// C21.2/C21.3：展示层三个字段的消费点；配置值只从 props.config（宿主 volatile Config）来。\n'
  + '\t\t\tconst configView = useConfigView(config);\n'
  + '\t\t\tconst configValues = configView.value ?? CONFIG_DEFAULTS;\n'
  + '\t\t\t// hideUnassignedRoles：未派发 = 没有对应实时成员（liveId 为空）。\n'
  + '\t\t\tconst configRows = configValues.hideUnassignedRoles === true\n'
  + '\t\t\t ? (team === void 0 ? [] : team.members.filter((member) => member.liveId !== void 0))\n'
  + '\t\t\t : (team === void 0 ? [] : team.members);');
patch('任务板可隐藏', '\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("section", { children: team.tasks.length === 0 ?',
  '\t\t\t\t\t\t\t\tconfigValues.showTaskBoard !== false && (0, react_jsx_runtime.jsx)("section", { children: team.tasks.length === 0 ?');
patch('强制紧凑面板', 'const compact = team !== void 0 && team.members.length === 1 && team.tasks.length === 0;',
  'const compact = configValues.forceCompactPanel === true || (team !== void 0 && team.members.length === 1 && team.tasks.length === 0);');

// ────────── 补丁组 4：成员行 → 角色行（官方 .member 视觉 + 真实状态 + C7 点击进详情）──────────
const roleRow = [
  '\t\t/**',
  '\t\t * 角色行：沿用官方 .member 卡片视觉，内容 = 状态点 + 角色中文名 + Tag（角色 id）+ 状态词 + 职责简述。',
  '\t\t * 口径见 C5.1（用户 2026-10-14 第二次 UI 裁决）：不再内联「产物 / 边界 / 能力」，',
  '\t\t * 那三项与悬空技能改挂插件管理页的详情区块（C20.2）。',
  '\t\t *',
  '\t\t * 运行状态口径与官方完全一致（观感才一致）：',
  '\t\t *   本地镜像 useSessionStatus 优先，host 快照 useSessions.byId 兜底，用 ?? 而不是 ||；',
  '\t\t *   相位不是 active 就直接用相位；名册里没有对应成员时状态是 unassigned（未派发）。',
  '\t\t *',
  '\t\t * C7（用户 2026-10-14 决定）：点击进入该成员的会话详情，实现照抄官方——',
  '\t\t *   行可点时调用 openTeammate(sessionId, liveId)，与官方同一入口、同一语义。',
  '\t\t *   只有「未派发」以及官方也视为不可点（failed / provisioning）的行才禁用——',
  '\t\t *   那些行没有可打开的成员会话，点了只会报错。',
  '\t\t */',
  '\t\tfunction TeamMemberRow({ member, sessionId, useSessions, useSessionStatus, openTeammate, t }) {',
  '\t\t const jsx = react_jsx_runtime.jsx;',
  '\t\t const jsxs = react_jsx_runtime.jsxs;',
  '\t\t const css = TeamAction_module_css_default;',
  '\t\t const P = _deepseek_ai_dsh_client_ui_primitives;',
  '\t\t const liveId = member.liveId;',
  '\t\t const dispatched = liveId !== void 0;',
  '\t\t const running = useSessionStatus((state) => state.get(liveId)?.running);',
  '\t\t const summaryRunning = useSessions((state) => state.byId[liveId]?.running);',
  '\t\t const status = dispatched === false ? "unassigned"',
  '\t\t  : member.livePhase !== "active" ? member.livePhase',
  '\t\t  : (running ?? summaryRunning) === true ? "running" : "inactive";',
  '\t\t const dotState = status === "failed" ? "error" : status === "running" || status === "provisioning" ? "ongoing" : void 0;',
  '\t\t const openable = dispatched && status !== "failed" && status !== "provisioning";',
  '\t\t // C5.1：悬停提示固定为官方原文那一句；不可点的行与官方一样 disabled（不给提示）。',
  '\t\t return jsx(P.Tooltip, {',
  '\t\t  label: t("open"),',
  '\t\t  disabled: !openable,',
  '\t\t  side: "bottom",',
  '\t\t  gap: 4,',
  '\t\t  children: jsxs("button", {',
  '\t\t   type: "button",',
  '\t\t   disabled: !openable,',
  '\t\t   onClick: openable ? () => openTeammate(sessionId, liveId) : void 0,',
  '\t\t   className: css.member,',
  '\t\t   children: [jsx("span", {',
  '\t\t    className: css.memberDot,',
  '\t\t    children: dotState === void 0',
  '\t\t     ? jsx(P.IconUserOutlineRegular, { size: 14, className: css.inactiveIcon })',
  '\t\t     : jsx(P.StateDot, { state: dotState })',
  '\t\t   }), jsxs("span", {',
  '\t\t   className: css.memberText,',
  '\t\t   children: [',
  '\t\t    jsxs("span", { className: css.memberName, children: [',
  '\t\t     jsx("span", { className: css.memberNameText, children: member.name }),',
  '\t\t     jsx(P.Tag, { tone: "info", className: css.currentTag, children: member.id }),',
  '\t\t     jsx("small", { className: css.meta, children: t("memberStatus." + status) })',
  '\t\t    ] }),',
  '\t\t    jsx("small", { className: css.roleDuty, children: member.duty })',
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

// ────────── 补丁组 5：C1 同槽位遮蔽（官方优先、本插件让位、官方关闭即接管）──────────
// 一处常量块 + 重写注册语句（加 priority 与让位兜底）+ 面板里一行本插件状态。
// ────────── C20：插件管理入口（状态卡片按钮）与插件管理页详情区块 ──────────
// C20.3：官方插件管理器用 reflect.provide("pluginNavigation", { openBundle }) 暴露入口，
// 公开契约是"其他 Client 插件调用 openBundle(packageName) 打开该组合包详情"。
// 这里用 ctx.reflect 懒取而不是 inject：官方管理器缺席时本插件仍要能激活（inject 会等它出现）。
patch('插件管理入口动作', '\t\t\tconst actions = { openTeammate(sessionId, childSessionId) {', [
  '\t\t\t/**',
  '\t\t\t * C20.3：打开插件管理面板并直达本组合包详情页。',
  '\t\t\t * 平台没有"插件管理弹窗"API——openBundle 打开的是侧栏「插件」面板（已向用户说明并获确认）；',
  '\t\t\t * 官方管理器缺席时降级为切到「插件」面板；两者都没有则静默无操作（绝不抛错）。',
  '\t\t\t */',
  '\t\t\tconst openPluginManager = () => {',
  '\t\t\t const reflect = ctx.reflect;',
  '\t\t\t if (reflect === void 0 || typeof reflect.get !== "function") return;',
  '\t\t\t const navigation = reflect.get("pluginNavigation");',
  '\t\t\t if (navigation !== void 0 && typeof navigation.openBundle === "function") {',
  '\t\t\t  navigation.openBundle(' + JSON.stringify(MODULE_ID) + ');',
  '\t\t\t  return;',
  '\t\t\t }',
  '\t\t\t const layout = reflect.get("layout");',
  '\t\t\t if (layout !== void 0 && typeof layout.selectPanel === "function") layout.selectPanel("plugins");',
  '\t\t\t};',
  '\t\t\tconst actions = { openTeammate(sessionId, childSessionId) {',
].join('\n'));
patch('插件管理入口接上动作', '\t\t\t} };\n\t\t\tctx.slots.inject("conversation.session.header.actions"',
  '\t\t\t}, openPluginManager };\n'
  + '\t\t\t// C21.3：配置只有一份（宿主 volatile Config）；这里只造一个读写把手，构造失败也只降级。\n'
  + '\t\t\tconst configController = createConfigController(ctx, openPluginManager);\n'
  + '\t\t\tctx.effect(() => () => configController.dispose(), ' + JSON.stringify(MODULE_ID + ': config form') + ');\n'
  + '\t\t\tctx.slots.inject("conversation.session.header.actions"');
// C21.3：configForms 是官方设置服务在客户端的半边；缺席时本插件宁可不激活，也不半死。
patch('inject 加 configForms', '\t\t\t"sessions",\n\t\t\t"uiWorkspace",', '\t\t\t"sessions",\n\t\t\t"configForms",\n\t\t\t"uiWorkspace",');
patch('TeamAction 收 config', '\t\tfunction TeamAction({ sessionId, useSession, useSessions, useSessionStatus, openTeammate, t }) {', '\t\tfunction TeamAction({ sessionId, useSession, useSessions, useSessionStatus, openTeammate, config, t }) {');
// C21：弹窗开合状态；配置的读写把手由 inject() 从产物自己的 actions 里给（不靠测试桩代填）。
patch('TeamAction 持弹窗状态', '\t\t\tconst [open, setOpen] = (0, react.useState)(false);',
  '\t\t\tconst [open, setOpen] = (0, react.useState)(false);\n\t\t\tconst [configOpen, setConfigOpen] = (0, react.useState)(false);');
// C21.2：名册行数与可见行数一致（隐藏未派发时徽标也要跟着变）。
patch('名册徽标随可见行', 'team.members.length > 1 && (0, react_jsx_runtime.jsx)("span", {',
  'configRows.length > 1 && (0, react_jsx_runtime.jsx)("span", {');
patch('名册徽标数值', 'children: team.members.length\n', 'children: configRows.length\n');
patch('名册行过滤', 'children: team.members.map((member) => (0, react_jsx_runtime.jsx)(TeamMemberRow, {',
  'children: configRows.map((member) => (0, react_jsx_runtime.jsx)(TeamMemberRow, {');

// C20.2：插件管理页详情区块组件。subject 由官方管理器给出：
//   { kind: "bundle", pkg: { name, version, installed, enabled, rows } }
const detailSection = [
  '\t\t/**',
  '\t\t * C20.2：只在本组合包的插件管理详情页渲染的角色与能力边界区块。',
  '\t\t * subject 由官方管理器传入（kind: bundle/row/item）；kind 不是 bundle、或不是本包时返回 null，',
  '\t\t * 也就是对别人的页面无话可说——绝不在别处插内容。',
  '\t\t */',
  '\t\tfunction TeamWorkflowDetailSection({ subject, t }) {',
  '\t\t const jsx = react_jsx_runtime.jsx;',
  '\t\t const jsxs = react_jsx_runtime.jsxs;',
  '\t\t const css = TeamAction_module_css_default;',
  '\t\t if (subject === void 0 || subject.kind !== "bundle" || subject.pkg === void 0',
  '\t\t  || subject.pkg.name !== ' + JSON.stringify(MODULE_ID) + ') return null;',
  '\t\t const dangling = WORKFLOW_ROLES.filter((role) => (role.danglingSkills ?? []).length > 0);',
  '\t\t return jsxs("section", { className: css.detail, children: [',
  '\t\t  jsx("h4", { className: css.detailTitle, children: t("detailTitle") }),',
  '\t\t  jsx("p", { className: css.detailNote, children: t("detailNote") }),',
  '\t\t  jsx("div", { className: css.detailList, children: WORKFLOW_ROLES.map((role) => jsxs("div", {',
  '\t\t   className: css.detailRole,',
  '\t\t   children: [jsxs("div", { className: css.detailHead, children: [',
  '\t\t    jsx("b", { className: css.detailName, children: role.title }),',
  '\t\t    jsx("span", { className: css.detailId, children: role.id }),',
  '\t\t    jsx("span", { className: css.detailCapability, children: (role.writable ? t("writable") : t("readonly"))',
  '\t\t     + " · " + role.tools.join(", ") + " · " + role.autoloadSkills.length + " " + t("skills") })',
  '\t\t   ] }),',
  '\t\t   jsx("div", { className: css.detailLine, children: role.duty }),',
  '\t\t   jsxs("div", { className: css.detailLine, children: [',
  '\t\t    jsx("b", { className: css.detailLabel, children: t("outputs") }),',
  '\t\t    role.outputs.join(" · ")',
  '\t\t   ] }),',
  '\t\t   jsxs("div", { className: css.detailLine, children: [',
  '\t\t    jsx("b", { className: css.detailLabel, children: t("boundaries") }),',
  '\t\t    role.boundaries',
  '\t\t   ] })',
  '\t\t  ] }, role.id)) }),',
  '\t\t  dangling.length > 0 && jsx("p", { className: css.detailWarn, children:',
  '\t\t   "⚠ " + t("dangling") + "：" + dangling.map((role) => role.id + " → " + role.danglingSkills.join("、")).join("；") })',
  '\t\t ] });',
  '\t\t}',
  '',
].join('\n');
insertBefore('详情区块组件', '\t\tfunction registerAgentTeamUi(ctx) {', detailSection + '\n');

patch('遮蔽坐标常量', '\t\tfunction registerAgentTeamUi(ctx) {', [
  '\t\t/**',
  '\t\t * C1 的实现坐标（见 CONSTITUTION.md C3/C13）。**本文件唯一允许出现官方 slot id 的地方**：',
  '\t\t * 它只用于「与官方占同一个格子」，locale / 样式前缀 / 模块 id 仍然是自己的，所以不会撞车。',
  '\t\t */',
  `\t\tconst SLOT_NAME = ${JSON.stringify(SLOT_NAME)};`,
  `\t\tconst OFFICIAL_SLOT_ID = ${JSON.stringify(OFFICIAL_SLOT_ID)};`,
  `\t\tconst SHADOW_PRIORITY = ${SHADOW_PRIORITY};`,
  '\t\t/** C21.3：配置条目 id 必须与 profile 里的 `- id:` 一致（改名即断）。 */',
  '\t\tconst CONFIG_ENTRY_ID = "team-workflow";',
  '\t\tfunction registerAgentTeamUi(ctx) {',
].join('\n'));

// ────────── C21：自有配置弹窗（官方 Modal + 官方 SettingsForm 外观；单一真源 = 宿主 volatile Config）──────────
const configSupport = [
  '\t\t/**',
  '\t\t * C21.3：配置的读写把手，挂在官方设置服务 ctx.configForms 上（键 = profile 条目 id）。',
  '\t\t * **不另存 localStorage、不建配置文件**；任何一步失败都降级成"不可写"，绝不抛错——',
  '\t\t * 客户端 entry 抛错会让整个 GUI 停在 "Failed to load plugins"（同 C1 的让位纪律）。',
  '\t\t */',
  '\t\tfunction createConfigController(ctx, openPluginManager) {',
  '\t\t const P = _deepseek_ai_dsh_client_ui_primitives;',
  '\t\t let scope;',
  '\t\t let model;',
  '\t\t try {',
  '\t\t  const forms = ctx.configForms;',
  '\t\t  if (forms !== void 0 && typeof forms.get === "function") scope = forms.get(CONFIG_ENTRY_ID);',
  '\t\t } catch (error) { scope = void 0; }',
  '\t\t try {',
  '\t\t  if (scope !== void 0 && typeof P.SettingsFormModel === "function") {',
  '\t\t   model = new P.SettingsFormModel(scope, [',
  '\t\t    configRolesSpec("disabledRoles"),',
  '\t\t    configBooleanSpec("autoloadSkills"),',
  '\t\t    configBooleanSpec("routeGuard"),',
  '\t\t    configBooleanSpec("showTaskBoard"),',
  '\t\t    configBooleanSpec("hideUnassignedRoles"),',
  '\t\t    configBooleanSpec("forceCompactPanel")',
  '\t\t   ], []);',
  '\t\t  }',
  '\t\t } catch (error) { model = void 0; }',
  '\t\t const readSnapshot = () => {',
  '\t\t  try { return scope === void 0 ? void 0 : scope.getSnapshot(); } catch (error) { return void 0; }',
  '\t\t };',
  '\t\t const readValues = () => {',
  '\t\t  const snapshot = readSnapshot();',
  '\t\t  const raw = snapshot !== void 0 && snapshot.value !== void 0 ? snapshot.value : {};',
  '\t\t  const values = {};',
  '\t\t  for (const field of CONFIG_FIELDS) values[field] = raw[field] === void 0 ? CONFIG_DEFAULTS[field] : raw[field];',
  '\t\t  return values;',
  '\t\t };',
  '\t\t return {',
  '\t\t  snapshot() {',
  '\t\t   const shell = model === void 0 ? CONFIG_EMPTY_VIEW : model.shell();',
  '\t\t   const fields = {};',
  '\t\t   if (model !== void 0) for (const field of CONFIG_FIELDS) fields[field] = model.field(field);',
  '\t\t   return {',
  '\t\t    available: shell.available === true,',
  '\t\t    writable: shell.writable === true,',
  '\t\t    dirty: shell.dirty === true,',
  '\t\t    invalid: shell.invalid === true,',
  '\t\t    saving: shell.saving === true,',
  '\t\t    failed: shell.failed === true,',
  '\t\t    value: readValues(),',
  '\t\t    fields',
  '\t\t   };',
  '\t\t  },',
  '\t\t  subscribe(listener) {',
  '\t\t   if (scope === void 0 || typeof scope.subscribe !== "function") return () => {};',
  '\t\t   try {',
  '\t\t    const dispose = scope.subscribe(listener);',
  '\t\t    return typeof dispose === "function" ? dispose : () => {};',
  '\t\t   } catch (error) { return () => {}; }',
  '\t\t  },',
  '\t\t  values: readValues,',
  '\t\t  edit(field, text) { if (model !== void 0) model.actions().edit(field, text); },',
  '\t\t  resetField(field) { if (model !== void 0) model.actions().resetField(field); },',
  '\t\t  save() { return model === void 0 ? void 0 : model.actions().save(); },',
  '\t\t  discard() { if (model !== void 0) model.actions().discard(); },',
  '\t\t  openManager() { openPluginManager(); },',
  '\t\t  dispose() { try { if (model !== void 0 && typeof model.dispose === "function") model.dispose(); } catch (error) {} }',
  '\t\t };',
  '\t\t}',
  '\t\t/**',
  '\t\t * C21.1：自有配置弹窗。浮层/遮罩/Esc/Tab/焦点归还是一律交给官方 Modal（useModalLayer），',
  '\t\t * 控件是官方 Switch / SettingsValueField，表单外观是官方 SettingsForm——不自造视觉。',
  '\t\t * 底部「在插件管理页中查看」是保留下来的官方入口（C20.3 改写后降级为次级链接）。',
  '\t\t */',
  '\t\tfunction TeamWorkflowConfigDialog({ open, onClose, config, t }) {',
  '\t\t const P = _deepseek_ai_dsh_client_ui_primitives;',
  '\t\t const jsx = react_jsx_runtime.jsx;',
  '\t\t const jsxs = react_jsx_runtime.jsxs;',
  '\t\t const css = TeamAction_module_css_default;',
  '\t\t const view = useConfigView(config);',
  '\t\t if (open !== true) return null;',
  '\t\t const values = view.value ?? CONFIG_DEFAULTS;',
  '\t\t const writable = view.writable === true;',
  '\t\t const fields = view.fields ?? {};',
  '\t\t const stage = (field, text) => {',
  '\t\t  if (config !== void 0 && typeof config.edit === "function") config.edit(field, text);',
  '\t\t };',
  '\t\t const switchRow = (field, labelKey) => jsx("div", {',
  '\t\t  className: css.configRow,',
  '\t\t  children: [',
  '\t\t   jsx("span", { className: css.configLabel, children: t(labelKey) }),',
  '\t\t   jsx(P.Switch, {',
  '\t\t    checked: values[field] === true,',
  '\t\t    label: t(labelKey),',
  '\t\t    disabled: writable !== true,',
  '\t\t    onChange: (next) => stage(field, next === true ? "true" : "false")',
  '\t\t   })',
  '\t\t  ]',
  '\t\t }, field);',
  '\t\t const roles = fields.disabledRoles ?? { text: "", overridden: false, invalid: false };',
  '\t\t return jsx(P.Modal, {',
  '\t\t  open: true,',
  '\t\t  onClose,',
  '\t\t  title: t("configTitle"),',
  '\t\t  closeLabel: t("configClose"),',
  '\t\t  children: jsxs(P.SettingsForm, {',
  '\t\t   labels: {',
  '\t\t    unavailable: t("formUnavailable"),',
  '\t\t    readOnly: t("formReadOnly"),',
  '\t\t    saveFailed: t("formSaveFailed"),',
  '\t\t    save: t("formSave"),',
  '\t\t    saving: t("formSaving")',
  '\t\t   },',
  '\t\t   state: {',
  '\t\t    available: view.available === true,',
  '\t\t    writable,',
  '\t\t    dirty: view.dirty === true,',
  '\t\t    invalid: view.invalid === true,',
  '\t\t    saving: view.saving === true,',
  '\t\t    failed: view.failed === true',
  '\t\t   },',
  '\t\t   onSave: () => { if (config !== void 0 && typeof config.save === "function") config.save(); },',
  '\t\t   onDiscard: () => { if (config !== void 0 && typeof config.discard === "function") config.discard(); },',
  '\t\t   children: [',
  '\t\t    jsx("p", { className: css.configHint, children: t("configHint") }),',
  '\t\t    jsx(P.SettingsValueField, {',
  '\t\t     id: "twf-config-disabled-roles",',
  '\t\t     label: t("cfgDisabledRoles"),',
  '\t\t     hint: t("cfgDisabledRolesHint"),',
  '\t\t     overriddenLabel: t("formOverridden"),',
  '\t\t     resetLabel: t("formReset"),',
  '\t\t     invalidLabel: t("formInvalid"),',
  '\t\t     disabled: writable !== true,',
  '\t\t     text: roles.text,',
  '\t\t     overridden: roles.overridden === true,',
  '\t\t     invalid: roles.invalid === true,',
  '\t\t     onEdit: (text) => stage("disabledRoles", text),',
  '\t\t     onReset: () => { if (config !== void 0 && typeof config.resetField === "function") config.resetField("disabledRoles"); }',
  '\t\t    }),',
  '\t\t    jsx("div", { className: css.configList, children: [',
  '\t\t     switchRow("autoloadSkills", "cfgAutoloadSkills"),',
  '\t\t     switchRow("routeGuard", "cfgRouteGuard"),',
  '\t\t     switchRow("showTaskBoard", "cfgShowTaskBoard"),',
  '\t\t     switchRow("hideUnassignedRoles", "cfgHideUnassignedRoles"),',
  '\t\t     switchRow("forceCompactPanel", "cfgForceCompactPanel")',
  '\t\t    ] }),',
  '\t\t    jsx("div", { className: css.configFoot, children: jsx("button", {',
  '\t\t     type: "button",',
  '\t\t     className: css.configLink,',
  '\t\t     onClick: () => { if (config !== void 0 && typeof config.openManager === "function") config.openManager(); },',
  '\t\t     children: t("configOpenManager")',
  '\t\t    }) })',
  '\t\t   ]',
  '\t\t  })',
  '\t\t });',
  '\t\t}',
  '',
].join('\n');
insertBefore('配置弹窗组件', '\t\tfunction registerAgentTeamUi(ctx) {', configSupport + '\n');

replaceInclusive(
  '注册（同槽位遮蔽 + 让位兜底）',
  'ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({',
  '}, TeamAction));',
  [
    'ctx.slots.inject(SLOT_NAME, () => {',
    '\t\t\t\ttry {',
    '\t\t\t\t\treturn ctx.slots.register({',
    '\t\t\t\t\t\tname: SLOT_NAME,',
    '\t\t\t\t\t\tid: OFFICIAL_SLOT_ID,',
    '\t\t\t\t\t\torder: ' + ORDER + ',',
    '\t\t\t\t\t\tpriority: SHADOW_PRIORITY,',
    '\t\t\t\t\t\tlocale: NS,',
    '\t\t\t\t\t\tinject: () => actions',
    '\t\t\t\t\t}, TeamAction);',
    '\t\t\t\t} catch (error) {',
    '\t\t\t\t\t// 官方若用同一个 id 且 priority 相同占位，register 会抛 "already has an entry with id"。',
    '\t\t\t\t\t// 这不是故障：C1 要求官方优先，此处让位即可。异常绝不能冒出去——',
    '\t\t\t\t\t// 客户端 entry 抛错会让 Web 外壳的启动激活审计在 mount 之前 throw，',
    '\t\t\t\t\t// 整个 GUI 停在 "Failed to load plugins"（第一版就是这个死法）。',
    '\t\t\t\t\treturn () => {};',
    '\t\t\t\t}',
    '\t\t\t});',
    '',
    '\t\t\t// C20.2：本组合包详情页的区块（卡片 locale meta 只有一句话，结构化内容在这里）。',
    '\t\t\t// 槽位由官方管理器页面声明（list / scope root），按页面传入的 subject 渲染。',
    '\t\t\tctx.slots.inject("plugins.detail.section", () => {',
    '\t\t\t\ttry {',
    '\t\t\t\t\treturn ctx.slots.register({',
    '\t\t\t\t\t\tname: "plugins.detail.section",',
    '\t\t\t\t\t\tid: "team-workflow-roles",',
    '\t\t\t\t\t\tlocale: NS',
    '\t\t\t\t\t}, TeamWorkflowDetailSection);',
    '\t\t\t\t} catch (error) {',
    '\t\t\t\t\t// 与卡片同理：注册失败只能让位，绝不能冒出去（整页会停在 Failed to load plugins）。',
    '\t\t\t\t\treturn () => {};',
    '\t\t\t\t}',
    '\t\t\t});',
  ].join('\n'),
);

// C21.3：配置把手随 inject 交给卡片组件（走产物自己的 actions，不靠外部代填）。
// 必须放在上面那条 replaceInclusive 之后——`inject: () => actions` 是那次重写才产生的。
patch('注入带上配置把手', '\t\t\t\t\t\tinject: () => actions', '\t\t\t\t\t\tinject: () => ({ ...actions, config: configController })');

// D2(d) + C20.3 改写 + C21.1：面板顶部是**卡片**（不是一行纯文字），右侧按钮打开**本插件自有配置弹窗**。
// mechanism 甲下，本卡片能渲染 ⇒ 官方那条没占住槽位 ⇒ 这句话就是真实状态。
patch('本插件状态卡片', '(0, react_jsx_runtime.jsxs)("section", { children: [(0, react_jsx_runtime.jsxs)("h3", { children: [t("roster")',
  '(0, react_jsx_runtime.jsxs)("div", {\n'
  + '\t\t\t\t\t\t\t\t\tclassName: TeamAction_module_css_default.statusCard,\n'
  + '\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular, {\n'
  + '\t\t\t\t\t\t\t\t\t\tsize: 14\n'
  + '\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n'
  + '\t\t\t\t\t\t\t\t\t\tclassName: TeamAction_module_css_default.statusText,\n'
  + '\t\t\t\t\t\t\t\t\t\trole: "status",\n'
  + '\t\t\t\t\t\t\t\t\t\tchildren: t("pluginStatus")\n'
  + '\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("button", {\n'
  + '\t\t\t\t\t\t\t\t\t\ttype: "button",\n'
  + '\t\t\t\t\t\t\t\t\t\tclassName: TeamAction_module_css_default.statusButton,\n'
  + '\t\t\t\t\t\t\t\t\t\tonClick: () => setConfigOpen(true),\n'
  + '\t\t\t\t\t\t\t\t\t\tchildren: t("configButton")\n'
  + '\t\t\t\t\t\t\t\t\t})]\n'
  + '\t\t\t\t\t\t\t\t}),\n'
  + '\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("section", { children: [(0, react_jsx_runtime.jsxs)("h3", { children: [t("roster")');

// C21.1：把自有配置弹窗挂进卡片树。它自己 portal，与面板开合无关——
// 面板关掉（鼠标移出）时弹窗不会跟着消失。
patch('配置弹窗接到卡片', '}), open && (0, react_dom.createPortal)(',
  '}), (0, react_jsx_runtime.jsx)(TeamWorkflowConfigDialog, {\n'
  + '\t\t\t\t\t\t\t\t\topen: configOpen,\n'
  + '\t\t\t\t\t\t\t\t\tonClose: () => setConfigOpen(false),\n'
  + '\t\t\t\t\t\t\t\t\tconfig,\n'
  + '\t\t\t\t\t\t\t\t\tt\n'
  + '\t\t\t\t\t\t\t\t}), open && (0, react_dom.createPortal)(');

// ────────── 补丁组 6：附加样式 ──────────
// 官方 .roster 两列网格、.member 卡片、.panel 一律不改（观感就是要这个）。
// 只补官方没有的那几样：角色文本换行（官方 small 是 nowrap+ellipsis，我们的文案更长）、
// memberText 占满剩余宽度、行内标签的字重与颜色，以及 C20 的状态卡片与插件管理详情区块。
// 全部带自有前缀 _twf_，绝不碰官方类名。
const roleCss = [
  `.${CSS_PREFIX}memberText{flex:1}`,
  `.${CSS_PREFIX}member .${CSS_PREFIX}roleDuty,.${CSS_PREFIX}member .${CSS_PREFIX}roleLine{white-space:normal;overflow:visible;text-overflow:clip;line-height:16px}`,
  `.${CSS_PREFIX}roleDuty{color:var(--dsw-alias-label-secondary)}`,
  `.${CSS_PREFIX}roleLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}`,
  // C8(d) + C20.3：状态卡片（卡片/按钮样式，不是一行纯文字）
  `.${CSS_PREFIX}statusCard{display:flex;align-items:center;gap:8px;margin:12px 4px 0;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-stroke);font-size:12px;line-height:16px}`,
  `.${CSS_PREFIX}statusText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary)}`,
  `.${CSS_PREFIX}statusButton{flex:none;cursor:pointer;border:0;border-radius:6px;padding:3px 8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px}`,
  `.${CSS_PREFIX}statusButton:hover{background:var(--dsw-alias-bg-layer-4)}`,
  `.${CSS_PREFIX}statusButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}`,
  // C20.2：插件管理页详情区块
  `.${CSS_PREFIX}detail{display:flex;flex-direction:column;gap:8px;margin-top:16px;color:var(--dsw-alias-label-primary)}`,
  `.${CSS_PREFIX}detailTitle{margin:0;font-size:13px;font-weight:500}`,
  `.${CSS_PREFIX}detailNote{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}`,
  `.${CSS_PREFIX}detailList{display:flex;flex-direction:column;gap:6px}`,
  `.${CSS_PREFIX}detailRole{border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2)}`,
  `.${CSS_PREFIX}detailHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}`,
  `.${CSS_PREFIX}detailName{font-size:12px}`,
  `.${CSS_PREFIX}detailId{font-size:11px;color:var(--dsw-alias-label-tertiary)}`,
  `.${CSS_PREFIX}detailCapability{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}`,
  `.${CSS_PREFIX}detailLine{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}`,
  `.${CSS_PREFIX}detailLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}`,
  `.${CSS_PREFIX}detailWarn{margin:0;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}`,
  // C21.1：配置弹窗里官方没有的那几样（表单外壳与控件本身用官方样式，这里只补排布与次级链接）
  `.${CSS_PREFIX}configHint{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}`,
  `.${CSS_PREFIX}configList{display:flex;flex-direction:column;gap:8px;margin-top:12px}`,
  `.${CSS_PREFIX}configRow{display:flex;align-items:center;justify-content:space-between;gap:10px}`,
  `.${CSS_PREFIX}configLabel{font-size:12px;color:var(--dsw-alias-label-primary)}`,
  `.${CSS_PREFIX}configFoot{margin-top:12px}`,
  `.${CSS_PREFIX}configLink{cursor:pointer;border:0;padding:0;background:none;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px;text-decoration:underline}`,
].join('');
patch('附加样式注入', '\t\tconst tagId = ', `\t\tconst ROLE_CSS = ${JSON.stringify(roleCss)};\n\t\tconst tagId = `);
patch('附加样式生效', 'tag.textContent = css;', 'tag.textContent = css + ROLE_CSS;');

// 自有类名必须同时进官方那张 CSS-modules 类名表。
// 坑（2026-10-14 实测）：产物里的 `TeamAction_module_css_default` 是一张**静态表**
// （键 = 官方样式表里的类名）。只往样式表里追加规则、不往表里加键，`css.statusCard` 就是
// undefined —— 类名根本落不到 DOM 上，规则白写（旧代码里 roleDuty / roleLine / roleLabel
// 三条小字样式一直没生效，就是这个原因）。
const ownClasses = [
  'roleDuty', 'roleLine', 'roleLabel',
  'statusCard', 'statusText', 'statusButton',
  'detail', 'detailTitle', 'detailNote', 'detailList', 'detailRole', 'detailHead',
  'detailName', 'detailId', 'detailCapability', 'detailLine', 'detailLabel', 'detailWarn',
  'configHint', 'configList', 'configRow', 'configLabel', 'configFoot', 'configLink',
];
patch('自有类名进官方 class map', `"notice": "${CSS_PREFIX}notice",`,
  [`"notice": "${CSS_PREFIX}notice",`]
    .concat(ownClasses.map((name) => `"${name}": "${CSS_PREFIX}${name}",`))
    .join('\n\t\t\t'));

// ────────── 文件头 ──────────
const rosterFingerprint = createHash('sha256').update(JSON.stringify(inlineRoles)).digest('hex').slice(0, 16);
source = `/*
 * 本文件由 _tools/build-client.js 生成 —— 不要手改，改生成器再重跑 \`node _tools/build-client.js\`。
 * 设计契约见 CONSTITUTION.md（20 条），本文件头只复述与产物直接相关的几条。
 *
 * 生成方式：以官方客户端 bundle 为**外壳**（完整样式表、面板、portal、
 * useAnchoredPosition 定位、悬停展开、Esc 关闭、aria/role、中英文字典全部原样保留），
 * 只做三层改动：
 *
 *   A. 让位层（C1，机制=同槽位遮蔽）——slot id 与 order 与官方相同（${OFFICIAL_SLOT_ID} / ${ORDER}），
 *      但 priority = ${SHADOW_PRIORITY} 高于官方默认 0。DSH 的 list 槽每个格子只渲染
 *      (priority ?? 0) 最小的那一条，于是：
 *        官方启用 → 官方那条胜出，本插件被自动遮蔽，不渲染任何东西；
 *        官方关闭 → 本插件成为唯一胜出者，自动接管它原来的位置。
 *      注册外包 try/catch：万一官方将来用同一个 priority 占位，register 抛错会被兜成
 *      「让位」而不是让整个 GUI 停在 "Failed to load plugins"。
 *
 *   B. 身份层（C3）——locale ns ${LOCALE_NS} / CSS 前缀 ${CSS_PREFIX} /
 *      模块 id ${MODULE_ID} 一律自有。这三项沿用官方会让第二个 apply 抛错。
 *
 *   C. 内容层——数据来源换成 roles.json 内联的 ${inlineRoles.length} 个角色
 *      （指纹 ${rosterFingerprint}），与 agentTeam 投影的真实成员按「成员名 = 角色 id」对齐，
 *      从而显示真实运行状态；角色行只展示五项（状态点 / 中文名 / 角色 id Tag / 状态词 / 职责，C5.1），
 *      悬停提示固定为官方那句「打开成员会话」，可点击进入该成员的会话详情（C7，官方同一入口）；
 *      官方面板的 tasks / failure 原样透传（C20.4）；产物 / 边界 / 能力 / 悬空技能改挂
 *      插件管理页的详情区块 plugins.detail.section（C20.2）。
 *
 * 落盘前硬断言（C13）：官方 CSS 前缀与官方包名 0 处；官方 slot id 恰好 1 处
 * （只能出现在 SHADOW_PRIORITY 旁边那个只读常量里）；自有坐标齐全。
 */
` + source;

// ────────── 落盘前硬断言 ──────────
const problems = [];
for (const [label, needle] of [
  ['官方 CSS 前缀', OFFICIAL_CSS_PREFIX],
  ['官方包名', OFFICIAL_ID],
]) {
  if (source.includes(needle)) {
    const at = source.indexOf(needle);
    problems.push(`${label} 仍残留（${JSON.stringify(needle)}）附近：…${source.slice(Math.max(0, at - 60), at + 60).replace(/\n/g, ' ')}…`);
  }
}
// 官方 slot id：C1 的遮蔽机制需要它，但只允许出现在一处（那个只读常量），
// 且不得被当成自己的 locale ns 或模块 id。
const officialIdHits = source.split(`"${OFFICIAL_SLOT_ID}"`).length - 1;
if (officialIdHits !== 1) {
  problems.push(`官方 slot id 出现 ${officialIdHits} 处（C13 修订后要求恰好 1 处，只作为遮蔽用的只读常量）`);
} else if (!source.includes(`const OFFICIAL_SLOT_ID = "${OFFICIAL_SLOT_ID}";`)) {
  problems.push('唯一那处官方 slot id 不在 SHADOW_PRIORITY 旁边的只读常量里');
}
for (const [label, needle] of [
  ['locale ns', `"${LOCALE_NS}"`],
  ['CSS 前缀', CSS_PREFIX],
  ['模块 id', `"${MODULE_ID}"`],
]) {
  if (!source.includes(needle)) problems.push(`自有${label} 缺失（${JSON.stringify(needle)}）`);
}
// 遮蔽机制的两个要件：优先级与让位兜底，缺一个 C1 就不成立。
if (!source.includes(`priority: SHADOW_PRIORITY,`)) problems.push('注册选项里没有 priority（同槽位遮蔽失效，会与官方并存）');
if (!source.includes('catch (error)')) problems.push('注册没有 try/catch 兜底（官方同 priority 时整个 GUI 会起不来）');
// C20：本轮用户裁决的两样交付物必须在产物里（缺一个就是"改了但没接上"）。
if (!source.includes('openBundle(')) problems.push('产物里没有 pluginNavigation.openBundle 调用（C20.3 的官方入口降级后仍要在弹窗里）');
if (!source.includes('"plugins.detail.section"')) problems.push('产物里没有 plugins.detail.section 注册（C20.2 的详情区块缺失）');
// C21：自有配置弹窗与六个字段的接线（缺一个就是"改了但没接上"）。
if (!source.includes('forms.get(CONFIG_ENTRY_ID)')) problems.push('产物没有从 ctx.configForms 取配置（C21.3 单一真源失效）');
if (!source.includes('config: configController')) problems.push('产物没有把配置把手注入卡片组件（按钮点了也读不到配置）');
if (!source.includes('TeamWorkflowConfigDialog')) problems.push('产物没有配置弹窗组件（C21.1）');
if (!source.includes('P.Modal')) problems.push('产物没有用官方 Modal（C21.1：会变成自己造的浮层，Esc/焦点纪律全丢）');
if (!source.includes('P.SettingsFormModel') || !source.includes('P.SettingsForm')) {
  problems.push('产物没有用官方 SettingsForm/SettingsFormModel（C21.1 的表单外观与保存语义）');
}
if (!source.includes('const P = _deepseek_ai_dsh_client_ui_primitives;')) {
  problems.push('产物里的配置代码没有引用官方 primitives 模块（控件会落空）');
}
for (const field of ['"disabledRoles"', '"autoloadSkills"', '"routeGuard"', '"showTaskBoard"', '"hideUnassignedRoles"', '"forceCompactPanel"']) {
  if (source.split(field).length - 1 < 3) problems.push(`产物里字段 ${field} 的声明/规格/控件不足 3 处（六个字段必须都接上）`);
}
// C21.2 的硬要求：默认值 = 改动前的行为。默认值一旦漂移，这条断言先红。
const defaultsLiteral = 'const CONFIG_DEFAULTS = { disabledRoles: [], autoloadSkills: true, routeGuard: true, showTaskBoard: true, hideUnassignedRoles: false, forceCompactPanel: false };';
if (!source.includes(defaultsLiteral)) problems.push('C21.2 的默认值被改动（默认值必须等于改动前的行为）');
// 展示层三个字段必须各有一个真实消费点。
if (!source.includes('configValues.forceCompactPanel === true')) problems.push('forceCompactPanel 没有消费点（字段是死的）');
if (!source.includes('configValues.showTaskBoard !== false')) problems.push('showTaskBoard 没有消费点（字段是死的）');
if (!source.includes('member.liveId !== void 0')) problems.push('hideUnassignedRoles 没有消费点（字段是死的）');
if (problems.length > 0) {
  console.error('✗ 生成中止：');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}

writeFileSync(target, source);
console.log(`已生成 ${target}`);
console.log(`  外壳：官方客户端 bundle + ${applied.length} 组补丁`);
console.log(`  补丁：${applied.join(' / ')}`);
console.log(`  角色 ${inlineRoles.length} 个；指纹 ${rosterFingerprint}；${source.length} 字符`);
console.log(`  让位：slot id ${OFFICIAL_SLOT_ID}（同官方）+ priority ${SHADOW_PRIORITY}（官方默认 0 → 官方优先）`);
console.log(`  自有：locale ns ${LOCALE_NS} / CSS ${CSS_PREFIX} / 模块 id ${MODULE_ID} / order ${ORDER}`);
