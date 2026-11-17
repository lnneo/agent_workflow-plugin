#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON="$(cat || true)"

python3 - "$INPUT_JSON" <<'PY'
import json
import os
import sys

raw = sys.argv[1].strip() if len(sys.argv) > 1 else ""
try:
    data = json.loads(raw) if raw else {}
except Exception:
    data = {}

workspaces = data.get("workspacePaths") or []
if not workspaces:
    print("{}")
    sys.exit(0)

missing = []
for ws in workspaces:
    ws_abs = os.path.abspath(ws)
    parent = os.path.dirname(ws_abs)
    candidates = [
        os.path.join(ws_abs, ".ai", "workspace.md"),
        os.path.join(ws_abs, "WORKSPACE.md"),
        os.path.join(parent, ".ai", "workspace.md"),
        os.path.join(parent, "WORKSPACE.md"),
    ]
    if not any(os.path.isfile(c) for c in candidates):
        missing.append(ws_abs)

if not missing:
    print("{}")
    sys.exit(0)

msg = (
    "[WORKFLOW ONBOARDING]\n"
    f"Workspace(s) without .ai/workspace.md or WORKSPACE.md: {', '.join(missing)}.\n"
    "Before diving into work, ask the developer interactively once if they want to run /init "
    "to configure the workspace structure (FE/BE/Infra), verify/Playwright commands, and initial /handoff-sync."
)

print(json.dumps({
    "injectSteps": [
        {
            "systemMessage": {
                "systemMessage": msg
            }
        }
    ]
}))
PY
