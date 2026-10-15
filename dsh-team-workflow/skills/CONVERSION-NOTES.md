# CONVERSION-NOTES — OMP → DSH skill-layer migration

Read-only source package: `OMP团队开发工作流-DeepSeekHarness复刻包-20261013` (`sources/omp/skills/`,
`sources/shared/skills/`).
Target: `<projectRoot>/skills/` — i.e. the DSH **project skill root** `<projectRoot>/.dsh/skills`
(see §6). 24 skills delivered: 15 team + 9 shared, plus their `references/`, `scripts/`, `tests/`
resources.

> **Installation note for the integration step (owned elsewhere).** This workstream delivers the
> payload at `<workstream>/skills/`. That directory is **not itself a DSH discovery root**: the
> platform scans `<projectRoot>/.dsh/skills` (and `<projectRoot>/.agents/skills`, then
> `~/.dsh/skills`, `~/.agents/skills`). For the 24 skills to become discoverable, this tree must be
> installed/copied/symlinked so that the bundles land at `<root>/<name>/SKILL.md` under one of those
> roots. Nothing in this workstream performs that install, and being present in `skills/` alone does
> not make a skill discoverable.

Method: each `SKILL.md` was copied byte-identically and then patched by exact-string replacement, so
every unchanged rule is the source's own text. Only the changes listed below were made; any change not
listed here did not happen. No content was summarised away, and no skill, rule, or test result was
invented.

---

## 1. Path remap table

| # | Source construct (old) | DSH target (new) | Applies to |
|---|---|---|---|
| 1 | `~/.omp/agent/skills/<x>` | `~/.dsh/skills/<x>/SKILL.md` | general convention |
| 2 | `skill://<x>` | `~/.dsh/skills/<x>/SKILL.md` — **DSH has no `skill://` URI scheme and no autoload**; the skill is discovered into the session catalog and loaded by name | `team-workflow` |
| 3 | `~/.omp/agent/RULES.md` | `~/.dsh/team/RULES.md` | `docker-artifact-safety`, `operations-delivery` |
| 4 | `~/.omp/agent/usage/authorized/agent-ledger.jsonl` | `~/.dsh/team/ledger/agent-ledger.jsonl` | `agent-usage-ledger`, `team-workflow` |
| 5 | `/Users/lmqhx/wiki` and every Obsidian vault path | **not configured** → `KNOWLEDGE VAULT: not configured in DSH — do not assume this path exists`. The authority rule is kept: approved standards/ADRs outrank drafts, session memory, and unverified reports; if no vault is configured, only standards recorded in the repository count as approved | `hermes-obsidian`, `team-workflow` |
| 6 | `/Users/lmqhx/Documents/蒸馏_牟建波_知识库/` | **not configured** → `HOST PATH: not configured in DSH — do not assume this path exists`. The referenced document names/§ numbers are kept as instructional, explicitly non-authorizing context | `docker-artifact-safety`, `operations-delivery` |
| 7 | `~/react/memory.md`, `setup.md`, `memory-template.md` | **not configured** → same host-path marker. Decision persistence redirected to project-local decision records / `<project>/delivery/`; the package ships neither helper file | `react-best-practices` |
| 8 | `@~/.codex/AGENTS.md` reference | **not present in any migrated skill body.** It occurs only in `sources/omp/AGENTS.md` and `sources/imported/AGENTS.md`, which are instruction-layer inputs owned by `instructions/`. Recorded here so it is not silently assumed | instruction layer (not this workstream) |
| 9 | repository delivery evidence (PRD, ADR, Tech Spec, implementation plan, Test Spec, QA acceptance report, any revision-bound gate report) | `<project>/delivery/` | `team-workflow` (artifact contract) |
| 10 | `DevDocs/` project documentation tree | `<project>/delivery/DevDocs/` — tree shape, filenames, and step numbering preserved (15 occurrences) | `pm-requirements` |
| 11 | `.ai-rules.md` / `AGENT_CONSTITUTION.md` simplified constitution | **not configured** by this package. The DSH equivalent is the instruction layer (`instructions/`, incl. `AGENTS.md`); the skill now says so and does not claim the file exists | `pm-requirements` |
| 12 | `@oh-my-pi/pi-coding-agent`, `pi.on("tool_call")` | **not present in any migrated skill body.** Where an OMP plugin behavior is needed, the DSH equivalent is a **PreToolUse command hook** — see `policies/` (owned by another workstream). This package does **not** claim the OMP plugin runs on DSH | plugin/policy layer |
| 13 | OMP dispatch API `task` / `agent()`, `task[]` batch id | DSH `subagent` / `subagent_fork` tool dispatch; one dispatch call = one batch | `agent-usage-ledger`, `team-workflow`, `verification-before-completion` |
| 14 | `autoloadSkills` role frontmatter | **no DSH equivalent (not configured)** — DSH discovers skills into a session catalog and loads them by name; there is no autoload, so a role must load explicitly | role layer (not this workstream) |
| 15 | `triggers:` regex routing blocks | **not configured** — DSH has no trigger routing; converted into `whenToUse` and the removed block is recorded in §3 | 9 shared skills |
| 16 | `allowed-tools:` frontmatter (Claude Code field) | **not configured** — DSH skill frontmatter cannot constrain tools; tool permission is enforced by the host/tool + sandbox layer | `react-best-practices`, `verification-before-completion` |
| 17 | `model: "@team_*"` role aliases | not applicable to the skill layer (role layer). No provider, account, or credential is inferred from an alias | role layer |

`~/.dsh/team/RULES.md` and `~/.dsh/team/ledger/agent-ledger.jsonl` are the agreed **targets for the
remap**; this workstream did not create them and does not claim they exist (they belong to the
instructions/policies and ledger owners).

## 2. Frontmatter normalisation

DSH frontmatter for every delivered skill now contains only: `name` (kebab-case, required),
`description` (required), optional `whenToUse`, and optional `metadata`. The source `name` and
`description` are kept verbatim except where an OMP-only token had to change (§3). Nothing was added
that the source does not support.

`whenToUse` was added to **16** skills, only where the source states invocation conditions (a "Use
when …" description, a 何时使用 / 什么时候用 / 触发时机 / When to Use section, or explicit entry
conditions):

`team-workflow`, `agent-usage-ledger`, `docker-artifact-safety`, `hermes-obsidian`, `qa-delivery`,
`quota-governance`, `technical-design-delivery`, `anti-fake-testing`, `cross-team-contract-alignment`,
`code-review-defect-patterns`, `database-design-checklist`, `pm-requirements`, `react-best-practices`,
`security-test-matrix`, `verification-before-completion`, `web-architecture-patterns`.

The remaining **8** skills state no invocation condition in the source, so no `whenToUse` was invented
for them: `architecture-delivery`, `backend-delivery`, `code-review-delivery`, `compliance-delivery`,
`frontend-delivery`, `harness-delivery`, `operations-delivery`, `product-delivery`.

`user-invocable: false` was **not** set anywhere: no source states that a skill is internal-only. The
phrases that might be mistaken for it — `agent-usage-ledger` ("the main Agent calls this skill"),
`technical-design-delivery` ("a shared skill, not an Agent role"), `hermes-obsidian` ("the main Agent
owns vault operations") — describe *who applies* the skill, not a prohibition on user invocation.

Source-only frontmatter keys removed (all of them are OMP/Hermes/Claude-Code constructs that DSH
either ignores or would misrepresent; DSH ignores unknown top-level keys, but keeping them would imply
a routing/enforcement mechanism that does not exist):

| Skill | Removed source keys | Kept |
|---|---|---|
| `anti-fake-testing` | `version`, `author`, `triggers` | `metadata.hermes` |
| `code-review-defect-patterns` | `version`, `author`, `license`, `platforms`, `triggers` | `metadata.hermes` |
| `cross-team-contract-alignment` | `version`, `author`, `license` | `metadata.hermes` |
| `database-design-checklist` | `version`, `author`, `triggers` | `metadata.hermes` |
| `pm-requirements` | `version`, `author`, `triggers` | — |
| `react-best-practices` | `version`, `author`, `license`, `platforms`, `triggers`, `allowed-tools` | `metadata.hermes` |
| `security-test-matrix` | `version`, `author`, `triggers` | `metadata.hermes` |
| `verification-before-completion` | `version`, `author`, empty `metadata:`, `triggers`, `allowed-tools` | — |
| `web-architecture-patterns` | `category`, `triggers` | — |
| `hermes-obsidian` | none | `metadata` (`source`, `source-sha256`, `migration-batch`) |
| other 14 team skills | none | — |

The removed values are still traceable: the 9 shared skills' triggering conditions are preserved as
`whenToUse`, and the raw source text of every removed key remains available in the read-only package
and is covered by `sources/SHA256SUMS.txt`.

## 3. Per-skill semantic changes

Verified against the source with `diff`: **7 skills are byte-identical to the source**
(`architecture-delivery`, `backend-delivery`, `code-review-delivery`, `compliance-delivery`,
`frontend-delivery`, `harness-delivery`, `product-delivery`). Every other skill differs only in the
ways listed below — no other line was touched. `operations-delivery` changed in its body but not its
frontmatter; the other 16 have a rewritten frontmatter block as well.

| Skill | changed lines (+added/−removed) | Kind of change |
|---|---:|---|
| `architecture-delivery`, `backend-delivery`, `code-review-delivery`, `compliance-delivery`, `frontend-delivery`, `harness-delivery`, `product-delivery` | 0 / 0 | none |
| `qa-delivery`, `technical-design-delivery` | +1 / 0 | `whenToUse` added |
| `quota-governance` | +2 / −1 | `whenToUse` added, `OMP` token dropped from description |
| `operations-delivery` | +3 / −3 | body remaps only |
| `docker-artifact-safety` | +3 / −2 | frontmatter + body remaps |
| `agent-usage-ledger` | +7 / −6 | frontmatter + OMP API/path remaps |
| `hermes-obsidian` | +8 / −6 | frontmatter + vault/title/command remaps |
| `team-workflow` | +9 / −6 | frontmatter + role/authority/path remaps |
| `anti-fake-testing` | +1 / −12 | `whenToUse` added; `version`/`author`/`triggers` moved out of frontmatter |
| `cross-team-contract-alignment` | +1 / −3 | `whenToUse` added; `version`/`author`/`license` removed |
| `database-design-checklist` | +1 / −17 | `whenToUse` added; `version`/`author`/`triggers` removed |
| `security-test-matrix` | +1 / −16 | `whenToUse` added; `version`/`author`/`triggers` removed |
| `web-architecture-patterns` | +1 / −16 | `whenToUse` added; `category`/`triggers` removed |
| `code-review-defect-patterns` | +3 / −14 | `whenToUse` added; keys removed; reference link added |
| `react-best-practices` | +7 / −29 | `whenToUse` added; keys removed; host-path markers added |
| `verification-before-completion` | +5 / −27 | `whenToUse` added; keys removed; `task`→`subagent`; pipeline names aligned |
| `pm-requirements` | +24 / −42 | frontmatter + `DevDocs` remap + DSH migration note |

**`team-workflow`**
1. H1 `# OMP Team Workflow Contract` → `# DSH Team Workflow Contract`.
2. `description`: `Governs OMP professional-team …` → `Governs DSH professional-team …` (only the
   platform token changed).
3. Authority order item 3: "Approved team standards and ADRs in the Obsidian team space" →
   "… in the team knowledge space", with the `KNOWLEDGE VAULT: not configured in DSH` marker and the
   fallback that only repository-recorded standards count as approved while no vault is configured.
   The authority ranking itself (user instruction > repo constitution/AGENTS.md/effective ADRs >
   approved standards > task manifest > memory) is unchanged.
4. "OMP dispatch IDs are fixed runtime identifiers" → "Dispatch IDs are fixed runtime identifiers".
   The 15-row display-name/ID table is unchanged.
5. Added one paragraph after the table recording that only 10 of the 15 registry roles have a local
   definition and that the other 5 are out of scope for the skill layer, pointing at
   `../MISSING-SKILLS.md`.
6. Role-invocation accounting: `skill://agent-usage-ledger` → the `agent-usage-ledger` skill at
   `~/.dsh/skills/agent-usage-ledger/SKILL.md`; `task`/`agent()` → `subagent`/`subagent_fork`; ledger
   path remapped (row 4). The MUST-load-before-every-dispatch rule and the "ledger is evidence, not
   approval" caveat are unchanged.
7. Artifact contract: repository-bound artifacts now name `<project>/delivery/`; the vault sentence
   carries the `KNOWLEDGE VAULT` marker. The rule that reports are evidence and not approval, and that
   code-version-bound artifacts live in the repository, is unchanged.

**`agent-usage-ledger`**
1. `description`: "BEFORE every `task`/`agent()` spawn (pre-dispatch)" → "BEFORE every subagent spawn
   (pre-dispatch)". Everything else in the description is verbatim.
2. "Spawning with the default role (no explicit `agent`) → record `task`." → "Spawning without an
   explicit role → record `task`." (same rule, DSH has no `agent` parameter).
3. Ledger path remapped (row 4).
4. "For every `task`/`agent()` invocation" → "For every subagent dispatch (`subagent` /
   `subagent_fork`)".
5. `role` field note now says "default `task` if the role is omitted"; `batch_id` note no longer refers
   to the OMP `task[]` type. Record schema, append-only discipline, atomic single-`>>` write, and the
   "never backfill / do not fabricate records" constraints are unchanged.

**`docker-artifact-safety`**
1. Rule pointer `~/.omp/agent/RULES.md` → `~/.dsh/team/RULES.md` (row 3).
2. Source-context path marked **not configured** (row 6) while keeping the document names/§ numbers as
   explicitly non-authorizing instructional context. All inventory, release, and cleanup gates are
   unchanged.

**`operations-delivery`**
1. "if the skill URI is unavailable, read `~/.omp/agent/skills/docker-artifact-safety/SKILL.md`" →
   "if it is not in the session catalog, read `~/.dsh/skills/docker-artifact-safety/SKILL.md`".
2. Cleanup step RULES pointer remapped (row 3).
3. Source-context path marked **not configured** (row 6). The six-step SOP and its four separate gate
   outcomes are unchanged.

**`hermes-obsidian`**
1. H1 `# OMP Obsidian Knowledge Management` → `# Knowledge Vault Management (Obsidian format)`.
2. Opening rule rewritten for the unconfigured vault (row 5): the marker plus "the OMP source
   configured the vault at `/Users/lmqhx/wiki`; use this skill only for a vault path the user explicitly
   supplies in this session". The `SCHEMA.md`-first rule, `raw/` immutability, and "only the controlled
   ingest script may add its required frontmatter; never rewrite source bodies" are unchanged.
3. Controlled commands: the three source commands with the hardcoded vault path became
   `"$VAULT"`-parameterised commands with a comment that `$VAULT` is the session-supplied path, plus a
   note that the `scripts/` paths are relative to this skill bundle. The script semantics (what
   `wiki_ingest.py` / `wiki_lint.py` / `wiki_dedup.py` do, and that `--rehash*` needs user
   authorization) are unchanged.
4. `metadata` (source, source-sha256, migration-batch) kept verbatim.

**`pm-requirements`**
1. `DevDocs/` → `<project>/delivery/DevDocs/` in all 15 occurrences; the project tree block was
   re-indented under `<project>/delivery/` with all filenames and step numbering intact.
2. Added one DSH migration note after Step 6's "完整宪法 … 生成" line: `agent-constitution-generator`
   and `project-bootstrap` are not in this package; the DSH carrier for project-level effective rules
   is the instruction layer (`instructions/`, incl. `AGENTS.md`), and this package does not configure
   or claim `.ai-rules.md`. No rule of the 7-step flow was changed.

**`react-best-practices`**
1. "项目决策持久化" section: persistence moved to project-local decision records /
   `<project>/delivery/`, with the original `~/react/memory.md`, `memory-template.md`, and `setup.md`
   explicitly marked **not configured** (row 7).
2. "转换说明 → 变更" bullet list updated so it no longer claims live DSH support for constructs that
   were removed: `triggers` → `whenToUse` (no autoload in DSH) and `allowed-tools` removed (DSH skill
   frontmatter cannot constrain tools); the `~/react/memory.md` bullet carries the host-path marker.
3. All React 19 engineering rules, decision tree, quick-reference table, performance priorities,
   pitfall tables, and the `metadata.hermes` block are unchanged.

**`verification-before-completion`**
1. "在 `task` 子代理返回结果后验证其声称" → "在 `subagent` 子代理返回结果后验证其声称" (row 13).
2. The three pipeline names were aligned to the team-workflow vocabulary:
   `极速管道` → `极速管道（Fast）`, `标准管道` → `标准管道（Standard）`, `深度管道` →
   `深度管道（Deep）`. No verification requirement changed.

**`code-review-defect-patterns`**
1. Added one pointer line to the reference file that shipped with the skill but was never linked from
   the source `SKILL.md`: `references/architecture-decision-conflicts.md`. This is a link to an
   existing source file, not new content. All defect patterns, weak-test patterns, SQLAlchemy notes,
   and the re-review procedure are unchanged.

**`cross-team-contract-alignment`, `database-design-checklist`, `anti-fake-testing`,
`security-test-matrix`, `web-architecture-patterns`, `qa-delivery`, `quota-governance`,
`technical-design-delivery`** — no body change. `quota-governance`'s and `team-workflow`'s
descriptions had the platform token `OMP` removed; all other descriptions are byte-identical to the
source. `web-architecture-patterns` keeps its source section-numbering defects (two `## 6.2`, two
`## 7`) because renumbering would change nothing operationally and the reference links are correct.

## 4. Resources carried over

All source `references/`, `scripts/`, and `tests/` files were copied byte-identically **inside the
owning skill bundle** (12 files), which is what DSH's resource base expects: the platform reports
`Base directory for this skill: <bundle>` and relative paths must resolve against it.

```
code-review-defect-patterns/references/architecture-decision-conflicts.md
hermes-obsidian/scripts/wiki_ingest.py
hermes-obsidian/scripts/wiki_lint.py
hermes-obsidian/scripts/wiki_dedup.py
hermes-obsidian/tests/test_wiki_lint.py
web-architecture-patterns/references/api-platform-compatibility.md
web-architecture-patterns/references/demo-frontend-with-docker.md
web-architecture-patterns/references/dual-platform-html-test-tool.md
web-architecture-patterns/references/html-to-react-spa-refactor.md
web-architecture-patterns/references/kling-ai-api.md
web-architecture-patterns/references/new-api-videos-endpoint.md
web-architecture-patterns/references/proxy-aware-adapters.md
```

Cross-check: all 12 files are byte-identical to `sources/**` (verified by `cmp`), and the three
`web-architecture-patterns` references that the source `SKILL.md` does not link
(`kling-ai-api.md`, `new-api-videos-endpoint.md`, `dual-platform-html-test-tool.md`) were carried
anyway because they are part of the source bundle; the validator reports them as `WARN unreferenced-resource`.

## 5. Not delivered (see MISSING-SKILLS.md)

- `react-page-implementation` (frontend) and `branch-diff-static-review` (code-review) are dangling
  autoload bindings with no `SKILL.md` in the package. Rerouted to `react-best-practices` and
  `code-review-defect-patterns`; **no stub was created**.
- The 5 registry roles without a local definition (`reviewer`, `security-reviewer`, `scout`, `sonic`,
  `task`) are out of scope for the skill layer.
- Skill names referenced by the bodies but not delivered here: `requesting-code-review`,
  `git-commit-gate`, `api-contract-testing`, `test-driven-development`, `gsd-add-tests`,
  `gsd-verify-work`, `gsd-secure-phase`, `gsd-ui-phase`, `gsd-sketch`, `gsd-ui-review`,
  `gsd-code-review`, `gstack-cso`, `design-taste-frontend`, `code-sandbox-review`,
  `spec-workflow-guide`, `brainstorming`, `grill-me`, `project-bootstrap`,
  `agent-constitution-generator`, `addyosmani-adr`, `documentation-workflow`,
  `devops-constraints-routing`, `codebase-architecture-analysis`. They are plain names, not URIs or
  paths, so they are outside the mechanical remap; the bodies were left faithful and the references
  are recorded rather than rewritten.

## 6. Verified DSH platform contract these files were built against

Read from the shipped application (`@deepseek-ai/dsh-skill-filesystem/lib/index.js` and
`@deepseek-ai/dsh-skill/lib/index.js` inside `app.asar`), not assumed:

- **Roots:** `<projectRoot>/.dsh/skills`, `<projectRoot>/.agents/skills`, custom dirs, then
  `~/.dsh/skills` (`DSH_HOME`) and `~/.agents/skills`. This workstream's `skills/` is the payload for
  `<projectRoot>/.dsh/skills`.
- **Discovery is exactly one level deep:** a directory entry becomes a skill via
  `<root>/<name>/SKILL.md`; a file entry becomes a single-file skill via `<root>/<name>.md`. A nested
  `**/SKILL.md` is never discovered. Resource subdirectories (`references/`, `scripts/`, `assets/`) are
  loadable but not scanned for skills.
- **Frontmatter:** `name` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; `description` is required;
  `whenToUse` is an optional string; `disable-model-invocation` / `user-invocable` are optional
  booleans (defaults: model-invocable unless disabled, user-invocable unless `false`); legacy
  camelCase keys (`disableModelInvocation`, `modelInvocable`, `userInvocable`) throw and the whole file
  is skipped; unknown extra top-level keys are ignored; `metadata` must be an object.
- **Failure mode:** malformed frontmatter makes the host skip the skill with a warning only — nothing
  fails the session. The validator is therefore the only model-visible safety net.
- **Directory name vs frontmatter name:** the platform keys the catalog on the frontmatter `name` and
  does not require it to equal the directory name. The validator enforces equality anyway, because the
  deliverable specifies `skills/<name>/SKILL.md` and a mismatch means the discoverable path no longer
  matches its name.
- **Root-level `*.md` is scanned** as a candidate single-file skill. That is why `MISSING-SKILLS.md`
  and this file (mandated names, no frontmatter) each cause a host warning "missing YAML frontmatter"
  and are skipped. Harmless, and reported as `WARN` — not `ERROR` — by the validator. `_tools/` is
  probed for `_tools/SKILL.md`, finds nothing, and is ignored.

## 7. Validator and evidence

- `_tools/validate_skills.js` — run as `node skills/_tools/validate_skills.js` from the workstream root
  (it also works from any cwd; it resolves the skills root from its own location). It uses only the
  Node standard library and a purpose-written minimal YAML-frontmatter reader: **no `npm install`, no
  dependency on the `yaml` package.** It prints a JSON summary and exits non-zero on any `ERROR`.
- `../evidence/skills-validate.txt` — exact command, raw stdout+stderr, exit code, followed by the raw
  `shasum -a 256 -c sources/SHA256SUMS.txt` output.
- `../evidence/skills-inventory.txt` — every delivered file with byte size.

Checks performed: frontmatter parses; directory name equals frontmatter `name`; kebab-case; unique
names; non-empty `description`; optional invocation keys are strict booleans; no legacy camelCase keys;
discoverable at exactly `<root>/<name>/SKILL.md`; no accidental nested `SKILL.md`; no forbidden
source-local/host path (`/Users/lmqhx`, `~/.omp`, `~/.codex`, `skill://`, `/Users/maxwell/Downloads`)
outside an explicit "not configured" marker line; no `SKILL.md` for the two dangling names; no
stub/empty skill; every referenced `references/…`, `scripts/…`, `assets/…` path resolves. It also
pins the delivered inventory: this exact set of 24 names, the 12 carried resources, and the two root
documents must all be present, and no undelivered skill may appear.

**Negative self-test (the validator was proven to fail on violations, not just to pass).** A fixture
tree was built inside the write scope (`skills/_selftest/`, since deleted) containing 16 deliberately
broken bundles, and the same script was run against it. It exited `1` and reported 69 errors, one or
more for every check, including: `description-missing`, `name-directory-mismatch` (×3),
`name-not-kebab-case`, `legacy-invocation-key`, `invocation-not-strict-boolean`, `metadata-not-object`,
`forbidden-path` (×2 for `~/.omp` and `skill://`), `resource-missing`, `stub-skill` (×2),
`nested-skill-file` (a `references/deep/SKILL.md`), `dangling-skill-file` +
`dangling-skill-name` (a planted `react-page-implementation/SKILL.md`), plus `skill-missing`,
`skill-unexpected` and `resource-not-carried` for the absent real inventory. A fixture line carrying
`not configured` was correctly **exempted** rather than flagged. The fixture was removed before the
final run; the real tree is the only tree under `skills/`.

## 8. Not verified / limitations

1. **Live catalog not observed.** The platform contract in §6 was established by reading the shipped
   implementation. No DSH session was started and no skill catalog was observed listing these 24
   skills; discovery/priority behaviour in a running host remains unverified.
2. **`hermes-obsidian` scripts need a vault that does not exist here.** Their syntax was compiled and
   the carried test was executed: `python3 tests/test_wiki_lint.py` → `Ran 1 test … OK`, exit 0 (raw
   output in `../evidence/skills-validate.txt`). `wiki_ingest.py` and `wiki_dedup.py` were **not**
   executed against a real vault (none is configured, and `--rehash*`/ingest would need explicit user
   authorization). No claim is made about their behaviour on real vault data.
3. **Reference documents were not executed.** The 8 `references/*.md` files are carried byte-identical
   and their existence resolves from their `SKILL.md`, but their example commands (Docker, nginx,
   curl, proxy) were not run — most target external services or hosts that do not exist here.
4. **Target directories are agreed, not created.** `~/.dsh/team/RULES.md`,
   `~/.dsh/team/ledger/agent-ledger.jsonl`, `<project>/delivery/`, and `instructions/` are referenced
   as targets; this workstream did not create them and does not assert they exist.
5. **Role/policy/instruction layers are out of scope.** `roles/`, `policies/`, `instructions/` are
   owned by other workstreams. In particular the two reroutes in §5 must be applied there before a role
   can load a covering skill, and no `PreToolUse` hook was implemented or tested here.
6. **The two missing skills remain unfound.** Only their absence from this package is verified; no
   trusted external implementation was sought or obtained.
