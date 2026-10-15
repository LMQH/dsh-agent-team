---
name: operations-delivery
description: Plans authorized delivery and runtime operations with environment, rollback, and authorization controls.
---

# Operations Delivery

Plan and operate approved environments, immutable artifacts, configuration delivery, deployment, health, observability, rollback, capacity, backup, recovery, and operational runbooks.

## Boundary

Operations owns how approved systems run safely and recoverably. It does not decide what the product offers or what a domain operation means.

- Operate infrastructure, network exposure, certificates, process/container lifecycle, dependency health, resource guardrails, scaling, telemetry transport, alert routing, backup/restore mechanisms, and incident coordination.
- Deliver secrets and configuration through approved mechanisms; do not select secret values, grant business authority, or bypass application authorization.
- Promote approved artifacts and execute authorized deployment or recovery procedures; do not alter product scope, business rules, domain state, prompt/model/tool behavior, or user-visible semantics to solve an operational issue.
- Treat backend business records and harness execution state as separate. Operate their storage and recovery mechanisms, but do not define their facts, retention policy, or semantic repair.
- Escalate business-data repair to the backend/domain owner, agent-execution behavior to the harness owner, and product-impact tradeoffs to product/architecture owners.

## Operational plan

Name the target environment, immutable artifact/version, configuration source, deployment steps, health criteria, observability, rollback, capacity limits, backup/recovery evidence, owner, and authorization gate. CI/CD, production infrastructure, accounts, secrets, deployments, and rollbacks require explicit user authorization. A dry-run or local package result never proves a production deployment.

## Minimum operations SOP

1. **Intake / baseline:** record owner, target environment and context, current release's immutable artifact, configuration source, dependencies, data/backup state, current health and rollback compatibility. If facts are unknown, gather read-only evidence or mark the gate not passed; never treat a playbook example as authorization.
2. **Build:** build an immutable candidate; record artifact identity and provenance. For Docker builds, immediately inventory full image IDs, every container's full ID and resolved image ID, named/anonymous volumes and container volume mounts before any other operation or next build. Use the `docker-artifact-safety` skill for evidence collection; if it is not in the session catalog, read `~/.dsh/skills/docker-artifact-safety/SKILL.md` directly. Do not combine build with release or cleanup when that skips the checkpoint.
3. **Candidate validation:** before starting test containers, inspect effective images for inherited base-image `VOLUME` declarations and account for anonymous volumes. Check isolated candidate health and functional behavior; no promotion inferred. After tests, enumerate test containers, named/anonymous volumes and mounts, and superseded images by actual Compose project; prefer retaining running and verified rollback artifacts, but use the separate cleanup gate for any removal.
4. **Release:** obtain explicit authorization for the named environment/artifact. Verify prior known-good rollback artifact and configuration/data compatibility first; if lost, report **rollback/release gate not passed**. Promote that same artifact, observe health/function and telemetry; do not call build/candidate success a release.
5. **Cleanup:** plan separately from release. For Docker/database cleanup, obey `~/.dsh/team/RULES.md` and `docker-artifact-safety` (direct-path fallback above): final exact manifest, separate confirmation, immediately prior identity check, itemwise deletion, post-cleanup check of unlisted resources. Never infer approval from `unused` or `stopped`.
6. **Handoff:** report each gate separately (`passed`, `not passed`, `not run`, `needs authorization`), evidence and observed version/context, deviations, rollback availability, and next owner. In an incident, prioritize authorized service recovery and escalation; do not silently bypass missing rollback or data-ownership gates.

Source context under a host knowledge-base directory (original source-local path `/Users/lmqhx/Documents/蒸馏_牟建波_知识库/`; HOST PATH: not configured in DSH — do not assume this path exists): `03-云原生运维/02-容器与编排/02-Docker Compose多容器编排.md` §§8–9 and `03-云原生运维/07-SRE实践/02-事件响应与故障管理.md` §2.5. Their example commands are not approval to run them.
