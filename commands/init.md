---
description: Interactive first-time setup (/init) to configure .ai/workspace.md (FE/BE/Infra), verify/Playwright commands, and initial /handoff-sync.
---

Execute the `init` skill interactively:

1. Inspect the current workspace briefly (git repos, `package.json`, Playwright config) to prepare smart defaults.
2. Ask the developer **step-by-step questions** (using `ask_question` or concise interactive prompts) to confirm:
   - Workspace slug/name and projects (`FE`, `BE`, `Infra`, `role`, `repo_path`, `deploy_order`)
   - Verification commands (`typecheck`, `lint`, `test`, `Playwright` E2E) and deploy notes
   - Whether to run `/handoff-sync` immediately after creating `.ai/workspace.md`
3. Write `.ai/workspace.md` (with YAML frontmatter + architecture/verify/deploy notes) and run `/handoff-sync` if confirmed.
