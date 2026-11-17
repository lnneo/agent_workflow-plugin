#!/bin/sh

# Get the directory where this script is located
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILLS_DIR="$SCRIPT_DIR/skills"
AGENTS_MD="$SCRIPT_DIR/AGENTS.md"

CLAUDE_DEST="$HOME/.claude/skills"
CURSOR_DEST="$HOME/.cursor/skills"
CODEX_DEST="$HOME/.codex/skills"
ANTIGRAVITY_DEST="$HOME/.gemini/config/skills"

echo "Select destination workflow(s). You can choose multiple options."
echo "1) claude  -> $CLAUDE_DEST"
echo "2) cursor  -> $CURSOR_DEST"
echo "3) codex   -> $CODEX_DEST"
echo "4) antigravity -> $ANTIGRAVITY_DEST"
printf "Enter choices (for example: 1 3, claude codex, antigravity, or all): "
read -r DEST_CHOICES

if [ -z "$DEST_CHOICES" ]; then
    echo "Error: At least one destination workflow is required. Installation aborted." >&2
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

for dest_dir in $DEST_DIRS; do
    if [ ! -d "$dest_dir" ]; then
        mkdir -p "$dest_dir" || {
            echo "Error: Failed to create destination folder '$dest_dir'." >&2
            exit 1
        }
    fi
done

# Iterate over each selected destination and create symbolic links
for dest_dir in $DEST_DIRS; do
    for SRC_PATH in "$SKILLS_DIR"/*; do
        if [ ! -d "$SRC_PATH" ]; then
            continue
        fi

        skill=$(basename "$SRC_PATH")
        dest_link="$dest_dir/$skill"

        # Remove existing symlink or directory before creating a new one.
        # ln -sf on an existing symlink-to-dir places a new symlink inside
        # the target directory instead of replacing the symlink itself.
        if [ -L "$dest_link" ]; then
            rm "$dest_link"
        elif [ -d "$dest_link" ]; then
            echo "Warning: '$dest_link' is a real directory, skipping to avoid data loss." >&2
            continue
        fi

        ln -s "$SRC_PATH" "$dest_link"
    done

    # Link AGENTS.md into the workflow config root.
    # claude expects CLAUDE.md; antigravity expects GEMINI.md; codex and cursor expect AGENTS.md.
    if [ -f "$AGENTS_MD" ]; then
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
        # Same safe-replace pattern for the AGENTS.md symlink
        dest_md="$config_root/$md_name"
        [ -L "$dest_md" ] && rm "$dest_md"
        ln -s "$AGENTS_MD" "$dest_md"
    fi

    # Stage regular plugin files for Antigravity (GetAllPlugins skips symlinked manifests/skills)
    if [ "$dest_dir" = "$ANTIGRAVITY_DEST" ] && [ -f "$SCRIPT_DIR/plugin.json" ]; then
        plugin_dir="$HOME/.gemini/config/plugins/agent-workflow-plugin"
        [ -L "$plugin_dir" ] && rm "$plugin_dir"
        mkdir -p "$plugin_dir/rules" "$plugin_dir/skills" "$plugin_dir/commands" "$plugin_dir/hooks"

        cp "$SCRIPT_DIR/plugin.json" "$plugin_dir/plugin.json"
        [ -f "$SCRIPT_DIR/mcp_config.json" ] && cp "$SCRIPT_DIR/mcp_config.json" "$plugin_dir/mcp_config.json"
        [ -f "$SCRIPT_DIR/hooks.json" ] && cp "$SCRIPT_DIR/hooks.json" "$plugin_dir/hooks.json"
        [ -f "$SCRIPT_DIR/rules/AGENTS.md" ] && cp "$SCRIPT_DIR/rules/AGENTS.md" "$plugin_dir/rules/AGENTS.md"

        if [ -d "$SCRIPT_DIR/hooks" ]; then
            for hook_file in "$SCRIPT_DIR/hooks"/*.sh; do
                [ -f "$hook_file" ] || continue
                cp "$hook_file" "$plugin_dir/hooks/$(basename "$hook_file")"
                chmod +x "$plugin_dir/hooks/$(basename "$hook_file")"
            done
        fi

        if [ -d "$SCRIPT_DIR/commands" ]; then
            for cmd_file in "$SCRIPT_DIR/commands"/*.md; do
                [ -f "$cmd_file" ] || continue
                cp "$cmd_file" "$plugin_dir/commands/$(basename "$cmd_file")"
            done
        fi

        for SRC_PATH in "$SKILLS_DIR"/*; do
            [ -d "$SRC_PATH" ] || continue
            skill=$(basename "$SRC_PATH")
            mkdir -p "$plugin_dir/skills/$skill"
            [ -f "$SRC_PATH/SKILL.md" ] && cp "$SRC_PATH/SKILL.md" "$plugin_dir/skills/$skill/SKILL.md"
            if [ -d "$SRC_PATH/references" ]; then
                mkdir -p "$plugin_dir/skills/$skill/references"
                cp -R "$SRC_PATH/references/"* "$plugin_dir/skills/$skill/references/" 2>/dev/null || true
            fi
        done
    fi
done

echo "Successfully created symbolic links for:$DEST_NAMES."
