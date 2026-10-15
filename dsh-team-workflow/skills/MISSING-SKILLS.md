# MISSING-SKILLS — dangling autoload bindings and role-layer gaps

Scope: what the **skill layer** of `dsh-team-workflow` deliberately does **not** provide.

This file is not a skill: it has no YAML frontmatter and its filename is not kebab-case, so DSH skill
discovery skips it (the platform scans one level of the skills root for `*.md` and `<dir>/SKILL.md`;
this file is parsed, found to have no frontmatter, and ignored with a host warning — see
`CONVERSION-NOTES.md` §6). Path remaps and per-skill semantic changes are in `CONVERSION-NOTES.md`.

---

## 1. Source evidence (authoritative)

Verbatim from the read-only migration package, `03-来源与差距.md`, section 「可观测的依赖缺口」:

> 从 10 份角色的 `autoloadSkills` 交集得到 24 个技能名：本地团队技能 13 个、共享技能 9 个实际存在、**2 个不存在**。其余两个团队技能 `agent-usage-ledger`、`technical-design-delivery` 由主 Agent/技术设计流程调用而非角色自动加载。缺口：
>
> - 前端角色引用 `react-page-implementation`，当前 `~/.omp/agent/skills/` 与 `~/.agents/skills/` 均无对应 `SKILL.md`。
> - 代码审查角色引用 `branch-diff-static-review`，同样不存在。现存 `code-review-defect-patterns` 和 `code-review-delivery` 并非同名实现。
>
> 不要以空壳文件消除缺口。目标系统应明确移除悬空绑定并按现有审查能力执行，或在获得可信实现后按来源/授权补齐，再验相应流程。另 5 个列于团队角色注册表中的通用/审查角色（`reviewer`、`security-reviewer`、`scout`、`sonic`、`task`）没有位于本机 OMP 专属 `agents/` 的定义；不能把 10 份专属角色文件误报为 15 份。

The two bindings, quoted from the role files in the package:

| Role file | `autoloadSkills` (verbatim) |
|---|---|
| `sources/omp/agents/frontend.md` | `[team-workflow, frontend-delivery, react-best-practices, react-page-implementation, hermes-obsidian]` |
| `sources/omp/agents/code-review.md` | `[team-workflow, code-review-delivery, branch-diff-static-review, code-review-defect-patterns, hermes-obsidian]` |

Recomputed from the package to confirm the source numbers (`sources/omp/agents/*.md` → union of
`autoloadSkills`):

```
roles with autoloadSkills : 10
union of autoloadSkills   : 24 names
present in the package    : 22  (13 team + 9 shared)
NOT present               :  2  (react-page-implementation, branch-diff-static-review)
local skills not role-autoloaded: agent-usage-ledger, technical-design-delivery (main-Agent / technical-design flow)
```

## 2. Neither binding exists in the package — verified

```
$ cd <package-root>
$ find sources -iname '*react-page-implementation*' -o -iname '*branch-diff-static-review*'
(no output)

$ ls sources/omp/skills/ | wc -l     # 16 incl. . and .. → 15 skill dirs
$ ls sources/shared/skills/ | wc -l  # 10 incl. . and .. →  9 skill dirs
```

Concretely, none of these exist:

- `sources/omp/skills/react-page-implementation/SKILL.md`
- `sources/shared/skills/react-page-implementation/SKILL.md`
- `sources/omp/skills/branch-diff-static-review/SKILL.md`
- `sources/shared/skills/branch-diff-static-review/SKILL.md`

Neither name appears in `sources/SHA256SUMS.txt` (51 source files, verified by
`shasum -a 256 -c sources/SHA256SUMS.txt`; raw output in `../evidence/skills-validate.txt`).

Therefore **24 = 22 existing + 2 dangling** is the exact skill inventory this workstream delivers; no
skill was invented to make the count 24 look complete.

## 3. Rerouting decision

| Dangling binding | Owner role | Covering existing skill | Why it covers the capability |
|---|---|---|---|
| `react-page-implementation` | frontend | **`react-best-practices`** | The frontend role already autoloads `react-best-practices`. That skill is the package's only React implementation guidance: component architecture, state-management decision tree, React 19 Server Components / Actions, performance priorities, pitfalls, and an "AI 常见错误" review table. A page-implementation capability is expressed by applying those rules to the assigned page; there is no separate missing body of rules to reconstruct. |
| `branch-diff-static-review` | code-review | **`code-review-defect-patterns`** | The code-review role already autoloads both `code-review-delivery` (review the exact designated diff, correctness/security/data-loss/contract/regression first) and `code-review-defect-patterns` (the concrete defect-pattern checklist: lazy-init race, resource leak, unwired contract, exception-convergence gap, async-cursor cross-execution, weak tests, plus push-gate re-review procedure). Together they are the branch/diff static review method the dangling name implied. `code-review-delivery` alone is too thin, which is why the reroute names `code-review-defect-patterns` as the substantive replacement. |

**Operational consequence for the role layer (not owned by this workstream):** the role definitions in
`roles/` must drop the dangling name from `autoloadSkills` and load the covering skill instead —
`[team-workflow, frontend-delivery, react-best-practices, hermes-obsidian]` for frontend, and
`[team-workflow, code-review-delivery, code-review-defect-patterns, hermes-obsidian]` for code-review.
Do not carry a reference to a name that cannot be discovered: DSH has no autoload mechanism, so a
dangling name is either silently absent or, if a role instruction tells an agent to load it, a failed
`skill` load. This workstream only publishes the decision; it does not edit `roles/`.

If a trustworthy `react-page-implementation` / `branch-diff-static-review` implementation is later
obtained, it must be added under its own `skills/<name>/SKILL.md` with source/provenance recorded, and
the corresponding role re-verified — not inferred from memory and not stubbed.

## 4. No stub was created — explicit statement

**No empty, placeholder, or stub skill was created for `react-page-implementation` or
`branch-diff-static-review`.** Specifically:

- there is no `skills/react-page-implementation/` directory and no `skills/branch-diff-static-review/` directory;
- there is no `SKILL.md` whose frontmatter `name` is either of those two names, at any depth;
- there is no placeholder body (no `TODO`/`TBD`/`WIP`/empty skill) anywhere in this skills root.

This follows the source instruction 「不要以空壳文件消除缺口」. `skills/_tools/validate_skills.js`
asserts all of the above mechanically (checks `no-dangling-skill-file` and `no-stub-skill`) and exits
non-zero if either is violated.

## 5. Role-registry roles with no local definition — out of scope for the skill layer

`team-workflow` lists a 15-entry role registry. Only **10** roles have a local definition in the package
(`sources/omp/agents/*.md`). The other **5** are out of scope for the skill layer:

| Registry role | Display name | Local role definition | Skill-layer status |
|---|---|---|---|
| `reviewer` | 技术审查专员 | absent | out of scope — no role file, therefore no autoload list to satisfy |
| `security-reviewer` | 安全审查专员 | absent | out of scope |
| `scout` | 代码探查专员 | absent | out of scope |
| `sonic` | 自动化操作员 | absent | out of scope |
| `task` | 通用开发工程师 | absent | out of scope |

Present and mapped (10): `pm`, `architect`, `backend`, `frontend`, `harness`, `devops`, `qa`,
`code-review`, `compliance`, `quota-control`.

The 10 local role files must not be reported as 15. The `agent-usage-ledger` role registry inside the
migrated skill is kept as the source's complete 15-role list (it is an accounting vocabulary, not a
claim that 15 role definitions exist), and the same 5 names appear there.

## 6. Other skill names referenced but not delivered by this package

The migrated bodies also mention skills that are neither team nor shared skills of this package
(OMP/Hermes ecosystem names, or bundled skills). They are **not** delivered here, are **not** stubs,
and must not be assumed present in a DSH session catalog:

`requesting-code-review`, `git-commit-gate`, `api-contract-testing`, `test-driven-development`,
`gsd-add-tests`, `gsd-verify-work`, `gsd-secure-phase`, `gsd-ui-phase`, `gsd-sketch`, `gsd-ui-review`,
`gsd-code-review`, `gstack-cso`, `design-taste-frontend`, `code-sandbox-review`, `spec-workflow-guide`,
`brainstorming`, `grill-me`, `project-bootstrap`, `agent-constitution-generator`, `addyosmani-adr`,
`documentation-workflow`, `devops-constraints-routing`, `codebase-architecture-analysis`.

These are plain skill-name references, not `skill://` URIs or source paths, so they are outside the
mechanical path remap; the bodies were left faithful and the references are recorded here and in
`CONVERSION-NOTES.md` §5. A role or task that needs one of them must treat it as unavailable unless the
host session actually exposes it.

## 7. What this file does not claim

- It does not claim the dangling bindings have been removed from `roles/` — that layer is owned by
  another workstream; only the decision is published here.
- It does not claim DSH has autoload; DSH discovers skills into a session catalog and loads them by
  name (see `CONVERSION-NOTES.md` §6 for the verified platform contract).
- It does not claim any replacement skill was executed or tested as a substitute for the two missing
  names.
