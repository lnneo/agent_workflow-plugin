#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON="$(cat || true)"

python3 - "$INPUT_JSON" <<'PY'
import json
import os
import subprocess
import sys

raw = sys.argv[1].strip() if len(sys.argv) > 1 else ""
try:
    data = json.loads(raw) if raw else {}
except Exception:
    data = {}

is_antigravity = (
    "workspacePaths" in data
    or "conversationId" in data
    or "hookEventName" in data
)

workspaces = data.get("workspacePaths") or []
if not workspaces and data.get("cwd"):
    workspaces = [data["cwd"]]

if not workspaces:
    print("{}")
    sys.exit(0)


def get_git_info(ws_path):
    try:
        res = subprocess.run(
            ["git", "-C", ws_path, "rev-parse", "--is-inside-work-tree"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=1.5,
        )
        if res.returncode != 0 or res.stdout.strip() != "true":
            return None
        branch_res = subprocess.run(
            ["git", "-C", ws_path, "branch", "--show-current"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=1.5,
        )
        branch = branch_res.stdout.strip()
        return branch if branch else "detached-HEAD"
    except Exception:
        return None


PROTECTED_BRANCHES = {"main", "master", "develop", "staging"}

missing = []
protected_alerts = []
working_reminders = []

for ws in workspaces:
    ws_abs = os.path.abspath(ws)
    parent = os.path.dirname(ws_abs)
    candidates = [
        os.path.join(ws_abs, ".ai", "workspace.md"),
        os.path.join(ws_abs, "WORKSPACE.md"),
        os.path.join(parent, ".ai", "workspace.md"),
        os.path.join(parent, "WORKSPACE.md"),
    ]
    has_manifest = any(os.path.isfile(c) for c in candidates)
    if not has_manifest:
        missing.append(ws_abs)
    else:
        branch = get_git_info(ws_abs)
        if branch:
            ws_name = os.path.basename(ws_abs)
            if branch in PROTECTED_BRANCHES:
                protected_alerts.append(
                    f"- '{ws_name}' is on protected branch '{branch}'. Do not edit source files or commit directly here; switch to a working branch (e.g. feature/*, fix/*) before coding."
                )
            else:
                working_reminders.append(
                    f"- '{ws_name}' is on active working branch '{branch}'. Remember to keep handoff updated via handoff MCP (handoff_save_handoff_snapshot) or /handoff-sync before wrapping up."
                )

sections = []
if missing:
    sections.append(
        "[WORKFLOW ONBOARDING]\n"
        f"Workspace(s) without .ai/workspace.md or WORKSPACE.md: {', '.join(missing)}.\n"
        "Before diving into work, ask the developer interactively once if they want to run /init "
        "to configure the workspace structure (FE/BE/Infra), verify/Playwright commands, and initial /handoff-sync."
    )

if protected_alerts:
    sections.append("[PROTECTED BRANCH POLICY]\n" + "\n".join(protected_alerts))

if working_reminders:
    sections.append("[HANDOFF & WORKFLOW REMINDER]\n" + "\n".join(working_reminders))

if not sections:
    print("{}")
    sys.exit(0)

msg = "\n\n".join(sections)

if is_antigravity:
    print(
        json.dumps(
            {
                "injectSteps": [
                    {
                        "systemMessage": {
                            "systemMessage": msg,
                        }
                    }
                ]
            }
        )
    )
else:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": msg,
                }
            }
        )
    )
PY
