---
name: technical-design-delivery
description: Use when approved product requirements and architecture decisions must become an implementation-ready design before backend, frontend, harness, or operations work begins.
whenToUse: Use when approved product requirements and architecture decisions must become an implementation-ready design before backend, frontend, harness, or operations work begins.
---

# Technical Design Delivery

## Purpose
Technical design turns approved product facts and ADR constraints into a buildable, reviewable change plan. It is a **shared skill**, not an Agent role: the owner for the affected capability executes it.

| Concern | Design owner |
|---|---|
| APIs, domain state, storage, authorization | Backend |
| UI states, interaction, client data flow | Frontend |
| prompts, context, agent loop, tools, sessions | Harness |
| artifacts, configuration, rollout, recovery | DevOps |

## Entry Gate
Before designing, identify:

1. Approved product facts and acceptance behavior.
2. Applicable ADR invariants and prohibited solution classes.
3. Owning component and active consumers.

Missing product scope or ADR authority that changes behavior, ownership, security, consistency, or an external contract is a blocking decision. Do not invent it.

A downstream choice that does not block the proposed implementation—such as final screen wording—must be recorded with its owner and gate, not relabeled as a failure of the entire technical design.

## Required Design
Produce these sections, using repository conventions rather than inventing a second pattern:

1. **Scope and non-goals** — approved facts, ADR constraints, excluded behavior.
2. **Ownership and boundaries** — authoritative component, callers/consumers, trust boundaries.
3. **Contract** — inputs, outputs, lifecycle outcomes, validation, safe errors, compatibility.
4. **State and consistency** — authoritative data, transitions, transaction/concurrency/idempotency semantics where relevant.
5. **Failure and recovery** — retries, partial failure, reconciliation, audit/observability.
6. **Delivery** — migrations, rollout/rollback, compatibility, dependency order where relevant.
7. **Verification** — observable happy path, authorization boundary, conflict/race, failure/recovery cases.
8. **Open decisions** — owner, exact decision, why it matters, and whether it blocks implementation.

The design is implementation-ready only when all blocking decisions are resolved or explicitly excluded from the planned slice.

## Boundaries

- Product requirements own user value, roles, scope, priority, and user-visible behavior. Do not redefine them.
- ADRs own durable boundaries, invariants, and permitted/prohibited solution classes. Do not revise them implicitly.
- Technical design owns concrete implementation choices consistent with both: schema/API/component details, state transitions, migration and rollout mechanics, and verification.
- A technical design MUST NOT become a surrogate PRD or ADR.
- The design owner MUST inspect existing conventions before selecting a concrete contract or storage pattern.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Treating every undecided downstream detail as a total blocker | Deliver the resolved design; isolate the decision and mark its gate. |
| Choosing product behavior in an API or schema decision | Return the decision to the product owner. |
| Reopening an ADR during implementation planning | Escalate the contradiction; do not silently diverge. |
| Writing code from a vague design | Resolve only the blocking unknowns first. |
| Letting the client or harness enforce backend authority | Keep authorization and durable outcomes at the authoritative backend boundary. |
