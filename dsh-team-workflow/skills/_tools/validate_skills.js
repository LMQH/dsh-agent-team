#!/usr/bin/env node
'use strict';

/*
 * validate_skills.js — static validator for the DSH skills root.
 *
 * Run:            node skills/_tools/validate_skills.js
 * Working dir:    irrelevant; the skills root is derived from this file's location.
 * Dependencies:   Node standard library only. No npm install, no `yaml` package.
 *
 * It deliberately re-implements the platform's frontmatter contract (name/description/whenToUse,
 * strict-boolean invocation keys, legacy camelCase rejection, one-level discovery) because malformed
 * frontmatter makes the real host skip a skill with a warning only, so a failing validator is the
 * only model-visible safety net.
 *
 * Stdout: one machine-readable JSON summary.
 * Stderr: the same failures in a short human-readable form.
 * Exit:   0 when there are no ERRORs, 1 otherwise. Warnings never change the exit code.
 */

const fs = require('fs');
const path = require('path');

const SKILLS_ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ expectations */

// The delivered inventory: 15 team skills + 9 shared skills. Any drift is an ERROR.
const EXPECTED_SKILLS = [
  // team (sources/omp/skills)
  'agent-usage-ledger',
  'architecture-delivery',
  'backend-delivery',
  'code-review-delivery',
  'compliance-delivery',
  'docker-artifact-safety',
  'frontend-delivery',
  'harness-delivery',
  'hermes-obsidian',
  'operations-delivery',
  'product-delivery',
  'qa-delivery',
  'quota-governance',
  'team-workflow',
  'technical-design-delivery',
  // shared (sources/shared/skills)
  'anti-fake-testing',
  'code-review-defect-patterns',
  'cross-team-contract-alignment',
  'database-design-checklist',
  'pm-requirements',
  'react-best-practices',
  'security-test-matrix',
  'verification-before-completion',
  'web-architecture-patterns',
];

// Resource files that must be carried inside their owning bundle.
const EXPECTED_RESOURCES = [
  'code-review-defect-patterns/references/architecture-decision-conflicts.md',
  'hermes-obsidian/scripts/wiki_dedup.py',
  'hermes-obsidian/scripts/wiki_ingest.py',
  'hermes-obsidian/scripts/wiki_lint.py',
  'hermes-obsidian/tests/test_wiki_lint.py',
  'web-architecture-patterns/references/api-platform-compatibility.md',
  'web-architecture-patterns/references/demo-frontend-with-docker.md',
  'web-architecture-patterns/references/dual-platform-html-test-tool.md',
  'web-architecture-patterns/references/html-to-react-spa-refactor.md',
  'web-architecture-patterns/references/kling-ai-api.md',
  'web-architecture-patterns/references/new-api-videos-endpoint.md',
  'web-architecture-patterns/references/proxy-aware-adapters.md',
];

// Dangling autoload bindings: these must NOT have a SKILL.md (no stub — see MISSING-SKILLS.md).
const DANGLING_NAMES = ['react-page-implementation', 'branch-diff-static-review'];

// Non-skill deliverables that must exist at the skills root.
const EXPECTED_ROOT_FILES = ['MISSING-SKILLS.md', 'CONVERSION-NOTES.md'];

// Source-local / host paths that must not survive the migration.
const FORBIDDEN_PATTERNS = [
  { label: 'source-user-path', re: /\/Users\/lmqhx/ },
  { label: 'source-omp-home', re: /~\/\.omp/ },
  { label: 'source-codex-home', re: /~\/\.codex/ },
  { label: 'skill-uri', re: /skill:\/\// },
  { label: 'resource-package-path', re: /\/Users\/maxwell\/Downloads/ },
];

// A line carrying this marker is an explicit, reviewed "not configured" statement.
const NOT_CONFIGURED_MARKER = /not configured/i;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KNOWN_TOP_LEVEL_KEYS = new Set([
  'name',
  'description',
  'whenToUse',
  'metadata',
  'disable-model-invocation',
  'user-invocable',
]);
const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable'];

const MIN_BODY_CHARS = 100;
const STUB_BODY_RE = /^\s*(?:TODO|TBD|WIP|stub|placeholder)\b/i;
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.yaml', '.yml', '.sh', '.toml', '.cfg', '.ini']);

/* ------------------------------------------------------------------ reporting */

const errors = [];
const warnings = [];
const infos = [];
function error(code, message, detail) {
  errors.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}
function warn(code, message, detail) {
  warnings.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}
function info(code, message, detail) {
  infos.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

/* ------------------------------------------------------------------ frontmatter */

function unquoteScalar(rest) {
  const text = rest.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

/**
 * Minimal YAML frontmatter reader for the subset this repository uses.
 * Top-level `key: value` scalars plus nested blocks. Nested content is recorded as a block, not parsed.
 * @returns {{ok: true, data: object, raw: object, blocks: object, body: string} | {ok: false, error: string}}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { ok: false, error: 'missing YAML frontmatter' };
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { ok: false, error: 'frontmatter block is not terminated by a closing ---' };

  const raw = {};
  const data = {};
  const blocks = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^[ \t]/.test(line)) continue; // nested content belongs to the previous key
    const kv = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
    if (!kv) return { ok: false, error: `unparsable frontmatter line ${i + 1}: ${JSON.stringify(line)}` };
    const key = kv[1];
    const rest = kv[2];
    raw[key] = rest;
    if (/^[ \t]*[|>][+-]?[ \t]*$/.test(rest)) {
      blocks[key] = true;
      data[key] = undefined;
      continue;
    }
    const trimmed = rest.trim();
    if (trimmed === '') {
      blocks[key] = true;
      data[key] = undefined;
      continue;
    }
    data[key] = unquoteScalar(rest);
  }

  return { ok: true, data, raw, blocks, body: content.slice(match[0].length) };
}

function strictBoolean(raw) {
  const text = (raw === undefined ? '' : raw).trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

/* ------------------------------------------------------------------ filesystem helpers */

function listDir(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkFiles(abs, out = []) {
  for (const entry of listDir(abs)) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) walkFiles(child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function isTextFile(file) {
  return TEXT_EXT.has(path.extname(file).toLowerCase());
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ checks */

const summary = {
  tool: 'validate_skills.js',
  skillsRoot: SKILLS_ROOT,
  expectedSkillCount: EXPECTED_SKILLS.length,
  discoveredSkillCount: 0,
  deliveredFileCount: 0,
  deliveredBytes: 0,
  skills: [],
  rootLevelMarkdown: [],
  nonSkillDirectories: [],
  danglingSkillFiles: [],
  stubSkills: [],
  unresolvedResourcePaths: [],
  unreferencedResources: [],
  forbiddenPathHits: [],
  notConfiguredMarkerLines: [],
  errors,
  warnings,
  infos,
};

function validateBundle(name, dir) {
  const skillFile = path.join(dir, 'SKILL.md');
  const content = fs.readFileSync(skillFile, 'utf8');
  const parsed = parseFrontmatter(content);
  const record = {
    name,
    dirName: name,
    path: path.relative(SKILLS_ROOT, skillFile),
    discoverablePath: `<root>/${name}/SKILL.md`,
    dirNameMatchesFrontmatterName: null,
    kebabCase: KEBAB.test(name),
    unique: true,
    descriptionChars: 0,
    whenToUse: false,
    modelInvocable: true,
    userInvocable: true,
    bodyChars: 0,
    bytes: fileBytes(skillFile),
    resources: [],
  };

  if (!parsed.ok) {
    error('frontmatter-invalid', `${record.path}: ${parsed.error} (the host would silently skip this skill)`);
    summary.skills.push(record);
    return { record, content: '', body: '', frontmatterName: undefined };
  }

  // Legacy camelCase invocation keys are rejected by the platform (whole file skipped).
  for (const legacy of LEGACY_INVOCATION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed.data, legacy) || Object.prototype.hasOwnProperty.call(parsed.raw, legacy)) {
      error('legacy-invocation-key', `${record.path}: legacy key "${legacy}" is unsupported by DSH (use kebab-case)`);
    }
  }

  const fmName = typeof parsed.data.name === 'string' ? parsed.data.name : undefined;
  const fmDescription = typeof parsed.data.description === 'string' ? parsed.data.description : undefined;
  const fmWhenToUse = typeof parsed.data.whenToUse === 'string' ? parsed.data.whenToUse : undefined;

  record.dirNameMatchesFrontmatterName = fmName === name;
  if (fmName === undefined) error('name-missing', `${record.path}: frontmatter "name" is missing or not a non-empty string`);
  else if (!KEBAB.test(fmName)) error('name-not-kebab-case', `${record.path}: frontmatter name "${fmName}" is not kebab-case`);
  else if (fmName !== name) error('name-directory-mismatch', `${record.path}: directory "${name}" != frontmatter name "${fmName}"`);

  if (fmDescription === undefined || fmDescription.trim() === '') {
    error('description-missing', `${record.path}: frontmatter "description" is required and must be non-empty`);
  } else {
    record.descriptionChars = fmDescription.length;
  }

  record.whenToUse = fmWhenToUse !== undefined && fmWhenToUse.trim() !== '';
  if (Object.prototype.hasOwnProperty.call(parsed.raw, 'whenToUse') && !record.whenToUse) {
    error('when-to-use-invalid', `${record.path}: "whenToUse" must be a non-empty string when present`);
  }

  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (!Object.prototype.hasOwnProperty.call(parsed.raw, key)) continue;
    const value = strictBoolean(parsed.raw[key]);
    if (value === undefined) {
      error('invocation-not-strict-boolean', `${record.path}: "${key}" must be the boolean true or false (got ${JSON.stringify(parsed.raw[key].trim())})`);
    } else if (key === 'disable-model-invocation') {
      record.modelInvocable = value !== true;
    } else {
      record.userInvocable = value !== false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed.raw, 'metadata')) {
    const isBlock = parsed.blocks.metadata === true;
    const isInlineObject = typeof parsed.data.metadata === 'string' && parsed.data.metadata.trim().startsWith('{');
    if (!isBlock && !isInlineObject) {
      error('metadata-not-object', `${record.path}: "metadata" must be a mapping`);
    }
  }

  for (const key of Object.keys(parsed.raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warn('unknown-frontmatter-key', `${record.path}: top-level key "${key}" is ignored by DSH (kept out of the delivered frontmatter on purpose)`);
    }
  }

  const body = parsed.body;
  record.bodyChars = body.trim().length;
  if (record.bodyChars < MIN_BODY_CHARS) {
    summary.stubSkills.push(record.path);
    error('stub-skill', `${record.path}: body has ${record.bodyChars} chars (< ${MIN_BODY_CHARS}) — looks empty or placeholder`);
  }
  if (STUB_BODY_RE.test(body)) {
    summary.stubSkills.push(record.path);
    error('stub-skill', `${record.path}: body starts with a stub/placeholder marker`);
  }

  validateResources(record, dir, body);
  scanForbiddenPaths(record.path, skillFile, content);

  summary.skills.push(record);
  return { record, content, body, frontmatterName: fmName };
}

function validateResources(record, dir, body) {
  const referenced = new Set();
  const re = /(?:^|[^\w./-])((?:\.\.\/)?(?:references|scripts|assets)\/[A-Za-z0-9._\-/]+)/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const rel = match[1].replace(/[.,;:)\]]+$/, '');
    referenced.add(rel);
    const abs = path.resolve(dir, rel);
    if (!fs.existsSync(abs)) {
      summary.unresolvedResourcePaths.push(`${record.path} -> ${rel}`);
      error('resource-missing', `${record.path}: referenced resource "${rel}" does not resolve inside the bundle`);
    }
  }
  record.resources = [...referenced].sort();

  const present = walkFiles(dir)
    .map((file) => path.relative(dir, file).split(path.sep).join('/'))
    .filter((rel) => rel !== 'SKILL.md');
  for (const rel of present) {
    if (!referenced.has(rel)) {
      summary.unreferencedResources.push(`${record.path} :: ${rel}`);
      warn('unreferenced-resource', `${record.path}: resource "${rel}" is delivered but not referenced by SKILL.md`);
    }
  }
}

function scanForbiddenPaths(displayPath, absFile, content) {
  if (!isTextFile(absFile)) return;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { label, re } of FORBIDDEN_PATTERNS) {
      if (!re.test(line)) continue;
      if (NOT_CONFIGURED_MARKER.test(line)) {
        summary.notConfiguredMarkerLines.push({ file: displayPath, line: i + 1, pattern: label });
        continue;
      }
      summary.forbiddenPathHits.push({ file: displayPath, line: i + 1, pattern: label });
      error('forbidden-path', `${displayPath}:${i + 1}: unresolved ${label} — remap it or mark the line "not configured"`);
    }
  }
}

/* ------------------------------------------------------------------ run */

function main() {
  if (!fs.existsSync(SKILLS_ROOT)) {
    error('skills-root-missing', `skills root not found: ${SKILLS_ROOT}`);
    return;
  }

  const entries = listDir(SKILLS_ROOT);
  const bundleDirs = [];
  const rootMarkdown = [];
  const nonSkillDirs = [];

  for (const entry of entries) {
    const abs = path.join(SKILLS_ROOT, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(path.join(abs, 'SKILL.md'))) bundleDirs.push({ name: entry.name, dir: abs });
      else nonSkillDirs.push(entry.name);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      rootMarkdown.push(entry.name);
    }
  }

  summary.discoveredSkillCount = bundleDirs.length;
  summary.nonSkillDirectories = nonSkillDirs.sort();
  summary.rootLevelMarkdown = rootMarkdown.sort();

  // --- root-level markdown files are scanned by the platform as candidate single-file skills.
  for (const file of summary.rootLevelMarkdown) {
    const abs = path.join(SKILLS_ROOT, file);
    const parsed = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
    if (parsed.ok && typeof parsed.data.name === 'string' && KEBAB.test(parsed.data.name)) {
      error('root-markdown-is-skill', `${file}: root-level markdown with a valid kebab-case skill name would be discovered as a skill; deliverable requires <name>/SKILL.md bundles`);
    } else {
      warn('root-markdown-skipped', `${file}: scanned by the platform as a candidate single-file skill, then skipped (no valid frontmatter). Harmless; the mandated filename keeps it here.`);
    }
  }

  // --- expected non-skill deliverables
  for (const file of EXPECTED_ROOT_FILES) {
    if (!fs.existsSync(path.join(SKILLS_ROOT, file))) {
      error('deliverable-missing', `required document missing: ${file}`);
    }
  }

  // --- per bundle
  const seenNames = new Map();
  for (const { name, dir } of bundleDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    validateBundle(name, dir);
  }
  for (const record of summary.skills) {
    const key = record.name;
    if (seenNames.has(key)) {
      record.unique = false;
      error('name-duplicate', `frontmatter name "${key}" is used by both ${seenNames.get(key)} and ${record.path}`);
    } else {
      seenNames.set(key, record.path);
    }
  }

  // --- expected inventory
  const discoveredNames = new Set(summary.skills.map((s) => s.name));
  for (const name of EXPECTED_SKILLS) {
    if (!discoveredNames.has(name)) {
      error('skill-missing', `expected skill "${name}" is not discoverable at <root>/${name}/SKILL.md`);
    }
  }
  for (const name of discoveredNames) {
    if (!EXPECTED_SKILLS.includes(name)) {
      error('skill-unexpected', `undelivered skill "${name}" is present at <root>/${name}/SKILL.md`);
    }
  }

  // --- expected resources
  for (const rel of EXPECTED_RESOURCES) {
    if (!fs.existsSync(path.join(SKILLS_ROOT, rel))) {
      error('resource-not-carried', `expected resource missing: ${rel}`);
    }
  }

  // --- accidental nested SKILL.md (the platform would never discover it)
  for (const file of walkFiles(SKILLS_ROOT)) {
    if (path.basename(file) !== 'SKILL.md') continue;
    const rel = path.relative(SKILLS_ROOT, file).split(path.sep).join('/');
    const segments = rel.split('/');
    if (segments.length === 2 && segments[1] === 'SKILL.md') continue; // exactly <root>/<name>/SKILL.md
    error('nested-skill-file', `${rel}: SKILL.md is not at <root>/<name>/SKILL.md; DSH discovery is exactly one level deep and would not find it`);
  }

  // --- dangling bindings must not have a SKILL.md, and must not be stubbed anywhere
  for (const name of DANGLING_NAMES) {
    const candidate = path.join(SKILLS_ROOT, name, 'SKILL.md');
    if (fs.existsSync(candidate)) {
      summary.danglingSkillFiles.push(`${name}/SKILL.md`);
      error('dangling-skill-file', `${name}/SKILL.md exists but this name has no source implementation — no stub may be created (see MISSING-SKILLS.md)`);
    }
    for (const record of summary.skills) {
      if (record.name === name) {
        error('dangling-skill-name', `${record.path}: frontmatter name "${name}" belongs to a dangling binding and must not be delivered`);
      }
    }
  }

  // --- forbidden paths in any text resource inside a bundle
  for (const { dir } of bundleDirs) {
    for (const file of walkFiles(dir)) {
      if (!isTextFile(file)) continue;
      const rel = path.relative(SKILLS_ROOT, file).split(path.sep).join('/');
      if (rel.endsWith('/SKILL.md')) continue; // already scanned
      scanForbiddenPaths(rel, file, fs.readFileSync(file, 'utf8'));
    }
  }

  // --- totals over all delivered files under the skills root
  const allFiles = walkFiles(SKILLS_ROOT).sort();
  summary.deliveredFileCount = allFiles.length;
  summary.deliveredBytes = allFiles.reduce((sum, file) => sum + fileBytes(file), 0);
  summary.files = allFiles.map((file) => ({
    path: path.relative(SKILLS_ROOT, file).split(path.sep).join('/'),
    bytes: fileBytes(file),
  }));

  info('non-skill-directories', `directories without SKILL.md (ignored by discovery): ${summary.nonSkillDirectories.join(', ') || '(none)'}`);
  info('not-configured-markers', `${summary.notConfiguredMarkerLines.length} source-local/host path line(s) explicitly marked "not configured"`);
}

try {
  main();
} catch (err) {
  error('validator-crash', `${err && err.stack ? err.stack : String(err)}`);
}

summary.ok = errors.length === 0;
summary.errorCount = errors.length;
summary.warningCount = warnings.length;

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (errors.length > 0) {
  process.stderr.write(`\nvalidate_skills.js: ${errors.length} ERROR(s)\n`);
  for (const e of errors) process.stderr.write(`  ERROR [${e.code}] ${e.message}\n`);
  if (warnings.length > 0) {
    process.stderr.write(`  (${warnings.length} warning(s) — see JSON summary)\n`);
  }
  process.exitCode = 1;
} else {
  process.stderr.write(`\nvalidate_skills.js: OK — ${summary.discoveredSkillCount} skills, ${summary.deliveredFileCount} files, ${summary.deliveredBytes} bytes, ${warnings.length} warning(s)\n`);
  for (const w of warnings) process.stderr.write(`  WARN  [${w.code}] ${w.message}\n`);
  process.exitCode = 0;
}
