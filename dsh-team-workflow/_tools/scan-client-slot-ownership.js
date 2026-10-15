#!/usr/bin/env node
/**
 * 全量扫描：当前 profile 里**谁占用了哪些客户端 slot / locale 坐标**。
 *
 * 为什么需要它：客户端插件之间的注册冲突是**抛错**而不是覆盖
 * （`dsh-client-ui-slots` 的 list slot：同 id 同 priority 直接 throw），
 * 而且报错只出现在浏览器 console，宿主侧完全看不到。所以「我要加一张卡片」之前，
 * 必须先在离线状态把坐标占用情况查清楚。
 *
 * 用法：
 *   node scan-client-slot-ownership.js                 # 只报占用 agent-team 的包
 *   node scan-client-slot-ownership.js agent-team      # 指定要查的坐标
 *   node scan-client-slot-ownership.js agent-team team-workflow
 *
 * 数据来源：profile 的 `cordis.yml`（已解析的插件清单）+ app.asar 里的 `lib/client.js`。
 * 全程只读。
 */
import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const ASAR = process.env.DSH_ASAR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const PROFILE = process.env.DSH_PROFILE_DIR
  || join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop');

const needles = process.argv.slice(2);
const COORDS = needles.length > 0 ? needles : ['agent-team'];

// ── asar 读取 ────────────────────────────────────────────
const fd = openSync(ASAR, 'r');
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const headerLen = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerLen);
readSync(fd, headerBuf, 0, headerLen, 16);
const header = JSON.parse(headerBuf.toString('utf8'));
let base = 16 + headerLen;
while (base % 4) base += 1;

function asarNode(path) {
  let cur = header;
  for (const part of String(path).split('/').filter(Boolean)) {
    if (!cur.files || !cur.files[part]) return null;
    cur = cur.files[part];
  }
  return cur;
}
function asarRead(path) {
  const node = asarNode(path);
  if (node === null || node.files) return null;
  const buf = Buffer.alloc(node.size);
  readSync(fd, buf, 0, node.size, base + parseInt(node.offset, 10));
  return buf.toString('utf8');
}
function asarHas(path) {
  const node = asarNode(path);
  return node !== null && !node.files;
}

// ── 1. 当前 profile 实际加载的包清单 ──────────────────────
// **不能只看 cordis.yml**：它是已经「落盘解析」的那份，实测不含组合包
// （bundle）patch 里的 insert 行——例如官方 agent-team 三个包在 cordis.yml 里完全找不到，
// 但它们在运行时确实加载了。所以包清单必须是三者的并集：
//   a) profile 的 dsh.profile.bundles（含每个 bundle 自己的名）
//   b) 每个 bundle 的 dsh.bundle.patch 文件里所有 `name:` 行（insert 出来的插件）
//   c) cordis.yml 里所有 `name:` 行（含用户自己的 cordis.patch.yml 成果）
function packageDirCandidates(root) {
  return [join(PROFILE, 'node_modules', root), `/dsh/node_modules/${root}`];
}

function readPackageJson(root) {
  for (const dir of packageDirCandidates(root)) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    const asarFile = `${dir}/package.json`;
    if (asarHas(asarFile)) return JSON.parse(asarRead(asarFile));
  }
  return null;
}

function readAny(root, relative) {
  for (const dir of packageDirCandidates(root)) {
    const file = join(dir, relative);
    if (existsSync(file)) return readFileSync(file, 'utf8');
    const asarFile = `${dir}/${relative}`;
    if (asarHas(asarFile)) return asarRead(asarFile);
  }
  return null;
}

const cordisPath = join(PROFILE, 'cordis.yml');
if (!existsSync(cordisPath)) {
  console.error(`找不到已解析的插件清单：${cordisPath}`);
  process.exit(2);
}
const cordis = readFileSync(cordisPath, 'utf8');
const names = new Set([...cordis.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]));

// a) + b)
const profilePkg = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'));
const bundles = profilePkg.dsh?.profile?.bundles ?? [];
names.add('@local/dsh-team-workflow'); // 本插件自己（可能未被列进 cordis.yml 的某个版本）
for (const bundleName of bundles) {
  names.add(bundleName);
  const manifest = readPackageJson(bundleName);
  const patchRel = manifest?.dsh?.bundle?.patch;
  if (typeof patchRel !== 'string') continue;
  const patch = readAny(bundleName, patchRel.replace(/^\.\//, ''));
  if (patch === null) continue;
  for (const m of patch.matchAll(/name:\s*'([^']+)'/g)) names.add(m[1]);
}
// profile 自己的补丁层也参与解析
const userPatchPath = join(PROFILE, 'cordis.patch.yml');
if (existsSync(userPatchPath)) {
  for (const m of readFileSync(userPatchPath, 'utf8').matchAll(/name:\s*'([^']+)'/g)) names.add(m[1]);
}

// 取包根：`@scope/pkg/sub` → `@scope/pkg`
const roots = [...new Set([...names].map((n) => (n.startsWith('@') ? n.split('/').slice(0, 2).join('/') : n.split('/')[0])))]
  .sort();

// ── 2. 每个包找它的客户端 bundle ──────────────────────────
function locateClientBundle(root) {
  // a) 应用内置包：asar 里 /dsh/node_modules/<root>/lib/client.js
  for (const candidate of [`/dsh/node_modules/${root}/lib/client.js`, `/dsh/node_modules/${root}/client.js`]) {
    if (asarHas(candidate)) return { path: candidate, read: () => asarRead(candidate) };
  }
  // b) profile 自己挂的包：node_modules 下的真实路径（含 @local 符号链接）
  const dir = join(PROFILE, 'node_modules', root);
  for (const candidate of [join(dir, 'lib/client.js'), join(dir, 'client.js'), join(dir, 'client.mjs')]) {
    if (existsSync(candidate)) return { path: candidate, read: () => readFileSync(candidate, 'utf8') };
  }
  return null;
}

const scanned = [];
const occupied = [];
for (const root of roots) {
  const bundle = locateClientBundle(root);
  if (bundle === null) {
    scanned.push({ root, bundle: null, hits: [] });
    continue;
  }
  const text = bundle.read();
  const hits = [];
  for (const needle of COORDS) {
    const count = text.split(needle).length - 1;
    if (count > 0) {
      const at = text.indexOf(needle);
      hits.push({ needle, count, context: text.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ') });
    }
  }
  scanned.push({ root, bundle: bundle.path, hits });
  if (hits.length > 0) occupied.push({ root, bundle: bundle.path, hits });
}

// ── 3. 报告 ─────────────────────────────────────────────
console.log(`profile：${PROFILE}`);
console.log(`清单包数：${roots.length}；含客户端 bundle 的：${scanned.filter((s) => s.bundle !== null).length}`);
console.log(`扫描坐标：${COORDS.map((c) => JSON.stringify(c)).join(', ')}`);
console.log('');
const clientBundles = scanned.filter((s) => s.bundle !== null);
console.log('--- 客户端 bundle 清单 ---');
for (const item of clientBundles) console.log(`  ${item.root}  ←  ${item.bundle}`);
console.log('');
console.log('--- 坐标占用 ---');
if (occupied.length === 0) {
  console.log(`  没有任何已加载的客户端插件占用 ${COORDS.map((c) => JSON.stringify(c)).join(' / ')}`);
} else {
  for (const item of occupied) {
    console.log(`  ${item.root}`);
    for (const hit of item.hits) console.log(`      ${JSON.stringify(hit.needle)} × ${hit.count}  …${hit.context}…`);
  }
}

// 与本主题直接相关的包单独点名：它们「有没有客户端 bundle、占没占坐标」是最关键的两个事实。
const FOCUS = /team-workflow|agent-team/;
console.log('');
console.log('--- 焦点包 ---');
for (const item of scanned.filter((s) => FOCUS.test(s.root))) {
  const where = item.bundle === null ? '无客户端 bundle' : item.bundle;
  const claim = item.hits.length === 0 ? '未占用坐标' : `占用 ${item.hits.map((h) => JSON.stringify(h.needle)).join(', ')}`;
  console.log(`  ${item.root}  ←  ${where}；${claim}`);
}

// 组装一个可复用的结构化结果，便于写进证据文件
const summary = {
  profile: PROFILE,
  coords: COORDS,
  packageCount: roots.length,
  clientBundleCount: clientBundles.length,
  occupied: occupied.map((o) => ({
    root: o.root,
    bundle: o.bundle,
    hits: o.hits.map((h) => ({ needle: h.needle, count: h.count })),
  })),
};
if (process.env.SCAN_JSON_OUT) {
  writeFileSync(process.env.SCAN_JSON_OUT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n结构化结果：${process.env.SCAN_JSON_OUT}`);
}

closeSync(fd);
// 退出码不表达「有没有人占用」（占用是常态），只表达扫描本身成功。
process.exit(0);
