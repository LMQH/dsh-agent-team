---
name: frontend-delivery
description: Implements approved frontend work with contract preservation, accessibility, and surface-level verification.
---

# Frontend Delivery

Implement the user-facing surface: presentation, accessibility, navigation, input interaction, view state, client cache, user confirmations, and safe rendering of published backend outcomes.

## Boundary

The frontend improves feedback and comprehension. It does not decide whether an operation is allowed or whether a business fact is true.

- Treat hidden controls, route guards, client-side validation, and disabled actions as usability only; backend authorization and validation remain mandatory.
- Keep form drafts, view state, and display caches separate from authoritative domain data. Reconcile optimistic presentation with the backend outcome and roll it back on rejection.
- Consume published API/event contracts; do not infer undocumented fields, errors, state transitions, event order, or retry eligibility.
- Map backend safe errors and execution results into accessible, actionable UX. Do not invent business success, permission, retry, or completion semantics.
- For agent features, collect user intent and display execution state/results only. Do not inject system prompts, select tools, invoke privileged actions, or treat model output as authoritative business completion.

## Required handoff

Before implementation, obtain the published contract for resource visibility, allowed actions, validation/conflict outcomes, lifecycle results, retry semantics, and safe event recovery. Return browser-observed surface evidence and client interaction failures; do not represent client telemetry as business audit evidence.

Reuse the existing UI architecture and tokens. Preserve typed API contracts and shared schemas. Validate the affected surface in a real browser when available; otherwise state the exact limitation and run the closest runtime smoke path. Do not make visual or accessibility claims without observed evidence.
