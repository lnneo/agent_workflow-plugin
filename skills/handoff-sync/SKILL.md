---
name: handoff-sync
description: On-demand synchronization of Git branches, commits, merge/cherry-pick status (develop, staging, main), and source-grounded handoff snapshots into handoff MCP. Use when onboarding a repository or when /handoff-sync is invoked.
---

# Handoff Sync

Synchronize `handoff` MCP SQLite state by having the AI inspect `.ai/workspace.md` and run `git` directly in the current workspace on the host, then sending the result to `handoff` MCP (no Docker host mounts required).

## Workflow

### Phase A: Host-Side Git & Workspace Inspection -> `handoff_bulk_sync`

1. **Read Workspace Manifest**:
   - Look for `.ai/workspace.md` or `WORKSPACE.md` in the current workspace/repo.
   - Extract `workspace` (`slug`, `name`), `deploy_order`, `manifest_path`, and every project (`slug`, `name`, `role`, `repo_path`, `default_branch`).
   - If no manifest exists and there are multiple repos (`FE`, `BE`, `Infra`), offer to create `.ai/workspace.md` first; otherwise inspect the single current repo.
2. **Scan All Branches via `git` in the Current Workspace**:
   For each project repo on the host, run `git` locally (`run_command`):
   - List all branches (`git for-each-ref --format='%(refname:short)' refs/heads`), covering main branches (`develop`, `staging`, `main`/`master`) and all working branches (`feature/*`, `fix/*`, `refactor/*`, `chore/*`, etc.).
   - For each working branch:
     - Find `base_branch` and `base_commit` via `git merge-base`.
     - Collect commits (`git log --reverse --format=... <base>..HEAD` + `files_changed` via `git diff-tree --no-commit-id --name-only -r <sha>`).
     - Check sync status onto `develop`, `staging`, `main`/`master` via `git merge-base --is-ancestor` (merge) and `git cherry` (cherry-pick), mapping to `synced_status`: `unmerged`, `develop`, `develop + staging`, or `develop + staging + main`.
   - Group matching task slugs across projects (`FE`, `BE`, `Infra`) using `project_slug` + `related_projects`.
3. **Send Result in One Call**:
   - Call `handoff_bulk_sync` once with `{ workspace, projects, tasks }` (including `commits` and `deployments` with `env: "dev" | "staging" | "production" | "local"`).
4. **Present Summary**:
   - Display a concise table showing Project, Branch / Task slug, `synced_status` (`unmerged`, `develop`, `develop + staging`, `develop + staging + main`), commits synced, and whether a handoff snapshot is missing or stale.

### Phase B: Source-Grounded Handoff Refresh (Targeted)

1. For active or developer-selected branches missing/stale in `handoff_get_task`, inspect `git diff <base_commit>..HEAD` and key symbols via `codegraph` / targeted reads.
2. Call `handoff_save_handoff_snapshot` with `final_business_logic`, `technical_flow`, `important_references`, `workspace_manifest_path`, and `affected_projects`.
