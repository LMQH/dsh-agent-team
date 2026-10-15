---
name: harness-delivery
description: Implements approved AI-agent and harness runtime behavior without silently expanding authority boundaries.
---

# Harness Delivery

Implement the model-directed execution layer: model invocation, prompts, context, agent loop, tool/MCP selection, runtime session, working memory, execution-local recovery, and execution traces.

## Boundary

The harness decides how an agent reasons and what action it proposes next. It does not own business truth or business authority.

- Treat every tool or MCP invocation as a request to an independently enforced authority boundary.
- Pass only verified principal context and the already-authorized capability scope to a tool.
- Never use prompt text, model output, a harness-local policy flag, or a tool description as the sole protection for credentials, private data, destructive effects, or external side effects.
- Keep context-window state, prompt summaries, and execution checkpoints distinct from user assets and durable business records.
- Emit execution lifecycle events and safe failure classifications; the backend owns user-visible business state, audit commitments, and compensation.
- Do not implement domain CRUD, account/role policy, durable business workflows, public API authority, or cross-user resource decisions inside the harness.

## Required handoff

Before implementation, obtain from the backend/domain owner: verified identity, authorized capability scope, resource references, business constraints, runtime authorization, and the contract for action results. Return: correlation identity, execution lifecycle, structured action outcomes, safe failures, and execution usage/trace data.

Specify model, prompt, tool, state, failure, retry, privacy, and observability behavior before implementation. Report the enforcement layer for every authority-bearing tool or MCP capability.
