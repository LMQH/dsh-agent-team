#!/usr/bin/env node
/**
 * 从资源包生成 roles.json —— 角色与职责的**单一来源**。
 *
 * 来源：OMP团队开发工作流-DeepSeekHarness复刻包-20261013
 *   sources/omp/agents/*.md        ← 10 份权威角色定义（front-matter + 正文）
 *   sources/omp/skills/*           ← 团队技能（用于判定悬空引用）
 *   sources/shared/skills/*        ← 共享技能（同上）
 *
 * 原则（照资源包的要求）：
 *   · 角色的 id / description / model / tools / spawns / autoloadSkills 一律**从包里解析**，
 *     不手抄，避免与来源漂移；
 *   · autoloadSkills 里指向不存在的技能时，**移出自动加载并列进 danglingSkills**，
 *     不以空壳文件消除缺口（包明确禁止）；
 *   · model 别名 `@team_*` 只作角色映射保留，不推断供应商、不复制凭据；
 *   · 中文标题 / 职责 / 产物 / 边界是一张显式对照表（下方 ZH），便于逐条核对，
 *     不做机器翻译猜测。
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const PACK = '/Users/maxwell/Downloads/OMP团队开发工作流-DeepSeekHarness复刻包-20261013';
const AGENTS_DIR = join(PACK, 'sources/omp/agents');
const OUT = join(here, '..', '..', 'dsh-team-plugin', 'roles.json');

/** 中文对照表：忠实译自各角色 description 与正文，并标注该角色的产物与边界。 */
const ZH = {
  pm: {
    title: '产品经理',
    duty: '把用户意图转成有范围、可测的产品需求与验收标准。',
    outputs: ['PRD 草稿', '用户流', '明确的非目标', '优先级', '验收标准', '未决问题'],
    boundaries: '不改代码、不选技术架构、不批准例外、不直接联系用户。',
  },
  architect: {
    title: '架构师',
    duty: '设计技术边界、契约与 ADR 草案，但不实现它们。',
    outputs: ['可实施的技术方案', '接口契约', '所有权边界', 'ADR 影响分析'],
    boundaries: '不改实现、不擅自修订生效 ADR、不批准例外；重大架构变更须经主 Agent 以 needs-authorization 上报。',
  },
  backend: {
    title: '后端',
    duty: '仅在指派路径与契约内实现已批准的后端与数据层工作。',
    outputs: ['变更路径', '验证证据', '风险', '所需的下一道门'],
    boundaries: '不改架构 / CI-CD / 生产部署文件 / 密钥，不改自己的评审状态；schema 与迁移按串行共享所有权处理。',
  },
  frontend: {
    title: '前端',
    duty: '仅在指派路径与契约内实现已批准的前端工作。',
    outputs: ['变更路径', '验证证据', '风险', '所需的下一道门'],
    boundaries: '保持后端与共享 schema 契约；不改架构、受保护部署文件、密钥或自己的评审状态。',
  },
  harness: {
    title: '智能体',
    duty: '在指派路径内实现已批准的 agent 运行时、模型、提示、工具、MCP 与编排改动。',
    outputs: ['变更路径', '被实际执行的行为', '风险', '所需的下一道门'],
    boundaries: '不重定义系统授权、权限模型、跨服务契约或架构；绝不在工件中暴露凭据。',
  },
  devops: {
    title: '运维',
    duty: '设计并执行获授权的交付、部署与运行时操作。',
    outputs: ['确切目标环境', '不可变工件与完整 Docker 清单', '回滚门', '命令证据', '风险', '下一道门'],
    boundaries: '未经记录的授权不得操作真实基础设施、密钥、账号、受保护 CI/CD，也不得执行部署/推送/提交；构建、候选、发布、清理四道门相互独立。',
  },
  qa: {
    title: '测试',
    duty: '独立测试被指派的改动，并报告可复现缺陷而不修复它们。',
    outputs: ['独立推导并执行的测试证据', '缺陷（含复现、期望与实际、受影响 revision、严重度、实现 owner）'],
    boundaries: '不修改被测实现、不批准自己的证据、不把未执行的测试报告为通过。',
  },
  'code-review': {
    title: '代码审查',
    duty: '独立审查实现 diff、证据与交接的正确性与可维护性。',
    outputs: ['发现项（含严重度、受影响路径与行/构造、后果、具体修复建议）'],
    boundaries: '不改实现、不自审、不编造测试结果。',
  },
  compliance: {
    title: '合规',
    duty: '独立评估安全、策略、授权与架构边界的合规性。',
    outputs: ['每条结论归类为 pass / risk / block / needs-authorization 并附具体证据'],
    boundaries: '不修改被审实现、不豁免违规、不冒用用户授权。',
  },
  'quota-control': {
    title: '资源财务',
    duty: '分析团队用量证据，报告预算、重试与容量异常。',
    outputs: ['事实', '数据缺口', '阈值突破', '建议'],
    boundaries: '不取消工作、不改模型、不改预算、不声称未经权威来源提供的测量值。',
  },
};

/** 解析 front-matter 为简单键值；数组支持 `[a, b, c]` 形式。 */
function parseFrontMatter(text, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) throw new Error(`${file}: 缺少 front-matter`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    meta[key] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((item) => item.trim()).filter((item) => item.length > 0)
      : value;
  }
  return { meta, body: match[2].trim() };
}

/** 包里实际存在的技能名（目录名即技能名）。 */
function availableSkills() {
  const names = new Set();
  for (const group of ['sources/omp/skills', 'sources/shared/skills']) {
    for (const entry of readdirSync(join(PACK, group), { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  return names;
}

const skills = availableSkills();

/**
 * 展示顺序 —— **不按字母序**，因为卡片要读起来像工作流，而不是像电话簿。
 *
 * 顺序直接采用资源包 `01-现行工作流.md` 对 10 个角色的枚举原文：
 *   「产品经理 pm、架构师 architect、后端 backend、前端 frontend、智能体 harness、
 *     运维 devops、测试 qa、代码审查 code-review、合规 compliance、资源财务 quota-control」
 * 语义上即：**先开发主线**（需求 → 架构 → 实施 → 交付运维），
 * **后独立门与治理成员**（测试 → 代码审查 → 合规 → 资源财务）。
 * 包在 `sources/omp/AGENTS.md` 里另有一处枚举，顺序不同且把门穿插在实施之间，故不采用。
 */
const DISPLAY_ORDER = [
  'pm', 'architect', 'backend', 'frontend', 'harness', 'devops',
  'qa', 'code-review', 'compliance', 'quota-control',
];

/**
 * 重映射角色正文里的本机路径。
 *
 * 资源包 03-来源与差距.md 明确要求：`/Users/lmqhx/wiki`、`~/.omp/agent/...` 等
 * 「是来源定位，不是 DeepSeekHarness 默认目录」，迁移必须重映射，不能让失效路径静默通过。
 */
const VAULT_SENTENCE = 'Knowledge vault access is read-only: search and read `/Users/lmqhx/wiki` when relevant, cite note paths, and return knowledge-change proposals to the main Agent. Do not write vault files or run ingest/rehash operations.';
const VAULT_REPLACEMENT = 'Knowledge vault: **not configured in this deployment** — no vault root is available, so do not assume one exists and do not cite vault paths. If the main agent supplies a vault root, treat it as read-only: cite note paths and return knowledge-change proposals to the main Agent. Never write vault files or run ingest/rehash operations.';
const PATH_REWRITES = [
  [VAULT_SENTENCE, VAULT_REPLACEMENT],
  ['~/.omp/agent/RULES.md', `${process.env.DSH_HOME || join(os.homedir(), '.dsh')}/team-workflow/RULES.md`],
];

function rewritePaths(text, label) {
  let out = text;
  let hits = 0;
  for (const [from, to] of PATH_REWRITES) {
    const count = out.split(from).length - 1;
    if (count > 0) {
      out = out.split(from).join(to);
      hits += count;
    }
  }
  if (hits === 0) throw new Error(`${label}: 未命中任何路径重映射锚点，包结构可能已变`);
  return out;
}
const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).sort();

const roles = [];
const danglingReport = [];

for (const file of files) {
  const { meta, body } = parseFrontMatter(readFileSync(join(AGENTS_DIR, file), 'utf8'), file);
  const id = meta.name;
  if (id === undefined) throw new Error(`${file}: front-matter 缺 name`);
  const zh = ZH[id];
  if (zh === undefined) throw new Error(`${file}: 中文对照表里没有角色 ${id}，请先补条目`);

  const declared = meta.autoloadSkills ?? [];
  const dangling = declared.filter((name) => !skills.has(name));
  const effective = declared.filter((name) => skills.has(name));

  if (dangling.length > 0) danglingReport.push({ id, dangling });

  roles.push({
    id,
    title: zh.title,
    duty: zh.duty,
    dutySource: meta.description,
    model: meta.model,
    tools: meta.tools ?? [],
    writable: (meta.tools ?? []).some((tool) => ['edit', 'write', 'bash'].includes(tool)),
    spawns: meta.spawns === 'true' || meta.spawns === true,
    autoloadSkills: effective,
    danglingSkills: dangling,
    outputs: zh.outputs,
    boundaries: zh.boundaries,
    instruction: rewritePaths(body, `${id} 的正文`),
    source: `sources/omp/agents/${file}`,
  });
}

// 迁移后不允许残留本机路径——包明确要求「不要让失效路径静默通过」。
const stale = roles.filter((role) => /lmqhx|\.omp\/|\.codex\//.test(role.instruction));
if (stale.length > 0) {
  throw new Error(`角色正文仍含本机路径：${stale.map((r) => r.id).join(', ')}`);
}

// 展示顺序必须是这 10 个角色的一个排列，多一个少一个都要报错。
const unordered = roles.map((role) => role.id).filter((id) => !DISPLAY_ORDER.includes(id));
const absent = DISPLAY_ORDER.filter((id) => !roles.some((role) => role.id === id));
if (unordered.length > 0 || absent.length > 0) {
  throw new Error(
    `展示顺序与角色集合不一致：顺序里缺 [${absent.join(', ')}]，多出 [${unordered.join(', ')}]`,
  );
}
roles.sort((a, b) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id));

const missing = Object.keys(ZH).filter((id) => !roles.some((role) => role.id === id));
if (missing.length > 0) throw new Error(`中文对照表有包里不存在的角色: ${missing.join(', ')}`);

const payload = {
  source: 'OMP团队开发工作流-DeepSeekHarness复刻包-20261013',
  sourcePaths: { agents: 'sources/omp/agents/*.md', skills: ['sources/omp/skills', 'sources/shared/skills'] },
  note: 'model 别名 @team_* 仅表示角色映射，不代表任何供应商，也不含凭据；danglingSkills 为包中不存在的技能，已移出自动加载。',
  displayOrder: {
    basis: '资源包 01-现行工作流.md 对 10 个角色的枚举顺序',
    rule: '先开发主线（需求 → 架构 → 实施 → 交付运维），后独立门与治理成员（测试 → 代码审查 → 合规 → 资源财务）',
    ids: DISPLAY_ORDER,
    note: 'roles 数组即已按此顺序排列；卡片、名册、AGENTS.md 三处共用，不要在别处再排一次。',
  },
  roles,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');

// ── 迁移角色正文引用的参考文件 ────────────────────────────────
// 正文里引用了 RULES.md 与任务合同模板；不迁移过去就是死链（包禁止失效路径静默通过）。
const RUNTIME = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'team-workflow');
mkdirSync(RUNTIME, { recursive: true });
const REFERENCES = [
  ['sources/omp/RULES.md', 'RULES.md'],
  ['templates/任务合同模板.md', '任务合同模板.md'],
];
const migrated = [];
for (const [from, to] of REFERENCES) {
  const src = join(PACK, from);
  if (!existsSync(src)) throw new Error(`包里的参考文件不存在：${from}`);
  copyFileSync(src, join(RUNTIME, to));
  migrated.push(to);
}

console.log(`已生成 ${OUT}`);
console.log(`角色数: ${roles.length}`);
for (const role of roles) {
  const w = role.writable ? '可写' : '只读';
  console.log(`  ${role.id.padEnd(14)} ${role.title.padEnd(6)} ${w}  工具[${role.tools.join(',')}]  技能 ${role.autoloadSkills.length}${role.danglingSkills.length > 0 ? `  悬空 ${role.danglingSkills.length}` : ''}`);
}
console.log('\n悬空技能（包中不存在，已移出自动加载）:');
for (const item of danglingReport) console.log(`  ${item.id}: ${item.dangling.join(', ')}`);
console.log(`\n已迁移参考文件到 ${RUNTIME}: ${migrated.join(', ')}`);
console.log('已重映射角色正文里的本机路径（vault 未配置 / RULES.md 指向迁移后位置）');
