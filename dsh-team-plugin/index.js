/**
 * Agent 团队工作流 —— DSH 插件宿主半侧。
 *
 * 角色与职责的**单一来源是 `roles.json`**，由 `_tools/sync-roles-from-pack.js`
 * 从资源包 `OMP团队开发工作流-DeepSeekHarness复刻包-20261013` 生成：
 *   sources/omp/agents/*.md  → 10 份权威角色定义（front-matter + 正文）
 *
 * 本文件不硬编码任何角色，避免与来源漂移。改角色请改资源包后重跑生成脚本。
 *
 * 设计原则（照资源包要求）：
 *   · **尽量少依赖**：原先只用 `node:` 内置模块；C21 起多一个 `@deepseek-ai/schemastery`
 *     （官方设置服务要求的配置 schema，版本与 app 内置一致）——这是唯一的外部依赖；
 *   · **无门控、无钩子**：不拦截任何工具调用；
 *   · **按需创建角色**，不常驻（来源：01-现行工作流.md §3）；
 *   · `autoloadSkills` 中指向不存在技能时**显式报告并移出自动加载**，
 *     不以空壳文件消除缺口（来源：03-来源与差距.md）。
 *
 * 落盘同时是“链路已打通”的证据：`apply` 在宿主进程内执行，
 * 文件出现在磁盘上就证明“包被解析 → 插件被激活 → 宿主进程内代码真的跑了”。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';

/** Cordis 插件名。 */
export const name = 'team-workflow';

/** 声明依赖的服务：只有命令注册表。 */
export const inject = ['commands'];

/**
 * 读取角色名册（单一来源 `roles.json`）。
 *
 * **每次都重新读盘，不做模块级缓存** —— 实测教训：宿主会把插件模块缓存到重启，
 * 若在模块顶层 `readFileSync`，则 `roles.json` 的任何改动都必须重启整个应用才生效。
 * 惰性读取让「重新挂载」就足以让数据改动生效。
 */
export function loadRoster() {
  return JSON.parse(fs.readFileSync(new URL('./roles.json', import.meta.url), 'utf8'));
}

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const OUT_DIR = path.join(HOME, 'team-workflow');

/**
 * C21.2：六个配置字段的默认值。**默认值必须等于改动前的行为**——
 * 配置功能本身不得改变任何现有行为（门 6f/6h 在默认值下必须与改前等价）。
 */
export const CONFIG_DEFAULTS = Object.freeze({
  disabledRoles: [],
  autoloadSkills: true,
  routeGuard: true,
  showTaskBoard: true,
  hideUnassignedRoles: false,
  forceCompactPanel: false,
});

/**
 * 取生效配置：schema 默认值兜底 + 字段类型兜底。
 *
 * 调用方在**每次使用时**重新调用它，读到的就是当时的值——volatile 字段改完不重启也生效。
 * 手动跑（不走 DSH）或旧 profile 没有这段配置时，这里保证仍然是"改动前的行为"。
 */
export function effectiveConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    ...CONFIG_DEFAULTS,
    ...raw,
    disabledRoles: Array.isArray(raw.disabledRoles) ? raw.disabledRoles : CONFIG_DEFAULTS.disabledRoles,
  };
}

// ---------------------------------------------------------------------------
// 三级管道（Fast / Standard / Deep）
//
// 路线决定启用哪些**流程门**（独立 QA、代码审查、合规、工件链）。它与工具层
// 硬门无关：发布、部署、破坏性操作、密钥目录、工作区边界这些永远生效，不会
// 因为「我走的是 Fast」而放宽。
//
// 工具层唯一能强制的路线规则是：声明 fast 却去派发子 Agent —— 因为 Fast 的
// 定义就是主 Agent 单独执行。该判断在 `~/.dsh/team/policies/policy_check.js`
// 里实现，读的就是下面这个文件。
// ---------------------------------------------------------------------------

const ROUTE_FILE = process.env.DSH_TEAM_ROUTE
  ? path.resolve(process.env.DSH_TEAM_ROUTE)
  : path.join(HOME, 'team', 'route.json');

/** 三级路线。顺序即从简到繁。 */
export const ROUTE_TIERS = ['fast', 'standard', 'deep'];

const ROUTE_GUIDE = {
  fast: '范围窄、解法明确、无实质设计或独立门要求、回归风险低。主 Agent 单独执行并自查，**不冒充独立 QA、不派发**。',
  standard: '默认路线。短计划与验收点 → 主 Agent 或按路径隔离的成员实施 → 独立 QA 核对；必要时加代码审查/合规。',
  deep: '未决产品或持久架构决策、跨 owner 契约变更、敏感数据/权限、迁移、不可逆操作。先确认输入与授权，再按依赖顺序形成工件。',
};

/** 读取当前路线；缺失或损坏一律回落到 standard，绝不因此报错或阻断。 */
export function readRoute() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROUTE_FILE, 'utf8'));
    const tier = String(parsed.tier || '').trim().toLowerCase();
    if (ROUTE_TIERS.includes(tier)) {
      return { tier, reason: String(parsed.reason || ''), declared_at: parsed.declared_at ?? null, file: ROUTE_FILE };
    }
  } catch (_error) {
    // 无声明 / 不可读 / JSON 损坏 → 默认路线
  }
  return { tier: 'standard', reason: '', declared_at: null, file: ROUTE_FILE, note: '默认（尚无 route.json 声明）' };
}

/** 声明路线并落盘。 */
export function writeRoute(tier, reason) {
  fs.mkdirSync(path.dirname(ROUTE_FILE), { recursive: true });
  const record = { tier, reason: reason || '', declared_at: Date.now(), declared_by: 'user-command' };
  fs.writeFileSync(ROUTE_FILE, JSON.stringify(record, null, 2) + '\n');
  return { ...record, file: ROUTE_FILE };
}

/** 路线的纯文本渲染（`/team route` 输出）。 */
export function renderRoute(route) {
  const lines = [
    `当前路线：${route.tier}`,
    `触发原因：${route.reason || '（未声明）'}`,
  ];
  if (route.declared_at) lines.push(`声明时间：${new Date(route.declared_at).toISOString()}`);
  if (route.note) lines.push(route.note);
  lines.push(
    '',
    `含义：${ROUTE_GUIDE[route.tier] || ''}`,
    `声明位置：${route.file || ROUTE_FILE}`,
    '',
    '切换：`/team route fast|standard|deep <触发原因>`',
    '',
    '路线只决定启用哪些**流程门**（独立 QA / 代码审查 / 合规 / 工件链）。',
    '与路线无关的**工具层硬门**永远生效：发布、部署、具名/通配删除、密钥目录、工作区边界。',
    '其中「fast 路线下派发子 Agent」会转为**人工审批**，因为 Fast 的定义就是主 Agent 单独执行。',
  );
  return lines.join('\n');
}

/** 包中不存在、已被移出自动加载的技能绑定。 */
export function danglingSkills(roster = loadRoster()) {
  const items = [];
  for (const role of roster.roles) {
    for (const skill of role.danglingSkills ?? []) items.push({ role: role.id, skill });
  }
  return items;
}

/** 追加一条加载日志——用于在插件外部核验“宿主进程内确实执行了”。 */
function trace(event, extra) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(OUT_DIR, 'plugin.log'),
      JSON.stringify({ ts: Date.now(), pid: process.pid, event, ...(extra || {}) }) + '\n'
    );
  } catch (_error) {
    /* 诊断日志失败绝不能影响插件激活 */
  }
}

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].length));

/** 名册的纯文本渲染（同时用于落盘与 `/team` 输出）。 */
export function renderRoster(roster = loadRoster(), config) {
  const { disabledRoles } = effectiveConfig(config);
  const all = roster.roles;
  const roles = all.filter((role) => !disabledRoles.includes(role.id));
  const lines = [
    `Agent 团队工作流 · 角色名册（${roles.length} 个）`,
    `来源：${roster.source}`,
    '',
  ];
  for (const role of roles) {
    lines.push(`  ${pad(role.id, 15)} ${pad(role.title, 7)} ${role.writable ? '可写' : '只读'}  ${role.duty}`);
  }
  lines.push('', '按需创建角色，不常驻。用 `/team <角色 id>` 查看单个角色的完整简报。');

  if (roles.length !== all.length) {
    const off = all.filter((role) => disabledRoles.includes(role.id)).map((role) => role.id);
    lines.push('', `已按配置停用（C21.2 disabledRoles，共 ${off.length} 个）：${off.join('、')}`);
  }

  const dangling = danglingSkills(roster).filter((item) => roles.some((role) => role.id === item.role));
  if (dangling.length > 0) {
    lines.push('', '⚠ 悬空技能（包中不存在，已移出自动加载，不得静默加载）：');
    for (const item of dangling) lines.push(`  ${item.role} → ${item.skill}`);
  }
  return lines.join('\n');
}

/** 单个角色的完整简报。 */
export function renderRole(role, config) {
  const { autoloadSkills } = effectiveConfig(config);
  const lines = [
    `${role.id}（${role.title}）`,
    `职责：${role.duty}`,
    `产物：${role.outputs.join('、')}`,
    `边界：${role.boundaries}`,
    `能力：${role.writable ? '可写' : '只读'}（${role.tools.join(', ')}）；${role.spawns ? '可再派发' : '不可再派发'}`,
    `模型别名：${role.model}（仅角色映射，不代表供应商，不含凭据）`,
    autoloadSkills === false
      ? '自动加载技能：已按配置关闭（C21.2 autoloadSkills；派发 prompt 里不要求成员加载技能）'
      : `自动加载技能（${role.autoloadSkills.length}）：${role.autoloadSkills.join('、')}`,
  ];
  if ((role.danglingSkills ?? []).length > 0) {
    lines.push(`⚠ 已移除的悬空绑定：${role.danglingSkills.join('、')}（包中无此技能，不得静默加载）`);
  }
  lines.push(
    '',
    `派发简报（作为 subagent 的 prompt；源自 ${role.source}）：`,
    role.instruction,
  );
  return lines.join('\n');
}

/** 角色名册（供其它插件/工具复用）。 */
export function roles() {
  return loadRoster().roles.map((role) => ({ ...role }));
}

/**
 * C21.3：宿主侧配置 schema。六个字段**全部 `.volatile()`**——官方设置服务据此允许
 * 不重启地改这些值；写法与官方插件一致（`@deepseek-ai/dsh-client-ui-settings`）。
 * 字段与默认值的口径见 CONSTITUTION.md C21.2。
 */
export const Config = z.object({
  disabledRoles: z.array(z.string()).default([]).volatile(),
  autoloadSkills: z.boolean().default(true).volatile(),
  routeGuard: z.boolean().default(true).volatile(),
  showTaskBoard: z.boolean().default(true).volatile(),
  hideUnassignedRoles: z.boolean().default(false).volatile(),
  forceCompactPanel: z.boolean().default(false).volatile(),
});

/**
 * Cordis 插件入口。
 * @param ctx - 宿主进程内的 Cordis 上下文（用到 `commands`；`settings` 走可选注入）。
 * @param config - 本插件配置（由 `Config` 校验并补默认值；volatile 字段会被就地更新）。
 */
export function apply(ctx, config) {
  /**
   * **调用时刻**的活配置：优先读 fiber 上的当前值（volatile 改完立刻生效，不管服务是
   * 就地改对象还是换新对象），退回 `apply` 收到的 config。手动调用时退回默认值。
   */
  const liveConfig = () => effectiveConfig(ctx && ctx.fiber && ctx.fiber.config ? ctx.fiber.config : config);

  // C21.3：关掉官方插件管理页给本插件自动生成的表单，避免两个入口写同一份配置。
  // 可选注入（官方写法）：设置服务缺席时这段不执行，本插件照常激活。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  // 1) 名册落盘：既让主 Agent 能读到角色，也是“插件已加载”的证据。
  let roster;
  try {
    roster = loadRoster();
  } catch (error) {
    trace('load-failed', { message: String((error && error.message) || error) });
    throw error;
  }

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'roles.json'), JSON.stringify(roster, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'roles.md'), renderRoster(roster, liveConfig()) + '\n');
    trace('apply', {
      roleCount: roster.roles.length,
      danglingSkillCount: danglingSkills(roster).length,
      outDir: OUT_DIR,
    });
  } catch (error) {
    trace('apply-write-failed', { message: String((error && error.message) || error) });
  }

  // 2) 注册 `/team` 命令。`CommandDefinitionId` 在运行时是恒等函数
  //    （已核验 @deepseek-ai/dsh-commands/lib/types/brand.js），因此这里直接传字符串，
  //    从而让本插件保持零外部依赖。
  ctx.effect(function* () {
    // 清理函数先 yield：Cordis 在插件卸载时会执行它。
    yield () => {
      trace('dispose', { command: 'team' });
    };
    try {
      yield ctx.commands.register({
        definitionId: '@local/dsh-team-workflow/team',
        name: 'team',
        description: 'Agent 团队工作流：名册与三级路线（/team、/team <角色 id>、/team route <fast|standard|deep> <原因>）',
        handler: (invocation) => {
          // 每次调用重新读盘：roles.json 改动后无需重启即可生效。
          const current = loadRoster();
          // 每次调用重新取活配置：C21.2 的字段改完（volatile）无需重启即可生效。
          const cfg = liveConfig();
          const raw = String((invocation && invocation.rawInput) || '').trim();

          if (raw === 'route' || raw.startsWith('route ')) {
            const rest = raw.slice('route'.length).trim();
            if (rest === '') return { kind: 'success', text: renderRoute(readRoute()) };
            const [tier, ...reasonParts] = rest.split(/\s+/);
            if (!ROUTE_TIERS.includes(tier)) {
              return {
                kind: 'error',
                text: `未知路线：${tier}\n可用路线：${ROUTE_TIERS.join(', ')}\n\n用法：/team route <fast|standard|deep> <触发原因>`,
              };
            }
            const reason = reasonParts.join(' ').trim();
            // C21.2 routeGuard：默认 true = 改动前的行为（强制写明原因）。
            if (reason === '' && cfg.routeGuard !== false) {
              return {
                kind: 'error',
                text: `声明路线必须写明触发原因。\n\n${tier}：${ROUTE_GUIDE[tier]}\n\n例：/team route ${tier} <为什么这个任务属于这条路线>`,
              };
            }
            const record = writeRoute(tier, reason === '' ? '未声明（routeGuard 已按配置关闭）' : reason);
            trace('route-declared', { tier, reason });
            return { kind: 'success', text: `路线已声明。\n\n${renderRoute(record)}` };
          }

          if (raw === '') return { kind: 'success', text: renderRoster(current, cfg) };
          const role = current.roles.find((item) => item.id === raw);
          if (!role) {
            return {
              kind: 'error',
              text: `未知角色：${raw}\n可用角色：${current.roles.map((item) => item.id).join(', ')}\n查看路线：/team route`,
            };
          }
          // C21.2 disabledRoles：停用是**显式**的，不是静默消失——这里明确说"已按配置停用"。
          if (cfg.disabledRoles.includes(role.id)) {
            const usable = current.roles.filter((item) => !cfg.disabledRoles.includes(item.id)).map((item) => item.id);
            return {
              kind: 'error',
              text: `角色已按配置停用（C21.2 disabledRoles）：${raw}\n可在插件卡片的「配置」里重新启用。\n可用角色：${usable.join(', ')}`,
            };
          }
          return { kind: 'success', text: renderRole(role, cfg) };
        },
      });
      trace('command-registered', { command: 'team' });
    } catch (error) {
      trace('command-register-failed', { message: String((error && error.message) || error) });
      throw error;
    }
  }, 'team-workflow /team 命令');
}
