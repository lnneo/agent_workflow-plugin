# Feature History: agent-autonomy

## Feature summary

Spec-Gated Autonomy workflow for the agent_workflow pack. Phase 1 delivers greenfield `tools/handoff-mcp` (TypeScript MCP + SQLite) for chronological change history: workspaces → projects → tasks → append-only events. HTTP gateway hosting of the same tools lives in sibling repo `mcp-server` (`/handoff` beside `/pg`, `/redis`, `/backlog`). Phase 2 (not yet) wires AGENTS.md + skills.

## Source branch / target branch

- Source branch: `feature/agent-autonomy`
- Intended target branch: `develop`
- Base commit: `56a1fd3` (`develop` tip when branch created)

## Ordered commit list (oldest → newest)

| Commit | Purpose | Files / modules |
|--------|---------|-----------------|
| `fe7560a` | Scaffold handoff-mcp (schema, store, MCP tools, smoke, README, gitignore) | `tools/handoff-mcp/**`, `.gitignore` |
| `c1a5fd7` | Feature history ledger Phase 1 | `.ai/feature-history/agent-autonomy.md` |
| `b39421d` | Document HTTP gateway co-location with pg/redis/backlog | `tools/handoff-mcp/README.md` |

## Verification

- `npm install` in `tools/handoff-mcp`
- `npm run typecheck`
- `npm run smoke` (upsert workspace/project/task, append events, timeline, env_promoted)
- `npm run build` → `dist/index.js`
- Sibling `mcp-server`: `npm run typecheck && npm run build` + HandoffStore smoke (`bc1dea9`)

## Dependencies between commits

- `b39421d` depends on `fe7560a`
- Sibling HTTP work: `mcp-server` `bc1dea9` (not in this repo)

## Cherry-pick notes

- Order: `fe7560a` → ledger updates → docs
- Config: stdio via this package, or HTTP via `mcp-server` `MCP_HANDOFF_ENABLED=true`
- Follow-up: Phase 2 — AGENTS + `spec-gated-autonomy` skill + overlays

## Rollback notes

- Revert docs commit, then earlier Phase 1 commits as needed
