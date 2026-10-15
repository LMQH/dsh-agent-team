/*
 * 实测 SlotCore 的遮蔽语义（用于决定 C1「官方优先」的实现机制）。
 * 只读：用真实 SlotCore 注册假组件，不碰任何交付产物。
 * 结论见 evidence/client-card-v2-2026-10-14.txt。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const SLOTS = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js';
const SLOT = 'conversation.session.header.actions';
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const p = join(dir, 'slots.mjs');
writeFileSync(p, execFileSync(process.execPath, ['_tools/inspect-dsh-checkout.js', 'get', SLOTS], { encoding: 'utf8' }));
const { SlotCore } = await import(pathToFileURL(p).href);

function core2() {
  const c = new SlotCore();
  c.registerFactory({ name: 'parent', scope: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } }, () => null);
  return c;
}
const ids = (c) => c.entries(SLOT).length + ' entries / ' + c.entriesOfSlot(SLOT).length + ' winners  [' +
  c.entries(SLOT).map((e) => `${e.options.id}@prio=${e.options.priority ?? 'default'}/${e.options.order}`).join(', ') + ']';

// 场景 1：官方 id（默认 priority）+ 我方同 id、不同 priority —— 会不会抛？
const c1 = core2();
c1.register({ name: SLOT, id: 'agent-team', order: -20 }, () => 'OFFICIAL');
try {
  const mine = c1.register({ name: SLOT, id: 'agent-team', order: -19, priority: 10 }, () => 'MINE');
  console.log('场景1 同 id 不同 priority 注册：不抛');
  console.log('   ', ids(c1));
  console.log('   胜出者渲染内容 =', c1.entriesOfSlot(SLOT)[0].component === undefined ? '(见 component)' : '');
  const win = c1.entriesOfSlot(SLOT)[0];
  console.log('    胜出者 id/prio =', win.options.id, win.options.priority ?? 'default');
  mine.dispose();
  console.log('   我方 dispose 后：', ids(c1));
} catch (e) { console.log('场景1 抛错：', e.message); }

// 场景 2：只有我方（官方未启用）—— 我方应当胜出
const c2 = core2();
c2.register({ name: SLOT, id: 'agent-team', order: -19, priority: 10 }, () => 'MINE');
console.log('场景2 仅我方：', ids(c2), '胜出=', c2.entriesOfSlot(SLOT)[0].options.id);

// 场景 3：先我方后官方（加载顺序反转）
const c3 = core2();
c3.register({ name: SLOT, id: 'agent-team', order: -19, priority: 10 }, () => 'MINE');
c3.register({ name: SLOT, id: 'agent-team', order: -20 }, () => 'OFFICIAL');
console.log('场景3 先我后官方：', ids(c3), '胜出 prio=', c3.entriesOfSlot(SLOT)[0].options.priority ?? 'default');

// 场景 4：同 id 同 priority（都不写 priority）
const c4 = core2();
c4.register({ name: SLOT, id: 'agent-team', order: -20 }, () => 'OFFICIAL');
try { c4.register({ name: SLOT, id: 'agent-team', order: -19 }, () => 'MINE'); console.log('场景4 同 id 同 priority：不抛（意外）'); }
catch (e) { console.log('场景4 同 id 同 priority 抛错：', String(e.message).slice(0, 90)); }

// 场景 5：不同 id（当前做法）—— 两张都渲染
const c5 = core2();
c5.register({ name: SLOT, id: 'agent-team', order: -20 }, () => 'OFFICIAL');
c5.register({ name: SLOT, id: 'team-workflow', order: -19, priority: 10 }, () => 'MINE');
console.log('场景5 不同 id：', ids(c5), '→ 胜出', c5.entriesOfSlot(SLOT).length, '个（并存）');
