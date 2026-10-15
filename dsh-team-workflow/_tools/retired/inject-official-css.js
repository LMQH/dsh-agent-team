#!/usr/bin/env node
// ⛔ 已退役（2026-10-14）：同 copy-official-client.js，卡片整体移除。不要运行。
// 另注：本脚本依赖 client.js 里的 `"__CSS_PLACEHOLDER__"` 占位符，该占位符早已不存在，
// 现阶段运行必然在「找不到占位符」处直接报错。见同目录 README.md。
/**
 * 从官方 @deepseek-ai/dsh-experimental-client-ui-agent-team 的客户端 bundle 里
 * 抽出内联样式表，替换 CSS-module 前缀后注入我们的 client.js 占位符。
 *
 * 这样做而不是手抄：官方 CSS 约 4KB 且含大量转义，手抄必然出错。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inspector = join(here, 'inspect-dsh-checkout.js');
const target = join(here, '..', '..', 'dsh-team-plugin', 'client.js');

const OFFICIAL = '/dsh/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/lib/client.js';
const OLD_PREFIX = '_2tNPVa_';
const NEW_PREFIX = '_teamwf_';

const source = execFileSync(process.execPath, [inspector, 'get', OFFICIAL], { encoding: 'utf8' });

const match = /const css = "((?:[^"\\]|\\.)*)";/.exec(source);
if (match === null) throw new Error('未能定位官方内联样式表');
const css = JSON.parse('"' + match[1] + '"');

if (!css.includes(OLD_PREFIX)) throw new Error('样式表里没有预期的 class 前缀');
const renamed = css.split(OLD_PREFIX).join(NEW_PREFIX);
if (renamed.includes(OLD_PREFIX)) throw new Error('前缀替换不完整');

const client = readFileSync(target, 'utf8');
const placeholder = '"__CSS_PLACEHOLDER__"';
if (!client.includes(placeholder)) throw new Error('client.js 里找不到占位符');

writeFileSync(target, client.replace(placeholder, JSON.stringify(renamed)));

console.log('官方样式表长度:', css.length, '字符');
console.log('替换前缀:', OLD_PREFIX, '→', NEW_PREFIX, '共', css.split(OLD_PREFIX).length - 1, '处');
console.log('已注入 client.js（新长度', readFileSync(target, 'utf8').length, '字符）');
