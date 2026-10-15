---
name: code-review-defect-patterns
description: "审查/推送门控时逐条对照的缺陷模式库：懒加载竞态、资源泄漏、契约未接线、异常收敛缺口、弱测试。"
whenToUse: Use during independent code review, push gating, or self-review of a diff as a defect-pattern checklist; also when 懒加载/竞态/连接池泄漏/异常收敛/弱测试 is suspected.
metadata:
  hermes:
    tags: [code-review, defect-patterns, async, sqlalchemy, fastapi, langgraph, push-gate]
    category: software-development
    related_skills: [requesting-code-review, git-commit-gate, verification-before-completion]
---

# 代码审查缺陷模式库（Code Review Defect Patterns）

**用途**：独立审查者、推送门控、自查 diff 时的**缺陷对照清单**。结合
requesting-code-review（bundled，流程）使用：本 skill 回答"审查时找什么"。

**来源**：SynCore 智枢 P1 编排层推送门控实战（2026-08-17）——238 passed 后
独立审查仍抓到 8 个运行期缺陷 + 3 个弱测试。模式对 FastAPI/SQLAlchemy/
LangGraph 类异步服务具有普遍性。

**方案级（非代码层）审查补充**：任务与已接受 ADR 的语义冲突、文档与源码双向漂移、里程碑依赖链核查，见 `references/architecture-decision-conflicts.md`。

## 一、运行期缺陷模式（代码审查重点）

### 1. 懒加载单例无锁竞态
```python
# BAD：并发首用多个实例创建，后完成者覆盖，败者资源永不释放
if self._saver is not None: return self._saver
pool = AsyncConnectionPool(...); await pool.open()  # 让出控制权 → 竞态
# GOOD：asyncio.Lock + 双检
async with self._saver_lock:
    if self._saver is not None: return self._saver  # 等待锁期间他人已完成
```
**审查要点**：任何 `_ensure_*` / 懒加载单例，检查是否加锁 + 双检。

### 2. 半途失败资源泄漏
```python
# BAD：open 成功但 setup 失败 → 池已开不关闭
await pool.open(); saver = AsyncPostgresSaver(pool); await saver.setup()
# GOOD：try/except 中 close 再 raise
try:
    await pool.open(); saver = ...; await saver.setup()
except Exception:
    await pool.close(); raise
```
**审查要点**：`open()` 与后续初始化之间失败时，已获取资源是否释放。

### 3. 契约未接线（docstring 承诺 ≠ 代码实现）
- docstring 写"request 为 None 时构造最小 request"但代码直接 `state['request']=None` 传入 → 恒崩溃。
- **自查**：grep docstring 中的"为 None 时/兜底/尝试"，确认对应代码分支真实存在。
- 修复：实现 `_build_minimal_request()`（占位身份 + 注释注明生产装配归调用方）。

### 4. 异常收敛边界缺口
```python
# BAD：基础设施异常（DB 故障/编译失败）在收敛 try 外逃逸
saver = await self._ensure_saver()          # 若抛异常 → 后台任务死亡
compiled = self._build_wrapper_graph(...)   # 若抛异常 → consumer 不被回调
# GOOD：全部纳入 try/except → 统一收敛 failed，不逃逸
```
**后果**：未捕获异常 → `Task exception was never retrieved` → 子任务永久卡住，
只能等重启扫描兜底。
**审查要点**：后台任务/回调路径中，**所有**可能抛异常的基础设施调用是否都在
收敛 try 内（不只业务逻辑）。

### 5. async 懒游标交叉执行
```python
# BAD：for 循环内对同一 AsyncSession 交叉 UPDATE/SELECT/INSERT
rows = await session.execute(stmt)
for row in rows: await session.execute(update...)  # asyncpg 下游标未耗尽 → InterfaceError
# GOOD：先物化再循环
rows = (await session.execute(stmt)).all()
```
**审查要点**：async SQLAlchemy 中 `execute()` 结果在循环内是否又发起新查询。

### 6. 审计 run_id / 关联字段解析错误
- 子对象从不写 `task.created` 审计（只写 `stage.created`）→ 按 `task.created` 解析
  恒 None → 回退错误值 → 破坏账本语义（如"子 Task 继承父 run_id"）。
- **自查**：解析用的 action 名必须与实际写入方一致（查 create 路径的审计 action）。

### 7. docstring 与实现自相矛盾
- docstring 声称"30min 窗口时间戳计数"，实现是信号量，另一处又写"不重复计数"。
- 审查者会抓住：**诚实描述实现**，删掉从未实现的声称。

## 二、弱测试模式（测试审查重点，FAIL-CLOSED 拦截）

| 模式 | 问题 | 修复 |
|------|------|------|
| 空 dict 缺必填字段"通过" | `Model.model_validate({"x": {}})` 因缺必填字段抛错 → 从未验证被测行为（如未知字段被拒） | 完整合法字段 + 只加被测项 + `match="字段名"` |
| 未断言副作用次数 | "不重试"测试只断言两次都失败，引擎内部重试 10 次也通过 | Mock 加 `calls` 计数，断言 `len(calls) == 1` |
| 未断言并发峰值 | "并发上限 5"只断言 6 个都执行完，无限并发也通过 | Fake 加 `active/max_active` 追踪，断言 `max_active <= 5` |

**审查方法**：读 diff + 实际源文件交叉验证断言（不能只看 mock 返回）。
发现假测试 → logic_errors → FAIL-CLOSED。

## 三、SQLAlchemy PG 实用技巧

- `func.jsonb_merge` **不存在**（非 PG 内置函数）→ 用 `col.op("||")(func.cast(marker, JSONB))`（jsonb `||` 是 PG 原生运算符）。
- `JSONB` 在 `sqlalchemy.dialects.postgresql`，不在顶层 `sqlalchemy` 命名空间。
- Pydantic 最小构造注意：`tuple` 字段可能要求至少 1 项、`str` 字段可能要求至少 1 字符——构造占位值时先读契约 validator。

## 四、推送门控复验流程（第二轮审查）

修复后复验时，**工作区未提交的修复不在 `git diff origin/<branch> HEAD` 里**：
```bash
# 已提交 diff + 工作区修复的合并视图
(git diff origin/lmqh-dev HEAD -- core_src/ && git diff -- core_src/) > /tmp/review_v2.diff
```
复验 prompt 显式列出"待验证的 N 个问题"，让审查者逐一确认解决 + 无新问题。
大型 diff 按目录分区并行审查（core_src/ 与 tests/ 各一独立审查者）。
