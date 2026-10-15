---
name: anti-fake-testing
description: "Use when 防假测试. Break code, if tests still pass they're fake."
whenToUse: Use when a test suite must be proven able to catch broken logic (防假测试 / "测试有效吗") — before feature delivery, during a security audit, when the user asks, or when coverage confidence is low.
metadata:
  hermes:
    tags: [testing, mutation-testing, quality-gate, verification, anti-fake]
    category: software-development
    related_skills:
      - verification-before-completion
      - test-driven-development
      - gsd-add-tests
      - gsd-verify-work
---

# Anti-Fake Testing — 防假测试

**核心原则：测试每次都"通过"不代表代码是对的——可能是测试根本没测到关键逻辑。防假测试通过"故意改错代码"来验证测试的有效性：如果改错了测试还能通过，说明测试是假的。**

## 什么是假测试

假测试是指看起来在测试、实际什么都没验证的测试。常见形态：

| 假测试类型 | 表现 | 为什么危险 |
|-----------|------|-----------|
| **空断言** | `expect(result).toBeTruthy()` — 任何非 null 值都通过 | 不验证具体行为，只验证"有返回值" |
| **未覆盖关键路径** | 测了 `getUserInfo()` 但没测 `getUserInfo(别人的ID)` | 安全漏洞完全没被测到 |
| **Mock 过度** | 把整个数据库 Mock 掉，测试只验证 Mock 的行为 | 真实环境行为完全未知 |
| **只测正常路径** | 只测正确输入，不测异常/边界 | 异常路径一旦出问题就是生产事故 |
| **断言条件错误** | `if (user.role === 'admin')` 写成了测 `role === 'user'` 也能通过 | 权限校验形同虚设 |

---

## 防假测试标准流程（5 步）

### Step 1 — 选择要验证的关键逻辑

不需要对所有代码做防假测试——聚焦高风险逻辑：

| 优先级 | 逻辑类型 | 为什么要测 |
|-------|---------|-----------|
| P0 | 权限校验（角色检查、owner_id 校验） | 越权漏洞是最常见的安全问题 |
| P0 | 金额计算（支付、退款、余额） | 算错一分钱都是事故 |
| P1 | 输入校验（类型/长度/格式检查） | 注入攻击的入口 |
| P1 | 数据归属查询（WHERE user_id = ?） | 越权访问他人数据 |
| P2 | 核心业务流程（注册→下单→支付） | 主流程走不通=产品不可用 |

**选取规则**：每次选 1-3 个最关键的逻辑点做防假测试，不必全量。

### Step 2 — 故意改错代码

对选定的逻辑点，做以下任一"破坏性修改"：

| 改法 | 示例 | 预期效果 |
|------|------|---------|
| **反转条件** | `if (user.role === 'admin')` → `if (user.role === 'hacker')` | 权限校验失效，所有人都能访问 |
| **注释掉校验** | `// validateInput(data)` | 输入不校验，恶意数据直接进系统 |
| **去掉归属条件** | `WHERE id = ?` (去掉 `AND user_id = ?`) | 任何人都能查到任何数据 |
| **改返回值** | `return total + tax` → `return total` | 金额计算错误 |
| **跳过校验** | `if (skipValidation) return true;` 加一个永远为 true 的跳过 | 校验被绕过 |

**安全提醒**：改错代码只在本地/测试环境做，不要推到远程仓库。测试完毕后立即恢复。

### Step 3 — 运行测试

```bash
# 运行项目的测试套件
npm test          # Node.js
pytest tests/     # Python
cargo test        # Rust
go test ./...     # Go
```

### Step 4 — 判断结果

| 测试结果 | 含义 | 行动 |
|---------|------|------|
| ❌ 测试**失败**了 | ✅ 测试是真的——它能抓到代码被改错 | 恢复正确代码，测试通过 |
| ✅ 测试**通过**了 | ⚠️ 测试是假的——改错了它都没发现 | **必须修复测试** |

### Step 5 — 修复假测试（如果 Step 4 发现假测试）

假测试的修复方向：

| 假测试原因 | 修复方法 |
|-----------|---------|
| 断言太弱 | `expect(result).toBeTruthy()` → `expect(result.role).toBe('admin')` |
| 没测异常路径 | 增加 `expect(() => getUserInfo(otherUserId)).toThrow()` |
| Mock 过度 | 减少 Mock，用测试数据库做真实查询 |
| 只测正常路径 | 增加边界和异常用例 |
| 根本没测到这个逻辑 | 补写针对该逻辑的测试 |

修复后重新执行 Step 2-4，直到改错后测试能失败为止。

### Step 6 — 恢复正确代码

```bash
# 恢复所有被改错的文件
git checkout -- <被改错的文件>

# 或使用 git restore
git restore <被改错的文件>

# 确认恢复后测试通过
npm test  # 或对应测试命令
```

---

## 防假测试报告模板

```
🔍 防假测试报告
================
测试时间: [时间]
测试范围: [模块/功能]

┌────┬──────────────────┬──────────────────────┬──────────┬──────────┐
│ #  │ 改错位置          │ 改法                  │ 测试结果 │ 判定     │
├────┼──────────────────┼──────────────────────┼──────────┼──────────┤
│ 1  │ auth.ts:42       │ 反转 role 条件        │ FAILED   │ ✅ 真测试 │
│ 2  │ billing.ts:78    │ 去掉 tax 计算         │ PASSED   │ ⚠️ 假测试 │
│ 3  │ user.ts:120      │ 去掉 owner_id 条件    │ PASSED   │ ⚠️ 假测试 │
└────┴──────────────────┴──────────────────────┴──────────┴──────────┘

假测试修复:
  - #2 billing.ts: 补充断言 expect(total).toBe(unitPrice * qty + tax)
  - #3 user.ts: 补充越权访问测试用例

修复后复验:
  - #2 billing.ts: FAILED ✅ (改错后被抓到)
  - #3 user.ts: FAILED ✅ (改错后被抓到)

决议: ALL_PASS ✓ (所有测试均为真测试)
```

---

## 触发时机

| 时机 | 触发方式 | 范围 |
|------|---------|------|
| **功能交付前** | `verification-before-completion` 调用（可选步骤） | 本次变更涉及的关键逻辑 |
| **安全审计时** | `gsd-secure-phase` 或 `gstack-cso` 调用 | P0/P1 功能的权限校验 |
| **用户主动** | 用户说"防假测试""测试有效吗" | 用户指定范围 |
| **测试覆盖率不放心时** | 开发者直觉判断 | 当前模块 |

---

## 与其他 skill 的关系

```
verification-before-completion (完成前验证)
  ├→ 运行测试套件（基础验证）
  ├→ 三种走法全覆盖（主流程 + 异常 + 牵连）
  └→ anti-fake-testing (本 skill：验证测试本身的质量) ← 可选但推荐
       └→ 发现假测试 → gsd-add-tests (补写/修复测试)
```

| skill | 职责 | 关系 |
|-------|------|------|
| **本 skill** | 验证测试的有效性（测试能不能抓 bug） | 测试的"元测试" |
| verification-before-completion | 验证代码的正确性（功能跑不跑得通） | 本 skill 的调用方 |
| test-driven-development | RED-GREEN-REFACTOR 流程 | 本 skill 验证 GREEN 阶段的测试质量 |
| gsd-add-tests | 补写测试用例 | 本 skill 发现假测试后的修复路径 |

---

## 常见陷阱

### 陷阱 1：改错代码后忘了恢复

- **表现**：改错的代码被提交到了 Git，生产环境出问题
- **解决**：防假测试完毕后立即 `git checkout -- <文件>` 恢复，并用 `git diff` 确认无残留

### 陷阱 2：只改了一处，不够有代表性

- **表现**：改了一个非关键条件，测试通过了就认为"测试是真的"
- **解决**：聚焦 P0 逻辑（权限/金额/归属），每类至少改一处

### 陷阱 3：对 Mock 过度的测试做防假测试

- **表现**：改了真实逻辑，但因为全 Mock 了，测试照样通过
- **解决**：先减少 Mock，用测试数据库做真实查询，再做防假测试

### 陷阱 4：防假测试替代正常测试

- **表现**：只做防假测试不做功能测试
- **解决**：防假测试是"验证测试质量"的补充手段，不替代功能测试。正常流程是：功能测试 → 防假测试验证测试质量

---

## 验收标准

- [ ] 选取了 1-3 个关键逻辑点
- [ ] 对每个逻辑点做了至少一种"破坏性修改"
- [ ] 运行了测试套件
- [ ] 改错后测试能失败 → 确认为真测试 ✅
- [ ] 改错后测试仍通过 → 识别为假测试 → 已修复 → 复验通过
- [ ] 所有被改错的代码已恢复（`git diff` 确认无残留）
- [ ] 恢复后测试全部通过

---

## 变更历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0.0 | 2026-08-03 | 初始版本。蒸馏自 VibeCoding SOP-03 阶段四 + SOP-04 第四步防假测试方法论。5 步流程 + 报告模板。 |
