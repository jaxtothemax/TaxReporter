#!/usr/bin/env bash
# scripts/tests/pre-mr-security-gate.test.sh — the pre-MR security gate hook
# fires on the event it actually claims to cover now: a `gh pr create`
# Bash call (a GitHub pull request — this repository's "MR"), not the literal
# string "/mr" in a user prompt (issue #11).
#
# The hook is not itself a CI gate — it is a Claude Code PreToolUse hook, so
# it has no job of its own in .github/workflows/. This is the bucket
# scripts/tests/wt-args.test.sh models: hermetic, no gate job to piggyback
# on, run directly from `tooling-self-tests`.
#
# Each case feeds a fabricated PreToolUse event (the shape
# `{"tool_name":"Bash","tool_input":{"command":"..."}}`) to the hook's stdin
# from inside a throwaway git repo, and asserts on its JSON output:
# `permissionDecision: "deny"` (blocked, with a reason) or no output at all
# (the hook exits 0 silently — the common case, and the one that must stay
# free for every non-PR Bash call).

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.claude/hooks/pre-mr-security-gate.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rc=0
pass() { echo "SELF-TEST OK: $1"; }
fail() { echo "SELF-TEST FAILED: $1" >&2; rc=1; }

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# Builds a throwaway repo at $TMP/<name> with `origin/main` at an empty root
# commit and `feat/x` checked out with the given files added on top.
# <name> <file:content pairs...>
make_repo() {
  local name="$1"
  shift
  local d="$TMP/$name"
  mkdir -p "$d"
  (
    cd "$d" || exit 1
    git init -q -b main
    git config user.email test@example.com
    git config user.name test
    git commit -q --allow-empty -m init
    git update-ref refs/remotes/origin/main HEAD
    git checkout -q -b feat/x
    while [ "$#" -ge 2 ]; do
      local path="$1" content="$2"
      mkdir -p "$(dirname "$path")"
      printf '%s\n' "$content" >"$path"
      shift 2
    done
    git add -A
    git commit -q -m "feat: change"
  )
}

# Runs the hook inside <repo-dir> with a Bash tool_input.command of <command>,
# and prints its permission decision: "deny", "allow" (no output / exit 0),
# or "error" (non-JSON output, non-zero exit with output).
run_hook() { # <repo-dir> <command>
  local repo="$1" command="$2" out status
  out="$(
    cd "$repo" || exit 1
    python3 -c '
import json, sys
print(json.dumps({"tool_name": "Bash", "tool_input": {"command": sys.argv[1]}}))
' "$command" | "$HOOK"
  )"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "error"
    return
  fi
  if [ -z "$out" ]; then
    echo "allow"
    return
  fi
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("hookSpecificOutput", {}).get("permissionDecision", "allow"))
except Exception:
    print("error")
' <<<"$out"
}

check() { # <label> <repo-dir> <command> <want: deny|allow>
  local label="$1" repo="$2" command="$3" want="$4" got
  got="$(run_hook "$repo" "$command")"
  if [ "$got" = "$want" ]; then
    pass "$label"
  else
    fail "$label — wanted '$want', got '$got'"
  fi
}

# ── Fixture repos ────────────────────────────────────────────────────────

make_repo sensitive app/views.py "def view(): pass"
make_repo docs_only README.md "some docs"
make_repo nonsensitive app/utils.py "def util(): pass"

PR_CREATE='gh pr create --title "x" --base main --body "desc"'

# ── Case 1: a real `gh pr create` on a branch with sensitive source
# changes fires the gate. ────────────────────────────────────────────────
check "gh pr create + sensitive diff → denied" \
  "$TMP/sensitive" "$PR_CREATE" deny

# ── Case 2: a non-PR Bash command never fires it, even on the same
# sensitive branch — including read-only `gh pr` subcommands. ───────────
check "non-PR command on the same branch → allowed" \
  "$TMP/sensitive" 'git push -u origin feat/x' allow
check "read-only gh pr view on the same branch → allowed" \
  "$TMP/sensitive" 'gh pr view --json number,url' allow

# ── Case 3: the SKIP_SECURITY_GATE=1 opt-out bypasses the gate. ─────────
check "SKIP_SECURITY_GATE=1 prefix → allowed" \
  "$TMP/sensitive" "SKIP_SECURITY_GATE=1 $PR_CREATE" allow

# ── Case 4: the opt-out phrase appearing only inside the --body
# heredoc body must NOT bypass the gate — it has to be a real env-var
# assignment on the command, not prose the hook happens to read. ────────
# Deliberately single-quoted: this builds the literal `$(cat <<'EOF'` text
# fed to the hook as fixture data, not an expression meant to expand here.
# shellcheck disable=SC2016
BODY_WITH_PHRASE='gh pr create \
  --title "x" \
  --base main \
  --body "$(cat <<'"'"'EOF'"'"'
Use SKIP_SECURITY_GATE=1 gh pr create to bypass this hook.
EOF
)"'
check "opt-out phrase only in PR body → still denied" \
  "$TMP/sensitive" "$BODY_WITH_PHRASE" deny

# ── Case 5: source changed but nothing sensitive still requires the gate
# (security-review is required on every source-touching branch). ───────
check "gh pr create + non-sensitive source diff → denied" \
  "$TMP/nonsensitive" "$PR_CREATE" deny

# ── Case 6: a docs-only branch never fires the gate at all. ─────────────
check "gh pr create + docs-only diff → allowed" \
  "$TMP/docs_only" "$PR_CREATE" allow

# ── Case 6b: `gh pr new` is gh's built-in alias for `gh pr create`; it
# opens the same PR, so it must hit the same gate. ──────────────────────
check "gh pr new (alias) + source diff → denied" \
  "$TMP/nonsensitive" 'gh pr new --title "x" --base main --body "desc"' deny

# ── Case 6c: a `gh pr create` chained after another statement is still a
# real invocation, not prose. ───────────────────────────────────────────
check "git push && gh pr create + source diff → denied" \
  "$TMP/nonsensitive" "git push -u origin feat/x && $PR_CREATE" deny

# ── Case 7: the deny reason names security-review as the ONE required gate,
# so an agent is never told to wait for a gate this project does not ship. ─
reason_gates="$(
  cd "$TMP/nonsensitive" || exit 1
  python3 -c '
import json, sys
print(json.dumps({"tool_name": "Bash", "tool_input": {"command": sys.argv[1]}}))
' "$PR_CREATE" | "$HOOK" | python3 -c '
import json, sys
reason = json.load(sys.stdin)["hookSpecificOutput"]["permissionDecisionReason"]
print(",".join(l[2:] for l in reason.splitlines() if l.startswith("- ") and " " not in l[2:]))
'
)"
if [ "$reason_gates" = "security-review" ]; then
  pass "deny reason requires exactly security-review"
else
  fail "deny reason required gates '$reason_gates', wanted exactly 'security-review'"
fi

[ "$rc" -eq 0 ] && echo "pre-mr-security-gate: self-test passed."
exit "$rc"
