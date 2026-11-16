#!/bin/sh

# Remove workflow symlinks created by setup.sh for this repository.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILLS_DIR="$SCRIPT_DIR/skills"
AGENTS_MD="$SCRIPT_DIR/AGENTS.md"

CLAUDE_DEST="$HOME/.claude/skills"
CURSOR_DEST="$HOME/.cursor/skills"
CODEX_DEST="$HOME/.codex/skills"
ANTIGRAVITY_DEST="$HOME/.gemini/config/skills"

echo "Select destination workflow(s) to uninstall. You can choose multiple options."
echo "1) claude  -> $CLAUDE_DEST"
echo "2) cursor  -> $CURSOR_DEST"
echo "3) codex   -> $CODEX_DEST"
echo "4) antigravity -> $ANTIGRAVITY_DEST"
printf "Enter choices (for example: 1 3, claude codex, antigravity, or all): "
read -r DEST_CHOICES

if [ -z "$DEST_CHOICES" ]; then
    echo "Error: At least one destination workflow is required. Uninstall aborted." >&2
    exit 1
fi

DEST_CHOICES=$(printf "%s" "$DEST_CHOICES" | tr ",;" "  ")

DEST_DIRS=""
DEST_NAMES=""

add_destination() {
    dest_name=$1
    dest_dir=$2

    case " $DEST_NAMES " in
        *" $dest_name "*) return ;;
    esac

    DEST_NAMES="$DEST_NAMES $dest_name"
    DEST_DIRS="$DEST_DIRS $dest_dir"
}

for choice in $DEST_CHOICES; do
    case "$choice" in
        1|claude|Claude|CLAUDE)
            add_destination "claude" "$CLAUDE_DEST"
            ;;
        2|cursor|Cursor|CURSOR)
            add_destination "cursor" "$CURSOR_DEST"
            ;;
        3|codex|Codex|CODEX)
            add_destination "codex" "$CODEX_DEST"
            ;;
        4|antigravity|Antigravity|ANTIGRAVITY)
            add_destination "antigravity" "$ANTIGRAVITY_DEST"
            ;;
        all|All|ALL)
            add_destination "claude" "$CLAUDE_DEST"
            add_destination "cursor" "$CURSOR_DEST"
            add_destination "codex" "$CODEX_DEST"
            add_destination "antigravity" "$ANTIGRAVITY_DEST"
            ;;
        *)
            echo "Error: Unknown destination workflow '$choice'." >&2
            exit 1
            ;;
    esac
done

removed_count=0
skipped_count=0

remove_managed_symlink() {
    link_path=$1
    expected_target=$2
    label=$3

    if [ ! -e "$link_path" ] && [ ! -L "$link_path" ]; then
        return
    fi

    if [ -L "$link_path" ]; then
        link_target=$(readlink "$link_path")
        if [ "$link_target" = "$expected_target" ]; then
            rm "$link_path"
            echo "Removed $label: $link_path"
            removed_count=$((removed_count + 1))
            return
        fi

        echo "Skipped $label (symlink not managed by this repo): $link_path -> $link_target" >&2
        skipped_count=$((skipped_count + 1))
        return
    fi

    echo "Skipped $label (not a symlink): $link_path" >&2
    skipped_count=$((skipped_count + 1))
}

for dest_dir in $DEST_DIRS; do
    if [ ! -d "$dest_dir" ]; then
        echo "Warning: destination '$dest_dir' does not exist. Skipping." >&2
        continue
    fi

    for SRC_PATH in "$SKILLS_DIR"/*; do
        if [ ! -d "$SRC_PATH" ]; then
            continue
        fi

        skill=$(basename "$SRC_PATH")
        dest_link="$dest_dir/$skill"
        remove_managed_symlink "$dest_link" "$SRC_PATH" "skill"
    done

    case "$dest_dir" in
        "$CLAUDE_DEST")
            config_root=$(dirname "$dest_dir")
            md_name="CLAUDE.md"
            ;;
        "$ANTIGRAVITY_DEST")
            config_root="$HOME/.gemini"
            md_name="GEMINI.md"
            ;;
        *)
            config_root=$(dirname "$dest_dir")
            md_name="AGENTS.md"
            ;;
    esac

    dest_md="$config_root/$md_name"
    remove_managed_symlink "$dest_md" "$AGENTS_MD" "config"
done

echo "Uninstall complete for:$DEST_NAMES."
echo "Removed: $removed_count symlink(s). Skipped: $skipped_count item(s)."
