# Agent Workflow Plugin (v2)

Developer-driven **2-stage AI engineering workflow** (`/spec` and `/build`) packaged as an IDE plugin with a unified Docker HTTP MCP server (`pg`, `redis`, `handoff`) and **Live Activity Monitor** (`/viewer`).

## 1. Workflow Overview

- **`/spec` (Stage 1 — Human-in-the-loop, read-only on repo)**:
  - Runs on any branch without modifying repository files.
  - Reads `.ai/workspace.md` (or `WORKSPACE.md`) for multi-project structure (`FE`, `BE`, `Infra`).
  - Aligns findings and planned work with the developer, drafts **Solution Proposal** (`proposal-writer`) and **Tech Spec** (`tech-spec-writer`), and locks the Executable Spec in `handoff` MCP.
- **`/build` (Stage 2 — Autonomous execution on a working branch)**:
  - Requires a working branch (`feature/*`, `fix/*`, `refactor/*`, `chore/*`) and a locked Spec.
  - Executes `Plan -> Implement/TDD -> Verify & Playwright E2E (Chrome DevTools for debugging failures) -> Review -> Atomic Commits & Handoff Snapshot`.
- **`/handoff-sync`**:
  - On-demand sync of `.ai/workspace.md` projects and all Git branches (`develop`, `staging`, `main`, `feature/*`, `fix/*`) into `handoff` MCP.

## 2. Start Unified HTTP MCP Server (`tools/mcp`)

```sh
cd tools/mcp
cp -n .env.example .env
# Edit .env: set PG_URL, REDIS_URL, PORT (default 3030), and PROJECTS_DIR
docker compose up -d --build
```

Endpoints (default port `3030`):
- `GET  http://localhost:3030/health`
- `GET  http://localhost:3030/viewer` *(Live Activity Monitor, Spec/Build Detail, Workspaces, Raw SQLite Tables)*
- `HTTP http://localhost:3030/pg` *(PostgreSQL read/write)*
- `HTTP http://localhost:3030/redis` *(Redis read/write)*
- `HTTP http://localhost:3030/handoff` *(Spec, Verification, Commits, Sync, Handoff, Activity Logs)*

## 3. Install Plugin

Run `./setup.sh` and select your target IDE(s).
