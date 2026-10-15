# 客户端插件（client plugin）加载顺序与注册冲突行为

- 扫描对象：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
- 版本：`@deepseek-ai/dsh-desktop-runtime` **0.2.0-rc.2**；`@deepseek-ai/dsh-client-modules` **0.2.0-rc.2**；`@deepseek-ai/cordis` 4.0.4；`cordis-plugin-loader` 1.0.5
- 方法：`inspect-dsh-checkout.js get` 逐文件导出到 `/tmp` 后逐行阅读 + 自写只读 asar 内容检索脚本（`/tmp/asar-grep.js`、`/tmp/asar-grep2.js`）。**未修改任何既有文件。**
- 重要时效性说明：本报告开工时 `@local/dsh-team-workflow` 的 `client.js` 仍存在（32385 字节，mtime 14:30），其内容与 asar 内的 `@deepseek-ai/dsh-experimental-client-ui-agent-team/lib/client.js` **逐字节相同（仅 bundle id 一行不同）**。扫描过程中该文件于 **15:18 被删除**，`package.json` 同时移除了 `dsh.client` 声明与 `./client` 导出（父 Agent 正在做的修复）。因此：
  - 代码行号级证据统一引用 asar 内的 `dsh-experimental-client-ui-agent-team/lib/client.js`（同一份代码，可复核）；
  - 插件 A 的行号（429 / 509 / 530）是删除前实测所得，标注为"删除前读数"。

---

## 0. 结论速览（TL;DR）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 谁加载客户端插件 | 宿主半边 `@deepseek-ai/dsh-client-modules` 扫 `dsh.client` 组装 `window.__DSH_BOOT__`；浏览器半边由 **Vite 外壳 bundle**（`dsh-web-frontend`）的 boot 控制器 `__ModuleLoader__.create()` + `ClientEntries.start()` 逐个建 Loader entry，再由 cordis Loader 调各插件 `apply()` |
| 2 | 顺序如何决定 | 宿主侧数组顺序 = **按 `dsh.client.external` 拓扑排序，同层按 Loader 扫描顺序**（`orderByModuleGraph`，无包名排序）；浏览器侧 `start()` 用 **`Promise.all` 并发建 entry**，`apply()` 实际先后由各 bundle 到达/物化时机决定，**没有串行保证** |
| 3 | `immediately` 是什么 | **只是"预取层"（prefetch tier）**：外壳在所有 entry 启动之前 `await` 一次对 `immediately` 插件的 bundle 预取。全 asar 中 `immediately` 只有这一处消费点。它**不**重排 `manifest.plugins`，**不**是优先级，也**不**保证先 apply |
| 4 | `apply()` 抛异常 | 只有该插件自己的 fiber 变 `FAILED`（不牵连兄弟插件），但 boot 内核随后的**激活审计会 throw**，导致**整个 Web 客户端不挂载**（停在 "Failed to load plugins" 页）。该审计错误在桌面端经 IPC 上报宿主并写崩溃报告；浏览器端只有 boot 页 + 一次 `console.error`。**插件真实的异常消息不进 console**（只落 cordis logger 的 1000 条内存环形缓冲，没有任何 exporter 读它） |
| 5 | `locale.register` 同 ns 重复 | **throw**：`locale namespace "<ns>" already has locale "<locale>"`（按 locale 键逐个判重）。同 ns 的新 locale 键可以增量加；同 ns 同 locale 键必炸 |
| 6 | `order` vs `priority` | **两个不同字段**。`priority`（默认 0）是**遮蔽轴**：同 id 只在**相同 priority** 时冲突 throw；不同 priority 可共存，**每 id 只有最低 priority 的那个渲染**。`order`（默认 0）只是同 priority 内的显示排序 |
| 7 | 两个插件能否共存 | **槽位可以**（改成不同 priority 即可）；**locale 不行**（无 priority/merge 机制，必须换 ns 或换 locale 键）。即：只改槽位 priority **修不好**这个冲突 |
| 8 | 失败的插件会回滚吗 | **会**。fiber 装载失败 → `_error` 置位、epoch 回 `INACTIVE` → `_unload()` 逆序 dispose 该 fiber 在本次 apply 中收集到的全部 `ctx.effect`（含 `ctx.locale.register` 与 `ctx.slots.register` 的注册）。**赢家的注册不受影响** |

---

## 1. 客户端插件由谁加载、顺序如何决定

### 1.1 宿主半边：扫 `dsh.client` → 组装 boot 图

文件：`/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`

**(a) `dsh.client` 声明解析**（`immediately` 在此只做布尔校验，并进入图行）

```js
// lib/index.js:61-76
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	...
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return {
		platform: decl.platform,
		...inject !== void 0 ? { inject } : {},
		...external !== void 0 ? { external } : {},
		...decl.immediately !== void 0 ? { immediately: decl.immediately } : {}
	};
}
```

```js
// lib/index.js:396-404（graphRow：只有 immediately=true 才会写进 wire）
function graphRow(id, rev, fields) {
	return {
		id,
		url: comboReference([id], rev),
		rev,
		...fields.inject !== void 0 ? { inject: fields.inject } : {},
		...fields.immediately ? { immediately: true } : {},
		...fields.external.length > 0 ? { external: fields.external } : {}
	};
}
```

**(b) 顺序 = 拓扑排序（仅按 `external` 依赖），同层保持扫描顺序，无包名/字典序排序**

```js
// lib/index.js:410-437
/**
* Order composed rows so every requested dynamic package precedes its
* consumers. ...
* @returns the same rows reordered; scan order breaks every tie.
*/
function orderByModuleGraph(entries) {
	const rowsById = new Map();
	for (const entry of entries) rowsById.set(entry.id, entry);
	const ordered = []; const placed = new Set(); const open = [];
	const visit = (entry) => {
		if (placed.has(entry.id)) return;
		...
		for (const name of entry.external ?? []) {
			const dependency = rowsById.get(name) ?? rowsById.get(stripClientSuffix(name));
			if (dependency === entry) throw new Error(`client-modules: "${entry.id}" requests module "${name}" that it answers itself ...`);
			if (dependency !== void 0) visit(dependency);          // ← 只把 external 当依赖边
		}
		open.pop(); placed.add(entry.id); ordered.push(entry);
	};
	for (const entry of entries) visit(entry);
	return ordered;
}
```

```js
// lib/index.js:649-656（compose：table 的插入顺序即"扫描顺序"的平局判据）
compose() {
	const entries = orderByModuleGraph([...this.table.values()].map((record) => record.entry));
	const bootstrap = PARSER_PRELOAD_IDS.map((id) => this.table.get(id)).filter((record) => record !== void 0);
	...
	for (const records of partitionComboRecords(bootstrap)) artifacts.push(buildBatch("bootstrap", records, this.readSourceMap));
	for (const records of partitionComboRecords(application)) artifacts.push(buildBatch("application", records, this.readSourceMap));
```

`this.table` 是 `Map`，插入顺序来自 `flush → processOne`，而 `dirty` 集合来自 **Loader entry 扫描顺序**：

```js
// lib/index.js:539-541
for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);
...
// lib/index.js:893-900
flush(onError) {
	let changed = false;
	for (const entryName of [...this.dirty]) {          // Set 保持插入顺序
		this.dirty.delete(entryName);
		try { if (this.processOne(entryName, onError)) changed = true; }
		catch (error) { onError(...); }
```

> 注意：`dsh.client.inject` **不参与**这里的排序（`orderByModuleGraph` 只看 `external`）。`inject` 只在浏览器侧的"到达顺序"里被用到（见 1.3）。

**(c) 批次与注入行：application 批次是 head 里的 preload，bootstrap 批次是阻塞脚本**

```js
// lib/index.js:440-500（节选）
const CLIENT_MODULES_ID = "@deepseek-ai/dsh-client-modules";
const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID];
function bootInjections(graph) {
	const queue = `(()=>{ ... window.__ModuleLoader__={ mode:"queue", pendingQueue, load(r){pendingQueue.push(r)}, create(options){...} } })()`;
	const bootstrap  = graph.batches.filter((batch) => batch.phase === "bootstrap");
	const application = graph.batches.filter((batch) => batch.phase === "application");
	const rows = [{ kind: "script", placement: "head", text: queue }];
	for (const batch of application) rows.push({ kind: "script-preload", src: batch.url });
	for (const batch of bootstrap)  rows.push({ kind: "script-src", placement: "head", src: batch.url });
	rows.push({ kind: "global", name: "__DSH_BOOT__", value: graph });
	return rows;
}
```

```js
// /dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:38-41
case "script-preload": return {
	placement: "head",
	markup: `<link rel="preload" as="script" href="${escapeHtmlAttribute(row.src)}">`
};
```

即：application 批次只是**预加载**（浏览器提前取网络资源，不执行），实际执行时机由浏览器侧按需插 `<script>` 决定。

**(d) 批次切分只受 URL 长度限制，与 `immediately` 无关**

```js
// lib/index.js:236-256
/** Partition one phase in graph order without allowing a generated URL above the protocol limit. */
function partitionComboRecords(records) {
	const chunks = []; let current = [];
	for (const record of records) {
		const candidate = [...current, record];
		if (projectedComboUrlBytes(candidate) <= MAX_COMBO_URL_BYTES) { current = candidate; continue; }
		...
	}
	...
}
```

### 1.2 外壳（浏览器 boot 内核）：`immediately` 的唯一消费点

文件：`/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js`（Vite 产物，**整个应用压在第 126 行**；以下引文为该行内的子串，为便于阅读做了换行/缩进重排，token 与原文一致）

```js
// index-5SrrfWpU.js:126  （class dM = boot 控制器）
async run(e){try{
  await globalThis.__DSH_BOOT_READY__?.promise;
  const n=globalThis,o=n.__ModuleLoader__;
  if(o===void 0)throw new Error("web boot: window.__ModuleLoader__ bootstrap facade is missing");
  const s=globalThis.__DSH_TRANSPORT__;
  this.modules=o.create({boot:n.__DSH_BOOT__,staticModules:rM(),...s?.loadBundle===void 0?{}:{loadBundle:s.loadBundle},...this.seams}),
  this.manifest=this.modules.manifest;
  const a=this.prefetchImmediateTier(),        // ← ① 先发动 immediate 预取
        u=new Ge;
  this.ctx=u, this.page.setTotal(this.manifest.plugins.length),
  await a,                                     // ← ② 等预取全部结束（.catch 吞错）
  await JS({ctx:u,modules:this.modules,manifest:this.manifest,onEntryState:(f,h)=>{(e===void 0||h!=="failed")&&this.page.setState(f,h)}}),
  this.stopDragRecall=sM({document:this.container.ownerDocument}),
  await nM(u,this.container)                   // ← ⑤ 挂载应用（只有前面都不抛才到这里）
}catch(n){console.error(n), e!==void 0?e(n):this.page.fail(n instanceof Error?n.message:String(n))}}

async prefetchImmediateTier(){
  await Promise.all(this.manifest.plugins.filter(e=>e.immediately).map(e=>this.modules.prefetch(e.id).catch(n=>{})))
}
```

```js
// index-5SrrfWpU.js:126  （JS = 客户端内核：装 Loader、启动全部 entry、激活审计）
async function JS(e){const{ctx:n,manifest:o,onEntryState:s}=e;
  await n.plugin(mf);                          // mf = 浏览器版 Loader
  const a=n.loader; a.internal=e.modules;
  n.on("internal/status",f=>{const h=f.entry;h===void 0||h.fiber===void 0||s?.(h.options.name,A7[h.fiber.state])});
  const u=o.plugins.map(f=>f.id);
  for(const f of u) s?.(f,"loading");
  await e.modules.entries.start(a,o);          // ← ③ 并发建 entry，各插件 apply()
  for(const f of a.entries()) f.fiber===void 0&&s?.(f.options.name,"failed");
  await a.await();
  eM(n,e.modules)                              // ← ④ 激活审计，任一条未 active 就 throw
}
```

**`immediately` 的语义由此完全确定**：它是一个**预取层**——`immediately: true` 的插件 bundle 在**所有 entry 启动之前**被 `prefetch`（脚本执行完、factory 注册好）。全 asar 内容检索 `immediately` 的消费点只有：`parseDshClient`（校验/透传）、`parseBootManifest`（透传）、`graphRow`（写入 wire）、`resolveMeta`（读取声明）、以及上面这一处 `prefetchImmediateTier`。**没有任何排序/优先级逻辑读它。**

因此：
- `immediately` **不是**"先加载后加载"的顺序开关，它是"提前取包"；
- 它**会间接影响** apply 先后：被预取的插件 factory 已就绪，`modules.import(id)` 走"已注册 factory → 直接物化"的快路径，而未被预取的插件要走一次 `<script>` 传输（至少一个 macrotask）。**但这是实现副作用，不是契约**（推论，未在浏览器实测）；
- 如果两个插件被切进**同一个 application 批次**（URL 未超 3 KiB，见 `partitionComboRecords`），预取其中一个等于把整批脚本都执行了，两者 factory 同时就绪，这个"提前量"就消失了——顺序退回 1.3 的并发竞态。

### 1.3 浏览器侧：`start()` 并发建 entry —— apply 顺序无串行保证

文件：`/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js`

```js
// lib/client.js:114-140（parseBootManifest：plugins 视图把 immediately 归一成布尔）
moduleFields.push({ id: row.id, url: row.url, rev: row.rev, inject: ..., external: ... });
plugins.push({ id: row.id, inject: ..., immediately: row.immediately === true });
```

```js
// lib/client.js:254-269（start：注意 Promise.all —— 并发，且全程没有按 immediately 排序/分流）
start(loader, manifest) {
	if (this.loader !== void 0) throw new Error("client-modules: entries already started");
	this.loader = loader;
	this.desired = manifest;
	loader.ctx.effect(() => () => { this.stopped = true; this.generation++; return this.queue; }, "client-modules: entry reconciliation");
	return this.enqueue(async () => {
		await Promise.all(this.desired.plugins.map(async ({ id }) => {
			await this.create(loader, id);
		}));
		await loader.await();
		for (const row of this.modules.manifest.modules) this.revisions.set(row.id, row.rev);
	});
}
```

`plugins` 数组顺序 = `graph.entries` 顺序（1.1b），`start()` **保留了数组顺序去发起**，但用 `Promise.all` 并发等待——每个 `create()` 内部要走 `loader.create → Entry.init → tree.import → loader.internal.import(ClientModuleSystem.import)`，**apply 的真正先后取决于各 bundle 的到达/物化完成时机 + 微任务排队**。

`create()` 本身（`ClientEntries.create`，`lib/client.js:353-360`）先 `loader.ensureId(options)` 同步占位，因此 **entry id 分配顺序严格等于 manifest 顺序**（`Group.create` 里 `this.tree.store[id] ??= new Entry(...)`，见 `cordis-plugin-loader/src/config/group.ts:20-28`），但 `apply()` 不是。

`Entry._init` 里插件回调（apply）的调用点：

```ts
// /dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/entry.ts:197-215
private async _init() {
	let exports: any
	try { exports = await this.parent.tree.import(this.options.name, this.getOuterStack) }
	catch (error) { this.ctx.logger.error(error); return }        // ← 导入失败只记日志、不抛
	finally { this._initTask = undefined }
	const plugin = this.loader.unwrapExports(exports)
	this._patchContext([])
	this.loader.showLog(this, 'apply')
	this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack).ctx.fiber
}
```

```ts
// /dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/tree.ts:112-128
import(name: string, getOuterStack?: () => string[]) {
	if (name.startsWith('cordis:')) return this.ctx.loader.builtins[name.slice(7)]
	return composeError(async (info) => {
		info.offset += 3
		if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl!, {})
		...
```

而 `registry.plugin()` **不会同步执行 apply**：fiber 的 `_reload()` 先 `await Promise.resolve()` 再跑插件体（见 §2 引文），所以 apply 发生在之后的微任务里。

**结论**：客户端插件 apply 顺序 = *manifest 顺序做完"发起"，实际先后由异步完成时机决定*。`@deepseek-ai/dsh-client-modules/README.md:12` 只说宿主侧 bundle 是 "ordered so dynamic providers load before their consumers"（即 `external` 依赖序），**没有任何地方承诺两个互不依赖的插件谁先 apply**。

---

## 2. `apply()` 抛异常时框架怎么处理

### 2.1 fiber 层：只该插件 FAILED + 该插件自身注册回滚

文件：`/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts`

```ts
// fiber.ts:646-673
private async _reload() {
  this.store = { ...this._store }
  const oldEpoch = this._runner.epoch
  try {
    await Promise.resolve()
    if (this._runner.epoch === oldEpoch) {
      this.config = this._resolveConfig(this._config)
      await this._execute(this._runner)          // ← apply(ctx) 在这里跑
      this._error = undefined
    }
  } catch (reason) {
    this.ctx.logger.error(reason)               // ← 真实异常只进 logger（见 2.3）
    this._error = reason
    this._runner.epoch = INACTIVE               // ← 触发回滚
  }
  this._updateState(() => {
    if (this._runner.epoch === oldEpoch) { this.inertia = undefined }
    else { this.inertia = this._unload(); return FiberState.UNLOADING }   // ← 逆序 dispose 本 fiber 的全部 effect
  })
}
```

```ts
// fiber.ts:675-690（_unload：clear() + 逐个 runDisposable）
private async _unload() {
  await Promise.all(this._disposables.clear().map(async (dispose) => {
    try { await composeError(async (info) => { await Promise.resolve(); info.error = new Error(); await runDisposable(dispose) }, this._runner.getOuterStack) }
    catch (reason) { this.ctx.logger.error(reason) }
  }))
  this.store = undefined
  this._updateState(() => { ... })
}
```

```ts
// fiber.ts:573-578（状态判定：有 _error 即 FAILED）
private _getState() {
  if (this.uid === null) return FiberState.DISPOSED
  if (this._error) return FiberState.FAILED
  if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
  return FiberState.PENDING
}
```

**兄弟插件不受影响**：错误被 `_reload` 吞进 `_error`，`Entry.init()` 里的 `this.fiber?.await().then(notify, notify)` 用的是同一个 `notify` 做 reject 处理，**不会产生 unhandled rejection，也不会让 `loader.create` reject**（`entry.ts:207-215`）。所以宿主侧其他插件照常 active。

### 2.2 boot 内核：一条 entry 未激活 → **整个客户端引导失败**

```js
// index-5SrrfWpU.js:126（eM = 启动激活审计）
function eM(e,n){const o=[];
  for(const s of e.loader.entries()){const a=s.options.name;
    if(s.fiber===void 0){const f=n.importError(a);
      o.push(f===void 0?`${a}: import failed (see console for the import error)`:`${a}: import failed: ${f.message}`);continue}
    const u=A7[s.fiber.state];
    if(u!=="active")
      if(u==="pending"){const f=Object.keys(s.fiber.inject).filter(h=>e.get(h)===void 0);
        o.push(`${a}: pending (waiting for service${f.length===1?"":"s"}: ${f.join(", ")||"unknown"})`)}
      else o.push(`${a}: ${u}`)}            // ← FAILED 只输出 "<包名>: failed"，不含底层异常消息
  if(o.length>0)throw new Error(`web boot: ${String(o.length)} entr${o.length===1?"y":"ies"} did not activate\n${o.join("\n")}`)}
```

由于 `run()` 中 `await JS(...)` 在 `await nM(u,this.container)`（挂载应用）之前，`eM` 一抛：
- `run` 的 catch → `console.error(聚合错误)`；桌面端还有 `e(n)` = `dshDesktopBoot.failed(msg)`；浏览器端 `this.page.fail(msg)`。
- **`uiRenderer.mount()` 永不执行 → 整个 Web 客户端不渲染**，只剩 boot 页 "Failed to load plugins"（`tM.render()`，同文件 :126）。
- 因此：**一个客户端插件 apply 抛异常 = 整个 Web GUI 起不来**，不是"仅该插件失效"。

### 2.3 错误去哪了：console / boot 页 / host

**(a) 真实异常消息 → cordis logger（内存缓冲），不是 console。** 浏览器合成里 `LoggerService` 只注册了一个 1000 条环形缓冲 exporter，没有任何 console exporter：

```js
// index-5SrrfWpU.js:9（= cordis LoggerService，浏览器合成）
var C4=class _4{ bufferSize=1e3; buffer=[]; exporters=new Map;
  constructor(n){ ... s.exporter({colors:3, export:a=>{s.buffer.push(a); s.buffer.length>s.bufferSize&&(s.buffer=s.buffer.slice(-s.bufferSize))}}) }
```
全 asar 检索 `.exporter(`：只有 cordis 自身的内置 buffer、`dsh-app-boot/lib/index.js:4057`（**宿主 Node 侧**收集 startupLogs）以及上面这个浏览器 buffer。检索 `logger.buffer|getLogs` 无任何消费方。
→ 结论：**"list slot ... already has an entry with id ..." 这类真实报错，既不在 boot 页、也不在 console，只落在这个无出口的内存缓冲里**。console 里能看到的只有 `web boot: N entries did not activate` + `"<包名>: failed"`。

**(b) boot 页 / 状态回调**：`n.on("internal/status", ...)` → `onEntryState(name, state)` → `this.page.setState`；浏览器端（`run(e)` 的 `e === undefined`）会把 `"failed"` 也显示出来，桌面端刻意过滤（`(e===void 0||h!=="failed")`），改由最终聚合错误上报。
`internal/status` 发射点：`fiber.ts:581-587`。

**(c) 客户端内存状态快照**（可被 UI 观测，但本故障下不可达）：

```js
// dsh-client-modules/lib/client.js:216-229
/** Stable observable consumed by page diagnostics through the renderer's injected hook. */
state = { getSnapshot: () => this.snapshot, subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; } };
snapshot = { syncing: false, failures: [] };
```
唯一消费方是设置里的插件清单页：
```js
// /dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:785-789
hooks: { clientSync: ctx.modules.entries.state },
retryClient: () => { ctx.modules.entries.retry().catch((error) => { ctx.logger.error(error); }); }
```
注意 `start()`（首次启动路径）**不**填充 `snapshot.failures`（只有 `reconcile()` 的审计循环会，`lib/client.js:415-439`）；而启动失败时应用没挂载，这个设置页也打不开。**该诊断面在这个故障场景下不可用。**

**(d) 桌面端确实上报到 host（仅桌面）：**

```js
// /lib/preload-app.cjs:863-866
electron.contextBridge.exposeInMainWorld("dshDesktopBoot", {
	ready: () => electron.ipcRenderer.invoke(DESKTOP_IPC.boot),
	failed: (message) => electron.ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message)
});
```
```js
// /lib/main.js:11569-11574
ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message) => {
	assertDesktopSender(event, ["app"]);
	if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("dsh desktop: rejected startup failure from a non-primary frame");
	if (typeof message !== "string") throw new Error("dsh desktop: startup failure must be text");
	reportFatal(new Error(message), "web-boot");
});
```
```js
// /lib/main.js:11008-11019
function reportFatal(error, source) {
	console.error(error);
	if (shuttingDown) { persistCrashReport(error, source); return; }
	recovery.report(error, source).catch((failure) => { console.error(failure); app.exit(1); });
}
```
`persistCrashReport`（`main.js:10989-11003`）会把 `rendererConsole: rendererConsole.snapshot()` 一起写进 `<userData>/logs` 的崩溃报告；renderer console 由主进程持续采集：
```js
// /lib/main.js:12056-12059
window.webContents.on("console-message", (details) => {
	if (details.level !== "error") return;
	rendererConsole.push(`${details.sourceId}:${String(details.lineNumber)} ${details.message}`);
});
```
→ 桌面端：**会弹致命恢复对话框 + 落崩溃报告文件（含 renderer error console）**。
→ 纯浏览器（`dsh web` 在外部浏览器打开，无 `dshDesktopBoot`）：**只有 boot 页 + 一次 `console.error`，不上报宿主**。我没找到任何把客户端 entry 失败回传宿主的 HTTP/RPC 接口。

---

## 3. `ctx.locale.register(ns, dict)` 同 ns 重复注册

文件：`/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js`（服务由该插件 `ctx.provide("locale", locale)` 提供，`:1526`）

```js
// client.js:1387-1414
register(ns, localeOrDicts, dict) {
	const pairs = typeof localeOrDicts === "string" ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts);
	for (const [locale] of pairs) if (!LOCALE_ID_PATTERN.test(locale)) throw new Error(`locale id "${locale}" is not a BCP 47-style tag`);
	let locales = this.dicts.get(ns);
	if (!locales) { locales = new Map(); this.dicts.set(ns, locales); }
	for (const [locale] of pairs) if (locales.has(localeKey(locale))) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
	for (const [locale, entries] of pairs) locales.set(localeKey(locale), entries);
	this.publish(this.snapshot.active, false);
	return () => {
		const owner = this.dicts.get(ns);
		if (!owner) return;
		let removed = false;
		for (const [locale, entries] of pairs) {
			const key = localeKey(locale);
			if (owner.get(key) === entries) { owner.delete(key); removed = true; }
		}
		if (removed) this.publish(this.snapshot.active, false);
	};
}
```

结论（**throw，不是覆盖也不是合并**）：
- 同 `ns` + 同 locale 键（例如两个插件都注册 `"agent-team"` 的 `zh`/`en`）→ **`throw new Error('locale namespace "agent-team" already has locale "zh"')`**。
- 同 `ns` + **新增** locale 键 → 允许（增量合并进同一 ns 的 Map）。
- 判重先于写入（第一层 for 全部检查完才 set），所以**失败时不会留下半写状态**；返回的 disposer 只删"自己那次写入的那些键"（`owner.get(key) === entries` 身份比对）。

> 关键顺序含义：本冲突中两个插件的 `apply()` 都是 **先 locale.register、后 slots.inject**（见 §6），因此**第二个 apply 的失败点在 locale 这一行，而不是槽位那一行**。要看到题面描述的 `list slot ... already has an entry with id "agent-team"`，必须先让两个插件的 locale ns 不再相同。

---

## 4. `order` 与 `priority` 语义

文件：`/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`

```js
// index.js:163-186
register(options, component) {
	const rec = this.records.get(options.name);
	if (!rec?.spec) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
	const spec = rec.spec;
	const priority = options.priority ?? 0;
	const occupantHint = (occupant) => `at priority ${priority}${occupant.registrant !== void 0 ? ` (registered by ${occupant.registrant})` : ""} — register at a different priority to shadow it (lowest renders)`;
	switch (spec.kind) {
		case "single": {
			const occupant = rec.entries.find((e) => (e.options.priority ?? 0) === priority);
			if (occupant) throw new Error(`single slot "${options.name}" already has a registration ${occupantHint(occupant)}`);
			break;
		}
		case "keyed": {
			if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);
			const occupant = rec.entries.find((e) => e.options.key === options.key && (e.options.priority ?? 0) === priority);
			if (occupant) throw new Error(`keyed slot "${options.name}" already has an entry for key "${options.key}" ${occupantHint(occupant)}`);
			break;
		}
		case "list": {
			if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
			const occupant = rec.entries.find((e) => e.options.id === options.id && (e.options.priority ?? 0) === priority);
			if (occupant) throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`);
			break;
		}
		case "chain":
			if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`);
			break;
	}
```

排序与取胜规则：

```js
// index.js:220-222（排序：先 priority，list 再按 order）
const next = [...rec.entries, entry];
next.sort(spec.kind === "list"
	? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0)
	: (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
rec.entries = next;
```

```js
// index.js:266-296（entriesOfSlot：每 id 只取第一个 → 最低 priority 渲染）
/**
* Project a key's entries to its shadowing winners: the first live
* (non-abdicated) entry of each cell in priority order — single: the slot
* is one cell; keyed: one cell per `key`; list: one cell per `id` (winners
* keep ledger sequence; list renderers still refine display by `order`).
*/
entriesOfSlot(key) {
	const rec = this.records.get(key);
	if (!rec?.spec) return NO_ENTRIES;
	const kind = rec.spec.kind;
	if (kind === "chain") return rec.entries;
	const heads = []; const seenCells = new Set();
	for (const entry of rec.entries) {
		if (this.abdicated.has(entry)) continue;
		const cell = kind === "keyed" ? entry.options.key : kind === "list" ? entry.options.id : void 0;
		if (seenCells.has(cell)) continue;
		seenCells.add(cell); heads.push(entry);
	}
	return heads;
}
```

| 维度 | `order` | `priority` |
|---|---|---|
| 默认值 | 0 | 0（`options.priority ?? 0`） |
| 作用 | list 槽位内**同 priority** 的显示次序 | **遮蔽轴**：决定哪个 entry 活下来（数字最小者渲染） |
| 是否参与冲突判重 | **否** | **是**（同 id/key + 同 priority 才 throw） |
| 同 id 不同 priority | 两个 entry **都保留**，只有最低 priority 的那个渲染（后者被 "shadow"） | 同左 |

`ctx.slots.register` 的运行时包装（`registrant` = 出错的插件名，会出现在错误消息里）：

```js
// /dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1577-1595
_register(options, component) {
	const store = typeof options.store === "function" ? options.store() : options.store;
	const registrant = options.registrant ?? this.ctx.fiber?.name;      // ← fiber.name = 插件包名
	const erased = { ...options, ...store !== void 0 ? { store } : {}, ...registrant !== void 0 ? { registrant } : {} };
	const dispose = this._core.register(erased, component);
	...
```
```js
// /dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1788-1795
SlotRegistry.prototype.register = function register(rawOptions, component) {
	const options = rawOptions;
	return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
};
SlotRegistry.prototype.registerFactory = function registerFactory(rawOptions, component) { ... };
```
→ **`slots.register` 的注册本身就是一个 `ctx.effect`**，throw 会沿 `_register → effect 设置失败 → 回滚 → 重抛` 一路上抛到 `slots.inject` 的回调，再上抛到 `apply()`。

`ctx.slots.inject(key, cb)` 的语义（`renderer/lib/client.js:1343-1407`）：当目标槽位**已声明**时，`cb` **立刻同步执行**（因此冲突在 `apply()` 期间就炸）；未声明时挂 `subscribeDeclaration` 等声明出现后执行，执行中的异常会被 `queueMicrotask(() => { throw failure })` 变成宏任务里的未捕获错误（`client.js:1375-1389` 的 `changed()` catch）。

---

## 5. 两个插件能否同时注册成功？失败方会回滚吗？

### 5.1 槽位：能（不同 priority）

`register` 的判重条件是 `id 相同 && priority 相同`（`slots/lib/index.js:183`）。所以把其中一个改成 `priority: -1`（或任意非 0 值）即可**两者都注册成功**，但**每 id 只有一个渲染**，数字更小者胜——即"共存"实际上只表现为"不炸"，不会同时显示两个按钮。错误消息自身也在指引这条路：`register at a different priority to shadow it (lowest renders)`。

### 5.2 locale：不能（无 priority / 无 merge）

`LocaleRuntime.register` 没有任何优先级或合并策略（§3）。同 ns 同 locale 键必 throw。要两者共存，**必须让其中一个换 ns**（例如 `"dsh-team-workflow"`），或换 locale 键名。

**因此：只改槽位 priority 修不好这个冲突**——第二个 apply 仍会在（先执行的）`locale.register` 处炸掉。

### 5.3 回滚：会，且只回滚失败方自己

两条证据链：

**(a) fiber 级**：`_reload` catch → `_error` + `epoch = INACTIVE` → `_updateState` → `_unload()` → `this._disposables.clear()` 逆序 dispose（`fiber.ts:646-690`，引文见 §2.1）。本次 apply 中通过 `ctx.effect(...)` 建立的注册（`slots.inject` 的 controller、`slots.register` 的 wrapper、locale.register 的 wrapper）都在这个列表里，**全部被逆序清理**：
- `ctx.effect(() => ctx.locale.register(...))` 的 disposer → 走 §3 的清理路径把该 ns 下自己写入的 locale 删掉；
- `slots.register` wrapper → `SlotCore.register` 返回的 disposer 从 `rec.entries` 移除 entry。

**(b) 单个 effect 内**：若某次 `ctx.effect` 的 setup 自身抛错，fiber 会先回滚"这一次 effect 已收集的 disposer"再重抛：

```ts
// /dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts:519-538
try {
  task = this._execute(runner)
} catch (reason) {
  executing = false
  setupFailed = true
  runner.epoch = false
  let cleanup: void | Promise<void>
  try { cleanup = finalizeDisposal(dispose) }   // ← 逆序跑本次已收集的 disposer
  finally { rejectSetup?.(reason) }
  if (isObject(cleanup) && 'then' in cleanup) cleanup.catch(error => this.ctx.logger.error(error))
  throw reason
}
```

**赢家不受影响**：回滚是 fiber 私有的 `_disposables`，不触碰其他 fiber 已注册的 entry / locale 键。

> 需要说明的边界：本结论覆盖 A/B 实际用到的 `ctx.effect` 与 `ctx.slots.*`。`ctx.provide(...)`（reflect 层服务提供）是否随 fiber 回滚**未验证**（本次未读 `reflect.ts` 的 provide 生命周期），不要外推。

---

## 6. 本冲突的完整链条（按当前代码重演）

事实：
- A `@local/dsh-team-workflow`：`dsh.client = { platform:"web", immediately:true, inject:[...] }`（删除前 `package.json`），client.js（删除前）与 B 的 asar bundle 逐字节相同，仅 id 行不同；`NS = "agent-team"`（A 删除前 :429；B `/dsh/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/lib/client.js:396`）。
- B `@deepseek-ai/dsh-experimental-client-ui-agent-team`：`dsh.client = { inject:[...], platform:"web" }`，**无 `immediately`**（asar `package.json` 的 `dsh.client` 段，见 §附录检索）。
- 两者都先（A 删除前 :509 / B :470）：
  ```js
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "client-ui-agent-team: dictionaries");
  ```
  后（A 删除前 :530 / B :491）：
  ```js
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
      name: "conversation.session.header.actions", id: "agent-team", order: -20, locale: NS, inject: () => actions
  }, TeamAction));
  ```
  两者 `order: -20`，**都未给 `priority`**（都是默认 0），`id` 都是 `"agent-team"`。

推演：
1. 宿主扫描顺序决定 `graph.entries`（`external` 拓扑 + 扫描序），A 因为 `immediately` 在浏览器侧先被 `prefetch` 到（§1.2），因此**大概率 A 先 apply**（推论，非契约）。
2. A 的 apply：`locale.register("agent-team", {zh,en})` 成功 → `slots.inject(...)` 发现槽位已声明 → 同步 `slots.register({id:"agent-team", order:-20})` 成功（假定此前无同名 id）。
3. B 的 apply：`locale.register("agent-team", {zh,en})` → **throw**：`locale namespace "agent-team" already has locale "zh"`（§3）。**这是本冲突实际会看到的第一条错误**。
   - 题面预期的 `list slot "conversation.session.header.actions" already has an entry with id "agent-team" at priority 0 (registered by @local/dsh-team-workflow) — register at a different priority to shadow it (lowest renders)` **只有在两个插件的 locale ns 已经不同（或 locale 键不重叠）之后才会出现**（§4 引文给出完整消息模板）。
4. B 的 fiber → `FAILED`；B 在 apply 中已建立的注册（此场景下为空）被逆序回滚（§5.3）。A 的注册完好。
5. `JS()` 之后 `eM()` 抛 `web boot: 1 entry did not activate\n@deepseek-ai/dsh-experimental-client-ui-agent-team: failed` → `run` catch → `console.error` + `page.fail` / `dshDesktopBoot.failed` → **uiRenderer 永不 mount，整个 Web GUI 停在失败页**（§2.2、§2.3）。
6. 真实报错文本只进 cordis logger 的 1000 条内存缓冲，**boot 页与 console 都看不到它**（§2.3a）——这是排查体验上的第二个坑。

（反之若 B 先 apply，则报错主体变成 A，结论对称。）

### 最新状态（15:18，父 Agent 的修复）
- `dsh-team-plugin/client.js` **已删除**；`package.json` 移除了 `./client` 导出、`dsh.client` 声明与 `immediately`；`files` 也去掉了 `client.js`。即 **A 已不再有客户端半边**（`dsh.client` 缺失 → `resolveMeta` 返回 null → 不进 boot 图）。这从根上消除了 locale/slot 双重冲突，但代价是 A 不再贡献任何 UI。

---

## 7. 证据不足 / 无法下结论的点

1. **apply 的实际先后未在浏览器实测**。"同批 combo / 分属不同 batch 时 `immediately` 预取是否真的改变 apply 顺序"只是代码推论（`Promise.all` + 脚本传输宏任务 + 微任务排队），我没有跑起浏览器抓 `internal/status` 时间线。要坐实需在真机 page 里记录 `onEntryState` 顺序。
2. **两个插件当时是否落在同一个 application combo（3 KiB 切分）未验证**。需要宿主日志/`window.__DSH_BOOT__` 实体才能定论。这直接影响"预取提前量是否被抵消"。
3. **`ctx.logger` 在浏览器是否还有我没搜到的 console 出口**。我按 `.exporter(` / `console.error` 全文检索得出"只有内存缓冲"，但没有跑一次真实失败页面看 devtools 到底打印了什么。若真机上能看到底层异常消息，则 §2.3a 需要修正。
4. **`dsh.client.inject` 是否间接影响 apply 顺序未验证**。它只影响浏览器侧"到达顺序"（`arriveGraphRow` 的 `inject` 边，`client.js:644-660`），与 `external` 的排序边是两套；我没有构造实验确认 `inject` 是否能在实践中改变 apply 先后。
5. **`ctx.provide` 的服务注册是否随失败 fiber 回滚未验证**（未读 `cordis/src/reflect.ts`）。
6. **题面所述"观察到 slot 冲突报错"与代码推演（先 locale 冲突）不一致**。我没有当时的 console/boot 页原始记录，无法判定是：(a) 当时两个插件的 locale ns 其实不同；(b) 报错来自另一次实验（例如先改过 ns）；(c) 另有第三个注册者占了 `conversation.session.header.actions` 的 `agent-team` id。**建议向用户索取当时的原始错误文本/截图**。
7. **`start()` 失败时 `entries.state.failures` 是否为空**：按代码 `start()` 不做 reconcile 审计循环，故应为空（§2.3c）；但我没有对应的运行时观测，且这会决定设置页诊断是否能显示失败原因。
8. HMR 路径（`dsh-client-hmr` 的 `invalidate`/`reload` 在 bundle 重建后是否会把冲突插件"换一个身份"重注册）未展开；本次任务范围内未读该包的完整实现。

---

## 附录 A：本次用到的关键文件与行号索引

| 主题 | 路径 | 行 |
|---|---|---|
| `dsh.client` 解析 / `immediately` 校验 | `/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` | 61-76 |
| graph 行写 `immediately` | 同上 | 395-404 |
| 拓扑排序（external 依赖 + 扫描序平局） | 同上 | 410-437 |
| bootstrap/application 批次划分 | 同上 | 440-441, 236-256, 649-661 |
| 注入行（queue / preload / blocking / global） | 同上 | 453-500 |
| 扫描顺序来源（Loader entries） | 同上 | 539-541, 833-900 |
| web 侧 manifest 解析（`plugins[].immediately`） | `/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js` | 110-175 |
| `ClientEntries.start`（`Promise.all` 并发） | 同上 | 254-269 |
| reconcile 审计 / failures 快照 | 同上 | 376-440 |
| **boot 控制器 + `prefetchImmediateTier` + `JS()` + `eM()`** | `/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js` | 126（整包一行） |
| cordis LoggerService（仅内存 exporter） | 同上 | 9 |
| `SlotCore.register`（list 冲突 throw） | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` | 163-186 |
| 排序（priority → order） | 同上 | 220-222 |
| `entriesOfSlot`（最低 priority 渲染） | 同上 | 266-296 |
| `ctx.slots.inject`（声明即同步执行） | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js` | 1343-1407 |
| `_register`（registrant = fiber.name） | 同上 | 1577-1596 |
| `register` 包 `ctx.effect` | 同上 | 1788-1795 |
| `LocaleRuntime.register`（同 ns 同 locale throw） | `/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js` | 1387-1414 |
| locale 服务提供 + 基础 ns 注册 | 同上 | 1509-1560 |
| fiber `_reload`（吞错 → FAILED → 回滚） | `/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts` | 646-695 |
| fiber `effect` setup 失败的自回滚 | 同上 | 519-538 |
| `_getState`（`_error` → FAILED） | 同上 | 573-578 |
| `internal/status` 发射 | 同上 | 581-587 |
| `Entry._init`（导入失败只记日志） | `/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/entry.ts` | 197-215 |
| `EntryGroup.create`（store 插入序 = 创建序） | `/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/group.ts` | 20-28 |
| `EntryTree.import` / `await` | `/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/tree.ts` | 36-50, 112-128 |
| `script-preload` → `<link rel=preload>` | `/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js` | 38-41 |
| `dshDesktopBoot.failed` 桥 | `/lib/preload-app.cjs` | 863-866 |
| `boot-failed` IPC → `reportFatal(...,"web-boot")` | `/lib/main.js` | 11569-11574, 11008-11019, 10990-11003, 12056-12059 |
| 插件 B（asar 内，与删除前的 A 同源） | `/dsh/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/lib/client.js` | 396, 470-473, 491-497 |
| 插件 B 声明（无 immediately） | `.../dsh-experimental-client-ui-agent-team/package.json` | `dsh.client` 段 |

## 附录 B：给修复的直接含义

1. **不要依赖加载顺序**：`immediately` 只是预取层，apply 顺序无契约；任何"我后加载所以不会撞"的假设都不成立。
2. **想保留 A 的头部按钮**：A 与 B 必须在**两个轴**上都错开——locale ns 换名（必须）+ 槽位 `priority` 不同（若要保留两个注册）或 `id` 换名。
3. **只改一个轴不够**：因 `locale.register` 在 `slots.inject` 之前执行，只改 priority 仍会在 locale 处炸（§6）。
4. **回归验证方式**：任一客户端插件失败都会让整个 GUI 停在 "Failed to load plugins"，且失败原因不在 console。验证时应同时看：boot 页文案、console 里的 `web boot: N entries did not activate` 聚合错误；桌面端还可看 `<userData>/logs` 崩溃报告与致命恢复对话框。
