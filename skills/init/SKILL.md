---
name: init
description: Interactive project/workspace onboarding (/init) to create .ai/workspace.md, configure verify/Playwright commands, and optionally run initial /handoff-sync.
---

# Init (Interactive Workspace Onboarding)

Set up the standard configuration for the 2-stage workflow (`/spec` and `/build`) through a **guided, interactive Q&A** with the developer.

## Rules

- **Interactive Q&A first**: Ask the developer to confirm each configuration group (do not silently generate `.ai/workspace.md` with guessed project roles or commands).
- **Smart defaults**: Quickly scan the current directory/repos (`git remote`, `package.json`, `playwright.config.*`, `.ai/workspace.md`) before asking so you can present concrete recommended options.
- **Keep it concise**: Group into 3–4 clear questions (use `ask_question` for multiple-choice decisions + short text prompts for repo paths/commands).

## Process

1. **Quick Discovery (Read-Only)**
   - Check if `.ai/workspace.md` or `WORKSPACE.md` already exists.
   - Detect Git repo(s), default branches, `package.json` scripts (`test`, `typecheck`, `lint`, `build`), and Playwright configs.
2. **Interactive Q&A with Developer**
   - **Q1 — Workspace & Projects**: Ask whether this is a single repo or multi-project workspace (`FE`, `BE`, `Infra`), and confirm `workspace` slug, project list (`slug`, `role`, `repo_path`, `default_branch`), and `deploy_order`.
   - **Q2 — Verification & Playwright E2E**: Present detected `verify_commands` and `Playwright` E2E command; ask the developer to confirm or adjust them (plus any local/VPS deploy notes).
   - **Q3 — Initial Handoff Sync**: Ask whether to register the workspace and backfill existing Git branches into `handoff` MCP via `/handoff-sync` (`handoff_bulk_sync`) right after writing `.ai/workspace.md`.
3. **Apply Configuration**
   - Create or update `.ai/workspace.md` with clean YAML frontmatter (`workspace`, `name`, `deploy_order`, `projects`) and concise Markdown sections for Architecture Notes, Verification Commands, Playwright E2E, and Deploy Notes.
   - If the developer opted in, run `/handoff-sync` (`handoff_bulk_sync`) and summarize the configured workspace.
