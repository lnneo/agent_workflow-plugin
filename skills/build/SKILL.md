---
name: build
description: Stage 2 of the 2-stage workflow. Autonomous execution from a locked Executable Spec through implementation, verification (Playwright primary, Chrome DevTools for debugging failures), self-review, atomic commits, and source-grounded handoff snapshot.
---

# Build (Stage 2)

Execute the locked Spec end-to-end without pausing for intermediate confirmations, stopping only if the Circuit Breaker trips (`fix_attempts >= 3`) or a requirement changes outside the Spec.

## Rules

- **Working branch required**: Never edit files or commit on `main`, `master`, `staging`, or `develop`. Stop and ask the developer to switch/create a working branch (`feature/*`, `fix/*`, `refactor/*`, `chore/*`) if currently on a protected branch.
- **Spec gate**: Read the locked Spec from `handoff` MCP (`handoff_get_task`). If `spec_json` is missing, stop and ask the developer to run `/spec` first.
- **Multi-repo editing**: Stay on the current agent root; edit sibling repos (`FE`, `BE`, `Infra`) via absolute paths.
- **UI/E2E policy**: Use **Playwright** as the primary E2E verification runner. Only invoke `browser-testing-with-devtools` (Chrome DevTools) to debug runtime/DOM/console/network errors when a failure occurs.
- **Circuit Breaker**: Use `debugging-and-error-recovery` on failures. If 3 fix attempts fail (`fix_attempts >= 3`), stop and report the root cause to the developer.
- **Lazy-load supporting skills (activate only when the condition applies)**:
  - *Plan & Build*: `planning-and-task-breakdown` (multi-repo/large tasks), `incremental-implementation`, `test-driven-development`, `frontend-ui-engineering` (UI/components/WCAG), `api-and-interface-design` (API/contracts), `source-driven-development` (verify SDK/framework docs via `context7`), `doubt-driven-development` (high-stakes auth/payment/migration logic), `context-engineering` (when context quality drops).
  - *Verify & Debug*: `debugging-and-error-recovery`, Playwright (primary E2E), `browser-testing-with-devtools` (debugging runtime/DOM/console/network failures only).
  - *Review & Harden*: `code-review-and-quality`, `security-and-hardening` (auth/input/DB/API), `code-simplification` (clarity refactor), `performance-optimization` (N+1/latency/Core Web Vitals).
  - *Ship & Handoff*: `ci-cd-and-automation` (CI/CD changes), `shipping-and-launch`, `observability-and-instrumentation` (logs/metrics/tracing), `deprecation-and-migration` (zero-downtime schema/API migration), `documentation-and-adrs`, `git-workflow-and-versioning`, `context-handoff` (if developer asks for a standalone `.ai/handoffs/*.md` file).

## Process

1. **Preflight & Load Spec**
   - Check `git status` and current branch across affected repos.
   - Read `.ai/workspace.md` (or `WORKSPACE.md`) if present to confirm `FE`, `BE`, `Infra` paths and `deploy_order`.
   - Fetch task & locked Spec from `handoff` MCP (`handoff_get_task`).
2. **Plan & Implement Incrementally**
   - If multi-repo or complex, use `planning-and-task-breakdown` to order slices along `deploy_order`.
   - Implement each slice with `incremental-implementation` and `test-driven-development`.
3. **Verify & E2E**
   - Run all `spec.verify_commands` (unit, integration, typecheck, lint, build).
   - Run `spec.e2e_checks` using **Playwright**. If a Playwright check or runtime flow fails and needs deeper inspection, use `browser-testing-with-devtools` to diagnose console/network/DOM state.
   - Record each verification outcome with `handoff_record_verification`.
4. **Review**
   - Review the full diff with `code-review-and-quality` (and `security-and-hardening` for auth/input/DB/API changes). Ensure no duplicated logic, unrelated refactors, or suppressed checks.
5. **Commit & Save Handoff Snapshot**
   - Commit logical slices with standard Git trailers (`git-workflow-and-versioning`) and record each commit via `handoff_record_commit` (including `commit_hash` and `files_changed`) so the Live Monitor tracks every code change by `commit_id`.
   - Call `handoff_save_handoff_snapshot` (`mark_shipped: true`) with:
     - `final_business_logic` (strictly grounded in the actual source code)
     - `technical_flow`
     - `important_references` (`symbol`, `file`, `notes`)
     - `workspace_manifest_path` and `affected_projects` (`FE`, `BE`, `Infra`)
     - `known_limitations` / `follow_up_tasks` / `next_ai_instructions`
