#!/usr/bin/env node
/**
 * 按资源包 `04-验收清单.md` 对已复刻部分做真实验收，产出证据报告。
 *
 * 本脚本只做**能自动核验**的检项；需要人机交互的检项（分诊路线、门控失效、
 * 授权拒绝等）标记为「未执行」，不冒充通过——这是清单自己的口径要求：
 *   「未验证的场景记未执行」「禁止以提示词输出“我会遵守”替代证据」。
 *
 * 覆盖：
 *   包静态完整性  shasum -a 256 -c sources/SHA256SUMS.txt
 *   检项 2        10 个角色逐一加载；ID / 权限 / 技能可用性；两个缺失技能必须被显式报告
 *   角色↔技能     roles.json 的 autoloadSkills 必须都能在已安装技能中找到
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', '..', 'dsh-team-plugin');
const PACK = '/Users/maxwell/Downloads/OMP团队开发工作流-DeepSeekHarness复刻包-20261013';
const HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');

const lines = [];
const results = [];
function check(id, name, expected, actual, ok) {
  results.push({ id, name, expected, actual, ok });
  lines.push(`| ${id} | ${name} | ${expected} | ${actual} | ${ok ? '**PASS**' : '**FAIL**'} |`);
}

// ── 0. 身份 ──────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const rosterRaw = readFileSync(join(pluginDir, 'roles.json'), 'utf8');
const roster = JSON.parse(rosterRaw);
const rosterHash = createHash('sha256').update(rosterRaw).digest('hex').slice(0, 16);

// ── 1. 包静态完整性（包自己的检查） ────────────────────────
let packOk = false;
let packActual = '';
try {
  const out = execFileSync('shasum', ['-a', '256', '-c', 'sources/SHA256SUMS.txt'],
    { cwd: PACK, encoding: 'utf8' });
  const failed = out.split('\n').filter((l) => l.includes('FAILED')).length;
  packOk = failed === 0;
  packActual = `校验 ${out.trim().split('\n').length} 个文件，失败 ${failed} 个`;
} catch (error) {
  packActual = `校验失败：${String(error.stdout || error.message).trim().split('\n').slice(-1)[0]}`;
}
check('0', '资源包静态完整性', '全部 SHA256 匹配', packActual, packOk);

// ── 2. 清单检项 2：10 个角色逐一加载 ──────────────────────
const agentFiles = readdirSync(join(PACK, 'sources/omp/agents')).filter((f) => f.endsWith('.md'));
check('2a', '角色文件数', '10', String(agentFiles.length), agentFiles.length === 10);
check('2b', 'roles.json 角色数', '10', String(roster.roles.length), roster.roles.length === 10);

// 逐角色：id 与包中 front-matter 的 name 一致
const idMismatch = [];
for (const file of agentFiles) {
  const text = readFileSync(join(PACK, 'sources/omp/agents', file), 'utf8');
  const name = /^name:\s*(\S+)/m.exec(text)?.[1];
  const role = roster.roles.find((r) => r.id === name);
  if (role === undefined) idMismatch.push(`${file}→${name}`);
}
check('2c', '角色 ID 与包 front-matter 一致', '10/10 匹配',
  idMismatch.length === 0 ? '10/10 匹配' : `不匹配：${idMismatch.join(', ')}`, idMismatch.length === 0);

// 迁移后不得残留来源机专属路径（包要求：不要让失效路径静默通过）
const stalePaths = roster.roles.filter((role) => /lmqhx|\.omp\/|\.codex\//.test(role.instruction));
check('2e', '角色正文无失效本机路径', '0 个',
  stalePaths.length === 0 ? '0 个' : stalePaths.map((r) => r.id).join(', '), stalePaths.length === 0);

// 展示顺序必须等于包 `01-现行工作流.md` 里对 10 个角色的枚举顺序。
// 不写死期望值，而是从包原文里按首次出现位置提取——这样包改了顺序，这里会立刻发现。
const flowText = readFileSync(join(PACK, '01-现行工作流.md'), 'utf8');
const packOrder = roster.roles
  .map((role) => ({ id: role.id, at: flowText.search(new RegExp('`' + role.id + '`')) }))
  .filter((item) => item.at >= 0)
  .sort((a, b) => a.at - b.at)
  .map((item) => item.id);
const actualOrder = roster.roles.map((role) => role.id);
const orderOk = packOrder.length === actualOrder.length
  && packOrder.every((id, index) => id === actualOrder[index]);
check('2g', '展示顺序 = 包里的角色枚举顺序', packOrder.join(' → '),
  orderOk ? actualOrder.join(' → ') : actualOrder.join(' → '), orderOk);

// 正文引用的本机文件必须真实存在，否则就是死链
const refMissing = [];
for (const role of roster.roles) {
  for (const ref of role.instruction.match(/`(\/[^`]+)`/g) ?? []) {
    const p = ref.slice(1, -1);
    if (!existsSync(p)) refMissing.push(`${role.id}→${p}`);
  }
}
check('2f', '正文引用的本机文件真实存在', '0 个死链',
  refMissing.length === 0 ? '0 个死链' : refMissing.join(', '), refMissing.length === 0);

// 权限：只读角色不得含可写工具
const permBad = roster.roles.filter((role) => {
  const hasWrite = role.tools.some((tool) => ['edit', 'write', 'bash'].includes(tool));
  return role.writable !== hasWrite;
});
check('2d', '权限判定与工具列表一致', '无矛盾',
  permBad.length === 0 ? '无矛盾' : permBad.map((r) => r.id).join(', '), permBad.length === 0);

// ── 3. 技能可用性：不得静默加载悬空技能 ────────────────────
const installed = new Set();
for (const root of [join(HOME, 'skills'), join(HOME, '..', '.agents/skills')]) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) installed.add(entry.name);
  }
}
const missingUsed = [];
for (const role of roster.roles) {
  for (const skill of role.autoloadSkills) {
    if (!installed.has(skill)) missingUsed.push(`${role.id}→${skill}`);
  }
}
check('3a', '自动加载技能全部可用', '0 个缺失',
  missingUsed.length === 0 ? '0 个缺失' : missingUsed.join(', '), missingUsed.length === 0);

// 悬空技能必须被显式报告，而不是静默加载
const reported = new Set();
for (const role of roster.roles) for (const s of role.danglingSkills ?? []) reported.add(`${role.id}→${s}`);
const expectedDangling = new Set(['frontend→react-page-implementation', 'code-review→branch-diff-static-review']);
const danglingMatch = reported.size === expectedDangling.size
  && [...expectedDangling].every((x) => reported.has(x));
check('3b', '两个缺失技能被显式报告且已解除绑定', 'frontend→react-page-implementation, code-review→branch-diff-static-review',
  [...reported].join(', ') || '(无)', danglingMatch);

const silentlyLoaded = [...reported].filter((item) => {
  const [roleId, skill] = item.split('→');
  const role = roster.roles.find((r) => r.id === roleId);
  return role.autoloadSkills.includes(skill);
});
check('3c', '悬空技能未被静默加载', '0 个',
  silentlyLoaded.length === 0 ? '0 个' : silentlyLoaded.join(', '), silentlyLoaded.length === 0);

// ── 4. 运行时证据：宿主实际落盘 ────────────────────────────
const rosterMd = join(HOME, 'team-workflow/roles.md');
if (existsSync(rosterMd)) {
  const text = readFileSync(rosterMd, 'utf8');
  const countOk = /角色名册（10 个）/.test(text);
  const hasDangling = /悬空技能/.test(text);
  check('4a', '宿主落盘名册为 10 个角色', '含「角色名册（10 个）」',
    countOk ? '命中' : '未命中', countOk);
  check('4b', '宿主落盘名册含悬空技能告警', '含「悬空技能」', hasDangling ? '命中' : '未命中', hasDangling);
} else {
  check('4a', '宿主落盘名册', '文件存在', '不存在（插件未激活？）', false);
}
check('4', 'roles.json 指纹', '记录用', `${rosterHash}（${roster.roles.length} 角色）`, true);

// ── 5. 交付文件里不得残留过时表述 ──────────────────────────
// 曾经踩过的坑：locale 描述还写着旧的 4 角色；来源机专属路径残留在文档里。
// 注：曾经这里还禁过 `spawn_teammate`（当时假设它是"本部署不存在的工具名"）。该假设已作废——
// 官方「智能体团队」启用后它确实存在，而且 2026-10-14 用户决定把团队角色的默认派发通路
// 改成它（见第 7 节）。禁的是「说错」，不是「提到官方工具名」。
const STALE = [
  ['pm / architect / backend / qa', '旧的 4 角色列表'],
  ['/Users/lmqhx', '来源机专属路径'],
];
const staleHits = [];
for (const file of readdirSync(pluginDir)) {
  if (!/\.(json|js|md|yml|sh)$/.test(file) || file === 'ACCEPTANCE.md') continue;
  const text = readFileSync(join(pluginDir, file), 'utf8');
  for (const [needle, what] of STALE) {
    if (text.includes(needle)) staleHits.push(`${file} 含${what}`);
  }
}
check('5', '交付文件无过时表述', '0 处',
  staleHits.length === 0 ? '0 处' : staleHits.join('；'), staleHits.length === 0);

// ── 6. 客户端卡片：坐标归属回归门 ──────────────────────────
// 背景（2026-10-14，两个阶段）：
//   ① 本插件曾自带一张页头卡片，是官方 @deepseek-ai/dsh-experimental-client-ui-agent-team
//      客户端 bundle 的逐字副本，只换文案与数据、没换身份 → 两边抢同一套坐标
//      （slot id "agent-team"、locale ns "agent-team"、CSS 前缀 "_2tNPVa_"、order -20）。
//      两个 apply 都是先 locale.register 后 slots.inject，于是第二个先在 locale 抛错；
//      客户端 entry 的 apply 一抛，Web 外壳启动激活审计就 throw，**整个 GUI 停在
//      "Failed to load plugins"**（用户实测确认）。当时的处置是把客户端半侧整体删掉。
//   ② 但删掉之后「官方插件一关，页头就没有本插件的入口」。于是改为**自有身份并存**：
//      生成器 _tools/build-client.js 产出 client.js，坐标全部归自己
//      （locale ns dsh-team-workflow / CSS _twf_ / order -20 / priority 100）。
// 所以本节的判据从「不许有 UI」升级为「UI 必须自有坐标」——约束的方向没变，
// 而且更准：它盯的正是当初真正出问题的东西（身份），而不是「有没有 UI」这个表象。
//
// 2026-10-14 修订（C3，用户裁决机制甲）：slot id **故意与官方相同**，靠 priority 遮蔽实现
// 「官方优先、本插件让位」。所以判定从「零处官方 slot id」改为「恰好一处，且只作为遮蔽常量」。
const EXPECTED = {
  // slot id 与官方相同是**有意的**（同槽位遮蔽），不列为自有坐标。
  officialSlotId: 'agent-team',
  shadowPriority: 100,
  localeNs: 'dsh-team-workflow',
  cssPrefix: '_twf_',
  order: -20,
  bundle: join(pluginDir, 'client.js'),
};
// 官方坐标——样式前缀与包名绝不允许出现在交付产物里；
// slot id 允许恰好出现一次（遮蔽用只读常量），见 6b。
const OFFICIAL = { slotId: 'agent-team', cssPrefix: '_2tNPVa_', pkg: '@deepseek-ai/dsh-experimental-client-ui-agent-team' };

/**
 * 取出产物里的样式表文本。
 * 现在外壳来自官方 bundle，CSS 常量叫 `css`（模块样式）+ `ROLE_CSS`（我们追加的几条），
 * 不再是自研版的 `CSS`，所以按变量名逐个取再拼接。
 */
function collectCss(text) {
  const parts = [];
  for (const name of ['css', 'ROLE_CSS', 'CSS']) {
    const m = new RegExp(`const ${name} = ("(?:[^"\\\\]|\\\\.)*");`).exec(text);
    if (m !== null) parts.push(JSON.parse(m[1]));
  }
  return parts.join('\n');
}

// 6a：客户端声明必须完整（少一样，卡片就不会被 boot 图收录）
const clientDecl = pkg.dsh?.client;
const clientExport = pkg.exports?.['./client'];
const clientInFiles = (pkg.files ?? []).includes('client.js');
const clientOnDisk = existsSync(EXPECTED.bundle);
const declOk =
  clientDecl !== undefined &&
  clientDecl.platform === 'web' &&
  clientExport !== undefined &&
  clientInFiles &&
  clientOnDisk;
check('6a', '客户端声明完整（dsh.client / ./client / files / 产物）', '四项齐全且 platform=web',
  `dsh.client=${clientDecl === undefined ? '(无)' : `platform=${clientDecl.platform}`}；` +
  `exports["./client"]=${clientExport === undefined ? '(无)' : '有'}；files 含 client.js=${clientInFiles}；磁盘存在=${clientOnDisk}`,
  declOk);

// 6b：官方标识不得被占用；官方 slot id 恰好一处（遮蔽常量）；自有坐标齐全
let bundleText = '';
try { bundleText = readFileSync(EXPECTED.bundle, 'utf8'); } catch { /* 6a 已报 */ }
const occupied = [];
// CSS 前缀与包名：任何位置的残留都说明补丁漏了（连"未加引号的提及"也算）。
if (bundleText.includes(OFFICIAL.cssPrefix)) occupied.push(`CSS 前缀 ${OFFICIAL.cssPrefix}`);
if (bundleText.includes(OFFICIAL.pkg)) occupied.push(`官方包名 ${OFFICIAL.pkg}`);
// slot id：C1 的遮蔽机制需要它，但必须恰好一处、且只作为只读常量——
// 一旦被当成自己的 locale ns 或模块 id，就会回到"第二个 apply 抛错"的老路。
const officialSlotHits = bundleText.split(`"${OFFICIAL.slotId}"`).length - 1;
if (officialSlotHits !== 1) {
  occupied.push(`官方 slot id 出现 ${officialSlotHits} 处（应为 1 处：只作遮蔽常量）`);
} else if (!bundleText.includes(`const OFFICIAL_SLOT_ID = "${OFFICIAL.slotId}";`)) {
  occupied.push('唯一那处官方 slot id 不在遮蔽常量里');
}
const ownCoordsOk =
  bundleText.includes(`"${EXPECTED.localeNs}"`) &&
  bundleText.includes(EXPECTED.cssPrefix) &&
  bundleText.includes('"@local/dsh-team-workflow"');
// 遮蔽机制的两个要件，缺一个 C1 就不成立
const shadowOk = bundleText.includes('priority: SHADOW_PRIORITY,') && bundleText.includes('catch (error)');
if (!shadowOk) occupied.push('遮蔽要件缺失（priority 或 try/catch 兜底）');
check('6b', '官方标识未被占用 + 自有坐标齐全 + 遮蔽要件在位',
  'CSS 前缀/包名 0 处；官方 slot id 恰好 1 处（遮蔽常量）；自有坐标齐全；priority + try/catch 在位',
  (occupied.length === 0 ? '全部满足' : `问题：${occupied.join('；')}`) +
  `；官方 slot id ${officialSlotHits} 处；自有坐标 ${ownCoordsOk ? '齐全' : '缺失'}；遮蔽要件 ${shadowOk ? '在位' : '缺失'}`,
  occupied.length === 0 && ownCoordsOk);

// 6c：生成器幂等——重跑后产物字节不变（防止手改产物、防止生成器漂移）
let idempotent = false;
let idempotentActual = '';
try {
  const before = createHash('sha256').update(bundleText).digest('hex');
  execFileSync(process.execPath, [join(here, 'build-client.js')], { stdio: 'pipe' });
  const after = createHash('sha256').update(readFileSync(EXPECTED.bundle, 'utf8')).digest('hex');
  idempotent = before === after;
  idempotentActual = idempotent ? `sha256 一致 ${before.slice(0, 16)}` : `重跑后变化：${before.slice(0, 12)} → ${after.slice(0, 12)}`;
} catch (error) {
  idempotentActual = `重跑生成器失败：${String(error.message).slice(0, 160)}`;
}
check('6c', '生成器幂等（产物可复现，不靠手改）', '重跑后 sha256 不变', idempotentActual, idempotent);

// 6d：载入**真实产物**，用**真实 SlotCore** 验证注册坐标与共存
const SLOTS_LIB = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js';
const SLOT_NAME = 'conversation.session.header.actions';
let registerOk = false;
let registerActual = '';
// 供 6f 渲染冒烟复用
let registeredComponent = null;
let shimPrimitives = null;
let shimReact = null;
// 供 6f/6h 复用：注册表、locale 注册表、注入过的槽位名，以及 C20.3 的 pluginNavigation / layout 桩。
// 提升到 try 之外是因为 6h 也要用它们（原来 registrations 等是 try 内的 const，外面取不到）。
let registrations = [];
let localeRegistrations = [];
let injectedSlots = [];
const navCalls = [];
const panelCalls = [];
let navStub = { openBundle: (name) => { navCalls.push(name); } };
const layoutStub = { selectPanel: (id) => { panelCalls.push(id); } };
let makeCtx = null;
let makeConfigScope = null;
let loadedModule = null;
let injectedActions = {};
try {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'dsh-slots-'));
  const libPath = join(tmpDir, 'slots.mjs');
  writeFileSync(libPath, execFileSync(process.execPath, [join(here, 'inspect-dsh-checkout.js'), 'get', SLOTS_LIB], { encoding: 'utf8' }));
  const { SlotCore } = await import(pathToFileURL(libPath).href);

  const freshCore = () => {
    const core = new SlotCore();
    core.registerFactory(
      { name: 'repro-parent', scope: 'root', children: { [SLOT_NAME]: { kind: 'list', scope: 'root' } } },
      () => null,
    );
    return core;
  };

  // —— 在 vm 里执行真实 bundle，只桩掉浏览器环境与 React ——
  /**
   * C21 的配置作用域桩：形状照官方 `ctx.configForms.get(id)` 的快照/订阅/写入 API
   * （`getSnapshot` / `subscribe` / `mutate`）。**这是桩**：官方 SettingsFormModel 内部的
   * op 编码（path/op/value）不在本门覆盖范围，本门验的是"我们的控制器确实按官方 API 形状读写"。
   */
  const makeConfigScopeImpl = () => {
    const scope = {
      mutateCalls: [],
      state: { value: {}, revision: 7, writable: true },
      listeners: new Set(),
      getSnapshot() { return { value: { ...scope.state.value }, revision: scope.state.revision, writable: scope.state.writable, mode: 'profile' }; },
      subscribe(listener) { scope.listeners.add(listener); return () => scope.listeners.delete(listener); },
      async mutate(ops, revision) { scope.mutateCalls.push({ ops, revision }); return true; },
      setValue(next) { scope.state.value = { ...next }; for (const listener of scope.listeners) listener(); },
    };
    return scope;
  };
  makeConfigScope = makeConfigScopeImpl;
  /** SettingsFormModel 桩：只实现官方类的公开形状（shell/field/actions/dispose）。 */
  class SettingsFormModelStub {
    constructor(scope, specs) {
      this.scope = scope;
      this.specs = new Map((specs ?? []).map((spec) => [spec.field, spec]));
      this.staged = new Map();
    }
    shell() {
      return { available: true, writable: this.scope.getSnapshot().writable !== false, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false };
    }
    field(name) {
      const spec = this.specs.get(name);
      const staged = this.staged.get(name);
      const value = this.scope.getSnapshot().value?.[name];
      if (staged === undefined) return { text: spec === undefined ? '' : spec.format(value), overridden: false, invalid: false };
      const parsed = spec.parse(staged);
      return { text: staged, overridden: parsed !== undefined && parsed.kind === 'set', invalid: parsed === undefined };
    }
    actions() {
      const self = this;
      return {
        edit: (field, text) => { self.staged.set(field, text); },
        resetField: (field) => { self.staged.delete(field); },
        async save() {
          const ops = [...self.staged].map(([field, text]) => {
            const parsed = self.specs.get(field).parse(text);
            return parsed.kind === 'clear' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: parsed.value };
          });
          self.staged.clear();
          return self.scope.mutate(ops, self.scope.getSnapshot().revision);
        },
        discard: () => { self.staged.clear(); },
      };
    }
    dispose() { this.disposed = true; }
  }
  let captured = null;
  const styleTags = [];
  const fakeDocument = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (tag) => styleTags.push(tag) },
  };
  const shims = {
    'react': { useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useLayoutEffect: () => {}, createElement: () => null, Fragment: {} },
    // 6f 要遍历元素树，所以 jsx/jsxs/createPortal 必须真的返回结构（不是 null）
    'react-dom': { createPortal: (child) => child },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@deepseek-ai/dsh-client-ui-primitives': {
      useAnchoredPosition: () => null, useDismissOnOutsidePointer: () => {},
      // 这几个原语也要"渲染"出 children，否则 6f 遍历到 Tooltip/Tag 就断了，看不到行内容
      StateDot: (props) => ({ type: 'twf-stub-statedot', props }),
      Tag: (props) => ({ type: 'twf-stub-tag', props }),
      Tooltip: (props) => ({ type: 'twf-stub-tooltip', props }),
      IconUserOutlineRegular: (props) => ({ type: 'twf-stub-icon', props }),
      IconUsersOutlineRegular: (props) => ({ type: 'twf-stub-icon', props }),
      // C21：官方浮层与表单原语。桩只负责"渲染出结构"，浮层语义（Esc/Tab/焦点归还）
      // 由官方 useModalLayer 负责——本门验的是"我们用的是官方原语，不是自己造的浮层"。
      Modal: (props) => ({ type: 'twf-stub-modal', props }),
      SettingsForm: (props) => ({ type: 'twf-stub-settingsform', props }),
      SettingsValueField: (props) => ({ type: 'twf-stub-settingsvalue', props }),
      Switch: (props) => ({ type: 'twf-stub-switch', props }),
      SettingsFormModel: SettingsFormModelStub,
    },
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (mod) => { captured = mod; } } },
    document: fakeDocument,
    setTimeout, clearTimeout, console, JSON, Symbol, Object, Array, String, Number, Boolean, Math, Date, RegExp, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(bundleText, sandbox, { filename: 'client.js' });

  loadedModule = captured === null ? null : captured.factory((name) => shims[name]);
  const loaded = loadedModule;
  registrations = [];
  localeRegistrations = [];
  injectedSlots = [];
  makeCtx = (slotOverrides = {}, services = {}) => ({
    effect: (fn) => { fn(); },
    ...services,
    locale: { register: (ns, dicts) => { localeRegistrations.push({ ns, locales: Object.keys(dicts) }); } },
    // C20.3：按钮经 ctx.reflect 懒取 pluginNavigation / layout（不加 inject，官方管理器缺席也要能激活）
    reflect: { get: (name) => (name === 'pluginNavigation' ? navStub : name === 'layout' ? layoutStub : undefined) },
    slots: {
      inject: (name, cb) => { injectedSlots.push(name); cb(); },
      register: (options, component) => { registrations.push({ options, component }); },
      ...slotOverrides,
    },
  });
  const ctx = makeCtx();
  loaded.apply(ctx);
  // 按槽位名取卡片，不按注册顺序取：C20.2 之后真实产物会注册第二个槽位（plugins.detail.section）。
  const cardRegistration = registrations.find((item) => item.options?.name === SLOT_NAME) ?? registrations[0];
  registeredComponent = cardRegistration?.component ?? null;
  shimPrimitives = shims['@deepseek-ai/dsh-client-ui-primitives'];
  shimReact = shims['react'];

  const reg = cardRegistration?.options ?? {};
  // C20.3：动作必须用**产物自己注入的**（inject: () => actions），不能由测试桩代填——
  // 桩代填就等于没测 bundle 里的 openPluginManager（懒取 ctx.reflect 那套）。
  injectedActions = typeof reg.inject === 'function' ? reg.inject() : {};
  const loc = localeRegistrations[0] ?? {};
  const declaredNamesOk = captured?.id === '@local/dsh-team-workflow';
  const coordinatesOk =
    reg.name === SLOT_NAME &&
    reg.id === EXPECTED.officialSlotId && // 同官方 id 是 C1 遮蔽的前提
    reg.order === EXPECTED.order &&
    reg.priority === EXPECTED.shadowPriority &&
    reg.locale === EXPECTED.localeNs && // locale ns 必须自有，否则与官方撞车
    loc.ns === EXPECTED.localeNs &&
    Array.isArray(loc.locales) && loc.locales.includes('zh') && loc.locales.includes('en');
  // 外壳要用到 sessions / uiWorkspace（官方同款 inject），自有的 slots / locale 也必须在
  const injectsOk =
    injectedSlots.includes(SLOT_NAME) &&
    Array.isArray(loaded.inject) &&
    ['slots', 'locale', 'sessions', 'uiWorkspace'].every((s) => loaded.inject.includes(s));

  // 真实 SlotCore：C1 的遮蔽语义（这才是"官方优先、本插件让位"的判据）
  //   ① 官方在场（默认 priority 0）+ 本插件（priority 100）→ 恰好 1 个胜出者，且是官方那条
  //   ② 官方缺席 → 本插件胜出（自动接管）
  //   ③ 加载顺序反转 → 官方照样胜出
  //   ④ 同 id 同 priority → 仍然抛错（证明这条判据本身没坏，也证明 try/catch 兜底有意义）
  const shadow = {};
  try {
    const core = freshCore();
    core.register({ name: SLOT_NAME, id: OFFICIAL.slotId, order: -20 }, () => 'OFFICIAL');
    core.register({ name: SLOT_NAME, id: reg.id, order: reg.order, priority: reg.priority }, () => 'MINE');
    const winners = core.entriesOfSlot(SLOT_NAME);
    shadow.officialWins = core.entries(SLOT_NAME).length === 2 && winners.length === 1 &&
      winners[0].options.priority === undefined;
  } catch { shadow.officialWins = false; }
  try {
    const core = freshCore();
    core.register({ name: SLOT_NAME, id: reg.id, order: reg.order, priority: reg.priority }, () => 'MINE');
    const winners = core.entriesOfSlot(SLOT_NAME);
    shadow.takeover = winners.length === 1 && winners[0].options.priority === reg.priority;
  } catch { shadow.takeover = false; }
  try {
    const core = freshCore();
    core.register({ name: SLOT_NAME, id: reg.id, order: reg.order, priority: reg.priority }, () => 'MINE');
    core.register({ name: SLOT_NAME, id: OFFICIAL.slotId, order: -20 }, () => 'OFFICIAL');
    const winners = core.entriesOfSlot(SLOT_NAME);
    shadow.orderFree = winners.length === 1 && winners[0].options.priority === undefined;
  } catch { shadow.orderFree = false; }
  let duplicateThrew = false;
  try {
    const core = freshCore();
    const row = { name: SLOT_NAME, id: OFFICIAL.slotId, order: -20 };
    core.register(row, () => null);
    core.register({ ...row }, () => null);
  } catch (error) {
    duplicateThrew = /already has an entry with id/.test(String(error.message));
  }
  const shadowOk = shadow.officialWins && shadow.takeover && shadow.orderFree && duplicateThrew;

  // ⑤ 让位兜底的**行为**（不只是文本）：官方若用同 id 同 priority 占位，register 会抛错，
  //    apply 必须把它吃掉并让位——绝不能冒出去（冒出去 = 整个 GUI 停在 Failed to load plugins）。
  let standDownOk = false;
  let standDownDetail = '';
  try {
    const dupError = new Error(`list slot "${SLOT_NAME}" already has an entry with id "${OFFICIAL.slotId}"`);
    const failingCtx = makeCtx({ register: () => { throw dupError; } });
    loaded.apply(failingCtx); // 不抛错才算兜住
    standDownOk = true;
    standDownDetail = 'apply 未抛错（已让位）';
  } catch (error) {
    standDownDetail = `apply 抛错：${String(error.message).slice(0, 80)}`;
  }

  registerOk =
    declaredNamesOk && coordinatesOk && injectsOk && shadowOk && standDownOk && styleTags.length === 1;
  registerActual =
    `模块 id 正确=${declaredNamesOk}；坐标正确=${coordinatesOk}（id=${reg.id} order=${reg.order} priority=${reg.priority} ns=${loc.ns} locale=${(loc.locales ?? []).join('/')}）；` +
    `inject 齐全=${injectsOk}；注入样式表=${styleTags.length} 个；` +
    `遮蔽：官方在场仅官方胜出=${shadow.officialWins} / 官方缺席本插件接管=${shadow.takeover} / 加载顺序无关=${shadow.orderFree} / 同 priority 仍抛错=${duplicateThrew}；` +
    `让位兜底：${standDownDetail}`;
} catch (error) {
  registerActual = `载入真实产物失败：${String(error.message).slice(0, 220)}`;
}
check('6d', '真实产物在真实 SlotCore 上注册（遮蔽语义：官方优先 / 缺席接管 / 顺序无关 / 兜底有意义）',
  '全部为真', registerActual, registerOk);

// 6e：CSS 选择器必须是合法类选择器且带自有前缀。
// 背景（用户实测「样式完全不对、展不开」）：上一版把 CSS 拼成 `${CSS_PREFIX}root{...}`，
// 产物里是 `_twf_root{...}`——**元素选择器**（去找 <_twf_root> 标签），不是类选择器。
// 21 条规则全部失效：面板丢掉 position:fixed（useAnchoredPosition 给的 left/top 全废）、
// z-index 与背景也没了，还量不到尺寸、一直停在 visibility:hidden 兜底态。
// 这一项盯的就是这个失败模式：每条选择器都必须以「. + 自有前缀」开头。
let cssOk = false;
let cssActual = '';
{
  const css = collectCss(bundleText);
  if (css === '') {
    cssActual = '产物里找不到样式表常量（css / ROLE_CSS）';
  } else {
    const bad = [];
    let buf = '';
    for (const ch of css) {
      if (ch === '{') {
        const prelude = buf.trim();
        buf = '';
        if (!prelude.startsWith('@')) {
          for (const raw of prelude.split(',')) {
            const sel = raw.trim();
            if (!sel.startsWith(`.${EXPECTED.cssPrefix}`) || !/^\.[A-Za-z_][\w-]*/.test(sel)) bad.push(sel);
          }
        }
      } else if (ch === '}') {
        buf = '';
      } else {
        buf += ch;
      }
    }
    const ruleCount = (css.match(/\{/g) ?? []).length;
    cssOk = bad.length === 0 && ruleCount > 0 && !css.includes('$');
    cssActual = bad.length > 0
      ? `非法/越界选择器：${bad.slice(0, 4).join('、')}${bad.length > 4 ? ` 等共 ${bad.length} 条` : ''}`
      : `选择器 ${ruleCount} 条全部合法且带前缀 ${EXPECTED.cssPrefix}`;
  }
}
check('6e', 'CSS 选择器合法且全部带自有前缀', '0 处非法选择器', cssActual, cssOk);

// 6f：渲染冒烟——把组件**真的渲染一遍**（桩 React 记录元素树），检查三件事：
//   ① 名册真的渲染出 10 行（不是空壳）
//   ② 面板保留了"悬停保活"接线：面板自己必须有 onMouseEnter/onMouseLeave。
//      面板是 portal 到 document.body 的、不在 rootRef 里；漏了这两个 handler，
//      鼠标从按钮移向面板会先触发 root 的 onMouseLeave 把面板关掉——用户看到的就是
//      "点不开 / 闪一下就没"（2026-10-14 实测症状之一）。
//   ③ 渲染树里用到的每一个 class 都必须在 CSS 里有对应规则（防止类名漂移）
//   ④ position 为 null 时必须退到 visibility:hidden 兜底（不能把 left/top 悬空）
let renderOk = false;
let renderActual = '';
{
  const fail = [];
  try {
    if (registeredComponent === null) throw new Error('6d 没拿到组件，无法渲染');
    // class 集合只从**样式表**取（不以 class map 为准），这样"有类名没规则"才会被抓到
    const cssClasses = new Set(
      (collectCss(bundleText).match(/\._twf_[A-Za-z_][\w-]*/g) ?? []).map((s) => s.slice(1)),
    );
    // open=true（组件里唯一的 useState 就是 open）
    shimReact.useState = () => [true, () => {}];
    const positionStub = { left: 12, top: 34, width: 300 };
    shimPrimitives.useAnchoredPosition = () => positionStub;

    const seenClasses = new Set();
    const seenTags = [];
    const tKeys = [];
    const openCalls = [];
    const clickable = [];
    let rowCount = 0;
    let panelProps = null;
    let dialogFound = false;
    // C5.1/C20 取证：按 class 收集节点、Tooltip 与 Tag 的 props 也要看
    const byClass = new Map();
    const tooltips = [];
    const tags = [];
    const plainText = (node, out = []) => {
      if (node === null || node === undefined) return out;
      if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
      if (Array.isArray(node)) { for (const child of node) plainText(child, out); return out; }
      if (typeof node !== 'object') return out;
      plainText(node.props?.children, out);
      return out;
    };
    const findButtonIn = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const child of node) { const hit = findButtonIn(child); if (hit !== null) return hit; } return null; }
      if (node.type === 'button') return node.props;
      if (typeof node.type === 'function') return findButtonIn(node.type(node.props));
      if (typeof node.type !== 'string') return findButtonIn(node.props?.children);
      if (node.type === 'twf-stub-tooltip' || node.type === 'twf-stub-tag' || node.type === 'twf-stub-icon' || node.type === 'twf-stub-statedot') return findButtonIn(node.props?.children);
      return findButtonIn(node.props?.children);
    };

    // 喂进真实形状的 agentTeam 投影：qa 在跑（active+running）、pm-2 准备中（provisioning）、
    // 其余未派发。这样才能验证三件事：状态词、C7 的点击、以及"未派发不可点"。
    const projection = {
      projectionsBySession: {
        'session-under-test': {
          values: {
            agentTeam: {
              members: [
                { id: 'teammate-qa', name: 'qa', phase: 'active' },
                { id: 'teammate-pm', name: 'pm-2', phase: 'provisioning' },
              ],
              // C20.4：官方任务板与失败横幅的数据源（以前 workflowRoster 写死 tasks: [] 且不传 failure，
              // 官方的任务卡与失败横幅因此永远不出现）
              tasks: [
                {
                  id: 'task-1',
                  subject: '共享任务板透传官方投影',
                  description: '把 agentTeam 投影里的 tasks 原样交给官方任务卡渲染，空态用官方原文。',
                  status: 'in_progress',
                  ownerName: 'backend',
                  ready: true,
                  blockedBy: [],
                  writeScopes: ['dsh-team-plugin/client.js'],
                  writeScopeWarnings: [],
                },
              ],
              failure: 'persisted record rejected（6f 探针）',
            },
          },
        },
      },
      byId: {},
    };
    const propsFor = () => ({
      ...injectedActions,
      sessionId: 'session-under-test',
      useSession: (selector) => selector({}),
      useSessions: (selector) => selector(projection),
      useSessionStatus: (selector) => selector({ get: (id) => (id === 'teammate-qa' ? { running: true } : undefined) }),
      openTeammate: (...args) => { openCalls.push(args); },
      t: (key) => { tKeys.push(key); return key; },
    });

    const visit = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) visit(child); return; }
      const { type, props } = node;
      if (props === undefined) return;
      const classes = props.className === undefined ? [] : String(props.className).split(/\s+/).filter((c) => c !== '');
      if (classes.includes(`${EXPECTED.cssPrefix}panel`)) panelProps = props;
      for (const cls of classes) {
        seenClasses.add(cls);
        const bucket = byClass.get(cls) ?? [];
        bucket.push({ type, props });
        byClass.set(cls, bucket);
      }
      if (type === 'twf-stub-tooltip') tooltips.push(props);
      if (type === 'twf-stub-tag') tags.push(props);
      // C21.1：卡片树里必须挂着自有配置弹窗元素（按钮切换的就是它）
      if (typeof type === 'function' && type.name === 'TeamWorkflowConfigDialog') dialogFound = true;
      // 子组件（角色行）是函数：调用它，才能验证行内容的渲染路径
      if (typeof type === 'function' && type !== registeredComponent) {
        if (props.member !== undefined) {
          rowCount += 1;
          const rendered = type(props);
          clickable.push({ member: props.member, node: rendered });
          visit(rendered);
          return;
        }
        visit(type(props));
        return;
      }
      if (typeof type === 'string') seenTags.push(type);
      visit(props.children);
    };
    visit(registeredComponent(propsFor()));

    if (rowCount !== 10) fail.push(`名册渲染出 ${rowCount} 行（应为 10）`);
    if (panelProps === null) fail.push('面板元素未渲染');
    else {
      if (typeof panelProps.onMouseEnter !== 'function') fail.push('面板缺 onMouseEnter（悬停保活）');
      if (typeof panelProps.onMouseLeave !== 'function') fail.push('面板缺 onMouseLeave（悬停保活）');
      if (panelProps.style !== positionStub) fail.push('面板 style 未接上 useAnchoredPosition 的结果');
    }
    for (const cls of seenClasses) if (!cssClasses.has(cls)) fail.push(`class ${cls} 在 CSS 里没有规则`);
    if (!seenTags.includes('button')) fail.push('没有渲染出 button 触发点');

    // D2(a)(b)：状态词必须覆盖"在运行"与"未派发"
    if (!tKeys.includes('memberStatus.running')) fail.push('没有渲染出"运行中"状态词（D2 a）');
    if (!tKeys.includes('memberStatus.unassigned')) fail.push('没有渲染出"未派发"状态词（D2 b）');
    if (!tKeys.includes('memberStatus.provisioning')) fail.push('没有渲染出"准备中"状态词');
    // C5.1（用户 2026-10-14 第二次裁决）：行内只允许五项。
    // 「产物 / 边界 / 能力 / 技能 / 悬空技能」已迁到 6h 的插件管理详情区块——卡片里再出现即为越界。
    for (const moved of ['outputs', 'boundaries', 'capability', 'skills', 'dangling']) {
      if (tKeys.includes(moved)) fail.push('卡片里又出现了已迁走的「' + moved + '」（C5.1 行内只留五项）');
    }
    // 五项都要真的渲染出来：状态点 / 中文名 / 角色 id Tag / 状态词 / 职责
    for (const row of clickable) {
      const text = plainText(row.node).join(' ');
      if (!text.includes(row.member.duty)) fail.push('角色行没有渲染出职责简述（' + row.member.id + '，C5.1）');
      if (text.includes(row.member.boundaries)) fail.push('角色行里还有边界（' + row.member.id + '，C5.1）');
      if (text.includes(row.member.outputs.join(' · '))) fail.push('角色行里还有产物（' + row.member.id + '，C5.1）');
    }
    const rowIds = clickable.map((row) => row.member.id).sort();
    const tagTexts = tags.map((props) => props.children).sort();
    if (JSON.stringify(rowIds) !== JSON.stringify(tagTexts)) {
      fail.push('Tag 显示的不是角色 id：' + JSON.stringify(tagTexts) + '（C5.1 第三项）');
    }
    // C5.1：悬停提示固定为官方那句「打开成员会话」（可点击的行才给提示，与官方 disabled 语义一致）
    const openableTips = tooltips.filter((props) => props.disabled !== true);
    if (openableTips.length !== 1 || openableTips.some((props) => props.label !== 'open')) {
      fail.push('可点击行的悬停文案不是「打开成员会话」：' + JSON.stringify(openableTips.map((props) => props.label)));
    }
    if (tooltips.some((props) => String(props.label).indexOf('skills') >= 0)) {
      fail.push('悬停文案里还拼着技能信息（C5.1 要求固定官方原文）');
    }
    // D2(d) + C20.3 改写 + C21.1：顶部状态必须是卡片，右侧按钮打开**自有配置弹窗**（不再跳官方页）
    if (!tKeys.includes('pluginStatus')) fail.push('面板缺本插件状态（D2 d）');
    if (!tKeys.includes('configButton')) fail.push('状态卡片上没有「配置」按钮（C20.3 改写 + C21.1）');
    if (!dialogFound) fail.push('卡片树里没有配置弹窗元素（C21.1：按钮点了不会开弹窗）');
    const statusCards = byClass.get(EXPECTED.cssPrefix + 'statusCard') ?? [];
    if (statusCards.length !== 1) {
      fail.push('状态卡片渲染了 ' + statusCards.length + ' 个（应为 1：C20.3 要求卡片而不是一行纯文字）');
    } else {
      const cardButton = findButtonIn(statusCards[0]);
      if (cardButton === null || cardButton.disabled === true || typeof cardButton.onClick !== 'function') {
        fail.push('状态卡片里没有可用的「配置」按钮（C20.3 改写 + C21.1）');
      } else {
        const navBefore = navCalls.length;
        cardButton.onClick();
        if (navCalls.length !== navBefore) {
          fail.push('「配置」按钮直接跳了官方插件管理页（C20.3 改写要求它打开自有弹窗）');
        }
      }
    }
    // C20.4：官方任务板必须真渲染（透传投影的 tasks），失败横幅也要透传
    if (!seenClasses.has(EXPECTED.cssPrefix + 'task')) fail.push('任务板没有渲染出任务卡（tasks 没透传，C20.4）');
    if (!tKeys.includes('tasks')) fail.push('任务板没有渲染出「共享任务」段（C20.4）');
    if (!tKeys.includes('failure')) fail.push('投影里的 failure 没有透传到官方失败横幅（C20.4）');

    // C7：可点击的行必须真的能点击，并且调用官方同一入口 openTeammate
    const findButton = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const c of node) { const r = findButton(c); if (r) return r; } return null; }
      const { type, props } = node;
      if (props === undefined) return null;
      if (type === 'button') return props;
      if (typeof type === 'function' && type !== registeredComponent) return findButton(type(props));
      if (type === 'twf-stub-tooltip' || type === 'twf-stub-tag' || type === 'twf-stub-icon' || type === 'twf-stub-statedot') return findButton(props.children);
      return findButton(props.children);
    };
    const clickableRows = clickable.filter(({ node }) => {
      const b = findButton(node);
      return b !== null && typeof b.onClick === 'function' && b.disabled !== true;
    });
    if (clickableRows.length !== 1) {
      fail.push(`可点击行 ${clickableRows.length} 个（应为 1：只有 qa 在 active+running）`);
    } else {
      const b = findButton(clickableRows[0].node);
      b.onClick();
      const call = openCalls[0];
      if (openCalls.length !== 1 || call?.[0] !== 'session-under-test' || call?.[1] !== 'teammate-qa') {
        fail.push(`点击没有按官方入口调用 openTeammate(sessionId, 成员会话 id)：${JSON.stringify(openCalls)}`);
      }
    }
    // 未派发的行必须禁用（没有可打开的成员会话，点了只会报错）
    const unassigned = clickable.filter(({ member }) => member.liveId === undefined);
    const wronglyEnabled = unassigned.filter(({ node }) => {
      const b = findButton(node);
      return b !== null && b.disabled !== true;
    });
    if (wronglyEnabled.length > 0) fail.push(`有 ${wronglyEnabled.length} 个未派发行却是可点的`);

    // 兜底：position 为 null 时必须隐藏而不是错位
    shimPrimitives.useAnchoredPosition = () => null;
    let hiddenProps = null;
    const visit2 = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) visit2(child); return; }
      const { type, props } = node;
      if (props === undefined) return;
      if (props.className !== undefined && String(props.className).split(/\s+/).includes(`${EXPECTED.cssPrefix}panel`)) hiddenProps = props;
      if (typeof type === 'function' && type !== registeredComponent) { visit2(type(props)); return; }
      visit2(props.children);
    };
    visit2(registeredComponent(propsFor()));
    if (hiddenProps === null || hiddenProps.style?.visibility !== 'hidden') {
      fail.push('position 为 null 时没有退到 visibility:hidden 兜底');
    }

    renderOk = fail.length === 0;
    renderActual = fail.length === 0
      ? `名册 10 行且每行恰为五项（状态点/中文名/角色 id Tag/状态词/职责，悬停固定「打开成员会话」）；`
        + `qa 运行中可点击→openTeammate；pm-2 准备中；其余未派发禁用；状态卡片 + 「配置」按钮（开自有弹窗，不跳官方页）；`
        + `任务板透传 tasks/failure；面板悬停接线齐全；${seenClasses.size} 个 class 全部命中 CSS；位置兜底正确`
      : fail.join('；');
  } catch (error) {
    renderActual = `渲染抛错：${String(error.message).slice(0, 200)}`;
  }
}
check('6f', '渲染冒烟（C5.1 五项行 + 悬停官方原文 + C7 点击进详情 + C20.3 状态卡片与自有弹窗 + C20.4 任务板 + class 对齐 + 位置兜底）',
  '全部通过', renderActual, renderOk);

// 6i：C21 —— 自有配置弹窗。把弹窗**真的渲染一遍**并驱动读写：
//   ① 用的是官方原语（Modal / SettingsForm / SettingsValueField / Switch），不是自造浮层
//   ② 六个字段齐全、标签全部走本地化键
//   ③ 值来自 ctx.configForms 的快照 + C21.2 默认值；保存走到官方作用域的 mutate（单一真源）
//   ④ 服务抛错或缺席时必须降级成"不可写"，且绝不抛异常
//   ⑤ 官方入口保留为弹窗内的次级链接（C20.3 改写后降级）
// 诚实边界：SettingsFormModel 是**桩**（形状照官方公开 API）；官方类内部的 op 编码
// （path/op/value）不在本门范围内——本门验的是"我们的控制器按官方 API 形状读写"。
let configDialogOk = false;
let configDialogActual = '';
await (async () => {
  const fail = [];
  try {
    if (typeof makeConfigScope !== 'function') throw new Error('配置作用域桩未就绪');
    const scope = makeConfigScope();
    // 作用域只有两个字段：其余四个必须落回 C21.2 的默认值
    scope.state.value = { showTaskBoard: false, autoloadSkills: false };
    let askedId = null;
    const ctx = makeCtx({}, { configForms: { get: (id) => { askedId = id; return scope; } } });
    loadedModule.apply(ctx);
    const cards = registrations.filter((item) => item.options?.name === SLOT_NAME);
    const reg = cards[cards.length - 1];
    if (reg === undefined) throw new Error('第二次 apply 没有注册卡片');
    if (askedId !== 'team-workflow') fail.push(`客户端没有按条目 id team-workflow 取配置（实际 ${String(askedId)}）`);
    const actions = typeof reg.options.inject === 'function' ? reg.options.inject() : {};
    const config = actions.config;
    if (config === undefined) throw new Error('inject 里没有 config 把手');
    const snapshot = config.snapshot();
    if (snapshot.value?.showTaskBoard !== false) fail.push('快照没有读到作用域里的 showTaskBoard=false');
    if (snapshot.value?.routeGuard !== true) fail.push('缺省字段没有落回 C21.2 默认值（routeGuard 应为 true）');
    if (snapshot.writable !== true) fail.push('可写状态没有从作用域透出');

    const prevUseState = shimReact.useState;
    shimReact.useState = (init) => [typeof init === 'function' ? init() : init, () => {}];
    const seen = [];
    const walk = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) walk(child); return; }
      const { type, props } = node;
      if (props === undefined) return;
      if (typeof type === 'function') { walk(type(props)); return; }
      seen.push({ type, props });
      walk(props.children);
    };
    try {
      const tree = reg.component({
        ...actions,
        sessionId: 'session-under-test',
        useSession: (selector) => selector({}),
        useSessions: (selector) => selector({ projectionsBySession: {}, byId: {} }),
        useSessionStatus: (selector) => selector({ get: () => undefined }),
        t: (key) => key,
      });
      let dialogNode = null;
      const findDialog = (node) => {
        if (dialogNode !== null || node === null || node === undefined || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) findDialog(child); return; }
        const { type, props } = node;
        if (props === undefined) return;
        if (typeof type === 'function' && type.name === 'TeamWorkflowConfigDialog') { dialogNode = node; return; }
        if (typeof type === 'function') { findDialog(type(props)); return; }
        findDialog(props.children);
      };
      findDialog(tree);
      if (dialogNode === null) throw new Error('卡片树里没有配置弹窗元素（按钮点了不会开弹窗）');
      walk(dialogNode.type({ ...dialogNode.props, open: true }));
    } finally {
      shimReact.useState = prevUseState;
    }

    const stubs = (name) => seen.filter((node) => node.type === name);
    const modal = stubs('twf-stub-modal')[0];
    if (modal === undefined) fail.push('弹窗没有用官方 Modal（C21.1：自造浮层会丢 Esc/Tab/焦点纪律）');
    else {
      if (modal.props.open !== true) fail.push('Modal 的 open 不是 true');
      if (modal.props.title !== 'configTitle') fail.push('Modal 标题不是本地化键 configTitle');
      if (modal.props.closeLabel !== 'configClose') fail.push('Modal 关闭标签不是本地化键 configClose');
      if (typeof modal.props.onClose !== 'function') fail.push('Modal 没有 onClose（关不掉）');
      else modal.props.onClose();
    }
    const form = stubs('twf-stub-settingsform')[0];
    if (form === undefined) fail.push('弹窗没有用官方 SettingsForm（C21.1）');
    else {
      for (const key of ['unavailable', 'readOnly', 'saveFailed', 'save', 'saving']) {
        if (form.props.labels?.[key] === undefined) fail.push(`SettingsForm 缺 labels.${key}`);
      }
      for (const key of ['available', 'writable', 'dirty', 'invalid', 'saving', 'failed']) {
        if (form.props.state?.[key] === undefined) fail.push(`SettingsForm 缺 state.${key}`);
      }
      if (typeof form.props.onSave !== 'function' || typeof form.props.onDiscard !== 'function') {
        fail.push('SettingsForm 没有保存/放弃动作');
      }
    }
    const switches = stubs('twf-stub-switch');
    const expectedSwitchKeys = ['cfgAutoloadSkills', 'cfgRouteGuard', 'cfgShowTaskBoard', 'cfgHideUnassignedRoles', 'cfgForceCompactPanel'];
    if (switches.length !== expectedSwitchKeys.length) {
      fail.push(`布尔开关 ${switches.length} 个（应为 ${expectedSwitchKeys.length}）`);
    }
    for (const key of expectedSwitchKeys) {
      if (!switches.some((node) => node.props.label === key)) fail.push(`弹窗缺开关「${key}」`);
    }
    for (const node of switches) {
      if (typeof node.props.onChange !== 'function') fail.push(`开关 ${String(node.props.label)} 不能改（没有 onChange）`);
    }
    const checkedOf = (key) => switches.find((node) => node.props.label === key)?.props.checked;
    if (checkedOf('cfgShowTaskBoard') !== false) fail.push('showTaskBoard 开关没有反映作用域里的 false');
    if (checkedOf('cfgAutoloadSkills') !== false) fail.push('autoloadSkills 开关没有反映作用域里的 false');
    if (checkedOf('cfgRouteGuard') !== true) fail.push('routeGuard 开关没有落回默认 true');
    if (checkedOf('cfgHideUnassignedRoles') !== false) fail.push('hideUnassignedRoles 开关没有落回默认 false');
    if (checkedOf('cfgForceCompactPanel') !== false) fail.push('forceCompactPanel 开关没有落回默认 false');
    const valueField = stubs('twf-stub-settingsvalue')[0];
    if (valueField === undefined) fail.push('弹窗缺 disabledRoles 输入控件');
    else {
      if (valueField.props.label !== 'cfgDisabledRoles' || valueField.props.hint !== 'cfgDisabledRolesHint') {
        fail.push('disabledRoles 控件的标签/提示不是本地化键');
      }
      if (typeof valueField.props.onEdit !== 'function' || typeof valueField.props.onReset !== 'function') {
        fail.push('disabledRoles 控件不能编辑/重置');
      }
    }
    const link = seen.find((node) => node.type === 'button' && node.props.children === 'configOpenManager');
    if (link === undefined) fail.push('弹窗里没有「在插件管理页中查看」次级链接（官方入口被删了）');
    else if (typeof link.props.onClick !== 'function') {
      fail.push('次级链接命中的元素没有 onClick（弹窗里的官方入口点不动）');
    }
    else {
      const before = navCalls.length;
      link.props.onClick();
      if (navCalls.length !== before + 1 || navCalls[navCalls.length - 1] !== '@local/dsh-team-workflow') {
        fail.push(`次级链接没有经 pluginNavigation.openBundle 打开本包：${JSON.stringify(navCalls)}`);
      }
    }
    // 写路径：edit → save 必须走到官方作用域的 mutate
    config.edit('routeGuard', 'false');
    await config.save();
    if (scope.mutateCalls.length !== 1) {
      fail.push(`保存没有调用官方作用域的 mutate（C21.3 单一真源断了）：${scope.mutateCalls.length} 次`);
    }
    // 展示层三个字段必须**行为上**生效（只验"源码里有字段名"是假门）
    {
      const displayScope = makeConfigScope();
      displayScope.state.value = { hideUnassignedRoles: true, showTaskBoard: false, forceCompactPanel: true };
      loadedModule.apply(makeCtx({}, { configForms: { get: () => displayScope } }));
      const list = registrations.filter((item) => item.options?.name === SLOT_NAME);
      const displayReg = list[list.length - 1];
      const displayActions = typeof displayReg.options.inject === 'function' ? displayReg.options.inject() : {};
      const prevUseState2 = shimReact.useState;
      // 前三个 useState 是 open / configOpen / error：要 true 才会渲染面板（同 6f 的做法）；
      // 之后的（useConfigView 里的函数式初值）必须真的求值，否则读不到作用域里的配置。
      let stateCall = 0;
      shimReact.useState = (init) => {
        stateCall += 1;
        if (stateCall <= 3) return [true, () => {}];
        return [typeof init === 'function' ? init() : init, () => {}];
      };
      const displayKeys = [];
      const displayClasses = new Set();
      let displayRows = 0;
      const walk2 = (node) => {
        if (node === null || node === undefined || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) walk2(child); return; }
        const { type, props } = node;
        if (props === undefined) return;
        for (const cls of String(props.className ?? '').split(/\s+/).filter((c) => c !== '')) displayClasses.add(cls);
        if (props.member !== undefined) displayRows += 1;
        if (typeof type === 'function') { walk2(type(props)); return; }
        walk2(props.children);
      };
      try {
        walk2(displayReg.component({
          ...displayActions,
          sessionId: 'session-under-test',
          useSession: (selector) => selector({}),
          useSessions: (selector) => selector({
            projectionsBySession: {
              'session-under-test': {
                values: {
                  agentTeam: {
                    members: [{ id: 'teammate-qa', name: 'qa', phase: 'active' }],
                    tasks: [{ id: 'task-1', subject: 'x', description: 'y', status: 'in_progress', ownerName: 'qa', ready: true, blockedBy: [], writeScopes: [], writeScopeWarnings: [] }],
                  },
                },
              },
            },
            byId: {},
          }),
          useSessionStatus: (selector) => selector({ get: () => undefined }),
          t: (key) => { displayKeys.push(key); return key; },
        }));
      } finally {
        shimReact.useState = prevUseState2;
      }
      if (displayRows !== 1) fail.push(`hideUnassignedRoles=true 时名册渲染 ${displayRows} 行（应只留 1 个已派发角色）`);
      if (displayKeys.includes('tasks') || displayKeys.includes('empty')) {
        fail.push('showTaskBoard=false 时任务板仍然渲染（字段是死的）');
      }
      if (!displayClasses.has(EXPECTED.cssPrefix + 'panelCompact')) {
        fail.push('forceCompactPanel=true 时面板没有加紧凑类（字段是死的）');
      }
    }
    // 降级：抛错 / 服务缺席
    for (const [label, services] of [
      ['configForms.get 抛错', { configForms: { get: () => { throw new Error('boom'); } } }],
      ['configForms 缺席', {}],
    ]) {
      let degraded;
      try {
        loadedModule.apply(makeCtx({}, services));
        const list = registrations.filter((item) => item.options?.name === SLOT_NAME);
        degraded = list[list.length - 1];
      } catch (error) {
        fail.push(`${label} 时 apply 抛错：${String(error.message).slice(0, 120)}`);
        continue;
      }
      let badSnapshot;
      try {
        const badConfig = (typeof degraded.options.inject === 'function' ? degraded.options.inject() : {}).config;
        badSnapshot = badConfig.snapshot();
      } catch (error) {
        fail.push(`${label} 时取快照抛错：${String(error.message).slice(0, 120)}`);
        continue;
      }
      if (badSnapshot.available !== false || badSnapshot.writable !== false) {
        fail.push(`${label} 时没有降级成"不可写"`);
      }
      if (badSnapshot.value?.routeGuard !== true) fail.push(`${label} 时没有落回默认值（会改变现有行为）`);
    }
    configDialogOk = fail.length === 0;
    configDialogActual = fail.length === 0
      ? '按钮打开自有弹窗：官方 Modal + SettingsForm + SettingsValueField + 5 个 Switch；六字段标签全走本地化键；'
        + '值与可写状态来自 ctx.configForms(get("team-workflow"))并落回 C21.2 默认值；保存走到作用域 mutate；'
        + '服务抛错/缺席时降级为「不可写」且不抛异常；官方入口保留为弹窗内次级链接'
      : fail.join('；');
  } catch (error) {
    configDialogActual = `渲染或驱动抛错：${String(error.message).slice(0, 200)}`;
  }
})();
check('6i', '自有配置弹窗（C21.1 官方原语 + C21.2 六字段 + C21.3 单一真源与降级）', '全部通过', configDialogActual, configDialogOk);

// 6h：C20 —— 插件管理页的呈现（locale meta 一句话 + plugins.detail.section 详情区块）与入口
//      （状态卡片按钮 → pluginNavigation.openBundle；服务缺席时降级 layout.selectPanel）。
let pluginPageOk = false;
let pluginPageActual = '';
{
  const fail = [];
  const detailCssClasses = new Set(
    (collectCss(bundleText).match(/\._twf_[A-Za-z_][\w-]*/g) ?? []).map((s) => s.slice(1)),
  );
  // 降级路径要重新渲染一次卡片，所以自带一份最小 props
  const propsForFallback = () => ({
    ...injectedActions,
    sessionId: 'session-under-test',
    useSession: (selector) => selector({}),
    useSessions: (selector) => selector({ projectionsBySession: {}, byId: {} }),
    useSessionStatus: (selector) => selector({ get: () => undefined }),
    openTeammate: () => {},
    t: (key) => key,
  });
  try {
    // ① C20.1：locale meta 必须是一句话，结构化内容不得再塞进描述
    const zh = JSON.parse(readFileSync(join(pluginDir, 'locale/zh.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(pluginDir, 'locale/en.json'), 'utf8'));
    const zhDesc = String(zh.meta?.description ?? '');
    const enDesc = String(en.meta?.description ?? '');
    if (zh.meta?.title !== 'Agent 团队工作流' || en.meta?.title !== 'Agent Team Workflow') fail.push('meta 标题被改动了');
    if (zhDesc.length === 0 || zhDesc.length > 90) fail.push('zh meta 描述 ' + zhDesc.length + ' 字（C20.1 要求一句话，≤90）');
    if (/工件链|零依赖|无门控/.test(zhDesc)) fail.push('zh meta 描述里还塞着结构化内容（C20.1）');
    if (enDesc.length === 0 || enDesc.length > 180) fail.push('en meta 描述 ' + enDesc.length + ' 字符（C20.1 要求一句话，≤180）');

    // ② C20.2：详情区块坐标 + subject 门控 + 承载内容
    const detail = registrations.find((item) => item.options?.name === 'plugins.detail.section');
    if (detail === undefined) {
      fail.push('没有注册 plugins.detail.section（C20.2 的详情区块缺失）');
    } else {
      if (detail.options.id !== 'team-workflow-roles') fail.push('详情区块 id=' + detail.options.id + '（应为 team-workflow-roles）');
      if (detail.options.locale !== EXPECTED.localeNs) fail.push('详情区块 locale ns=' + detail.options.locale + '（应为自有 ns）');
      if (typeof detail.component !== 'function') throw new Error('详情区块组件不是函数');
      const keys = [];
      const texts = [];
      const classCount = new Map();
      const walk = (node) => {
        if (node === null || node === undefined) return;
        if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
        if (Array.isArray(node)) { for (const child of node) walk(child); return; }
        if (typeof node !== 'object') return;
        for (const cls of String(node.props?.className ?? '').split(/\s+/).filter((c) => c !== '')) {
          classCount.set(cls, (classCount.get(cls) ?? 0) + 1);
        }
        walk(node.props?.children);
      };
      const t = (key) => { keys.push(key); return key; };
      // 别人的页面：一律返回 null，绝不在别处插内容
      const foreign = [
        { kind: 'bundle', pkg: { name: '@deepseek-ai/dsh-base', installed: true, enabled: true, rows: [] } },
        { kind: 'item', id: 'settings' },
        { kind: 'row', pkg: { name: '@local/dsh-team-workflow', rows: [] }, row: { rowId: 'x', moduleName: '@local/dsh-team-workflow', enabled: true } },
      ];
      for (const subject of foreign) {
        if (detail.component({ subject, t }) !== null) fail.push('详情区块对 subject.kind=' + subject.kind + ' 也渲染了（应返回 null）');
      }
      const mine = { kind: 'bundle', pkg: { name: '@local/dsh-team-workflow', installed: true, enabled: true, rows: [] } };
      if (detail.component({ subject: mine, t }) === null) {
        fail.push('详情区块对本包 subject 返回了 null');
      } else {
        walk(detail.component({ subject: mine, t }));
        const roleCards = classCount.get(EXPECTED.cssPrefix + 'detailRole') ?? 0;
        if (roleCards !== 10) fail.push('详情区块渲染了 ' + roleCards + ' 个角色（应 10）');
        for (const needed of ['outputs', 'boundaries', 'writable', 'readonly', 'skills', 'dangling', 'detailTitle', 'detailNote']) {
          if (!keys.includes(needed)) fail.push('详情区块没有承载「' + needed + '」（C8 c 的新落点）');
        }
        // 悬空技能必须真的被列出来（桩 t 返回 key，所以按 roles.json 里的技能 id 取证，不按中文标签）
        const danglingIds = JSON.parse(readFileSync(join(pluginDir, 'roles.json'), 'utf8')).roles
          .flatMap((role) => role.danglingSkills ?? []);
        if (danglingIds.length === 0) fail.push('roles.json 里没有悬空技能可验（本门失去意义）');
        for (const id of danglingIds) {
          if (!texts.some((text) => text.indexOf(id) >= 0)) fail.push('详情区块没有标出悬空技能 ' + id + '（C8 c）');
        }
        for (const cls of classCount.keys()) {
          if (!detailCssClasses.has(cls)) fail.push('详情区块的 class ' + cls + ' 在 CSS 里没有规则');
        }
      }
    }

    // ③ C20.3 改写 + C21.1：官方入口降级为**弹窗内的次级链接**；
    //    官方管理器缺席（没有 pluginNavigation）时，点它必须切到「插件」面板。
    navStub = undefined;
    panelCalls.length = 0;
    shimReact.useState = () => [true, () => {}];
    const findDialogIn = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const child of node) { const hit = findDialogIn(child); if (hit !== null) return hit; } return null; }
      const { type, props } = node;
      if (props === undefined) return null;
      if (typeof type === 'function' && type.name === 'TeamWorkflowConfigDialog') return node;
      if (typeof type === 'function') return findDialogIn(type(props));
      return findDialogIn(props.children);
    };
    const findButtonByLabel = (node, label) => {
      if (node === null || node === undefined || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const child of node) { const hit = findButtonByLabel(child, label); if (hit !== null) return hit; } return null; }
      const { type, props } = node;
      if (props === undefined) return null;
      if (type === 'button' && props.children === label) return props;
      if (typeof type === 'function') return findButtonByLabel(type(props), label);
      return findButtonByLabel(props.children, label);
    };
    const dialog = findDialogIn(registeredComponent(propsForFallback()));
    if (dialog === null) fail.push('降级路径拿不到自有配置弹窗（C21.1）');
    else {
      const link = findButtonByLabel(dialog.type({ ...dialog.props, open: true }), 'configOpenManager');
      if (link === null || typeof link.onClick !== 'function') {
        fail.push('弹窗里拿不到「在插件管理页中查看」次级链接');
      } else {
        link.onClick();
        if (panelCalls.length !== 1 || panelCalls[0] !== 'plugins') {
          fail.push('pluginNavigation 缺席时没有降级到 selectPanel("plugins")：' + JSON.stringify(panelCalls));
        }
      }
    }
    navStub = { openBundle: (name) => { navCalls.push(name); } };
  } catch (error) {
    fail.push('抛错：' + String(error.message).slice(0, 160));
  }
  pluginPageOk = fail.length === 0;
  pluginPageActual = fail.length === 0
    ? 'locale meta 一句话；plugins.detail.section 只对本包渲染且承载 10 角色与悬空技能；弹窗内次级链接经 openBundle 打开本包、服务缺席时降级 selectPanel("plugins")'
    : fail.join('；');
}
check('6h', '插件管理页呈现与入口（C20：meta 一句话 + 详情区块 + 弹窗内次级链接 openBundle / 降级）', '全部通过', pluginPageActual, pluginPageOk);

// 6j：C21.2 / C21.3 —— 宿主半。**真的 import 宿主模块**（只把 schemastery 换成记录用的桩）：
//   ① Config 恰好六个字段、类型正确、**全部 .volatile()**、默认值等于 C21.2 表列值
//   ② 行为字段真的改变 /team 输出（disabledRoles 排除、autoloadSkills 关闭技能段、routeGuard 放行）
//   ③ apply 里必须用可选注入关掉官方自动表单（configure({ auto: false })）
//   ④ 活配置优先读 fiber（volatile 改完不重启也要生效）
// 诚实边界：schemastery 是**桩**——本门验的是"声明与用法正确"；真实 schemastery 的解析/默认值
// 由安装后的实机核验补（见 evidence/）。
const SCHEMA_STUB = `const field = (type, extra = {}) => ({
  type, meta: { ...extra },
  default(value) { this.meta.default = value; return this; },
  volatile() { this.meta.volatile = true; return this; },
});
export default {
  object: (fields) => ({ type: 'object', fields, meta: {}, default(v) { this.meta.default = v; return this; }, volatile() { this.meta.volatile = true; return this; } }),
  array: (item) => field('array', { item }),
  string: () => field('string'),
  boolean: () => field('boolean'),
  number: () => field('number'),
};
`;
let hostConfigOk = false;
let hostConfigActual = '';
await (async () => {
  const fail = [];
  try {
    const tmp = mkdtempSync(join(os.tmpdir(), 'dsh-team-host-'));
    writeFileSync(join(tmp, 'schemastery.mjs'), SCHEMA_STUB);
    writeFileSync(join(tmp, 'roles.json'), rosterRaw);
    const hostSource = readFileSync(join(pluginDir, 'index.js'), 'utf8')
      .replace("from '@deepseek-ai/schemastery'", "from './schemastery.mjs'");
    if (hostSource === readFileSync(join(pluginDir, 'index.js'), 'utf8')) {
      fail.push('宿主半没有从 @deepseek-ai/schemastery 引入 schema（C21.3）');
    }
    writeFileSync(join(tmp, 'index.js'), hostSource);
    // 落盘证据写到临时 HOME，别碰真实 ~/.dsh（module 顶层读 DSH_HOME，必须先设）
    process.env.DSH_HOME = join(tmp, 'home');
    const host = await import(pathToFileURL(join(tmp, 'index.js')).href + '?v=' + Date.now());

    // ① Config 声明
    const fields = host.Config?.fields ?? {};
    const spec = {
      disabledRoles: ['array', []],
      autoloadSkills: ['boolean', true],
      routeGuard: ['boolean', true],
      showTaskBoard: ['boolean', true],
      hideUnassignedRoles: ['boolean', false],
      forceCompactPanel: ['boolean', false],
    };
    for (const [name, [type, def]] of Object.entries(spec)) {
      const field = fields[name];
      if (field === undefined) { fail.push(`Config 缺字段 ${name}`); continue; }
      if (field.type !== type) fail.push(`Config.${name} 类型是 ${field.type}（应为 ${type}）`);
      if (field.meta.volatile !== true) fail.push(`Config.${name} 没有 .volatile()（官方设置服务不许改它）`);
      if (JSON.stringify(field.meta.default) !== JSON.stringify(def)) {
        fail.push(`Config.${name} 默认值是 ${JSON.stringify(field.meta.default)}（应为 ${JSON.stringify(def)}）`);
      }
    }
    const extra = Object.keys(fields).filter((name) => !(name in spec));
    if (extra.length > 0) fail.push(`Config 多了字段：${extra.join(', ')}（C21.2 只允许六个）`);

    // ② 行为：渲染层
    const rosterReloaded = JSON.parse(rosterRaw);
    const rowCount = (text) => (text.match(/可写|只读/g) ?? []).length;
    if (rowCount(host.renderRoster(rosterReloaded)) !== 10) {
      fail.push(`默认配置下名册渲染 ${rowCount(host.renderRoster(rosterReloaded))} 行（应为 10：默认值 = 改动前的行为）`);
    }
    const trimmed = host.renderRoster(rosterReloaded, { disabledRoles: ['qa', 'frontend'] });
    if (rowCount(trimmed) !== 8) fail.push(`disabledRoles 没有排除角色（渲染 ${rowCount(trimmed)} 行，应为 8）`);
    if (!/已按配置停用/.test(trimmed)) fail.push('停用角色没有显式报告（静默消失）');
    if (!/qa/.test(trimmed.split('已按配置停用')[1] ?? '')) fail.push('停用清单里没有 qa');
    const qaRole = rosterReloaded.roles.find((role) => role.id === 'qa');
    if (qaRole === undefined) throw new Error('roles.json 里没有 qa 角色，本门失去意义');
    const briefOn = host.renderRole(qaRole);
    if (!briefOn.includes('自动加载技能（')) fail.push('默认配置下角色简报不再列出技能（改变了现有行为）');
    const briefOff = host.renderRole(qaRole, { autoloadSkills: false });
    if (briefOff.includes('自动加载技能（')) fail.push('autoloadSkills=false 时仍然列出技能');
    if ((qaRole.autoloadSkills ?? []).some((skill) => briefOff.includes(skill))) fail.push('autoloadSkills=false 时技能 id 仍然出现');
    if (!/已按配置关闭/.test(briefOff)) fail.push('autoloadSkills=false 时没有显式说明（静默变化）');
    if (host.effectiveConfig({}).routeGuard !== true || host.effectiveConfig({}).showTaskBoard !== true) {
      fail.push('effectiveConfig({}) 没有落回默认值');
    }

    // ③ 真跑 apply + /team 命令处理函数
    const settingsConfigures = [];
    const applyOnce = (config, fiber) => {
      const commands = [];
      const ctx = {
        fiber: fiber ?? {},
        effect: (fn) => { const iterator = fn(); let step = iterator.next(); while (step.done !== true) step = iterator.next(); },
        inject: (services, cb) => { cb({ effect: (fn) => fn(), settings: { configure: (options) => { settingsConfigures.push(options); } } }); },
        commands: { register: (definition) => { commands.push(definition); } },
      };
      host.apply(ctx, config);
      if (commands.length !== 1) throw new Error(`/team 命令注册了 ${commands.length} 次`);
      return commands[0].handler;
    };
    const guarded = applyOnce({});
    const strictRoute = guarded({ rawInput: 'route standard' });
    if (strictRoute.kind !== 'error' || !/必须写明触发原因/.test(strictRoute.text)) {
      fail.push('默认配置下 /team route 不再强制写明原因（改变了现有行为）');
    }
    const relaxed = applyOnce({ routeGuard: false });
    const looseRoute = relaxed({ rawInput: 'route standard' });
    if (looseRoute.kind !== 'success') fail.push('routeGuard=false 时 /team route 仍被拒绝');
    const disabled = applyOnce({ disabledRoles: ['qa'] });
    const hitDisabled = disabled({ rawInput: 'qa' });
    if (hitDisabled.kind !== 'error' || !/已按配置停用/.test(hitDisabled.text)) {
      fail.push('disabledRoles 里的角色仍能查看简报（停用无效）');
    }
    if (/^\s+qa\s/m.test(disabled({ rawInput: '' }).text)) fail.push('disabledRoles 没有从 /team 名册里排除 qa');
    const enabled = applyOnce({});
    if (enabled({ rawInput: 'backend' }).kind !== 'success') fail.push('默认配置下 /team backend 失败了（改变了现有行为）');
    // ④ 活配置：fiber 上改过的值优先于 apply 收到的（volatile 不重启）
    const liveFiber = applyOnce({}, { config: { disabledRoles: ['frontend'] } });
    if (/^\s+frontend\s/m.test(liveFiber({ rawInput: '' }).text)) {
      fail.push('没有优先读 fiber 上的活配置（volatile 改完不重启也不会生效）');
    }
    // ⑤ 关掉官方自动表单
    if (settingsConfigures.length === 0) {
      fail.push('apply 没有 configure({ auto: false })（官方自动表单会与本插件弹窗写同一份配置）');
    } else if (settingsConfigures.some((options) => options?.auto !== false)) {
      fail.push(`configure 的参数不是 { auto: false }：${JSON.stringify(settingsConfigures)}`);
    }

    hostConfigOk = fail.length === 0;
    hostConfigActual = fail.length === 0
      ? 'Config 六字段全部 volatile 且默认值 = C21.2 表列值；默认配置下名册 10 行、简报列技能、/team route 强制原因（= 改动前行为）；'
        + 'disabledRoles 排除并显式报告、autoloadSkills=false 去掉技能段、routeGuard=false 放行；fiber 上的活配置优先；'
        + `已用可选注入关掉官方自动表单（configure({ auto: false })×${settingsConfigures.length}）`
      : fail.join('；');
  } catch (error) {
    hostConfigActual = `宿主半核验抛错：${String(error.message).slice(0, 200)}`;
  }
})();
check('6j', '宿主半配置（C21.2 六字段 volatile + 默认值 = 现状 + /team 真的按配置变化 + 关掉官方自动表单）',
  '全部通过', hostConfigActual, hostConfigOk);

// 6g：C1 的上游漂移哨兵。
// 让位方向完全依赖一个**官方侧的偶然事实**：官方注册这条槽位时没有写 `priority` 字段，
// 于是有效值 = (priority ?? 0) = 0，小于本插件的 100。这不是我们控制的，
// 官方某天显式写一个 ≥ 100 的 priority，让位就会反过来——本插件会遮蔽官方，C1 直接不成立。
// 所以每次验收都去读一遍**当前安装的官方 bundle** 核对这个事实，而不是假设它永远成立。
let driftOk = false;
let driftActual = '';
try {
  // 官方 bundle 在 asar 里，不是普通文件路径——必须走 inspector 取文本。
  // `DSH_TEAM_OFFICIAL_CLIENT_FOR_TEST` 只是为了拿一份被改过的副本做反证（只读用）。
  const officialBundle = process.env.DSH_TEAM_OFFICIAL_CLIENT_FOR_TEST === undefined
    ? execFileSync(process.execPath,
      [join(here, 'inspect-dsh-checkout.js'), 'get', `/dsh/node_modules/${OFFICIAL.pkg}/lib/client.js`],
      { encoding: 'utf8' })
    : readFileSync(process.env.DSH_TEAM_OFFICIAL_CLIENT_FOR_TEST, 'utf8');
  const call = /ctx\.slots\.register\(\{([\s\S]*?)\}\s*,\s*TeamAction\)/.exec(officialBundle);
  if (call === null) throw new Error('在官方 bundle 里找不到该槽位的注册调用（官方结构变了，本门需重审）');
  const officialId = /id:\s*"([^"]+)"/.exec(call[1])?.[1];
  const priorityMatch = /priority:\s*(-?[\d.]+)/.exec(call[1]);
  const officialPriority = priorityMatch === null ? 0 : Number(priorityMatch[1]);
  const minePriority = Number(/const SHADOW_PRIORITY = (-?[\d.]+);/.exec(bundleText)?.[1]);
  const sameCell = officialId === OFFICIAL.slotId;
  const standsDown = officialPriority < minePriority;
  driftOk = sameCell && standsDown;
  driftActual =
    `官方注册：id=${officialId ?? '(未解析)'} priority=${priorityMatch === null ? '缺省→0' : officialPriority}；` +
    `本插件 priority=${minePriority}；` +
    (sameCell ? '' : `官方 id 变了（≠${OFFICIAL.slotId}）→ 遮蔽不再成立；`) +
    (standsDown ? '方向正确（官方更小 → 官方胜出）' : '方向反了：本插件会遮蔽官方，C1 不成立');
} catch (error) {
  driftActual = `读取官方 bundle 失败：${String(error.message).slice(0, 160)}`;
}
check('6g', '官方当前注册的有效 priority 仍低于本插件（C1 让位方向的上游哨兵）',
  '官方 id 相同 且 (官方 priority ?? 0) < 本插件 priority',
  driftActual, driftOk);

// ── 7. 规则层派发通路与团队工具面一致 ──────────────────────
// 背景（2026-10-14，用户决定）：团队角色的默认派发通路改为官方「智能体团队」的 spawn_teammate。
// 原因是官方面板的数据源 agentTeam 投影只收录 spawn_teammate 创建的成员，用 subagent 派发的
// 子会话根本不进成员列表——那样"成员运行状态"永远是空的。
// 策略层其实早就支持了：policy_check.js 的 DISPATCH_TOOLS / ALWAYS_GATED_DISPATCH 都含
// 'spawn_teammate'，hooks.json 的三个 matcher 也都含它（2026-10-14 15:00 那版）。
// 所以缺的只是规则与文档这一层——下面两条盯住它，防止改回去。
const agentsMdPath = join(HOME, 'AGENTS.md');
const agentsText = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, 'utf8') : null;

const DISPATCH_MARK = '派发团队角色一律用 `spawn_teammate`';
check('7a', '规则层 AGENTS.md 用 spawn_teammate 派发团队角色', `含「${DISPATCH_MARK}」`,
  agentsText === null ? `${agentsMdPath} 不存在`
    : agentsText.includes(DISPATCH_MARK) ? '已声明' : '未声明',
  agentsText !== null && agentsText.includes(DISPATCH_MARK));

const OLD_DISPATCH = '派发用 `subagent`';
const channels = [
  ['AGENTS.md', agentsText],
  ['README.md', existsSync(join(pluginDir, 'README.md')) ? readFileSync(join(pluginDir, 'README.md'), 'utf8') : null],
];
const oldDispatchHits = channels
  .filter(([, text]) => text !== null && text.includes(OLD_DISPATCH))
  .map(([label]) => label);
check('7b', '不再把 subagent 写成团队派发通路', '0 处',
  oldDispatchHits.length === 0 ? '0 处' : `${oldDispatchHits.join('、')} 仍含「${OLD_DISPATCH}」`,
  oldDispatchHits.length === 0);

// ── 8. 未执行项（需人机交互） ──────────────────────────────
const notRun = [
  ['1', '三级分诊 Fast/Standard/Deep 触发'],
  ['3', '不重叠路径并行 vs 同文件竞态'],
  ['4', '未授权访问/越界路径/符号链接绕过的实际拒绝'],
  ['5', '未经授权的部署、提交/推送、Docker/数据库删除'],
  ['6', '隔离项目的完整交付流与错误输入'],
  ['7', '自审被拒、QA 改被测实现被拒、变更后门失效'],
  ['8', '未批准 ADR / 过期记忆 / 生效规则冲突的权威顺序'],
  ['9', '派发前记账 JSONL'],
  ['10', '候选镜像 != 发布；清理另行授权'],
];

const pass = results.filter((r) => r.ok).length;
const report = `# Agent 团队工作流 · 验收报告

- 生成时间：${new Date().toISOString()}
- 插件：\`${pkg.name}@${pkg.version}\`
- roles.json 指纹：\`${rosterHash}\`
- 资源包：\`${PACK}\`
- 依据：资源包 \`04-验收清单.md\`

## 自动核验结果

| # | 检项 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
${lines.join('\n')}

**自动核验：${pass}/${results.length} 通过。**

## 未执行项（需人机交互，按清单口径记「未执行」，不冒充通过）

| # | 检项 |
|---|---|
${notRun.map(([id, name]) => `| ${id} | ${name} |`).join('\n')}

> 清单通过口径：任何必须安全/授权/独立门的失败都记 Block；未验证的场景记未执行；
> 平台欠缺 hook、文件权限或独立成员能力记未复刻。
`;
writeFileSync(join(pluginDir, 'ACCEPTANCE.md'), report);

console.log(`自动核验：${pass}/${results.length} 通过`);
for (const r of results) if (!r.ok) console.log(`  ✗ [${r.id}] ${r.name}：${r.actual}`);
console.log(`报告：${join(pluginDir, 'ACCEPTANCE.md')}`);
