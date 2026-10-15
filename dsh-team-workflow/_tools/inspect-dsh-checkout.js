// 只读检视 DSH 实现（app.asar）—— 可行性勘察用工具。
// 只读取，不修改任何东西。asar 内文件路径形如 "dsh/node_modules/@deepseek-ai/<pkg>/..."。
//
// 用法：
//   node inspect-dsh-checkout.js roots
//   node inspect-dsh-checkout.js ls   <asar内路径>
//   node inspect-dsh-checkout.js get  <asar内文件路径>
//   node inspect-dsh-checkout.js find <子串>        # 按路径子串列出文件
const fs = require('fs');

const ASAR = process.env.DSH_ASAR ||
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

function load() {
  const fd = fs.openSync(ASAR, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerLen = head.readUInt32LE(12);
  const headerBuf = Buffer.alloc(headerLen);
  fs.readSync(fd, headerBuf, 0, headerLen, 16);
  const header = JSON.parse(headerBuf.toString('utf8'));
  let base = 16 + headerLen;
  while (base % 4) base++;             // 数据段 4 字节对齐
  return { fd, header, base };
}

function nodeAt(header, path) {
  let cur = header;
  for (const part of String(path).split('/').filter(Boolean)) {
    if (!cur.files || !cur.files[part]) return null;
    cur = cur.files[part];
  }
  return cur;
}

function walk(node, prefix, out) {
  for (const key of Object.keys(node.files || {})) {
    const child = node.files[key];
    const path = prefix + '/' + key;
    if (child.files) walk(child, path, out);
    else out.push(path);
  }
  return out;
}

const [cmd, arg] = process.argv.slice(2);
const { fd, header, base } = load();

if (cmd === 'roots') {
  console.log(Object.keys(header.files).join('\n'));
} else if (cmd === 'ls') {
  const n = nodeAt(header, arg);
  console.log(n ? (n.files ? Object.keys(n.files).join('\n') : '(file)') : 'NOT FOUND');
} else if (cmd === 'find') {
  console.log(walk(header, '', []).filter((p) => p.includes(arg)).join('\n'));
} else if (cmd === 'get') {
  const n = nodeAt(header, arg);
  if (!n) { console.error('NOT FOUND: ' + arg); process.exit(1); }
  if (n.files) { console.log(walk(n, arg, []).join('\n')); process.exit(0); }
  const buf = Buffer.alloc(n.size);
  fs.readSync(fd, buf, 0, n.size, base + parseInt(n.offset, 10));
  process.stdout.write(buf);
} else {
  console.error('usage: roots | ls <p> | get <p> | find <substr>');
  process.exit(2);
}
