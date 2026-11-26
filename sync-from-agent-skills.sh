#!/usr/bin/env bash
# Sync upstream skills from agent-skills into this pack via direct file copy (not symlinks).
# Preserves local-only skills and re-applies local overlays on using-agent-skills.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST_SKILLS="${SCRIPT_DIR}/skills"
DEST_REFS="${SCRIPT_DIR}/references"

# Default: sibling checkout next to agent_workflow
DEFAULT_SOURCE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../agent-skills" 2>/dev/null && pwd || true)"
SOURCE_SKILLS="${AGENT_SKILLS_DIR:-${DEFAULT_SOURCE_ROOT:+${DEFAULT_SOURCE_ROOT}/skills}}"
SOURCE_REFS="${AGENT_SKILLS_REFS_DIR:-${SOURCE_SKILLS:+$(dirname "$SOURCE_SKILLS")/references}}"

DRY_RUN=0
INCLUDE_NEW=1

usage() {
  cat <<'EOF'
Usage: ./sync-from-agent-skills.sh [options]

Copy latest skills from an agent-skills checkout into ./skills (direct copy).

Options:
  --source DIR     Path to agent-skills/skills (default: ../agent-skills/skills
                   or $AGENT_SKILLS_DIR)
  --dry-run        Show what would change without writing
  --no-new         Do not add skills that exist only upstream
  -h, --help       Show this help

Local-only skills (never overwritten/deleted):
  context-handoff
  prefer-ripgrep-search

After sync, using-agent-skills is patched to keep local discovery entries.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE_SKILLS="${2:?--source requires a directory}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-new)
      INCLUDE_NEW=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$SOURCE_SKILLS" ]; then
  echo "Error: source skills directory not found: $SOURCE_SKILLS" >&2
  exit 1
fi

SOURCE_REFS="${AGENT_SKILLS_REFS_DIR:-$(dirname "$SOURCE_SKILLS")/references}"

if [ ! -d "$DEST_SKILLS" ]; then
  echo "Error: destination skills directory not found: $DEST_SKILLS" >&2
  exit 1
fi

is_local_only() {
  case "$1" in
    context-handoff|prefer-ripgrep-search|init|spec|build|handoff-sync|proposal-writer|tech-spec-writer) return 0 ;;
    *) return 1 ;;
  esac
}

# Skip junk / broken nested self-symlinks sometimes present in upstream checkouts.
should_skip_source_entry() {
  skill="$1"
  entry="$2"
  base=$(basename "$entry")

  case "$base" in
    .DS_Store|.git|.gitignore) return 0 ;;
  esac

  # Nested directory named the same as the skill is almost always a bad self-link.
  if [ "$base" = "$skill" ]; then
    return 0
  fi

  if [ -L "$entry" ]; then
    return 0
  fi

  return 1
}

copy_skill() {
  skill="$1"
  src="$SOURCE_SKILLS/$skill"
  dst="$DEST_SKILLS/$skill"

  if [ ! -d "$src" ]; then
    echo "Error: missing source skill: $src" >&2
    return 1
  fi

  echo "COPY  $skill"

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  mkdir -p "$dst"

  # Remove destination files that are not local junk we intentionally keep,
  # then copy fresh content from upstream (excluding nested self-links / junk).
  find "$dst" -mindepth 1 -maxdepth 1 ! -name '.DS_Store' -exec rm -rf {} +

  for entry in "$src"/* "$src"/.[!.]* "$src"/..?*; do
    [ -e "$entry" ] || continue
    if should_skip_source_entry "$skill" "$entry"; then
      continue
    fi
    cp -R "$entry" "$dst/"
  done
}

patch_using_agent_skills() {
  file="$DEST_SKILLS/using-agent-skills/SKILL.md"
  if [ ! -f "$file" ]; then
    echo "Warning: using-agent-skills/SKILL.md missing; skip local overlay" >&2
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "PATCH using-agent-skills (local overlays)"
    return 0
  fi

  python3 - "$file" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

discovery_lines = [
    "    ├── Explicit AI context handoff? ──→ context-handoff",
    "    ├── Searching code/text? ──────────→ prefer-ripgrep-search",
]

# Insert local discovery entries before the final Deploying line when missing.
marker = "    └── Deploying/launching? ─────────→ shipping-and-launch"
if marker in text:
    block = "\n".join(discovery_lines) + "\n" + marker
    if "→ context-handoff" not in text or "→ prefer-ripgrep-search" not in text:
        # Remove any partial local lines first, then insert cleanly.
        lines = []
        for line in text.splitlines(True):
            if "→ context-handoff" in line or "→ prefer-ripgrep-search" in line:
                continue
            lines.append(line)
        text = "".join(lines)
        text = text.replace(marker, block, 1)

table_rows = [
    "| Handoff | context-handoff | Compact, source-grounded context for the next AI agent |",
    "| Search | prefer-ripgrep-search | Prefer `rg` over `grep` for codebase text search |",
]

# Append local quick-reference rows after shipping-and-launch row when missing.
ship_row = "| Ship | shipping-and-launch | Pre-launch checklist, monitoring, rollback plan |"
if ship_row in text:
    missing = [row for row in table_rows if row not in text]
    if missing:
        text = text.replace(ship_row, ship_row + "\n" + "\n".join(missing), 1)

path.write_text(text)
print("PATCH using-agent-skills (local overlays applied)")
PY
}

sync_references() {
  if [ -z "$SOURCE_REFS" ] || [ ! -d "$SOURCE_REFS" ]; then
    echo "Warning: upstream references directory not found; skipping references sync." >&2
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "SYNC  references from $SOURCE_REFS"
    return 0
  fi

  mkdir -p "$DEST_REFS"
  for ref_file in "$SOURCE_REFS"/*.md; do
    [ -f "$ref_file" ] || continue
    cp "$ref_file" "$DEST_REFS/$(basename "$ref_file")"
  done
  echo "SYNC  references (*.md)"
}

UPDATED=0
ADDED=0
SKIPPED_LOCAL=0
UNCHANGED=0

echo "Source: $SOURCE_SKILLS"
echo "Dest:   $DEST_SKILLS"
echo

for src_path in "$SOURCE_SKILLS"/*; do
  [ -d "$src_path" ] || continue
  skill=$(basename "$src_path")

  if is_local_only "$skill"; then
    echo "SKIP  $skill (local-only name collision)"
    SKIPPED_LOCAL=$((SKIPPED_LOCAL + 1))
    continue
  fi

  dest_path="$DEST_SKILLS/$skill"
  if [ -d "$dest_path" ]; then
    # Compare meaningful content (ignore .DS_Store and nested self-named junk).
    if diff -rq \
      --exclude='.DS_Store' \
      --exclude="$skill" \
      "$src_path" "$dest_path" >/dev/null 2>&1; then
      echo "SAME  $skill"
      UNCHANGED=$((UNCHANGED + 1))
    else
      copy_skill "$skill"
      UPDATED=$((UPDATED + 1))
    fi
  else
    if [ "$INCLUDE_NEW" -eq 0 ]; then
      echo "OMIT  $skill (new upstream; --no-new)"
      continue
    fi
    echo "ADD   $skill"
    copy_skill "$skill"
    ADDED=$((ADDED + 1))
  fi
done

echo
echo "Local-only skills preserved:"
for skill in context-handoff prefer-ripgrep-search; do
  if [ -d "$DEST_SKILLS/$skill" ]; then
    echo "  keep  $skill"
  else
    echo "  miss  $skill (not present in dest)"
  fi
done

echo
sync_references
patch_using_agent_skills

echo
echo "Summary: updated=$UPDATED added=$ADDED unchanged=$UNCHANGED local_skip=$SKIPPED_LOCAL dry_run=$DRY_RUN"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run only — no files written."
fi
