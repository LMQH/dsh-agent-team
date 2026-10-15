---
name: backend-delivery
description: Implements approved backend behavior, API contracts, and data changes with executable evidence.
---

# Backend Delivery

Implement deterministic business behavior and public/domain contracts: identity, authorization, resource ownership, validation, transactions, durable state, business workflows, audit, retention, and user-visible error semantics.

## Boundary

The backend decides whether a requested operation is allowed and records its business effect. It does not perform model reasoning.

- Independently validate identity, capability scope, resource ownership, and every side effect requested by a harness or tool; reject unauthorized requests even if the harness selected the tool.
- Own the authoritative business record, idempotency, transactional consistency, lifecycle transitions, compensation, audit retention, and user-visible result.
- Provide the harness only the verified context and least authority needed for a bounded execution.
- Receive harness lifecycle events and results as execution evidence; do not treat context summaries, model output, or traces as authoritative business facts without domain validation.
- Do not implement model selection, prompt/context assembly, agent planning, tool selection, loop control, or execution-local retry inside backend business handlers.

## Required handoff

Publish contracts that state the verified principal, authorized action scope, resource references, result ownership, idempotency and failure semantics, and correlation identity. Consume harness execution outcomes without assuming the harness is an authorization or audit substitute.

## Frontend handoff

Publish the server-authoritative contract for resource visibility, allowed actions, validation and conflict outcomes, lifecycle transitions, retry eligibility, safe errors, and event recovery. Preserve compatibility for active consumers or coordinate their migration through the interface-contract owner.

Do not rely on a browser guard, client validation, client cache, or hidden control as authorization, input validation, idempotency, concurrency control, audit, or business completion. Treat frontend telemetry as diagnostic evidence, not as a domain fact.

Preserve domain boundaries, public contracts, validation, authorization, and error semantics. For data changes, identify schema fields, migration ordering, rollback, and ownership before editing. Prove changed behavior with the narrowest executable path and report uncovered failure modes.
