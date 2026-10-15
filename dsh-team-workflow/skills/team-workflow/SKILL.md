---
name: team-workflow
description: Governs DSH professional-team task intake, artifacts, independence, approvals, and handoffs.
whenToUse: Load for every task at the single main entry before planning, editing, or dispatching a specialist; classify the task as Fast, Standard (default), or Deep first and state the reason.
---

# DSH Team Workflow Contract

## Authority order

1. Current user instruction and explicit authorization.
2. Current repository constitution, `AGENTS.md`, effective ADRs, and protected-branch rules.
3. Approved team standards and ADRs in the team knowledge space (KNOWLEDGE VAULT: not configured in DSH — do not assume this path exists; when no vault is configured, only standards recorded in the repository count as approved).
4. Task manifest and approved implementation artifacts.
5. Agent memory and prior conversation summaries.

Never promote a draft, memory, or unverified report into an approved fact.

## Intake: three-level complexity gate

Before planning, editing, or dispatching a specialist, the main Agent classifies each task and states the chosen pipeline with a brief reason. Standard is the default. Fast requires all its entry conditions; Deep takes precedence when any of its triggers applies. Do not route by file count, token estimate, or number of Agents alone. Reclassify before continuing if investigation reveals broader scope or risk; do not retroactively claim skipped gates were performed.

| Pipeline | Entry conditions | Execution and exit |
|---|---|---|
| Fast | Only a very small task or an explicitly simple, well-understood task: narrow scope, known solution, no meaningful design decision, low regression risk, and no independent gate requirement. All conditions must hold. | Main Agent works alone, directly executes and checks the affected path, and reports evidence. No specialist dispatch or formal artifact chain; never label self-check as independent QA. |
| Standard (default) | Routine work with a clear goal and established constraints that does not trigger Deep. May span several modules or ownership domains when interfaces are already settled and work can be coordinated through small task contracts. | Main Agent states a short plan and acceptance checks → main Agent or needed specialists execute, including multiple Agents with disjoint ownership when useful → independent `qa` checks the resulting revision and reports observed results. Resolve defects and re-run affected QA before delivery. Add applicable independent review when required; do not generate PRD/ADR/Tech Spec merely to fill a template. |
| Deep | Unresolved product or durable architecture decisions, new or changing cross-owner contracts, sensitive data or authorization/security changes, migrations, operational or irreversible effects, or mandated full independent review/compliance. | Use the full team workflow below: establish approved inputs and task contracts, prepare applicable artifacts in dependency order, dispatch only needed roles, implement, then obtain revision-specific QA, code review, and compliance/security gates as applicable. Escalate decisions/authorizations rather than treating the pipeline as approval. |

Explicit user-required gates and repository/effective-policy requirements override pipeline shortcuts. Authorization boundaries, safe handling of secrets and destructive actions, and verification apply at every level. For research-only or documentation-only work with no executable behavior, the standard QA step checks the requested observable artifact rather than inventing a test run. If independent QA is required but unavailable, report the gate as outstanding; do not call the task accepted.

## Task contract

Every specialist task must state: task id, target repository/worktree, owner role, allowed paths, input artifacts, required output artifacts, acceptance criteria, dependencies, and reviewer role. Refuse shared-file parallel work without a designated integrator.

## Team display names

Dispatch IDs are fixed runtime identifiers. Team-facing assignments, plans, and handoffs MUST use the paired display name below; dispatches retain the exact ID.

| Display name | Dispatch ID |
|---|---|
| 产品经理 | `pm` |
| 架构师 | `architect` |
| 后端开发工程师 | `backend` |
| 前端开发工程师 | `frontend` |
| 智能体开发工程师 | `harness` |
| 运维工程师 | `devops` |
| 测试工程师 | `qa` |
| 代码审查专员 | `code-review` |
| 技术审查专员 | `reviewer` |
| 合规审查专员 | `compliance` |
| 安全审查专员 | `security-reviewer` |
| 代码探查专员 | `scout` |
| 资源财务专员 | `quota-control` |
| 自动化操作员 | `sonic` |
| 通用开发工程师 | `task` |

`技术设计` (`technical-design-delivery`) is a shared skill and responsibility layer, not a dispatchable Agent role.

The registry above is the complete role list. In this migration only 10 roles have a local role definition (`pm`, `architect`, `backend`, `frontend`, `harness`, `devops`, `qa`, `code-review`, `compliance`, `quota-control`); the remaining 5 (`reviewer`, `security-reviewer`, `scout`, `sonic`, `task`) have no local definition and are out of scope for the skill layer — see `../MISSING-SKILLS.md`.

## Delivery artifact chain

Artifacts have distinct authority. A later artifact MUST NOT silently change facts or constraints owned by an earlier one.

| Order | Artifact | Owner | Authority |
|---:|---|---|---|
| 1 | 产品需求文档（PRD） | 产品经理 | Product facts: goal, scope, roles, user-visible behavior, acceptance criteria, and non-goals. |
| 2 | 架构决策记录（ADR） | 架构师 | Durable technical boundaries, invariants, and tradeoffs. Create only for a durable architecture decision; otherwise technical work follows applicable active ADRs. |
| 3 | 技术规格说明（Tech Spec） | Named technical owner | Implementation-ready component boundaries, contracts, state/data, failures, rollout, and verification within the PRD and ADR constraints. `技术设计` is the shared method used to produce it. |
| 4 | 实施计划（Implementation Plan） | Named implementation owner | Ordered, owned execution slices derived from the approved Tech Spec; it does not redefine the specification. |
| 5 | 测试规格说明（Test Spec） | 测试工程师 | Independent, criterion-traceable scenarios, expected observable results, evidence requirements, and coverage boundaries. It may be prepared after the PRD and Tech Spec and before implementation completes. |
| 6 | QA 验收报告（QA Acceptance Report） | 测试工程师 | Revision-specific evidence against the Test Spec: verdict, executed results, defects, and residual risks. It is not the Test Spec itself. |

Independent code review, compliance/security review, and product acceptance are gates following their respective inputs; they are not substitutes for any artifact above. Only the 产品经理 / user makes final product acceptance.

## Product, architecture, and delivery boundaries

Assign work by decision type, not by document name.

| Owner | Decides | Must not decide |
|---|---|---|
| Product / PM | User value, product scope, roles, flows, visible behavior, priorities, acceptance criteria, and non-goals | Architecture, internal protocols, persistence, API schema, credential mechanics, or implementation sequence |
| Architect / ADR | Durable technical boundaries, ownership, invariants, solution classes, tradeoffs, and consequences that preserve approved product facts | Product scope, MVP content, commercial offering, user experience, or implementation details |
| Technical design | Components, APIs, schemas, data models, failure handling, migration, rollout, and verification | Product scope or effective ADR constraints |

When a product fact is missing, the architect returns `needs-decision`; it does not fill the gap. When an ADR constraint is missing, technical design returns `needs-decision`; it does not invent an architecture.

An ADR is not a technical design. It MUST NOT fix fields, tables, endpoint payloads, error codes, token formats, storage, files, functions, libraries, configuration, algorithms, or call ordering unless the user explicitly authorizes that item as the architecture decision. The technical-design owner chooses these details within the ADR constraints.

## Backend and agent-harness boundaries

Assign AI work by execution semantics, not by service name. Deterministic business facts and public contracts belong to backend; model-directed execution belongs to the harness.

| Capability domain | Harness owns | Backend owns |
|---|---|---|
| Model, prompt, and context | Model invocation, prompt assembly, context selection/compaction, and streaming adaptation | User-visible configuration, business entitlement, billing facts, and credential access policy |
| Agent loop and execution state | Model-directed planning, tool selection, observations, stop conditions, and ephemeral execution checkpoints | Deterministic workflows, durable business state, transactions, idempotency, and user-visible completion |
| Tools and MCP | Tool descriptions, capability injection, candidate arguments, and interpreting tool results | Real business operations, input validation, authorization, side-effect execution, and domain errors |
| Runtime and environment | Agent process, sandbox, work directory, CLI/SDK session, and local execution lifecycle | Runtime registration, ownership, scheduling authorization, availability records, and user-visible status |
| Memory and data | Context-window state, session state, execution summaries, and non-authoritative working memory | User assets, business records, permissions, retention/deletion, audit, and every user-visible fact source |
| Resilience, privacy, and observability | Model/tool-local timeout, retry, loop detection, redaction, execution traces, and runtime metrics | Business failure semantics, compensation, audit retention, compliance, incident policy, and user-visible errors |

The harness MAY request an action but MUST NOT be the sole authorization or enforcement layer for any credential use, private-data access, destructive action, or external side effect. The backend or the invoked domain service MUST independently validate authority and execute or reject the action.

The backend MAY create, cancel, observe, and expose an agent execution but MUST NOT implement model reasoning, prompt/context construction, tool selection, or the agent loop.

Cross-boundary contracts MUST carry verified principal context, authorized capability scope, correlation identity, resource references, lifecycle result, and safe failure classification. Harness traces and backend audit records may correlate, but neither may impersonate the other's source of truth.

## Frontend and backend boundaries

Frontend owns the user-facing surface; backend owns the authoritative business result. A browser may improve feedback but cannot be an authority boundary.

| Domain | Frontend owns | Backend owns |
|---|---|---|
| Presentation and interaction | Rendering, accessibility, navigation, form interaction, loading/empty/error states, and user-facing wording | Business semantics and user-visible result authority |
| Input and authorization | Ergonomic local validation and capability-aware affordances | Canonical validation, identity, authorization, resource ownership, and every side effect |
| State and data | View state, form drafts, display caches, and reversible optimistic presentation | Domain state, transactions, idempotency, concurrency resolution, audit, and data facts |
| Contract and errors | Consume published contracts and map safe outcomes to user action | Define contract semantics, compatibility, domain errors, retry eligibility, and lifecycle transitions |
| Events and agent experience | Subscription rendering, reconnection UX, intent collection, execution/result display, and user confirmations | Event authorization/order/recovery semantics, instruction authorization, and business lifecycle |

Frontend visibility rules, hidden controls, route guards, client validation, and local state MUST NOT be treated as authorization, domain validation, or a source of truth.

Backend MUST NOT change a consumed contract unilaterally. Contract producers and consumers must coordinate compatible migration through the technical-design or interface-contract owner.

Frontend MUST NOT directly invoke privileged tools, access private data outside a backend-authorized contract, inject system prompts, select agent tools, or treat model output as business completion.

## Operations and DevOps boundaries

DevOps owns the safe, observable, recoverable operation of approved systems. It does not own product semantics, domain authority, or agent reasoning.

| Domain | DevOps owns | Other owners retain |
|---|---|---|
| Release and environment | Immutable-artifact promotion, environment configuration delivery, deployment mechanics, health gates, rollback, and operational runbooks | Product release scope; architecture constraints; application correctness |
| Infrastructure and runtime | Compute, network, certificates, process/container supervision, resource guardrails, capacity, dependency health, and platform recovery | Backend resource authorization and business lifecycle; harness agent execution semantics |
| Secrets and configuration | Secret/configuration delivery, environment isolation, rotation procedures, and access observability | Secret values, business credential authority, request authorization, and domain policy |
| Data operations | Storage infrastructure, backup/restore mechanisms, recovery exercises, encryption operations, and capacity | Data model, business facts, retention/deletion policy, legal obligations, and domain data repair |
| Observability and incidents | Telemetry transport, dashboards, alert routing, on-call runbooks, platform incident coordination, and availability/capacity signals | Business metrics and audit facts; harness execution traces; customer-impact commitments |

DevOps MAY enforce safe platform guardrails. It MUST NOT silently change product entitlement, billing, domain state, business authorization, prompt/model/tool behavior, or user-visible semantics to address operational pressure.

DevOps MUST NOT directly repair business data or use infrastructure access to bypass application authorization. It may execute an approved recovery procedure; the backend/domain owner defines the semantic repair and verifies the result.

Production infrastructure, deployment, rollback, accounts, secrets, and protected delivery configuration remain explicit user-authorization boundaries.

### Role invocation accounting

Before every subagent dispatch (`subagent`/`subagent_fork`), the main Agent MUST load the `agent-usage-ledger` skill (`~/.dsh/skills/agent-usage-ledger/SKILL.md`) and append a pre-dispatch record to `~/.dsh/team/ledger/agent-ledger.jsonl`. The ledger is append-only evidence, not approval. Aggregates derived from it are subject to the skill's accuracy caveat (counts depend on main-Agent discipline).

## Artifact contract

Return a structured report with:

- `status`: `complete`, `blocked`, `needs-authorization`, or `needs-decision`;
- evidence paths and exact commands actually run;
- changed paths or reviewed revision/diff;
- constraints, risks, and uncovered cases;
- next owner and required gate.

Reports are evidence, not approval. Store code-version-bound artifacts in the repository. The team knowledge space indexes them and stores cross-project standards and approved decisions (KNOWLEDGE VAULT: not configured in DSH — do not assume this path exists).

## Independence and gates

- An implementation owner must not review its own diff.
- QA does not repair the implementation it tests.
- Code review and compliance are independent gates.
- Architecture changes, external dependencies, secret/account access, protected-path mutation, commit, push, deploy, and changing effective norms/ADRs require user authorization.
- A gate report applies only to the revision it identifies. Any later code change invalidates affected gates.

## Knowledge management

The main agent owns knowledge intake, indexing, provenance, freshness, and conflict marking. It may create drafts and indexes. Only the user can mark team standards or ADRs effective. `raw/` sources are immutable. Personal-vault content is private by default and must not be bulk-read or rewritten for project work.

## Escalation

Return `needs-decision` for missing product scope, incompatible contracts, or ambiguous ownership. Return `needs-authorization` for an authorization-gated action. Do not ask the user directly; the main agent is the only user-facing coordinator.
