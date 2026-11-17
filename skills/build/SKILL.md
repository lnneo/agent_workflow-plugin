---
name: build
description: Stage 2 of the 2-stage workflow. Autonomous execution from a locked Executable Spec through planning, implementation (with parallel repo subagents & 2-stage review when large), verification (Playwright primary + Live Monitor logging, Chrome DevTools for debugging failures), atomic commits, handoff snapshot, and branch wrap-up.
---

# Build (Stage 2)

Execute the locked Spec end-to-end without pausing for intermediate confirmations, stopping only if the Circuit Breaker trips (`fix_attempts >= 3`) or a requirement changes outside the Spec.

## Rules

- **Working branch required**: Never edit files or commit on `main`, `master`, `staging`, or `develop`. Stop and ask the developer to switch/create a working branch (`feature/*`, `fix/*`, `refactor/*`, `chore/*`) if currently on a protected branch.
- **Spec gate**: Read the locked Spec from `handoff` MCP (`handoff_get_task`). If `spec_json` is missing, stop and ask the developer to run `/spec` first.
- **Multi-repo editing**: Stay on the current agent root; edit sibling repos (`FE`, `BE`, `Infra`) via absolute paths.
- **UI/E2E policy**: Use **Playwright** as the primary E2E verification runner. Only invoke `browser-testing-with-devtools` (Chrome DevTools) to debug runtime/DOM/console/network errors when a failure occurs.
- **Iron Law (`verification-before-completion`)**: Never claim tests pass, a bug is fixed, or a build succeeds without running the fresh verification command **after the final code edit** and reading its exact exit code and output.
- **Circuit Breaker**: Use `debugging-and-error-recovery` on failures. If 3 fix attempts fail (`fix_attempts >= 3`), stop and report the root cause to the developer.
- **Receiving Review Feedback**: When the developer or a reviewer requests changes, verify against actual code before editing; ask if unclear and push back with technical evidence if a suggestion breaks the locked Spec.
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
2. **Task Plan & Parallel / Incremental Implementation**
   - For tasks touching >3 files or multiple repos (`FE`, `BE`, `Infra`), list a concrete slice plan first (exact `files` + `verify_command` per slice) ordered along `deploy_order`, and log progress milestones to Live Monitor via `handoff_log_activity`.
   - When `FE` and `BE` (or multiple bugs) are independent, you may dispatch parallel subagents scoped to separate repos/directories; otherwise implement sequentially with `incremental-implementation` and `test-driven-development`.
3. **Verify & Playwright E2E (with Live Monitor Logging)**
   - Run all `spec.verify_commands` (unit, integration, typecheck, lint, build) after the final edit.
   - Run `spec.e2e_checks` using **Playwright**. When running Playwright headless/in background, send run results (or use a lightweight reporter) to `POST http://localhost:48048/viewer/api/logs` (`source: "playwright"`, `status`, `duration_ms`, `summary`, `details`) so the Live Monitor reflects E2E progress in real time:
     ```bash
     curl -sf -X POST http://localhost:48048/viewer/api/logs \
       -H "content-type: application/json" \
       -d '{"workspace_slug":"<ws>","task_slug":"<task>","stage":"build","source":"playwright","action":"playwright.run","status":"success","duration_ms":1200,"summary":"Playwright E2E passed"}' >/dev/null || true
     ```
   - If a Playwright check fails, invoke `browser-testing-with-devtools` to diagnose console/network/DOM state.
   - Record each fresh verification outcome with `handoff_record_verification`.
4. **Two-Stage Review**
   - For non-trivial/multi-repo tasks, run an independent reviewer subagent (or strict 2-pass self-review for small tasks):
     1. **Spec Compliance**: Verify 100% of `acceptance_criteria` and `out_of_scope` boundaries in the locked Spec.
     2. **Code Quality & Security**: Check `code-review-and-quality` and `security-and-hardening` (no duplicated logic, unrelated refactors, or suppressed checks).
5. **Commit, Save Handoff & Finish Branch**
   - Commit logical slices with standard Git trailers (`git-workflow-and-versioning`) and record each commit via `handoff_record_commit` (including `commit_hash` and `files_changed`) so the Live Monitor tracks every code change by `commit_id`.
   - Call `handoff_save_handoff_snapshot` (`mark_shipped: true`) with:
     - `final_business_logic` (strictly grounded in the actual source code)
     - `technical_flow`
     - `important_references` (`symbol`, `file`, `notes`)
     - `workspace_manifest_path` and `affected_projects` (`FE`, `BE`, `Infra`)
     - `known_limitations` / `follow_up_tasks` / `next_ai_instructions`
   - Present concise integration options to the developer: *(1) Keep working branch as-is, (2) Open PR, or (3) Merge to target branch*.

## Red Flags (Strictly Forbidden in `/build`)
- Never say "should pass", "probably works", or reuse stale test results after editing code.
- Never silently expand scope beyond the locked Spec or suppress checks (`@ts-ignore`, `test.skip`) to force green.
- Never commit or push directly to `main`, `master`, `staging`, or `develop`.
