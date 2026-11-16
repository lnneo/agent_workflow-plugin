---
description: Stage 1 — Read-only analysis, clarify requirements, and lock an Executable Spec into handoff MCP (allowed on any branch).
---

Execute the `spec` skill for the developer's request:

1. Read `.ai/workspace.md` (or `WORKSPACE.md`) if present, and check `handoff` MCP for existing workspace/project/task state.
2. Perform read-only investigation (`codegraph` / targeted `rg`, minimal file reads) across affected projects (`FE`, `BE`, `Infra`). Do **not** edit any repository source files.
3. Always present your findings and the exact work you plan to do (impacted modules/APIs/tables, assumptions, and choices) and confirm alignment with the developer via `interview-me` (and `idea-refine` if comparing options) — never decide scope or architecture silently.
4. Draft the two required Stage 1 documents using `proposal-writer` (Solution Proposal / SOW / Out-of-Scope) and `tech-spec-writer` (Technical Specification / API & DB contracts / Rollback), and present the concise Executable Spec (`objective`, `affected_projects`, `out_of_scope`, `acceptance_criteria`, `verify_commands`, `e2e_checks`, `target_branch`, `deploy_order`) for developer confirmation.
5. Once confirmed, persist the Spec via `handoff_confirm_spec` and stop, ready for `/build` on a working branch.
