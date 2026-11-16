# Global AI Engineering Rules

Developer drives the workflow explicitly via `/spec` (Stage 1) and `/build` (Stage 2).
For normal Q&A, code inspection, or trivial one-line fixes without a command, respond or act directly with minimal safe changes.

## Core Invariants

- **Protected Branch Policy**: Never edit source files or commit/push directly to `main`, `master`, `staging`, or `develop`. Read-only inspection and `/spec` are allowed on any branch; switching to a working branch (`feature/*`, `fix/*`, `refactor/*`, `chore/*`) is required before `/build` or any code edit.
- **Multi-Repo Rule**: Stay on the current agent root; edit sibling repos via absolute paths. Never call `move_agent_to_root` while a worktree is dirty.
- **Workspace Manifest (Mandatory)**: Multi-project workspaces (`FE`, `BE`, `Infra`) are declared in `.ai/workspace.md` (or `WORKSPACE.md`). Read it on demand when planning or editing across projects, and preserve its path, affected projects, and `deploy_order` in any context summary or handoff.
- **Context Budget**: Prefer `codegraph` for symbol/call-flow lookup and targeted `rg` over reading whole files. Inspect only what is needed.
- **Quality Bar**: Minimal safe changes, no duplicated logic, no unrelated refactors, no suppressed checks (`@ts-ignore`, skipped tests) to force green.
- **Verification**: Always verify changes with relevant checks before claiming done.
- **Language**: Source code, comments, commit messages, logs, and errors in English; chat with the developer in Vietnamese.

## Workflow Commands (Developer-Controlled)

- `/spec`: Stage 1 — Read-only analysis + clarify requirements + confirm Executable Spec into `handoff` MCP (allowed on any branch, edits no repo files).
- `/build`: Stage 2 — Autonomous execution from confirmed Spec (`Plan -> Implement/TDD -> Verify -> Deploy/E2E -> Review -> Handoff & Commit`) on a working branch.
