---
name: docker-artifact-safety
description: Use when building container images, validating Docker or Compose candidates, releasing them, or cleaning up Docker resources where image identity and rollback safety matter.
whenToUse: Use when building container images, validating Docker or Compose candidates, releasing them, or cleaning up Docker resources where image identity and rollback safety matter.
---

# Docker artifact safety

The rule is `~/.dsh/team/RULES.md`; this skill describes how to collect its evidence. Scope every query to the intended Docker context/host; preserve only the required identity fields in the delivery record, not raw inspect JSON, environment variables, labels or secret-bearing configuration. Never infer deletion safety from `unused`, `dangling`, or a stopped state.

| Stage | Required evidence | Gate |
| --- | --- | --- |
| Build | Build result plus immediate full-ID inventory before any other operation | Not released |
| Candidate validation | Candidate's resolved image ID, container ID, isolated health/function checks; no promotion inferred | Candidate only |
| Release | Exact immutable artifact, target, observed health and rollback path (prior known-good artifact plus configuration/data compatibility) | Requires separate deployment authorization |
| Cleanup | Per-item manifest, separate confirmation, pre-delete identity recheck, post-delete reconciliation | Requires separate deletion authorization |

## Docker inventory (read-only)

After **every** build, before any other operation or next image build, collect `docker image ls --all --no-trunc --digests`, `docker container ls --all --no-trunc`, and `docker image inspect --format '{{.Id}} {{json .RepoDigests}} {{json .RepoTags}}' <built-reference>` for the full built ID and available digests/tags. Also enumerate **all** named and anonymous volumes in the affected context and inspect every container's volume mounts. Save only required fields, not unfiltered inspection output.
Use `docker volume ls --format '{{.Name}} {{.Label "com.docker.compose.project"}}'` followed by `docker volume inspect --format '{{.Name}} {{.CreatedAt}}' <volume>` for every listed volume; include anonymous names rather than filtering them out. Preserve only these identity/project fields; do not read arbitrary labels, volume contents, or secret-bearing container configuration.
Inspect **every container returned in the affected Docker context** with `docker container inspect --format '{{.Id}} {{.Image}} {{json .Config.Image}} {{json .Name}} {{json .State.Status}} {{range .Mounts}}{{if eq .Type "volume"}}{{.Type}}:{{.Name}}:{{.Destination}};{{end}}{{end}}' <full-id>`; record its full ID, requested reference, resolved image ID, name, state, and volume names/types/mount destinations. Record each image's repository tags/digests and identify all containers using built/prior image IDs. Compare each requested reference and resolved ID with the recorded immutable candidate/rollback identity; an unexplained mismatch fails the relevant inventory, release or cleanup gate until resolved. Tags and digest availability vary with build and registry; lists alone do not establish the container-to-image mapping.
If the build has no local output image (e.g. remote build/push), use the builder/registry's immutable digest and inventory the actual target runtime; do not invent a local image ID. If identity cannot be established, mark the gate not passed.

Avoid `docker compose up --build`, `down`, `down -v`, `down --rmi`, and equivalent combined steps when they prevent a pause for inventory/approval or remove unenumerated resources. Build first, inventory, validate in an isolated candidate, then seek release authorization. Before promotion, identify and verify that the previously running artifact is still obtainable at its exact immutable identity; check configuration/schema/data compatibility. If not, state **rollback/release gate not passed**, even when candidate health is green. Never replace the missing identity with a rebuilt or retagged image.
Before creating test containers, inspect `docker image inspect --format '{{json .Config.Volumes}}' <image>` on the effective test images: base-image `VOLUME` declarations may be inherited even when the Dockerfile or Compose file declares none. Plan explicit named volumes or tmpfs where appropriate, and record any anonymous volumes that are created; never assume an anonymous volume is disposable.

After tests, group the inventory by the **actual Compose project label**, not a guessed project name: enumerate its test containers, named/anonymous volumes with mounts, and superseded images. Prefer retaining only artifacts needed by the running workload and verified rollback path, subject to any required test evidence or data retention. Classify candidates for cleanup without treating `stopped`, `anonymous`, `dangling`, or `reclaimable` as deletion approval; use the exact cleanup transaction below for every proposed removal.
For project grouping, use `docker container ls --all --no-trunc --format '{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}'` and verify the same project label on named volumes; anonymous volumes require their container-mount mapping rather than a guessed name prefix. Include stopped containers in the mapping.

## Exact cleanup transaction

1. Inventory adjacent resource types for dependency/impact analysis (containers, images, volumes, networks, build cache, databases), but propose deletion **only** of resources explicitly named in the original user request; additional resources require a new request, not an expanded manifest. Identify dependencies, rollback artifacts and data ownership. No deletion is implied by build/release approval. For every proposed deletion, present context/host, resource type, full ID and name, image reference and resolved image ID if relevant, reason, rollback/data impact, and exact command/effect. State explicitly which resources are excluded.
2. Request **separate explicit confirmation of the final exact manifest**. If it changes, seek confirmation again. Right before execution, inspect every listed identity and relevant dependencies; if any differs, stop. Never use `prune`, wildcard selection, `compose down` or force removal to bypass this match. For an approved individual image deletion, distinguish removing a tag from removing the underlying image ID and check all tags/consumers first. Database/volume deletion needs the same manifest and a separately authorized data/backup procedure.
3. Remove only confirmed items, then re-inventory the same scope. Compare all unlisted before/after IDs, names, image references and rollback artifacts; verify listed items' intended disposition. Unexpected loss or new discrepancy is a failed cleanup gate and must be reported, not hidden by a zero exit code.

Source context under a host knowledge-base directory (original source-local path `/Users/lmqhx/Documents/蒸馏_牟建波_知识库/`; HOST PATH: not configured in DSH — do not assume this path exists; examples are instructional, **not authorization**): `03-云原生运维/02-容器与编排/01-Docker容器引擎.md` §§4.2–4.5, 9.5; `03-云原生运维/02-容器与编排/02-Docker Compose多容器编排.md` §§8.1, 9.2; `03-云原生运维/07-SRE实践/02-事件响应与故障管理.md` §2.5. Do not execute their `prune`, `down`, `up --build`, or rollback snippets without this SOP's inventory, scope and separate authorization gates.
