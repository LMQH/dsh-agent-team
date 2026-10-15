#!/usr/bin/env node
/**
 * DSH role-layer validator (WS-B).
 *
 * Usage:  node roles/_tools/validate_roles.js [--skills-dir=<path>]
 *
 * Checks (ERROR => exit 1):
 *   role-file        : exactly the 10 expected role files exist
 *   frontmatter      : required keys present, YAML parses, name == filename
 *   sections         : the 5 required sections exist in every role file
 *   write-access     : value is none|scoped, and no write tool is declared for write_access: none
 *   tools            : non-empty; unknown tool names only warn
 *   report-fields    : the 4 status values plus evidence/risk/uncovered fields are present
 *   vault-rule       : the DSH rewritten vault rule is present and /Users/lmqhx/wiki is never assumed to exist
 *   skill-binding    : every skill in `skills` exists as <skills>/<name>/SKILL.md or is recorded as a removed
 *                      binding in <skills>/MISSING-SKILLS.md  (dangling-autoload check)
 *   removed-skills   : removed bindings are not present in <skills>/ and are recorded in MISSING-SKILLS.md (warn)
 *   reviewer         : known role id, not itself, and no implementation role has only implementation reviewers
 *   registry         : 15 role names, exactly 5 dsh-builtin-substitute, internal consistency with role files
 *   forbidden-claims : no role file claims a DSH capability that does not exist, unless the line is marked
 *                      as a non-capability/limitation
 *
 * The skills directory belongs to another workstream (WS-A). If it does not exist yet, the
 * skill-existence check is DEFERRED (warning) and the validator exits 0 *only if* no other ERROR
 * was found. It never reports a PASS for a check it did not run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROLES_DIR = path.resolve(__dirname, '..');
const ROOT = path.dirname(ROLES_DIR);
const DEFAULT_SKILLS_DIR = path.join(ROOT, 'skills');

const EXPECTED_ROLE_IDS = [
  'pm', 'architect', 'backend', 'frontend', 'harness',
  'devops', 'qa', 'code-review', 'compliance', 'quota-control',
];

const EXPECTED_REGISTRY_IDS = [
  'pm', 'architect', 'backend', 'frontend', 'harness',
  'devops', 'qa', 'code-review', 'reviewer', 'compliance',
  'security-reviewer', 'scout', 'quota-control', 'sonic', 'task',
];

const IMPLEMENTATION_ROLES = ['backend', 'frontend', 'harness'];
const SUBSTITUTE_COUNT = 5;
const LOCAL_COUNT = 10;

const REQUIRED_FRONTMATTER_KEYS = [
  'name', 'description', 'source', 'spawns', 'write_access', 'tools',
  'skills', 'removed_skills', 'vault', 'authority',
  'independent_reviewer', 'required_gates',
];

const REQUIRED_SECTIONS = [
  '## 职责与边界',
  '## 授权边界',
  '## 派发合同',
  '## 汇报格式',
  '## 独立性约束',
];

const STATUS_VALUES = ['complete', 'blocked', 'needs-authorization', 'needs-decision'];

// Fields the Lead must fill in every `## 派发合同` section.
const CONTRACT_FIELDS = [
  'task_id', 'worktree_or_revision', 'owner_role', 'allowed_paths',
  'input_artifacts', 'output_artifacts', 'dependencies', 'acceptance_criteria',
  'independent_reviewer', 'required_gates', 'authorization_record',
];

// Tokens the `## 汇报格式` section must cover.
const REPORT_FIELDS = ['证据', '风险', '未覆盖', 'revision'];

// Tokens the `## 独立性约束` section must restate.
const INDEPENDENCE_TOKENS = ['diff', 'QA', '失效'];

function sectionText(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length);
  const nextIdx = rest.search(/\n## /);
  return nextIdx < 0 ? rest : rest.slice(0, nextIdx);
}

const KNOWN_TOOLS = [
  'read', 'grep', 'glob', 'edit', 'write', 'bash',
  'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'spawn_teammate',
  'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  'subagent', 'skill', 'todo_write', 'web_search', 'web_fetch', 'workflow',
];

const GATE_VOCABULARY = [
  'product-acceptance-by-user', 'architecture-authorization', 'independent-artifact-review',
  'independent-qa', 'code-review', 'compliance-review', 'security-review',
  'authorization-record', 'rollback-gate', 'release-gate', 'lead-acceptance',
];

const REGISTRY_ROLE_KEYS = [
  'id', 'display_name', 'type', 'status', 'spawns', 'local_definition',
  'local_definition_imported', 'skill_bindings', 'bound_skills', 'dangling_skills',
  'skill_reference_status', 'dsh_substitute',
];

const REGISTRY_TYPE_VALUES = ['read-only', 'implementation', 'review', 'mechanical', 'general'];
const REGISTRY_STATUS_VALUES = ['local-definition', 'dsh-builtin-substitute'];
const SKILL_REF_STATUS_VALUES = ['bound', 'bound-with-dangling', 'not-applicable'];

// Claims that would be false on DSH. A matching line is exempt only when it is explicitly
// marked as a limitation / non-capability (see EXEMPT_TOKENS).
const FORBIDDEN_CLAIMS = [
  {
    id: 'write-scope-enforcement',
    re: /(write_scopes|write scopes|写入范围)[^\n]{0,80}(automatic\w*\s*(enforc|block|prevent)|enforced by|blocks?\s+writes?|prevents?\s+(overlap|conflict)|guarantee\w*\s*(isolation|exclusion)|自动强制|强制拦截|保证隔离|阻止(重叠)?(写入|冲突)|自动阻止)/i,
  },
  {
    id: 'write-scope-enforcement-inverted',
    re: /(automatically\s+enforced|automatically\s+enforces|enforced\s+automatically|自动强制执行)[^\n]{0,80}(write_scopes|write scopes|写入范围)/i,
  },
  {
    id: 'automatic-ownership-release',
    re: /(ownership[^\n]{0,40}(released\s+automatically|automatically\s+released|auto-?releas\w*))|((自动(释放|回收)|自动解除)[^\n]{0,30}(所有权|ownership|任务归属))|((所有权|ownership|任务归属)[^\n]{0,30}自动(释放|回收|解除))/i,
  },
  {
    id: 'per-role-os-sandbox',
    re: /((per-role|role-level|per teammate|each role|each teammate)[^\n]{0,40}(OS\s+|operating-system\s+)?sandbox)|((角色级|按角色的|每个角色|每角色)[^\n]{0,24}(OS\s*)?(沙箱|隔离环境))/i,
  },
];

const EXEMPT_TOKENS = [
  'NON-CAPABILITY', 'LIMITATION', 'advisory', 'does not', 'do not', 'cannot', 'never', 'unavailable',
  'not enforced', 'not guaranteed', '不得', '不能', '不会', '不做', '不提供', '不自动', '不强制',
  '非强制', '无法', '未配置', '并非', '不是', '禁止', '不按角色', '不阻止', '未提供', '无自动',
  '不保证', '未验证', '不声称', '不承诺', '未声称',
];

const YAML_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// ---------------------------------------------------------------- findings

const findings = [];
let deferredSkills = false;
let skillCheckRan = false;

function report(level, check, detail) {
  findings.push({ level, check, detail });
}

function error(check, detail) { report('ERROR', check, detail); }
function warn(check, detail) { report('WARN', check, detail); }
function pass(check, detail) { report('PASS', check, detail); }
function deferred(check, detail) { deferredSkills = true; report('DEFERRED', check, detail); }

// ---------------------------------------------------------------- minimal YAML

function stripQuotes(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function splitFlow(inner) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => stripQuotes(p)).filter((p) => p !== '');
}

function scalar(raw) {
  const v = raw.trim();
  if (v === '') return null;
  if (v.startsWith('[') && v.endsWith(']')) return splitFlow(v.slice(1, -1));
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return stripQuotes(v);
}

function tokenizeYaml(src) {
  const out = [];
  src.split(/\r?\n/).forEach((raw, idx) => {
    if (/^\s*$/.test(raw)) return;
    if (/^\s*#/.test(raw)) return;
    out.push({ indent: raw.match(/^ */)[0].length, text: raw.trim(), line: idx + 1 });
  });
  return out;
}

/**
 * Minimal indentation-based YAML parser: nested maps, block sequences, flow lists,
 * quoted scalars, booleans, numbers, null. Enough for the files in this directory.
 */
function parseYaml(src, label) {
  const lines = tokenizeYaml(src);
  let pos = 0;

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    return lines[pos].text.startsWith('-') ? parseSeq(indent) : parseMap(indent);
  }

  function parseSeq(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('-')) {
      const text = lines[pos].text;
      const rest = text === '-' ? '' : text.slice(1).trim();
      pos += 1;
      if (rest === '') {
        arr.push(pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null);
        continue;
      }
      if (rest.startsWith('"') || rest.startsWith("'")) {
        arr.push(scalar(rest));
        continue;
      }
      const inline = rest.match(/^([^:]+):(\s*)(.*)$/);
      if (inline && YAML_KEY.test(inline[1].trim())) {
        const obj = {};
        const key = inline[1].trim();
        const val = inline[3].trim();
        obj[key] = val === ''
          ? (pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null)
          : scalar(val);
        while (pos < lines.length && lines[pos].indent > indent && !lines[pos].text.startsWith('-')) {
          const row = lines[pos];
          const m = row.text.match(/^([^:]+):(\s*)(.*)$/);
          if (!m || !YAML_KEY.test(m[1].trim())) {
            error('yaml', `${label}:${row.line} 无法解析的键值行: ${row.text}`);
            pos += 1;
            continue;
          }
          pos += 1;
          const k = m[1].trim();
          const v = m[3].trim();
          obj[k] = v === ''
            ? (pos < lines.length && lines[pos].indent > row.indent ? parseBlock(lines[pos].indent) : null)
            : scalar(v);
        }
        arr.push(obj);
      } else {
        arr.push(scalar(rest));
      }
    }
    return arr;
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('-')) {
      const row = lines[pos];
      const m = row.text.match(/^([^:]+):(\s*)(.*)$/);
      if (!m || !YAML_KEY.test(m[1].trim())) {
        error('yaml', `${label}:${row.line} 无法解析的键值行: ${row.text}`);
        pos += 1;
        continue;
      }
      const key = m[1].trim();
      const val = m[3].trim();
      pos += 1;
      if (val === '') {
        obj[key] = pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null;
      } else {
        obj[key] = scalar(val);
      }
    }
    return obj;
  }

  const doc = parseBlock(lines.length ? lines[0].indent : 0);
  if (pos < lines.length) {
    warn('yaml', `${label}: 解析结束后仍有 ${lines.length - pos} 行未消费（可能是缩进不一致）`);
  }
  return doc || {};
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { fm: null, body: text };
  return { fm: parseYaml(m[1], path.basename(file)), body: text.slice(m[0].length) };
}

function asArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function sortedUnique(arr) {
  return [...new Set(arr.map(String))].sort();
}

function sameSet(a, b) {
  const x = sortedUnique(a);
  const y = sortedUnique(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// ---------------------------------------------------------------- CLI

let skillsDir = DEFAULT_SKILLS_DIR;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('--skills-dir=')) skillsDir = path.resolve(a.slice('--skills-dir='.length));
  else if (a === '--skills-dir' && argv[i + 1]) { skillsDir = path.resolve(argv[i + 1]); i += 1; }
  else if (a === '--help' || a === '-h') {
    console.log('usage: node roles/_tools/validate_roles.js [--skills-dir=<path>]');
    process.exit(0);
  }
}
const missingSkillsFile = path.join(skillsDir, 'MISSING-SKILLS.md');

console.log('DSH role-layer validator (WS-B)');
console.log(`command: node roles/_tools/validate_roles.js${skillsDir === DEFAULT_SKILLS_DIR ? '' : ` --skills-dir=${skillsDir}`}`);
console.log(`root: ${ROOT}`);
console.log(`roles_dir: ${ROLES_DIR}`);
console.log(`skills_dir: ${skillsDir} (${isDir(skillsDir) ? 'present' : 'ABSENT'})`);
console.log(`missing_skills_file: ${missingSkillsFile} (${exists(missingSkillsFile) ? 'present' : 'absent'})`);
console.log('---');

// ---------------------------------------------------------------- 1. role files

const roleFiles = fs.readdirSync(ROLES_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
  .sort();
const foundIds = roleFiles.map((f) => f.replace(/\.md$/, ''));

const missingFiles = EXPECTED_ROLE_IDS.filter((id) => !foundIds.includes(id));
const extraFiles = foundIds.filter((id) => !EXPECTED_ROLE_IDS.includes(id));
if (missingFiles.length) error('role-file', `缺少角色文件: ${missingFiles.join(', ')}`);
if (extraFiles.length) error('role-file', `存在非预期角色文件: ${extraFiles.join(', ')}`);
if (!missingFiles.length && !extraFiles.length) {
  pass('role-file', `10/10 预期角色文件存在: ${foundIds.join(', ')}`);
}

// ---------------------------------------------------------------- 2. per role checks

const roles = {};
const allReviewers = {};

for (const id of foundIds) {
  const file = path.join(ROLES_DIR, `${id}.md`);
  const text = fs.readFileSync(file, 'utf8');
  const { fm } = readFrontmatter(file);
  if (!fm) { error('frontmatter', `${id}.md 缺少 YAML frontmatter`); continue; }
  roles[id] = { fm, text, file };
}

for (const [id, { fm, text, file }] of Object.entries(roles)) {
  // required keys
  const missingKeys = REQUIRED_FRONTMATTER_KEYS.filter((k) => !(k in fm));
  if (missingKeys.length) error('frontmatter', `${id}.md 缺少必需字段: ${missingKeys.join(', ')}`);
  if (fm.name !== id) error('frontmatter', `${id}.md 的 name="${fm.name}" 与文件名不一致`);
  if (typeof fm.description !== 'string' || !fm.description.trim()) error('frontmatter', `${id}.md 缺少 description`);

  // sections
  const missingSections = REQUIRED_SECTIONS.filter((s) => !text.includes(s));
  if (missingSections.length) error('sections', `${id}.md 缺少章节: ${missingSections.join(' / ')}`);

  // write access + tool consistency
  if (!['none', 'scoped'].includes(fm.write_access)) {
    error('write-access', `${id}.md write_access="${fm.write_access}" 不是 none|scoped`);
  }
  const tools = asArray(fm.tools);
  if (!tools.length) error('tools', `${id}.md 未声明任何 tools`);
  const unknownTools = tools.filter((t) => !KNOWN_TOOLS.includes(t));
  if (unknownTools.length) warn('tools', `${id}.md 声明了未在本清单中的工具（如 DSH 确实提供则可忽略）: ${unknownTools.join(', ')}`);
  if (fm.write_access === 'none') {
    const writeTools = tools.filter((t) => ['edit', 'write'].includes(t));
    if (writeTools.length) error('write-access', `${id}.md write_access=none 却声明了写入工具: ${writeTools.join(', ')}`);
  }

  // authority shape
  if (!fm.authority || typeof fm.authority !== 'object' || Array.isArray(fm.authority)) {
    error('frontmatter', `${id}.md authority 必须是包含 decides / does_not_decide 的映射`);
  } else {
    for (const key of ['decides', 'does_not_decide']) {
      if (!asArray(fm.authority[key]).length) error('frontmatter', `${id}.md authority.${key} 不能为空`);
    }
  }

  // report fields (scoped to the required sections)
  const reportSection = sectionText(text, '## 汇报格式');
  if (!reportSection) {
    error('report-fields', `${id}.md 缺少 ## 汇报格式 章节内容`);
  } else {
    const missingStatuses = STATUS_VALUES.filter((s) => !reportSection.includes(s));
    if (missingStatuses.length) error('report-fields', `${id}.md 汇报格式未覆盖 status 取值: ${missingStatuses.join(', ')}`);
    const missingReportTokens = REPORT_FIELDS.filter((t) => !reportSection.includes(t));
    if (missingReportTokens.length) error('report-fields', `${id}.md 汇报格式缺少字段: ${missingReportTokens.join(', ')}`);
  }

  // dispatch-contract fields
  const contractSection = sectionText(text, '## 派发合同');
  if (!contractSection) {
    error('contract-fields', `${id}.md 缺少 ## 派发合同 章节内容`);
  } else {
    const missingFields = CONTRACT_FIELDS.filter((f) => !contractSection.includes(f));
    if (missingFields.length) error('contract-fields', `${id}.md 派发合同缺少字段: ${missingFields.join(', ')}`);
  }

  // independence restatement
  const independenceSection = sectionText(text, '## 独立性约束');
  if (!independenceSection) {
    error('independence', `${id}.md 缺少 ## 独立性约束 章节内容`);
  } else {
    const missingTokens = INDEPENDENCE_TOKENS.filter((t) => !independenceSection.includes(t));
    if (missingTokens.length) error('independence', `${id}.md 独立性约束缺少要点: ${missingTokens.join(', ')}`);
  }

  // vault rule
  if (!/vault/i.test(text) || !text.includes('未配置')) {
    error('vault-rule', `${id}.md 未包含 DSH 重写的「知识库未配置」规则`);
  }
  text.split(/\r?\n/).forEach((line, n) => {
    if (line.includes('/Users/lmqhx/wiki') && !EXEMPT_TOKENS.some((t) => line.toLowerCase().includes(t.toLowerCase()))) {
      error('vault-rule', `${id}.md:${n + 1} 疑似假定 /Users/lmqhx/wiki 存在: ${line.trim()}`);
    }
  });

  // reviewer independence
  const reviewerRaw = fm.independent_reviewer;
  if (reviewerRaw === 'none') {
    if (!fm.independent_reviewer_note || !String(fm.independent_reviewer_note).trim()) {
      error('reviewer', `${id}.md independent_reviewer=none 但缺少 independent_reviewer_note 说明`);
    }
    allReviewers[id] = ['none'];
  } else {
    const list = asArray(reviewerRaw);
    if (!list.length) error('reviewer', `${id}.md independent_reviewer 为空`);
    for (const r of list) {
      if (!EXPECTED_REGISTRY_IDS.includes(r)) error('reviewer', `${id}.md independent_reviewer="${r}" 不是已知角色 id`);
      if (r === id) error('reviewer', `${id}.md 把自己指定为 independent_reviewer`);
    }
    if (IMPLEMENTATION_ROLES.includes(id)) {
      const nonImpl = list.filter((r) => !IMPLEMENTATION_ROLES.includes(r));
      if (!nonImpl.length) {
        error('reviewer', `${id}.md 是实现角色，但 independent_reviewer 只由实现角色组成: ${list.join(', ')}`);
      }
    }
    allReviewers[id] = list;
  }

  // required gates vocabulary (warn only)
  const gates = asArray(fm.required_gates);
  if (!gates.length) error('frontmatter', `${id}.md required_gates 不能为空`);
  const unknownGates = gates.filter((g) => !GATE_VOCABULARY.includes(g));
  if (unknownGates.length) warn('gates', `${id}.md 使用了 vocabulary 之外的 gate 名: ${unknownGates.join(', ')}`);
}

// ---------------------------------------------------------------- 3. skill bindings

const skillsAvailable = isDir(skillsDir);
let missingSkillsLines = [];
if (exists(missingSkillsFile)) {
  missingSkillsLines = fs.readFileSync(missingSkillsFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

function skillDirPresent(name) {
  return exists(path.join(skillsDir, name, 'SKILL.md'));
}

function recordedAsRemoved(name) {
  const hit = missingSkillsLines.find((l) => l.includes(name));
  return hit ? hit : null;
}

const danglingBindings = new Set();
const roleBindings = {};

for (const [id, { fm }] of Object.entries(roles)) {
  const skills = asArray(fm.skills);
  const removed = asArray(fm.removed_skills);
  roleBindings[id] = { skills, removed };

  if (!skills.length) error('skill-binding', `${id}.md 未声明任何 skills`);
  if (removed.length && !String(fm.removed_skills_note || '').trim()) {
    error('removed-skills', `${id}.md 声明了 removed_skills 但缺少 removed_skills_note`);
  }

  if (!skillsAvailable) {
    deferred('skill-existence',
      `DEFERRED: skills/ not yet present — rerun after WS-A (未校验 ${skills.length} 个绑定: ${skills.join(', ')})`);
    continue;
  }

  skillCheckRan = true;
  for (const name of skills) {
    if (skillDirPresent(name)) continue;
    const hit = recordedAsRemoved(name);
    if (hit) {
      warn('skill-binding', `${id}.md 绑定的技能 "${name}" 不在 ${skillsDir}，但已在 MISSING-SKILLS.md 记录为移除项: "${hit}"`);
      danglingBindings.add(name);
    } else {
      danglingBindings.add(name);
      error('skill-binding',
        `DANGLING: ${id}.md 绑定技能 "${name}"，既不存在 ${path.join(skillsDir, name, 'SKILL.md')}，也未记录在 ${missingSkillsFile}`);
    }
  }

  for (const name of removed) {
    if (skillDirPresent(name)) {
      warn('removed-skills', `${id}.md 把 "${name}" 记录为已移除，但该技能现在存在（绑定可能已过期，可重新绑定）`);
    } else if (!recordedAsRemoved(name)) {
      warn('removed-skills', `${id}.md 把 "${name}" 记录为已移除，但 ${missingSkillsFile} 未记录该名字（跨层记录缺失）`);
    }
  }
}

// ---------------------------------------------------------------- 4. forbidden capability claims

const claimTargets = [
  ...Object.entries(roles).map(([id, r]) => [`roles/${id}.md`, r.text]),
];
if (exists(path.join(ROLES_DIR, 'registry.yaml'))) {
  claimTargets.push(['roles/registry.yaml', fs.readFileSync(path.join(ROLES_DIR, 'registry.yaml'), 'utf8')]);
}
if (exists(path.join(ROLES_DIR, 'README.md'))) {
  claimTargets.push(['roles/README.md', fs.readFileSync(path.join(ROLES_DIR, 'README.md'), 'utf8')]);
}
// The validator source itself is intentionally NOT scanned: it necessarily contains the
// forbidden-claim patterns as literals, which would be a false positive.

let claimHits = 0;
for (const [label, text] of claimTargets) {
  text.split(/\r?\n/).forEach((line, n) => {
    for (const claim of FORBIDDEN_CLAIMS) {
      if (!claim.re.test(line)) continue;
      const exempt = EXEMPT_TOKENS.some((t) => line.toLowerCase().includes(t.toLowerCase()));
      if (exempt) continue;
      claimHits += 1;
      error('forbidden-claims',
        `${label}:${n + 1} 声称 DSH 具备平台不具备的能力 [${claim.id}]（如需表述为限制，请标注 NON-CAPABILITY 或使用否定表述）: ${line.trim()}`);
    }
  });
}
if (!claimHits) pass('forbidden-claims', '未发现未标注的虚假能力声明（write_scopes 强制执行 / 自动释放所有权 / 角色级 OS 沙箱）');

// ---------------------------------------------------------------- 5. registry.yaml

const registryPath = path.join(ROLES_DIR, 'registry.yaml');
let registry = null;
if (!exists(registryPath)) {
  error('registry', '缺少 roles/registry.yaml');
} else {
  registry = parseYaml(fs.readFileSync(registryPath, 'utf8'), 'registry.yaml');
  const regRoles = Array.isArray(registry.roles) ? registry.roles : [];
  const regIds = regRoles.map((r) => r && r.id);

  const missingReg = EXPECTED_REGISTRY_IDS.filter((id) => !regIds.includes(id));
  const extraReg = regIds.filter((id) => !EXPECTED_REGISTRY_IDS.includes(id));
  if (missingReg.length) error('registry', `registry.yaml 缺少角色: ${missingReg.join(', ')}`);
  if (extraReg.length) error('registry', `registry.yaml 存在非预期角色: ${extraReg.join(', ')}`);
  if (regIds.length !== EXPECTED_REGISTRY_IDS.length) {
    error('registry', `registry.yaml 角色条目数 ${regIds.length}，应为 ${EXPECTED_REGISTRY_IDS.length}`);
  }

  const subs = regRoles.filter((r) => r && r.status === 'dsh-builtin-substitute');
  const locs = regRoles.filter((r) => r && r.status === 'local-definition');
  if (subs.length !== SUBSTITUTE_COUNT) error('registry', `dsh-builtin-substitute 数量为 ${subs.length}，应为 ${SUBSTITUTE_COUNT}`);
  if (locs.length !== LOCAL_COUNT) error('registry', `local-definition 数量为 ${locs.length}，应为 ${LOCAL_COUNT}`);
  if (subs.length === SUBSTITUTE_COUNT && locs.length === LOCAL_COUNT) {
    pass('registry', `15 个角色覆盖完整，其中 ${LOCAL_COUNT} 个 local-definition、${SUBSTITUTE_COUNT} 个 dsh-builtin-substitute`);
  }

  for (const r of regRoles) {
    if (!r || !r.id) { error('registry', 'registry.yaml 存在缺少 id 的角色条目'); continue; }
    const missingKeys = REGISTRY_ROLE_KEYS.filter((k) => !(k in r));
    if (missingKeys.length) error('registry', `${r.id} 缺少字段: ${missingKeys.join(', ')}`);
    if (!REGISTRY_TYPE_VALUES.includes(r.type)) error('registry', `${r.id} type="${r.type}" 非法`);
    if (!REGISTRY_STATUS_VALUES.includes(r.status)) error('registry', `${r.id} status="${r.status}" 非法`);
    if (!SKILL_REF_STATUS_VALUES.includes(r.skill_reference_status)) {
      error('registry', `${r.id} skill_reference_status="${r.skill_reference_status}" 非法`);
    }
    if (typeof r.spawns !== 'boolean') error('registry', `${r.id} spawns 必须是布尔值`);

    const bindings = asArray(r.skill_bindings);
    const bound = asArray(r.bound_skills);
    const dangling = asArray(r.dangling_skills);
    if (!sameSet([...bound, ...dangling], bindings)) {
      error('registry', `${r.id} bound_skills + dangling_skills 与 skill_bindings 不一致（bindings=${bindings.length}, bound=${bound.length}, dangling=${dangling.length}）`);
    }
    const overlap = bound.filter((s) => dangling.includes(s));
    if (overlap.length) error('registry', `${r.id} 同一技能同时标记 bound 与 dangling: ${overlap.join(', ')}`);
    if (dangling.length && r.skill_reference_status !== 'bound-with-dangling') {
      error('registry', `${r.id} 有 dangling_skills 但 skill_reference_status != bound-with-dangling`);
    }
    if (!dangling.length && r.skill_reference_status === 'bound-with-dangling') {
      error('registry', `${r.id} skill_reference_status=bound-with-dangling 但没有 dangling_skills`);
    }

    if (r.status === 'local-definition') {
      if (r.local_definition_imported !== true) error('registry', `${r.id} 是 local-definition 但 local_definition_imported != true`);
      if (!r.local_definition) { error('registry', `${r.id} 缺少 local_definition 路径`); continue; }
      const p = path.resolve(ROOT, String(r.local_definition));
      if (!exists(p)) error('registry', `${r.id} local_definition 指向不存在的文件: ${r.local_definition}`);
      if (!(r.id in roles)) {
        error('registry', `${r.id} 标为 local-definition 但没有对应角色文件`);
        continue;
      }
      const rb = roleBindings[r.id] || { skills: [], removed: [] };
      if (!sameSet(rb.skills, bound)) {
        error('registry', `${r.id} bound_skills 与 roles/${r.id}.md 的 skills 不一致（registry=${sortedUnique(bound).join(',')} | role=${sortedUnique(rb.skills).join(',')}）`);
      }
      if (!sameSet(rb.removed, dangling)) {
        error('registry', `${r.id} dangling_skills 与 roles/${r.id}.md 的 removed_skills 不一致（registry=${sortedUnique(dangling).join(',')} | role=${sortedUnique(rb.removed).join(',')}）`);
      }
      if (r.dsh_substitute !== null && r.dsh_substitute !== undefined) {
        error('registry', `${r.id} 是 local-definition，dsh_substitute 应为 null`);
      }
    } else {
      if (r.local_definition !== null && r.local_definition !== undefined) {
        error('registry', `${r.id} 是 dsh-builtin-substitute，local_definition 应为 null`);
      }
      if (r.local_definition_imported !== false) {
        error('registry', `${r.id} 是 dsh-builtin-substitute，local_definition_imported 应为 false`);
      }
      if (!r.dsh_substitute || !String(r.dsh_substitute).trim()) {
        error('registry', `${r.id} 缺少具体 DSH 替代说明 dsh_substitute`);
      }
      if (!/未导入|not imported|no local role definition/i.test(String(r.notes || ''))) {
        error('registry', `${r.id} 缺少「未导入本地角色定义 / no local role definition was imported」的明确声明`);
      }
      if (bindings.length) warn('registry', `${r.id} 无本地定义却声明了 skill_bindings（源侧未声明自动加载，应为空）`);
    }
  }
}

// ---------------------------------------------------------------- summary

const errors = findings.filter((f) => f.level === 'ERROR');
const warnings = findings.filter((f) => f.level === 'WARN');
const passes = findings.filter((f) => f.level === 'PASS');
const deferreds = findings.filter((f) => f.level === 'DEFERRED');

for (const level of ['ERROR', 'WARN', 'DEFERRED', 'PASS']) {
  for (const f of findings.filter((x) => x.level === level)) {
    console.log(`${level.padEnd(8)} ${f.check.padEnd(18)} ${f.detail}`);
  }
}

console.log('---');
const summary = {
  roles_expected: EXPECTED_ROLE_IDS.length,
  roles_found: foundIds.length,
  registry_roles: registry && Array.isArray(registry.roles) ? registry.roles.length : 0,
  local_definitions: registry && Array.isArray(registry.roles)
    ? registry.roles.filter((r) => r && r.status === 'local-definition').length : 0,
  substitutes: registry && Array.isArray(registry.roles)
    ? registry.roles.filter((r) => r && r.status === 'dsh-builtin-substitute').length : 0,
  skill_check_ran: skillCheckRan,
  skills_dir_present: skillsAvailable,
  dangling_bindings: sortedUnique([...danglingBindings]),
  removed_bindings: sortedUnique(Object.values(roleBindings).flatMap((b) => b.removed)),
  forbidden_claim_hits: claimHits,
  errors: errors.length,
  warnings: warnings.length,
  deferred: deferreds.length,
  passes: passes.length,
  checks: {
    reviewers: allReviewers,
  },
};
console.log(`SUMMARY ${JSON.stringify(summary)}`);
if (errors.length === 0) {
  if (deferreds.length) {
    console.log('RESULT PASS (WITH DEFERRED: skills/ not yet present — rerun after WS-A; skill-existence was NOT verified)');
  } else {
    console.log('RESULT PASS (all checks ran; skill-existence enforced strictly)');
  }
  console.log('exit code 0');
  process.exit(0);
}
console.log(`RESULT FAIL (${errors.length} error(s))`);
console.log('exit code 1');
process.exit(1);
