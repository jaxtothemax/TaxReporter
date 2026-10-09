#!/usr/bin/env bash
# PreToolUse hook (matcher: "Bash") — before Claude runs a `gh pr create`
# command, inspect the branch diff and, if source (or sensitive) paths
# changed, BLOCK the command and tell Claude to run the security-review gate
# first.
#
# The file keeps its upstream Blueprint name (`pre-mr-security-gate.sh`) so it
# lines up with the template's docs; in this repository an MR is a GitHub pull
# request (PR), and the command it intercepts is `gh pr create` (or its alias
# `gh pr new`). It does not intercept `glab` — this project is GitHub-only.
#
# ## Why PreToolUse, not UserPromptSubmit (issue #11)
#
# This hook used to be wired to UserPromptSubmit and matched the literal
# string "/mr" in the user's prompt. That fires on every message in every
# session — a 10s-timeout subprocess + jq parse to catch a condition that is
# one prompt in fifty — and it never fires at all for an agent that opens the
# PR by reproducing `gh pr create` directly, which is exactly what
# CLAUDE.md tells every agent to do (`/mr` is `disable-model-invocation:
# true`, so an agent cannot invoke it through the Skill tool). PreToolUse
# with a Bash matcher fires on the real event — the command that actually
# creates the PR — regardless of how Claude was told to get there, and costs
# nothing on every other Bash call.
#
# Tradeoff, recorded honestly: UserPromptSubmit could hand Claude "here is
# what you'll need to run" before it started working the branch.
# PreToolUse only fires once the `gh pr create` call is already assembled,
# so the message here is "stop — run these first, then retry," not a
# heads-up. That ordering cost buys correctness on the path that matters.
#
# ## Output contract
#
# PreToolUse has no non-blocking "inject context" channel — that is
# UserPromptSubmit-only (`hookSpecificOutput.additionalContext`). The only
# way a PreToolUse hook can hand Claude a message is
# `permissionDecision: "deny"` with a `permissionDecisionReason`, which
# cancels the tool call and feeds the reason back so Claude can adjust and
# retry (see docs.claude.com/en/hooks, "PreToolUse Hook Reference" /
# "Exit 2 behavior"). So a required gate genuinely blocks `gh pr create`
# until it is satisfied — do not "guess" this shape from the old
# UserPromptSubmit script; it used a different field entirely.
#
# ## Opt-out / re-entry — one mechanism for both
#
# There is no `.prompt` field on a PreToolUse event, so the old "type 'skip
# security gate' in the same prompt" bypass has nothing to read. The
# replacement: prefix the command with `SKIP_SECURITY_GATE=1` as a literal
# shell env-var assignment immediately before `gh`, e.g.:
#
#   SKIP_SECURITY_GATE=1 gh pr create --title "..." ...
#
# This is the ONLY way through, and it is intentionally the same signal for
# two different reasons: this script cannot tell "the required gates already
# ran against this diff" from "they never ran" — the diff on disk looks
# identical either way. A hard deny with no bypass would therefore re-fire
# identically on the very retry Claude makes after running the gates,
# forever. So: an agent that has actually run the required gates retries the
# exact same command with the prefix; a user who wants the gate skipped
# outright tells the agent to add the same prefix. Both are recorded
# identically on purpose — this hook decides whether the command ran at all,
# not whether the reason for bypassing it was good.
#
# The flag is matched only as a real env-var assignment directly before the
# `gh pr create` invocation, never as a loose substring anywhere in the
# command — a PR `--body` that happens to quote this comment (or the phrase
# "skip security gate") must not silently defeat the gate. Heredoc bodies
# (`--body "$(cat <<'EOF' ... EOF)"`, the shape the `/mr` skill itself
# emits) are stripped before either check runs.
#
# CUSTOMIZE: adjust the sensitive-path patterns (Step "Sensitive-path
# detection") and the required-gate list for your stack. Blueprint also
# required an access-control (RBAC) agent on every source-touching MR; this
# project has no endpoints or authorization layer for one to read, so
# security-review is the only required gate here. Re-add an access-control
# gate to `required` if a server-side surface with roles ever appears.

set -uo pipefail

input="$(cat 2>/dev/null || true)"
tool_name="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
bash_command="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"

# Defensive — the "Bash" matcher in settings.json already restricts which
# events reach this script, but a widened matcher must not silently apply
# PR-detection logic to a non-Bash tool call.
if [[ "$tool_name" != "Bash" || -z "$bash_command" ]]; then
  exit 0
fi

# Decide (a) whether this command is really a `gh pr create` invocation —
# not just text that mentions one, e.g. inside a --body heredoc body
# — and (b) whether the SKIP_SECURITY_GATE=1 opt-out immediately precedes
# it. Both checks run against the command with heredoc bodies stripped, so
# prose in a PR body can never be mistaken for the command it is
# embedded in, or for a bypass of the gate that command is subject to.
match="$(python3 - "$bash_command" <<'PYEOF'
import re
import sys

command = sys.argv[1] if len(sys.argv) > 1 else ""


def strip_heredocs(text: str) -> str:
    """Blank out heredoc body lines so prose inside e.g. a --body
    payload can never be mistaken for the command it is embedded in."""
    lines = text.split("\n")
    out = []
    delim = None
    for line in lines:
        if delim is not None:
            if line == delim:
                delim = None
            continue
        match_start = re.search(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", line)
        if match_start:
            delim = match_start.group(2)
        out.append(line)
    return "\n".join(out)


cleaned = strip_heredocs(command)

# A real `gh pr create` (or `gh pr new`, its alias) invocation: at the very
# start of the command, or
# right after a statement separator (&&, ||, ;, a single |, or a newline),
# optionally preceded by a chain of shell env-var assignments — never a bare
# substring match anywhere in the text.
STATEMENT = re.compile(
    r"(?:^|&&|\|\||[;\n]|\|(?!\|))\s*"
    r"((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)"
    r"gh\s+pr\s+(?:create|new)\b"
)

is_pr_create = False
has_opt_out = False
for m in STATEMENT.finditer(cleaned):
    is_pr_create = True
    prefix = m.group(1)
    if re.search(r"(?:^|\s)SKIP_SECURITY_GATE=1(?:\s|$)", prefix):
        has_opt_out = True

print("pr_create=1" if is_pr_create else "pr_create=0")
print("opt_out=1" if has_opt_out else "opt_out=0")
PYEOF
)"

is_pr_create="$(grep -oE '^pr_create=[01]' <<<"$match" | cut -d= -f2)"
has_opt_out="$(grep -oE '^opt_out=[01]' <<<"$match" | cut -d= -f2)"

# Not a PR-creating command at all — the common case, and cheap: no diff
# was ever computed.
if [[ "$is_pr_create" != "1" ]]; then
  exit 0
fi

# The opt-out lets an agent that already ran the gates (or was told to skip
# them) through without this script re-litigating a diff it cannot
# distinguish from "never checked."
if [[ "$has_opt_out" == "1" ]]; then
  exit 0
fi

# Diff vs the default branch + uncommitted. Bail silently if not a git repo / no main.
committed="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
uncommitted="$(git diff --name-only HEAD 2>/dev/null || true)"
all_changed="$(printf '%s\n%s\n' "$committed" "$uncommitted" | sort -u | sed '/^$/d' || true)"

if [[ -z "$all_changed" ]]; then
  exit 0
fi

# Skip docs / CI / changelog-only branches — no source touched.
# CUSTOMIZE: add the source extensions your project uses.
if ! grep -qE '\.(py|ts|tsx|js|jsx|go|rb|java|rs|php|cs)$' <<<"$all_changed"; then
  exit 0
fi

# Sensitive-path detection — framework-neutral. Order: cheapest patterns first.
# CUSTOMIZE: tune these to where your project puts parsers, auth, and input handling.
# The parser/importer/reader/writer line is this project's main trust boundary:
# foreign-broker exports are untrusted input, and the generated eDavki XML is
# output another system ingests.
sensitive=0
if grep -qE \
  -e '(^|/)(parsers?|importers?|readers?|writers?)(/|\.|_)' \
  -e '(^|/)views?\.(py|rb)$' \
  -e '(^|/)serializers?\.py$' \
  -e '(^|/)permissions?\.(py|rb)$' \
  -e '(^|/)(routes?|handlers?|controllers?)/' \
  -e '(^|/)auth' \
  -e '(^|/)middleware' \
  -e 'file_?handl|upload' \
  <<<"$all_changed"; then
  sensitive=1
fi

# Every source-touching PR waits for security-review; sensitive paths only
# sharpen what the reason tells it to look at.
required=("security-review")
reason_line="Source files changed; security-review is required before this PR is opened."
if [[ "$sensitive" -eq 1 ]]; then
  reason_line+=" Sensitive paths detected (input handling/parsers/serializers/auth/middleware/upload) — the review must cover them in full."
fi

reason=$'Pre-PR security gate (.claude/hooks/pre-mr-security-gate.sh fired):\n\n'"$reason_line"$'\n\nThis `gh pr create` call is blocked until the required gates run. Run the following gates, in order, as a single parallel agent batch, then consolidate:\n\n'"$(printf -- '- %s\n' "${required[@]}")"$'\nFinding-handling rules:\n- Any Critical or High severity finding → do not retry this command. Surface the findings to the user and ask whether to proceed.\n- Medium / Low findings → summarize inline, then proceed.\n\nOnce the gates are satisfied (or the user has explicitly said to skip the security gate), retry the exact same gh pr create command with SKIP_SECURITY_GATE=1 prefixed as a literal shell env-var assignment, e.g.:\n\n  SKIP_SECURITY_GATE=1 gh pr create --title "..." ...\n\nThis hook cannot tell "the gates already ran" from "they never ran" — SKIP_SECURITY_GATE=1 is the only way through, whether the reason is a satisfied gate or an explicit user skip instruction.'

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
