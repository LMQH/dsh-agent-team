---
name: database-design-checklist
description: "数据库表结构设计 — 三范式检查、ER 建模、先出设计文档再建表，避免边写边改。"
whenToUse: 新项目需要设计表结构、新功能新增或修改表、用户说"帮我设计数据库/设计表结构/建表"，或设计流程涉及数据模型时使用；只改一个字段名或类型、只加一个索引时不用。
metadata:
  hermes:
    tags: [database, schema-design, normalization, er-modeling, sql]
    category: software-development
    related_skills:
      - spec-workflow-guide
      - brainstorming
      - addyosmani-adr
      - documentation-workflow
---

# Database Design Checklist — 数据库设计检查清单

先出设计文档，再生成建表 SQL。避免边写边改导致字段命名混乱、少了索引、关系不规范。

蒸馏自 wobushimomo SOP-02 Step 5，扩展了多数据库适配和实战陷阱。

## 何时使用

- 新项目需要设计数据库表结构
- 新功能涉及新增表或修改已有表
- 用户说"帮我设计数据库""设计表结构""建表"
- `spec-workflow-guide` Phase 2 (Design) 涉及数据模型时
- `brainstorming` Phase 5 分段展示设计的"数据模型"段

## 何时不用

- 只改一个字段名/类型 → 直接改
- 加一个索引 → 直接改
- 查看现有表结构 → 用 `codebase-architecture-analysis` 或直接查 DB

## 设计流程

### Step 1: 找对象（实体识别）

从业务流程中提取核心实体：

```
问自己：这个系统里有哪些"东西"需要存？

示例（电商）：
  用户、商品、订单、订单项、分类、评论、优惠券、地址
```

**技巧**：名词分析法 — 读需求文档，标出所有名词，重复出现的名词大概率是实体。

### Step 2: 确认关系

判断实体间的基数关系：

| 关系类型 | 示例 | 建表方式 |
|---------|------|---------|
| 一对一 (1:1) | 用户↔用户档案 | 外键加 UNIQUE 约束 |
| 一对多 (1:N) | 分类↔商品 | "多"方加外键指向"一"方 |
| 多对多 (M:N) | 商品↔订单 | 建中间表，两个外键联合主键 |

### Step 3: 三大范式检查

**逐表逐字段检查，不跳过：**

#### 第一范式 (1NF)：每个字段不可再分

**检查**：有没有在一个字段里塞多个值？

| ❌ 违反 | ✅ 正确 |
|---------|---------|
| `tags: "技术,生活,随笔"` | `tag` 表，每行一个 tag，关联文章 |
| `phone: "138xxxx, 139xxxx"` | `user_phones` 表，一个用户多行 |
| `address: "广东省深圳市南山区xx路"` | 拆分为 `province`, `city`, `district`, `street` |

**口诀**：一个格子里不要放多个东西。

#### 第二范式 (2NF)：每个字段都和主键相关（非主键字段不能只依赖主键的一部分）

**检查**：主要用于联合主键的表。有没有字段只依赖主键的一部分？

| ❌ 违反 | ✅ 正确 |
|---------|---------|
| 订单项表（order_id + product_id 联合主键）里有 `product_name` | `product_name` 应该在商品表，订单项只存 `product_id` |

**口诀**：每行数据只描述同一个主体。订单表里不要出现用户头像（那是用户表的活）。

#### 第三范式 (3NF)：字段之间不互相依赖（没有传递依赖）

**检查**：有没有字段 A 可以从字段 B 算出来？

| ❌ 违反 | ✅ 正确 |
|---------|---------|
| 订单表有 `unit_price`, `quantity`, `total_price` | 只存 `unit_price` 和 `quantity`，`total_price` 查询时计算 |
| 用户表有 `province`, `city`, `zip_code` 且 zip_code 可由 city 决定 | 如果 zip_code 完全由 city 决定，单独建 `city_zip_code` 表 |

**口诀**：不要用 A 字段算 B 字段。能算出来的不存。

**反范式例外**：为了性能可以适度冗余（如订单快照存下单时的商品价格），但要有意识——标注"这是反范式决策，理由是 xxx"。

### Step 4: 字段规范

每张表必须遵循以下字段规范：

| 规则 | 说明 | 示例 |
|------|------|------|
| 主键统一 `id` | 自增 INT 或 UUID | `id BIGSERIAL PRIMARY KEY` |
| 时间字段 | `created_at` + `updated_at` | `created_at TIMESTAMPTZ DEFAULT NOW()` |
| 状态字段 | TINYINT / ENUM / INT | `status SMALLINT DEFAULT 0` |
| 布尔字段 | 用 SMALLINT 或 BOOLEAN，不用 CHAR(1) | `is_deleted BOOLEAN DEFAULT FALSE` |
| 命名风格 | snake_case，不用 camelCase | `user_id` ✅，`userId` ❌ |
| 软删除 | `deleted_at TIMESTAMPTZ NULL` 或 `is_deleted` | 按项目约定 |
| 外键命名 | `{被引用表单数}_id` | `user_id`, `order_id` |
| 索引命名 | `idx_{表}_{字段}` 或 `idx_{表}_{字段1}_{字段2}` | `idx_orders_user_id_status` |

### Step 5: 产出设计文档

**先输出 Markdown 设计文档，用户确认后再生成建表 SQL。**

设计文档模板：

```markdown
# 数据库设计文档: <项目/模块名>

## 实体清单

| # | 实体 | 说明 | 对应表名 |
|---|------|------|---------|
| 1 | 用户 | 平台注册用户 | users |
| 2 | 商品 | 可购买的商品 | products |
| 3 | 订单 | 用户下单记录 | orders |
| ... | ... | ... | ... |

## 关系图

```
users 1───N orders N───N products
  │                  │
  │                  └── via order_items
  └───1 addresses
```

## 表结构详细设计

### users 表
| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | BIGSERIAL | PK | - | 主键 |
| username | VARCHAR(64) | UNIQUE NOT NULL | - | 用户名 |
| email | VARCHAR(255) | UNIQUE NOT NULL | - | 邮箱 |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | 更新时间 |

### orders 表
| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | BIGSERIAL | PK | - | 主键 |
| user_id | BIGINT | FK→users.id NOT NULL | - | 下单用户 |
| total_amount | DECIMAL(12,2) | NOT NULL | - | 订单总额 |
| status | SMALLINT | NOT NULL | 0 | 0=待支付 1=已支付 2=已取消 |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | 更新时间 |

索引：
- idx_orders_user_id (user_id)
- idx_orders_status_created_at (status, created_at)

## 范式检查记录
- [x] 1NF：所有字段不可再分
- [x] 2NF：非主键字段完全依赖主键
- [x] 3NF：无传递依赖（total_amount 为反范式例外，理由：订单快照）
```

### Step 6: 生成建表 SQL

设计文档经用户确认后，生成建表 SQL：

- PostgreSQL: 使用 `BIGSERIAL`、`TIMESTAMPTZ`、`TEXT`（不用 VARCHAR 无限长场景）
- MySQL: 使用 `BIGINT AUTO_INCREMENT`、`DATETIME`、`VARCHAR(n)`
- 纳入 Git 版本管理
- 遵循项目的 DevOps 数据库变更规范（见 `devops-constraints-routing`，如 code_space 项目需遵循 04-数据库变更规范）

## 常见陷阱

### 🔴 陷阱 1：边设计边建表

**后果**：字段命名混乱、少了索引、关系不规范，改来改去。

**对策**：先输出设计文档（Markdown），确认后再生成建表 SQL，SQL 纳入 Git。

### 🔴 陷阱 2：忽视索引规划

**后果**：数据量增长后查询变慢，线上紧急加索引影响服务。

**对策**：设计阶段就规划索引，按查询模式（WHERE / JOIN / ORDER BY 条件）建索引。

### 🔴 陷阱 3：金额用 FLOAT

**后果**：浮点精度问题，财务对账差 0.01。

**对策**：金额一律用 `DECIMAL(12,2)` 或 `DECIMAL(18,2)`（支持更大金额）。PostgreSQL 也可用 `NUMERIC`。

### 🔴 陷阱 4：时间不用时区

**后果**：跨时区服务时间错乱，夏令时问题。

**对策**：PostgreSQL 用 `TIMESTAMPTZ`（带时区），MySQL 用 `DATETIME` + 统一 UTC 存储。

### 🔴 陷阱 5：外键缺失或滥用

**后果**：缺失→数据不一致；滥用→性能下降 + 部署困难。

**对策**：
- 核心业务关系建外键（如订单→用户）
- 高性能/微服务场景可在应用层保证一致性
- 按项目约定决定，和团队规范对齐

### 🔴 陷阱 6：状态字段用字符串

**后果**：`status='PAID'` 比 `status=1` 占空间、查询慢、没有类型安全。

**对策**：状态用 `SMALLINT` / `INT`，代码层用枚举映射。PostgreSQL 也可用原生 `ENUM` 类型。

## 与其他 skill 的关系

```
brainstorming (Phase 5: 数据模型段)
  → database-design-checklist (本 skill：三范式检查 + 建表)
  → spec-workflow-guide (Phase 2 Design: 数据模型部分)
  → addyosmani-adr (记录反范式决策)
  → devops-constraints-routing (SQL 变更规范)
```

## 验收标准

完成数据库设计后，逐项检查：

- [ ] 所有实体已识别，无遗漏
- [ ] 实体间关系已明确（1:1 / 1:N / M:N）
- [ ] 1NF 检查通过（无字段内含多值）
- [ ] 2NF 检查通过（非主键字段完全依赖主键）
- [ ] 3NF 检查通过（无传递依赖，反范式决策已标注理由）
- [ ] 每张表有 `id`、`created_at`、`updated_at`
- [ ] 字段命名 snake_case
- [ ] 索引已规划
- [ ] 金额字段用 DECIMAL
- [ ] 时间字段带时区
- [ ] 设计文档已输出 Markdown
- [ ] 用户确认后生成建表 SQL
- [ ] SQL 纳入 Git 版本管理