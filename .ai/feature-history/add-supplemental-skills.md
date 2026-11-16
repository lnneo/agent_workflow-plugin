# Feature History: add-supplemental-skills

## Feature summary

Add missing lifecycle skills from `addyosmani/agent-skills` into this workflow pack, then wire them into `AGENTS.md` and `using-agent-skills` while preserving local custom skills (`context-handoff`, `prefer-ripgrep-search`, CodeGraph rules).

## Source branch / target branch

- Source branch: `feature/add-supplemental-skills`
- Intended target branch: `develop`
- Base: `develop` @ `a1b7642`

## Implementation commits (oldest → newest)

| Commit | Purpose | Files / modules |
|--------|---------|-----------------|
| `47593a1` | Add DEFINE skills `interview-me` and `idea-refine` | `skills/interview-me/`, `skills/idea-refine/` |
| `3de2e53` | Add BUILD skills `doubt-driven-development` and `context-engineering` | `skills/doubt-driven-development/`, `skills/context-engineering/` |
| `633e2e9` | Add VERIFY skill `browser-testing-with-devtools` | `skills/browser-testing-with-devtools/` |
| `78bd13c` | Add REVIEW skills `code-simplification` and `performance-optimization` | `skills/code-simplification/`, `skills/performance-optimization/` |
| `b1dd521` | Add SHIP skills `observability-and-instrumentation` and `deprecation-and-migration` | `skills/observability-and-instrumentation/`, `skills/deprecation-and-migration/` |
| `e7d7b75` | Wire new skills into lifecycle mapping and discovery | `AGENTS.md`, `skills/using-agent-skills/SKILL.md` |

## Verification

- Source repo `/Users/longnd/Projects/lnneo-docker/agent-skills` was `git pull`'d and reported already up to date
- Skills copied from local source checkout rather than rewritten by hand
- `idea-refine` supporting files copied (`examples.md`, `frameworks.md`, `refinement-criteria.md`, `scripts/idea-refine.sh`)
- Working tree clean after implementation commits
- No automated tests applicable (docs/skills only)

## Dependencies between commits

Cherry-pick in the order above. Wiring commit (`e7d7b75`) depends on the skill-add commits existing.

## Cherry-pick notes

- Required order: DEFINE → BUILD → VERIFY → REVIEW → SHIP → docs wire
- Expected conflicts: low, unless target already has similarly named skill directories
- Migrations: none
- Config changes: none beyond `AGENTS.md` and meta-skill discovery
- Follow-up: run `./setup.sh` to sync skills into Cursor/Claude/Codex destinations if desired

## Rollback notes

Reset or revert the commit range `47593a1..e7d7b75` (plus this ledger commit) on the feature branch. Removing only the wiring commit leaves unused skill files; removing only skill commits leaves broken references in `AGENTS.md` / `using-agent-skills`.
