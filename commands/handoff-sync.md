---
description: Sync all Git branches, commits, merge/cherry-pick progression (develop, staging, main), and stale/missing source handoffs into handoff MCP.
---

Run the `handoff-sync` workflow from the current workspace on the host:

1. Read `.ai/workspace.md` or `WORKSPACE.md` (if present) to get the workspace slug, `deploy_order`, and all projects (`FE`, `BE`, `Infra`).
2. Run `git` directly in the current workspace across each project to collect all branches (`develop`, `staging`, `main`, `feature/*`, `fix/*`, ...), commits (`hash`, `subject`, `files_changed`, `committed_at`), and merge/cherry-pick status (`develop`, `develop + staging`, `develop + staging + main`, or `unmerged`).
3. Send the collected payload to `handoff` MCP in one call via `handoff_bulk_sync`.
4. Summarize all projects & branches with their `synced_status`, commit counts, and missing/stale handoffs, then ask which branches should have `handoff_save_handoff_snapshot` refreshed from source code.
