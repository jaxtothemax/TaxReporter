#!/bin/bash
# NOT WIRED BY DEFAULT. Blueprint ships this as a documented example only —
# there is no "Stop" entry for it in .claude/settings.json, so a fresh
# checkout never runs it (issue #11: a hook that runs on every response to
# do nothing costs a subprocess for nothing). To opt in, uncomment one of
# the examples below and add a "Stop" block to .claude/settings.json's
# "hooks" object:
#
#   "Stop": [
#     {
#       "hooks": [
#         {
#           "type": "command",
#           "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/on-stop.sh\"",
#           "timeout": 10
#         }
#       ]
#     }
#   ]
#
# Stop hook: runs after Claude finishes each response.
# Receives the stop event JSON on stdin.
#
# Use this for post-response actions:
#   - Send a desktop notification when a long task completes
#   - Log session cost or token usage
#   - Trigger a CI status check
#   - Append a summary to a project log
#
# Exit 0 always — this hook cannot block a completed response.

# Example: desktop notification (macOS)
# python3 - <<'PYEOF'
# import json, sys, subprocess
# try:
#     data = json.load(sys.stdin)
#     msg = data.get("stop_reason", "done")
#     subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Claude Code"'])
# except Exception:
#     pass
# PYEOF

exit 0
