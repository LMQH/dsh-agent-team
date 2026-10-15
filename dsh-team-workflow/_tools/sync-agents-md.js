#!/usr/bin/env node
/**
 * 生成 `~/.dsh/AGENTS.md` —— 资源包 02 文档所说的「宿主规则层」。
 *
 * 角色表从 roles.json 渲染，保证与插件同源；工作流规则取自资源包：
 *   01-现行工作流.md   三级分诊、权威顺序、任务合同、工件链与独立门
 *   02-复刻方案.md     分层迁移顺序
 *   03-来源与差距.md   悬空技能不得静默加载
 *
 * 内容一律以资源包为准，不自行发明规则。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', '..', 'dsh-team-plugin');
const roster = JSON.parse(readFileSync(join(pluginDir, 'roles.json'), 'utf8'));

const HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh');
const target = join(HOME, 'AGENTS.md');

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].length));

const rows = roster.roles.map((role) =>
  `| \`${role.id}\` | ${role.title} | ${role.outputs.join(' / ')} | ${role.writable ? '可写' : '只读'} |`);

const dangling = [];
for (const role of roster.roles) {
  for (const skill of role.danglingSkills ?? []) dangling.push(`- \`${role.id}\` → \`${skill}\``);
}

const md = `# Agent 团队工作流（DeepSeekHarness 复刻）

来源：\`${roster.source}\`
角色与职责的单一来源：\`${pluginDir}/roles.json\`（由 \`_tools/sync-roles-from-pack.js\`
从 \`sources/omp/agents/*.md\` 生成）。**不要在别处另写一份角色表。**

查名册：\`/team\`；查单个角色（含可直接用作派发 prompt 的完整简报）：\`/team <角色 id>\`。

## 入口：先分诊，再动手

每个任务先选路线并说明触发原因：

| 路线 | 触发条件 | 做法 |
|---|---|---|
| **Fast** | 范围窄、解法明确、无实质设计或独立门要求、回归风险低 | 主 Agent 单独执行并检查。**不冒充独立 QA。** |
| **Standard**（默认） | 其余常规多步骤工作 | 短计划与验收点 → 主 Agent 或按路径隔离的成员实施 → **独立 QA** 核对；必要时加代码审查/合规 |
| **Deep** | 未解决的产品/持久架构决策、跨 owner 契约变更、敏感数据或权限安全、迁移、不可逆操作、强制完整独立门 | 先确认输入与授权 → 按依赖顺序形成必要工件 → 实施 → revision 专属 QA / 代码审查 / 合规门 |

调查中风险扩大则**升级**路线；不倒填未执行的门。

声明路线：\`/team route <fast|standard|deep> <触发原因>\`（查看当前路线：\`/team route\`）。

### 工具层强制的部分（与路线无关，永远生效）

路线只决定启用哪些**流程门**。下面这些是策略程序在工具层硬性执行的，**不会**因为"我走 Fast"而放宽：

| 行为 | 判定 |
|---|---|
| 写 \`.env\` 等机密文件；写密钥目录（\`~/.ssh\`、\`~/.aws\`、\`~/.gnupg\`、\`~/.kube\`、\`~/.dsh/.credentials.*\`）；写 \`*.pem\`/\`*.key\`/SSH 私钥 | **硬拒** |
| 工作区外的写入；任务合同 \`denied_paths\` 内的写入 | **硬拒** |
| \`docker/podman prune\`、通配符或动态资源删除、未命名 \`dropdb\`/TRUNCATE/\`dropDatabase\`、越界或通配的 \`rm -rf\` | **硬拒**（不提供授权出口——不可恢复、影响无法枚举） |
| 部署与发布：\`kubectl apply/delete\`、\`terraform apply/destroy\`、\`helm upgrade/install\`、\`docker push\`、\`npm/pnpm publish\`、\`gh release\`、\`scp\`、\`rsync\` 到远端 | **转人工审批** |
| 具名资源删除（如 \`docker rm <id>\`） | **转人工审批** |
| 声明了 \`fast\` 路线却派发子 Agent / 团队成员 | **转人工审批**（Fast 的定义就是主 Agent 单独执行；批准即表示要升级路线） |

**审批批准就等于授权**；被拒绝、或没有任何一方能决定时，**工具不会执行**（fail-closed）。
敏感动作因此不需要事先手写授权记录——直接做，会被问一次。

### 工具层**不**强制的部分（声明式，不要当成强制）

- 独立 QA 与三道独立门：平台无法判断一份报告的作者与实现者是否同一实体
- 工件顺序：平台无法判断 Test Spec 是否先于实现产生
- 任务合同 9 个字段是否写全
- "变更后旧 revision 报告失效"：只能比对 revision 做**检查**，无法阻止引用旧报告

**不要把这些说成"已门控"。** 资源包明确禁止「以提示词冒充强制机制」。

派发记账由策略程序自动写入 \`${HOME}/team/ledger/agent-ledger.jsonl\`（派发时记 \`dispatch\`，结束后记 \`complete\`），**无需手工预写**。

## 角色（10 个）

| 角色 id | 名称 | 产物 | 能力 |
|---|---|---|---|
${rows.join('\n')}

**按需创建角色，不常驻。** 角色选择与派发时机由主 Agent 自主判断；不要为了走流程而派人。

派发团队角色一律用 \`spawn_teammate\`（需要继承本次会话上下文时 \`context: "fork"\`，否则 \`context: "fresh"\`）；
续活或追问用 \`send_message\`，共享任务看板用 \`team_task_*\`。
**不要用 \`subagent\` 派发团队角色**——官方「智能体团队」面板只收录 \`spawn_teammate\` 创建的成员，
用 \`subagent\` 派发的子会话不进成员列表，也就看不到运行状态。两者不是同一层能力，别混用。
成员状态是**终态**：\`provisioning\` / \`active\` / \`failed\`，不会回滚；失败要如实报告，不要重试掩盖。

prompt = \`/team <id>\` 里的「派发简报」+ 具体任务 + 要求的汇报格式 + 该角色的 \`autoloadSkills\` 清单
（让成员开工前用 \`skill\` 工具加载自己的技能）。若该角色有悬空技能，在 prompt 里说明**不要加载**。
成员只向你汇报，你是对用户的唯一出口。\`model\` 别名 \`@team_*\` 只是角色映射，不含凭据。

## 任务合同（派发前必须写明）

任务 ID、目标仓库/worktree、owner、**允许路径**、输入/输出工件、依赖、验收标准、独立 reviewer、必要门。
参考 \`${HOME}/team-workflow/任务合同模板.md\`。共享文件并行写入须指定唯一集成者；迁移与共享契约按序处理。

## 工件链

PRD（\`pm\`）→ ADR（\`architect\`，仅持久决策时）→ Tech Spec（技术所有者）→ 实施计划（实施 owner）
→ Test Spec（\`qa\`）→ QA 验收报告（\`qa\`，针对确切 revision）。

**Standard 不为凑模板而造工件。** 每份报告写 status、被审 revision 或 diff、实际命令与路径、证据、限制风险、下一 owner 与门。

## 独立门（不能互代）

代码审查、合规/安全评审、最终产品验收是三道**独立**的门。QA 不修被测实现；实施者不审自己的 diff；
后续修改使受影响 revision 的报告**失效**，必须重验。

## 授权边界

架构实质变更、外部依赖、账号/密钥、受保护路径、提交、推送、部署、修改生效规范/ADR，
均需**用户明确授权**。破坏性操作（Docker 镜像、数据库删除）另需逐项精确清单的单独确认、
删除前重核与删除后核对，并保留真实可用的回滚工件。
建镜像、候选验证、发布、清理**互不自动授权**。

## 仍然坚持的少数几条

- **先验证再声称完成**：实际跑了验证命令、看到真实输出，才说"完成"。
- **独立验证不能是自证**：让 \`qa\` 自己写用例或复现步骤；自己跑一遍不叫独立 QA。
- **改代码后旧结论失效**：任何后续改动都让之前的 QA / 审查结论作废，必须重跑。
- **破坏性操作要用户明确授权**：没授权就不做。
- **不确定就问，不要猜**：存在多种理解时全部摆出来。

## 悬空技能（包中不存在，已移出自动加载）

以下绑定在资源包里指向不存在的技能，**不得以空壳文件消除缺口，也不得静默加载**；
应明确移除绑定，或在获得可信实现后按来源与授权补齐再启用：

${dangling.join('\n')}

## 其它

- 插件目录：\`${pluginDir}\`
- 名册落盘：\`${HOME}/team-workflow/roles.json\`（\`apply\` 时刷新）
- 策略程序：\`${HOME}/team/policies/policy_check.js\`（由 \`dsh-hooks-claude-code\` 通过
  \`${HOME}/team/hooks.json\` 挂载，PreToolUse / PostToolUse）
- 路线声明：\`${HOME}/team/route.json\`（缺失即视为 standard）
- 台账：\`${HOME}/team/ledger/agent-ledger.jsonl\`（append-only）
- 预授权（可选，用来免除重复询问）：\`${HOME}/team/authorizations.json\`
- 设计依据与取舍记录：\`${normalize(join(here, '..', '分析-三级管道与门控.md'))}\`
`;

if (existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(target, `${target}.bak-${stamp}`);
  console.log(`已备份原文件 → AGENTS.md.bak-${stamp}`);
}
writeFileSync(target, md);
console.log(`已生成 ${target}（${md.length} 字符，角色 ${roster.roles.length} 个）`);
