---
description: Sync all Git branches, commits, merge/cherry-pick progression (develop, staging, main), and stale/missing source handoffs into handoff MCP.
---

Run the `handoff-sync` workflow on the current workspace or repository:

1. Check for `.ai/workspace.md` or `WORKSPACE.md`:
   - If present, call `handoff_sync_workspace` to register all projects (`FE`, `BE`, `Infra`), scan all branches, and auto-link shared tasks.
   - If absent and this is a multi-project workspace, offer to create `.ai/workspace.md` first; otherwise call `handoff_sync_git_state` for the single repo.
2. Summarize all scanned projects & branches with their `synced_status` (`unmerged`, `develop`, `develop + staging`, `develop + staging + main`), commit counts, and `handoff_state` (`missing`, `stale`, `fresh`).
3. Ask the developer which `missing` or `stale` branches (or active branch by default) should have their source code inspected to generate/refresh `handoff_save_handoff_snapshot` (preserving the workspace manifest structure).
