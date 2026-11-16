---
name: context-handoff
description: Create compact, source-grounded AI handoff context after non-trivial engineering work so another AI agent can continue safely.
---

# Context Handoff Skill

Use this skill after completing non-trivial engineering work when another AI agent may need to continue from compact and accurate context.

This skill creates or updates Markdown handoff files under:

```txt
.ai/handoffs/
```

Use one handoff file per task, branch, or workstream.

## When to Use

Use `context-handoff` when the task involves:

- non-trivial features
- business logic changes
- payment, auth, database, infrastructure, or deployment changes
- production bugs
- risky refactors
- changes affecting public APIs
- work that may continue in another AI session
- work that required meaningful planning, CodeGraph analysis, or cross-file changes

For small one-file internal changes, use this skill only if the developer asks for a handoff or if future continuation is likely.

## Core Rule

The handoff must be based on the final source code, verified diff, and completed implementation.

Do not write handoff content based only on the original requirement.

Do not document planned behavior as completed behavior.

Do not include unrelated chat history.

Do not include secrets, tokens, private credentials, local environment values, or unnecessary generated output.

Keep handoff documents concise, factual, and source-grounded.

## Lifecycle Position

Use this skill after REVIEW and before SHIP:

```txt
DEFINE → PLAN → BUILD → VERIFY → REVIEW → HANDOFF → SHIP
```

If the work is already shipped, create the handoff immediately after SHIP and clearly mark the shipped commit.

## Git Safety

Before creating or updating a handoff file:

1. Follow `git-workflow-and-versioning`.
2. Check `git status`.
3. Preserve user changes.
4. If the current branch is protected, stop before making file changes and ask the developer for the target branch name and git worktree name/path.
5. Do not commit or push directly to protected branches.

Protected branches include:

- `main`
- `master`
- `staging`
- `develop`

## Handoff File Naming

Handoff file names must be based on the developer-provided task name.

Default path format:

```txt
.ai/handoffs/<task-name>.md
```

Normalize the task name only enough to make a safe Markdown file path:

- use lowercase
- replace spaces with hyphens
- remove or replace path-unsafe characters
- keep the name recognizable
- do not invent a different task name

Examples:

```txt
.ai/handoffs/subscription-upgrade-flow.md
.ai/handoffs/payment-webhook-pending-status.md
.ai/handoffs/refactor-billing-service.md
```

If this is the first time creating a handoff file for the task and the developer has not provided a task name or target file name, stop and ask:

```txt
What task name should I use for the handoff file under `.ai/handoffs/`?
```

Do not create the first handoff file using the branch name, date, commit hash, or an inferred title unless the developer explicitly approves it.

When updating an existing handoff file, reuse the existing file path.

## Required Process

When creating or updating a handoff:

1. Review the original task, plan, and implementation notes if available.
2. Confirm the handoff task name or target handoff file path.
3. If this is the first handoff file for the task and no task name/file path was provided, ask the developer before creating the file.
4. Review the final git diff.
5. Inspect changed files directly.
6. Use CodeGraph when relevant to confirm important symbols, call paths, and dependencies.
7. Run or review relevant verification results.
8. Create or update the handoff Markdown file.
9. Ensure the handoff reflects final behavior from source code.
10. Include the handoff file in the same working branch unless the developer explicitly defers it.

## Handoff Template

Use this template as the default structure.

```md
# AI Context Handoff: <Task or Branch Name>

## Task Summary

- Original task:
- Goal:
- Scope:

## Final Outcome

- What was implemented:
- What changed compared to the original requirement:

## Current Git Context

- Branch:
- Worktree:
- Latest commit:
- Related task/issue:
- Related PR:

## Changed Files

| File | Purpose |
|---|---|
| `path/to/file` | Why it changed |

## Final Business Logic

Describe the final confirmed behavior based on source code.

Include only behavior that is implemented and verified.

## Technical Flow

1. Entry point:
2. Main service/function/component:
3. Data changes:
4. Events/jobs/listeners/API calls:
5. Output/result:

## Important References

| Symbol / Function / Class | File | Notes |
|---|---|---|
| `ExampleService` | `app/Services/ExampleService.php` | Main logic |

## Verification

- Tests:
- Lint/typecheck:
- Manual checks:
- CodeGraph checks:
- Git diff reviewed:

## Known Limitations

- None / list known limitations

## Follow-up Tasks

- None / list next tasks

## Instructions for Next AI

- Read this file first.
- Check git status before editing.
- Use CodeGraph before changing related logic.
- Do not modify unrelated files.
```

## Writing Rules

All handoff files must be written in English.

Use clear technical English.

Do not use Vietnamese in file names, source code references, comments, commit messages, logs, or generated handoff content.

Developer-facing chat may be in Vietnamese.

## Content Guidelines

### Task Summary

Summarize the original task in 3-7 concise bullets.

Include the intended outcome, scope, and important constraints.

### Final Outcome

Describe what actually changed after implementation.

Mention differences from the original request if the implementation evolved during coding.

### Current Git Context

Include the current branch and worktree when available.

Include the latest commit after the commit exists.

If the task is not committed yet, write:

```txt
Latest commit: Not committed yet
```

### Changed Files

Include only files relevant to the task.

Do not list generated junk files.

Do not include secrets or local-only files.

### Final Business Logic

Describe the actual business behavior now implemented.

This section should help another AI understand what the system does without rereading the full chat.

### Technical Flow

Describe the flow from entry point to final output.

Include services, controllers, jobs, listeners, commands, components, database writes, and API calls when relevant.

### Important References

List symbols that another AI should inspect first.

Examples:

- service classes
- controller methods
- React components
- hooks
- jobs
- listeners
- events
- database models
- enums
- migration files

### Verification

Be specific.

Good examples:

```txt
- Tests: `php artisan test tests/Feature/Billing/SubscriptionUpgradeTest.php`
- Lint/typecheck: `npm run typecheck`
- Manual checks: verified pending subscription becomes active after webhook
- CodeGraph checks: verified no unrelated callers use the changed method
- Git diff reviewed: yes
```

If a check was not run, say so clearly:

```txt
- Tests: Not run; reason: existing test environment is unavailable
```

### Known Limitations

List only real limitations, risks, assumptions, or unresolved questions.

Do not invent issues.

### Follow-up Tasks

List work that should happen later.

If there is no follow-up, write:

```txt
- None
```

### Instructions for Next AI

Give short operational guidance.

Examples:

```txt
- Start by reading `app/Services/Billing/SubscriptionUpgradeService.php`.
- Do not change webhook status mapping without updating tests.
- Use CodeGraph to inspect callers of `changePlan`.
```

## Quality Checklist

Before finalizing the handoff, verify:

- the handoff file is under `.ai/handoffs/`
- the handoff is concise and source-grounded
- final behavior matches the source code
- changed files are accurate
- important symbols are listed
- verification status is honest
- known limitations are included or explicitly marked as none
- next AI instructions are actionable
- no secrets or credentials are included
- unrelated chat history is omitted
- file is included in the branch diff

## Commit Guidance

When the task requires a commit, include the handoff file in the final commit unless the developer explicitly asks otherwise.

Commit message must be in English.

Examples:

```txt
Add context handoff for subscription upgrade flow
Update context handoff for payment webhook fix
```

## Anti-Patterns

Do not:

- create long transcripts
- paste full source files into the handoff
- include speculative behavior
- include unrelated decisions
- hide failed checks
- claim tests passed when they were not run
- overwrite another task handoff without checking context
- store secrets, tokens, private credentials, or local environment values
- update handoff files on protected branches without confirmed branch/worktree approval
