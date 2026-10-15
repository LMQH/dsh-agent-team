---
name: architecture-delivery
description: Produces evidence-backed technical designs, interface contracts, ownership boundaries, and ADR drafts.
---

# Architecture Delivery

## Role boundary

Architecture turns approved product facts into durable technical constraints. It does not decide product scope.

| Layer | Owns |
|---|---|
| Product requirements | User value, roles, capabilities, scope, priorities, user flows, observable states, acceptance criteria, and product non-goals |
| ADR | Stable technical boundaries, responsibility ownership, invariants, permitted/prohibited solution classes, material tradeoffs, and consequences |
| Technical design / interface contract / data design | Components, API operations and schemas, database structures, fields, errors, credential mechanics, algorithms, migration steps, and rollout details |

If a choice changes what users can buy, see, do, or expect, or changes the product's MVP scope, it belongs to product requirements. An ADR MUST return an undecided product choice as `needs-decision`; it MUST NOT select it for convenience.

## ADR decision rule

Record a choice in an ADR only when it has at least two viable technical alternatives and the selected class of solution has durable consequences for security, ownership, interoperability, cost, operations, or future change.

An ADR MUST:

- state the approved product facts and architectural constraints it preserves;
- state the decision at the level of boundaries and invariants;
- name alternatives and their consequences;
- leave all compliant implementation variants available to technical design.

An ADR MUST NOT specify database tables or fields, endpoint paths or payloads, error codes, token claims or storage, file names, functions, libraries, configuration keys, algorithms, request sequencing, or migration commands. Those details belong to technical design, interface contracts, and data design unless the user explicitly authorizes a particular technology as the architectural decision itself.

Use this test: if the detail can change without violating the product facts or ADR invariants, it does not belong in the ADR.

## Workflow

1. Establish current approved product facts. Treat unresolved product choices as blockers, not design inputs.
2. Identify the durable architecture decision and its alternatives.
3. Write a draft ADR containing only the decision, constraints, consequences, and references to downstream design work.
4. Mark implementation details as owned by a technical-design, interface-contract, or data-design artifact; do not embed their schema.
5. A material change to an effective ADR or external contract remains a draft until user authorization. Never present a draft as effective.
