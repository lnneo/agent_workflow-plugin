---
description: Stage 2 — Autonomous execution from a locked Spec (Plan -> Implement/TDD -> Verify & Playwright E2E -> Review -> Handoff Snapshot & Commit) on a working branch.
---

Execute the `build` skill for the current task (or specified `task-slug`):

1. **Preflight & Spec Gate**: Verify the current branch is a working branch (not `main`, `master`, `staging`, `develop`), read `.ai/workspace.md` / `WORKSPACE.md` if present, and fetch the locked Spec from `handoff` MCP (`handoff_get_task`). If no Spec is confirmed yet, stop and ask the developer to run `/spec` first.
2. **Plan & Implement**: Follow `deploy_order` (`Infra -> BE -> FE`) using `incremental-implementation` and `test-driven-development` (plus `planning-and-task-breakdown` for multi-repo tasks). Edit sibling repos via absolute paths.
3. **Verify & E2E**: Run `spec.verify_commands`. For UI/E2E checks, use **Playwright** as the primary runner; use `browser-testing-with-devtools` (Chrome DevTools) **only** to debug failures that arise. Record outcomes via `handoff_record_verification` (stop on Circuit Breaker `fix_attempts >= 3`).
4. **Review**: Self-review the diff with `code-review-and-quality` (and `security-and-hardening` for auth/DB/API changes).
5. **Commit & Handoff**: Make atomic commits with Git trailers (`git-workflow-and-versioning`), then call `handoff_save_handoff_snapshot` with the final source-grounded behavior, workspace manifest reference, and affected projects.
