# Update Workflow Feature History

## Feature Summary

Optimize the global agent workflow instructions for faster routing, lower context usage, safer CodeGraph behavior, mandatory final-ledger feature history, opt-in handoff maintenance, and multi-target workflow setup.

## Branches

- Source branch: `feature/update-workflow`
- Intended target branch: not specified
- Base commit: `2940d71`

## Ordered Implementation Commit List

1. `a261120 docs: optimize agent workflow rules`
   - Purpose: Update `AGENTS.md` with workflow routing, context budgeting, preflight checks, research stop conditions, verification scaling, mandatory feature history, stricter CodeGraph index handling, and optional handoff behavior.
   - Files/modules changed:
     - `AGENTS.md`
     - `.ai/feature-history/update-workflow.md`
   - Verification:
     - Reviewed `git diff -- AGENTS.md`.
     - Verified workflow skills directory state before commit.
     - No automated tests were run because this is a documentation/workflow-only change.

2. `c83a154 docs: clarify workflow ledger commits`
   - Purpose: Require feature history to be finalized as a separate final ledger commit after implementation commits, and default active handoff Story matching to the branch name.
   - Files/modules changed:
     - `AGENTS.md`
   - Verification:
     - Reviewed `git diff -- AGENTS.md`.
     - Ran `git diff --check`.
     - No automated tests were run because this is a documentation/workflow-only change.

3. `ab2f071 feat: add workflow target selection setup`
   - Purpose: Add `setup.sh` support for choosing one or more workflow targets from `claude`, `cursor`, and `codex` instead of entering a free-text destination folder.
   - Files/modules changed:
     - `setup.sh`
   - Verification:
     - Ran `sh -n setup.sh`.
     - Ran temp `HOME` install test with `1,3`; verified 17 links for claude, 0 for cursor, and 17 for codex.
     - Ran temp `HOME` install test with `all`; verified 17 links for claude, cursor, and codex.

4. `e3811c5 refactor: discover setup skills dynamically`
   - Purpose: Remove the hard-coded skill list from `setup.sh` and link every direct skill directory found under the local `skills` folder.
   - Files/modules changed:
     - `setup.sh`
   - Verification:
     - Ran `sh -n setup.sh`.
     - Ran temp `HOME` install test with `all`; verified 17 links for claude, cursor, and codex.
     - Ran temp `HOME` install test with `2`; verified 17 links for cursor and 0 for claude/codex.

5. `beeac75 feat: link AGENTS.md into each workflow config root`
   - Purpose: In addition to linking skills, link the repo-root `AGENTS.md` into the parent of each destination skills folder so every workflow gets its expected instructions file (`CLAUDE.md` for claude, `AGENTS.md` for codex and cursor). Also auto-create destination folders with `mkdir -p` and default destinations under `$HOME/temp`.
   - Files/modules changed:
     - `setup.sh`
   - Verification:
     - Ran `sh -n setup.sh`.
     - Ran temp `HOME` install test with `all`; verified `CLAUDE.md` link for claude and `AGENTS.md` links for codex and cursor, all pointing at the repo-root `AGENTS.md`.

6. `f94ad82 Add skills`
   - Purpose: Add per-skill marker/link files under each skill directory so the packaged workflow includes all current skill folder entries.
   - Files/modules changed:
     - `skills/*/<skill-name>` marker/link files for 17 skills.
   - Verification:
     - Reviewed `git show --stat --oneline f94ad82`.

7. `1b68fd6 fix: restore workflow setup destinations`
   - Purpose: Restore setup destination defaults from `$HOME/temp/...` to the standard workflow config roots under `$HOME`.
   - Files/modules changed:
     - `setup.sh`
   - Verification:
     - Ran `sh -n setup.sh`.
     - Ran temp `HOME` install test with `all`; verified 17 skill links for claude, cursor, and codex.
     - Verified `CLAUDE.md` link for claude and `AGENTS.md` links for codex and cursor.

8. `764c8f3 feat: add antigravity setup target`
   - Purpose: Add antigravity as a selectable setup target using Gemini-compatible paths: skills in `$HOME/.gemini/config/skills` and rule file at `$HOME/.gemini/GEMINI.md`.
   - Files/modules changed:
     - `setup.sh`
   - Verification:
     - Ran `sh -n setup.sh`.
     - Ran temp `HOME` install test with `4`; verified 17 skill links under `.gemini/config/skills`, `GEMINI.md` link under `.gemini`, and no claude links.
     - Ran temp `HOME` install test with `all`; verified 17 skill links for claude, cursor, codex, and antigravity, plus `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` rule links.

## Superseded Ledger Commit

- `78e867b docs: finalize update-workflow feature history`
- Purpose: Previous final ledger commit before `setup.sh` was added.
- `576332a docs: update workflow feature history for setup`
- Purpose: Previous final ledger commit before dynamic setup skill discovery was added.
- `0deba0b docs: update workflow history for dynamic setup`
- Purpose: Previous final ledger commit before AGENTS.md config-root linking was added.
- `2f3a342 docs: update workflow feature history for agents md linking`
- Purpose: Previous final ledger commit before skill marker/link files and restored setup destinations were added.
- `364503b docs: update workflow history for setup destinations`
- Purpose: Previous final ledger commit before antigravity setup support was added.
- `eadda10 docs: update workflow history for antigravity setup`
- Purpose: Previous final ledger commit before rebasing `feature/update-workflow` onto `develop`.
- Note: Keep it when replaying the historical branch exactly, but use the latest final ledger commit as the authoritative feature history.

## Final Ledger Commit

- `docs: finalize update-workflow feature history`
- Purpose: Update this file after implementation commits so AI agents can cherry-pick the feature from an accurate ordered implementation commit list.
- Files/modules changed:
  - `.ai/feature-history/update-workflow.md`
- Note: This ledger commit is intentionally separate from implementation commits and should be applied last when preserving AI feature history.

## Dependencies Between Commits

- Apply `a261120` before `c83a154`.
- Apply `ab2f071` after `78e867b` in the current branch history, or after `c83a154` when rebuilding the feature without intermediate ledger commits.
- Apply `e3811c5` after `ab2f071`.
- Apply `beeac75` after `e3811c5`.
- Apply `f94ad82` after `2f3a342` in the current branch history, or after `beeac75` when rebuilding the feature without intermediate ledger commits.
- Apply `1b68fd6` after `f94ad82`.
- Apply `764c8f3` after `1b68fd6`.
- The final ledger commit depends on all implementation commits and should be applied last when carrying feature history forward.

## Cherry-Pick Notes

- Cherry-pick implementation commits in this order:
  - `a261120 docs: optimize agent workflow rules`
  - `c83a154 docs: clarify workflow ledger commits`
  - `ab2f071 feat: add workflow target selection setup`
  - `e3811c5 refactor: discover setup skills dynamically`
  - `beeac75 feat: link AGENTS.md into each workflow config root`
  - `f94ad82 Add skills`
  - `1b68fd6 fix: restore workflow setup destinations`
  - `764c8f3 feat: add antigravity setup target`
- Cherry-pick the latest final ledger commit last if preserving `.ai/feature-history/update-workflow.md`.
- If applying manually, copy `AGENTS.md` and `setup.sh` first, then update `.ai/feature-history/update-workflow.md`.
- No migrations, dependency installs, generated artifacts, or follow-up commands are required.
- `cce1616 chore: sync repository metadata` was dropped during rebase because `.gitignore` and `LICENSE` are now upstream on `develop`.
- Expected conflicts are limited to `AGENTS.md`, `setup.sh`, and `.ai/feature-history/update-workflow.md` if the target branch changed workflow instructions, setup behavior, or feature history independently.

## Rollback Notes

- Revert the final ledger commit first if only the feature history needs to be removed.
- Revert `764c8f3` to remove antigravity setup support.
- Revert `1b68fd6` to return setup destinations to `$HOME/temp/...`.
- Revert `f94ad82` to remove per-skill marker/link files.
- Revert `e3811c5` to restore the hard-coded setup skill list.
- Revert `beeac75` to stop linking `AGENTS.md` into workflow config roots and restore the missing-folder error behavior.
- Revert `ab2f071` to remove setup target selection.
- Revert `c83a154` and then `a261120` to restore the previous `AGENTS.md` behavior.
