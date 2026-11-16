# Feature History: sync-agent-skills-latest

## Summary

Sync overlapping workflow skills from the local `agent-skills` checkout into this pack using direct file copy (not symlinks), add the new upstream skill `constraint-driven-development`, preserve local-only skills, and add a reusable sync script.

## Branch

- Source branch: `chore/sync-agent-skills-latest`
- Intended target branch: `develop`
- Base commit: `4f6abc3` (`docs: add feature history ledger for Context7 rule and develop merges`)
- Landed on `develop` via squash merge (single commit)

## Commits (oldest → newest)

Source branch commits that were squashed:

| Commit | Purpose | Files changed |
|--------|---------|---------------|
| `04b9394` | Sync upstream skills, add `constraint-driven-development`, add `sync-from-agent-skills.sh`, wire DEFINE mapping in `AGENTS.md` | `AGENTS.md`, `sync-from-agent-skills.sh`, `skills/**` (19 updated + 1 added), `skills/using-agent-skills/SKILL.md` (local overlays retained) |
| `2043633` | Feature history ledger | `.ai/feature-history/sync-agent-skills-latest.md` |

On `develop` after squash:

| Commit | Purpose |
|--------|---------|
| `0ff1f06` | Squash of the above onto develop |

## Verification

- Compared `agent-skills/skills` vs `agent_workflow/skills` after sync: all upstream overlaps match except intentional `using-agent-skills` local overlays (`context-handoff`, `prefer-ripgrep-search`)
- Local-only skills preserved: `context-handoff`, `prefer-ripgrep-search`
- Linked `~/.cursor/skills/constraint-driven-development` → pack skill (outside git)
- Re-ran `./sync-from-agent-skills.sh` to confirm overlay patch stays applied
- No automated tests applicable (docs/skills only)

## Dependencies between commits

- Squashed into one develop commit; no inter-commit dependency remains on develop

## Cherry-pick notes

- Prefer cherry-picking the single develop squash commit rather than the pre-squash branch commits
- Conflicts: unlikely unless local skill edits diverged again
- Migrations/config: none
- Follow-up: after merge, run `./setup.sh` (or create symlink) on machines that still lack `constraint-driven-development` under `~/.cursor/skills`
- Future sync: `git -C ../agent-skills pull` then `./sync-from-agent-skills.sh`

## Rollback notes

- Revert the squash commit on `develop`
- Remove `~/.cursor/skills/constraint-driven-development` symlink if rolling back the new skill install
