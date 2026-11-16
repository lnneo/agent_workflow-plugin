---
name: spec
description: Stage 1 of the 2-stage workflow. Read-only workspace and code analysis, requirement clarification, and Executable Spec confirmation into handoff MCP without modifying repository files.
---

# Spec (Stage 1)

Prepare and lock an **Executable Spec** with the developer before any code changes begin.

## Rules

- **Read-only on repository files**: Do not create, edit, or delete repo source files during `/spec` (deliverable documents can be presented in chat or saved as artifacts unless the developer explicitly asks to write them to disk).
- **Allowed on any branch**: Because no repo files are modified, `/spec` can run on `main`, `develop`, `staging`, or any working branch.
- **Required Stage 1 Documents**: Stage 1 produces two complementary documents using their dedicated skills:
  1. **Solution Proposal** via `proposal-writer` (business objectives, Deliverables, Out-of-Scope, Feature-to-Benefit mapping, milestones).
  2. **Technical Specification (Tech Spec)** via `tech-spec-writer` (C4/Mermaid architecture, API contracts, DB schema, RFC 2119 requirements, trade-offs, failure modes & rollback).
- **Lazy-load supporting skills (activate only when the condition applies)**:
  - `interview-me`: always align findings, scope, and choices with the developer.
  - `idea-refine`: when exploring or comparing architectural options.
  - `spec-driven-development`: when decomposing a large requirement into a capability map across modules (`FE`/`BE`/`Infra`).
  - `constraint-driven-development`: when no quality bar (`CONSTRAINTS.md`, coverage, perf, a11y) is defined yet.
  - `api-and-interface-design`: when designing REST/GraphQL endpoints, module boundaries, or FE↔BE contracts.
  - `source-driven-development` + `context7`: when grounding library/framework/CLI choices in official docs.
  - `doubt-driven-development`: when stress-testing high-stakes decisions (auth, payment, security, DB migrations).
  - `documentation-and-adrs`: when recording an Architecture Decision Record (ADR).
  - `prefer-ripgrep-search`: when searching the codebase during read-only inspection.

## Process

1. **Load Workspace & Handoff Context (Minimal)**
   - Check for `.ai/workspace.md` or `WORKSPACE.md` to identify projects (`FE`, `BE`, `Infra`) and `deploy_order`.
   - Query `handoff` MCP (`handoff_list_workspaces`, `handoff_list_projects`, `handoff_get_task` if a task slug exists) to avoid duplicating existing tasks.
2. **Targeted Code Inspection (Read-Only)**
   - Use `codegraph` (or targeted `rg` + small `read_file` ranges, max 3–5 files initially) to identify affected modules, APIs, schemas, and tests across projects.
   - If the task depends on external libraries, frameworks, or CLIs, check official docs via `context7`.
3. **Mandatory Alignment & Confirmation with Developer (Always Required)**
   - Never silently assume scope, behavior, or architecture on your own.
   - Always display clearly to the developer:
     - What you inspected and found across the workspace (`FE`, `BE`, `Infra`).
     - The exact work you **plan to do** (proposed approach, impacted modules/APIs/tables, assumptions, and open choices).
   - Use `interview-me` (and `idea-refine` if architectural alternatives exist) to confirm every requirement and design decision with the developer before drafting the final Stage 1 documents.
4. **Produce Stage 1 Documents & Executable Spec for Developer Approval**
   - Invoke `proposal-writer` to draft the **Proposal** (business context, Deliverables, Out-of-Scope).
   - Invoke `tech-spec-writer` to draft the **Tech Spec** (architecture/sequence diagrams, API & DB contracts, verification/rollback).
   - Summarize the **Executable Spec** contract to lock:
     - **Objective**: What is being built/fixed and why.
     - **Affected Projects & Scope**: Which projects (`FE`, `BE`, `Infra`) change, and what is explicitly **out of scope**.
     - **Acceptance Criteria**: Verifiable pass/fail conditions.
     - **Verification Plan**: Unit/typecheck/lint commands (`verify_commands`) and browser/E2E checks (`e2e_checks`).
     - **Target Branch & Deploy Order**: Proposed working branch (e.g., `feature/<slug>`) and `deploy_order` if multi-repo.
5. **Lock Spec in Handoff MCP**
   - Wait for explicit developer confirmation (`OK` / edits).
   - Once confirmed, ensure workspace, projects, and task exist (`handoff_upsert_workspace`, `handoff_upsert_project`), then call `handoff_confirm_spec` with the final Spec and any `related_projects`.
   - Stop and report that the Spec is locked and ready for `/build` on a working branch.
