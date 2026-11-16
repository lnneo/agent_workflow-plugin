---
name: handoff-sync
description: On-demand synchronization of Git branches, commits, merge/cherry-pick status (develop, staging, main), and source-grounded handoff snapshots into handoff MCP. Use when onboarding a repository or when /handoff-sync is invoked.
---

# Handoff Sync

Synchronize `handoff` MCP SQLite state with the workspace manifest and Git repositories on demand.

## Workflow

### Phase A: Workspace Manifest & Git Branch Sync

1. Check for `.ai/workspace.md` or `WORKSPACE.md`:
   - If present, call `handoff_sync_workspace` (with `manifest_path` or `repo_path`) to register the workspace (`manifest_path`, `deploy_order`) and all listed projects (`FE`, `BE`, `Infra`), scan **all** branches (`develop`, `staging`, `main`/`master`, `feature/*`, `fix/*`, etc.), and auto-link matching task slugs across projects (`primary` + `related`).
   - If absent and multiple repos exist, offer to create `.ai/workspace.md` first; otherwise call `handoff_sync_git_state` for a single repo.
2. Present a concise summary table showing Project, Branch / Task slug, `synced_status` (`unmerged`, `develop`, `develop + staging`, `develop + staging + main`), commits synced, and `handoff_state` (`missing`, `stale`, `fresh`).

### Phase B: Source-Grounded Handoff Refresh (Targeted)

1. For developer-selected (or active) branches marked `"missing"` or `"stale"`, inspect `git diff <base_commit>..HEAD` and key symbols via `codegraph` / targeted reads.
2. Call `handoff_save_handoff_snapshot` with `final_business_logic`, `technical_flow`, `important_references`, `workspace_manifest_path`, and `affected_projects`.
