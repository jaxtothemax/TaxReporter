#!/usr/bin/env bash
# Block a push that would open a second pull request for an issue someone else
# is already working.
#
# Why this exists
# ---------------
# `wt new <issue>` refuses an issue that another worktree has already claimed.
# That guard is bypassed completely by a plain `git checkout -b feat/<issue>-…`,
# which is exactly how duplicate work happens: two sessions pick the same issue,
# neither sees the other, and the collision is only discovered when the second
# pull request appears against an issue that already has one.
#
# `git push` is the one chokepoint every branch passes through regardless of how
# it was created. Re-checking the claim here catches the duplicate before it can
# become a second PR — the cheapest possible moment to find out.
#
# Behavior
# --------
#   BLOCK  the issue already has an open PR from a *different* branch. This is
#          the strong, authoritative signal: someone has already published work.
#          Override with ALLOW_DUP_MR=1 (or its alias ALLOW_DUP_PR=1) for
#          legitimate stacked or multiple-PR-per-issue work.
#   WARN   the issue carries the work-in-progress label but has no PR yet. A
#          claim without published work is weaker evidence — it may be a stale
#          label — so this informs rather than blocks. Silent when the issue's
#          latest `wt` check-out comment names THIS branch: that is the claimant
#          pushing its own work, not a collision.
#   PASS   the branch carries no issue number, the issue is unclaimed, or there
#          is no GitHub origin / no `gh` to ask (a fresh scaffold has neither —
#          the gate degrades to a no-op rather than blocking on an optional tool).
#
# The repository is never hardcoded: `gh api` expands `{owner}/{repo}` from the
# origin remote of the checkout it runs in.
#
# Wire into the pre-push gate so it runs before the slower code checks:
#   pre-push-checks: ; scripts/check-issue-collision.sh && <lint/typecheck/…>
#
# Configure:
#   WIP_LABEL        label that marks a claimed issue   (default status:wip)
#   ALLOW_DUP_MR=1   allow a second PR for the issue    (stacked-PR escape hatch;
#                    the name matches upstream Blueprint — ALLOW_DUP_PR=1 is an alias)
#   COLLISION_MR_LIST  self-test and dry-run only: a command that prints the
#                      open-PR payload instead of calling GitHub. Setting it
#                      also lifts the `command -v gh` requirement, since the
#                      payload no longer comes from the CLI, and skips the
#                      weak-signal label lookup, which has no fixture.
set -euo pipefail

# ─── Reading the open-PR list ────────────────────────────────────────────────
#
# Use structured output, never the human-readable table: scraping a rendered
# list with a whitespace-anchored regex silently matches nothing when the
# layout changes, and the gate passes when it should block. A gate that fails
# open is worse than no gate.
#
# PAGINATE. `gh pr list --limit 100` is not "the open PRs", it is the FIRST
# HUNDRED of them — and the gate's own failure mode is a clean pass, so a
# repository that crosses that line loses the duplicate check with no signal
# anywhere that it happened. `gh api --paginate` walks every page. Depending on
# the gh version (and whether a --jq filter is applied) it either merges the
# pages into one array or emits one JSON array PER PAGE, concatenated, which
# plain `json.load` rejects; `read_source_branches` below decodes the stream
# with `raw_decode` so both shapes run the one decision path the self-test
# exercises.
mr_payload() {
  if [ -n "${COLLISION_MR_LIST:-}" ]; then
    $COLLISION_MR_LIST
    return
  fi
  gh api --paginate "repos/{owner}/{repo}/pulls?state=open&per_page=100" 2>/dev/null
}

# Reads the payload on stdin, prints one head-branch name per line.
# Exit 3 means the payload was not JSON — the caller reports that rather than
# treating it as "no open PRs", which is how a parse error becomes a silent pass.
read_source_branches() {
  python3 -c '
import json, sys

raw = sys.stdin.read()
decoder = json.JSONDecoder()
i, pages = 0, []
try:
    while i < len(raw):
        while i < len(raw) and raw[i].isspace():
            i += 1
        if i >= len(raw):
            break
        obj, i = decoder.raw_decode(raw, i)
        pages += obj if isinstance(obj, list) else [obj]
except ValueError:
    sys.exit(3)

for pr in pages:
    if not isinstance(pr, dict):
        continue
    head = pr.get("head") if isinstance(pr.get("head"), dict) else {}
    branch = head.get("ref") or ""
    if branch:
        print(branch)
'
}

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# Runs the real script end to end in a throwaway repo — branch parsing, CLI
# selection, the reader, and the block/pass decision — with the GitHub call
# replaced by a fixture. The case that matters is a collision on page TWO: a
# single-page read passes it, cleanly, forever.
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now, not at trap time
  trap "rm -rf '$tmp'" EXIT
  rc=0
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

  mkdir -p "$tmp/repo" "$tmp/fx"
  (
    cd "$tmp/repo"
    git init -q .
    git config user.email t@t.invalid && git config user.name t
    git commit -q --allow-empty -m init
    git checkout -q -b feat/123-mine
    # Only the URL's shape matters (it selects gh); nothing contacts it.
    git remote add origin git@github.com:example/project.git
  )

  # One page, one unrelated PR: nothing to block on.
  cat > "$tmp/fx/clean.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"number":1,"head":{"ref":"feat/999-other"}}]'
EOF
  # TWO pages, concatenated exactly as `gh api --paginate` emits them when it
  # does not merge pages, with the collision on the second. This is the regression.
  cat > "$tmp/fx/page-two.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"number":1,"head":{"ref":"feat/999-other"}}]'
echo '[{"number":2,"head":{"ref":"fix/123-someone-elses"}}]'
EOF
  # Our own branch is expected — an updated PR must never block its own push.
  cat > "$tmp/fx/only-mine.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"number":3,"head":{"ref":"feat/123-mine"}}]'
EOF
  # Pages already merged into one array (what current gh emits without --jq).
  cat > "$tmp/fx/merged-array.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"head":{"ref":"feat/999-other"}},{"head":{"ref":"chore/123-theirs"}}]'
EOF
  # An unreachable or broken oracle must SAY so, not read as "no open PRs".
  cat > "$tmp/fx/garbage.sh" <<'EOF'
#!/usr/bin/env bash
echo '<html>401 Unauthorized</html>'
EOF
  # Whitespace-only output (no PRs, or a CLI that prints a blank line and
  # nothing else) must take the same "could not be read" path as truly empty
  # output — this is the branch the payload-blank check (#48) guards.
  cat > "$tmp/fx/blank.sh" <<'EOF'
#!/usr/bin/env bash
printf '   \n\t  \n'
EOF
  # A multi-KB field (the #48 trigger shape: one large description alongside
  # the collision) must still resolve to the same verdict once size grows well
  # past what the old bash substitution handled cheaply. Deterministic and
  # fixed-size — no wall-clock assertion, per scripts/CLAUDE.md.
  cat > "$tmp/fx/large-payload.sh" <<'EOF'
#!/usr/bin/env bash
filler="$(printf 'x %.0s' {1..2500})"
printf '[{"head":{"ref":"feat/999-other"},"body":"%s"},{"head":{"ref":"fix/123-someone-elses"}}]\n' "$filler"
EOF
  chmod +x "$tmp/fx"/*.sh

  st_case() { # <description> <expected-exit> <fixture> [grep-stderr-for]
    local desc="$1" want="$2" fixture="$3" expect_text="${4:-}"
    local got=0 err
    err="$(cd "$tmp/repo" && COLLISION_MR_LIST="$tmp/fx/$fixture" bash "$SELF" 2>&1)" || got=$?
    if [ "$got" != "$want" ]; then
      echo "SELF-TEST FAILED: $desc (expected exit $want, got $got)" >&2; rc=1; return
    fi
    if [ -n "$expect_text" ] && ! grep -qF "$expect_text" <<<"$err"; then
      echo "SELF-TEST FAILED: $desc (stderr did not mention '$expect_text')" >&2; rc=1; return
    fi
    echo "SELF-TEST OK: $desc."
  }

  st_case "an unrelated issue's PR does not block"              0 clean.sh
  st_case "a collision on page TWO of the payload blocks"       1 page-two.sh "fix/123-someone-elses"
  st_case "our own branch's PR does not block its own push"     0 only-mine.sh
  st_case "a merged single-array payload blocks the same way"   1 merged-array.sh "chore/123-theirs"
  st_case "an unparseable payload warns instead of passing"     0 garbage.sh "could not be read"
  st_case "whitespace-only output degrades like empty output"   0 blank.sh "could not be read"
  st_case "a multi-KB field still resolves the collision"       1 large-payload.sh "fix/123-someone-elses"

  ALLOW_DUP_MR=1 st_case "ALLOW_DUP_MR=1 downgrades a block to a warning" 0 page-two.sh
  ALLOW_DUP_PR=1 st_case "ALLOW_DUP_PR=1 is the same escape hatch"        0 page-two.sh

  # A non-GitHub origin is not this gate's business: it must PASS without
  # consulting the payload at all (the fixture would block if it were read).
  git -C "$tmp/repo" remote set-url origin https://example.invalid/x/y.git
  st_case "a non-GitHub origin skips the gate"                  0 page-two.sh
  git -C "$tmp/repo" remote set-url origin git@github.com:example/project.git

  if [ "$rc" -eq 0 ]; then echo "SELF-TEST: all cases passed."; fi
  exit "$rc"
fi

cd "$(git rev-parse --show-toplevel)"

WIP_LABEL="${WIP_LABEL:-status:wip}"
ALLOW_DUP="${ALLOW_DUP_MR:-${ALLOW_DUP_PR:-}}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Extract the issue number from a branch named like feat/1234-short-description.
# No number → nothing to check; this is not an error.
ISSUE="$(printf '%s' "$BRANCH" | sed -nE 's@^[a-z]+/([0-9]+)-.*@\1@p')"
if [[ -z "$ISSUE" ]]; then
  exit 0
fi

# Only a GitHub origin has an issue tracker this gate can ask. No origin (a
# fresh scaffold) or another host → no-op. Absent gh is not a failure either —
# the gate degrades rather than blocking a push on a missing optional tool.
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
case "$ORIGIN_URL" in
  *github*) ;;
  *)        exit 0 ;;
esac
if [[ -z "${COLLISION_MR_LIST:-}" ]]; then
  command -v gh >/dev/null 2>&1 || exit 0
fi
# Pin gh (and `gh api`'s {owner}/{repo}) to origin's repository: with an
# `upstream` remote too, gh's own inference could read the wrong project's PRs.
# shellcheck source-path=SCRIPTDIR source=lib/gh-repo.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/gh-repo.sh"
gh_export_repo "$(pwd)"

say()  { printf '%s\n' "$*" >&2; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# --- Strong signal: an open PR for this issue from a different branch ---------
#
# Match the same issue-number prefix in the head branch name. A hit on our
# *own* branch is expected (an updated PR) and must not block.
payload="$(mr_payload || true)"
all_branches=""
# "Is the payload blank" used to be a bash ${payload//[[:space:]]/} global
# substitution. Bash's pattern-removal re-matches the glob across the whole
# remaining string at every hit, which is quadratic in payload size — and under
# a multibyte-aware locale (en_US.UTF-8) each character comparison is also
# locale-decoded, multiplying that cost further. Measured on this payload
# shape: 0.031s/0.144s (C/en_US.UTF-8) at 1KB, 3.76s/35.0s at 8KB — the curve,
# not just the locale gap, is the problem, since a paginated 100-PR page can
# run to hundreds of KB (#48). `tr -d` is a single linear pass with no such
# blowup at any size tested (~0.005s at 50KB in either locale), so it fixes
# the class rather than pinning one locale against a cost that still grows
# with input size.
if [[ -z "$(printf '%s' "$payload" | tr -d '[:space:]')" ]]; then
  # No output at all: the CLI errored (offline, unauthenticated, no access).
  # The gate degrades rather than blocking the push — but it says so, because a
  # silent degradation is indistinguishable from a clean pass.
  warn "note: the open pull request list could not be read — duplicate-PR check skipped."
elif ! all_branches="$(printf '%s' "$payload" | read_source_branches)"; then
  warn "note: the open pull request list could not be read (unparseable response)."
  warn "      duplicate-PR check skipped."
  all_branches=""
fi

other_branches="$(
  printf '%s\n' "$all_branches" \
    | { grep -E "^[a-z]+/${ISSUE}-" || true; } \
    | { grep -v "^${BRANCH}$" || true; } | sort -u
)"

if [[ -n "$other_branches" ]]; then
  if [[ "$ALLOW_DUP" == "1" ]]; then
    warn "collision: issue #${ISSUE} already has an open PR from:"
    while IFS= read -r b; do [[ -n "$b" ]] && warn "    $b"; done <<< "$other_branches"
    warn "ALLOW_DUP_MR=1 set — proceeding (stacked / multi-PR work)."
    exit 0
  fi
  fail ""
  fail "  Push blocked — issue #${ISSUE} already has an open pull request."
  fail ""
  while IFS= read -r b; do [[ -n "$b" ]] && fail "    existing branch: $b"; done <<< "$other_branches"
  fail "    your branch:     $BRANCH"
  fail ""
  say  "  Another session is already working this issue. Options:"
  say  "    - rebase onto the existing branch and continue there"
  say  "    - pick a different issue"
  say  "    - if this is deliberate stacked work:  ALLOW_DUP_MR=1 git push …"
  fail ""
  exit 1
fi

# --- Weak signal: claimed by label, but nothing published yet ----------------
#
# Skipped in fixture mode: the label lookup has no fixture, and a self-test that
# reached the real tracker would be testing the network.
if [[ -z "${COLLISION_MR_LIST:-}" ]]; then
  # One label name per line, matched whole-line: a substring match would let
  # `status:wip` fire on a hypothetical `status:wip-stale`.
  labels="$(gh issue view "$ISSUE" --json labels --jq '.labels[].name' 2>/dev/null || true)"

  if [[ -n "$labels" ]] && grep -qxF "$WIP_LABEL" <<< "$labels"; then
    # `wt new` labels the issue itself and records this branch in its check-out
    # comment, so a push from that branch is the claimant, not a collision. Only a
    # label held by a DIFFERENT branch (or by hand, with no comment) is worth a warning.
    notes="$(gh issue view "$ISSUE" --json comments --jq '.comments[].body' 2>/dev/null || true)"
    # Only the LAST check-out note counts: after a forced takeover by another
    # branch, an earlier note naming this one must not silence the warning.
    # gh returns comments oldest-first; keys on wt's `🔒 checked out` marker so
    # an ordinary comment saying "checked out" is never mistaken for one.
    last_note="$(grep -F '🔒 checked out' <<<"$notes" | tail -n 1 || true)"
    if [[ "$last_note" == *"branch \`${BRANCH}\`"* ]]; then
      exit 0
    fi
    warn "note: issue #${ISSUE} is labelled '${WIP_LABEL}' but has no open PR yet."
    warn "      If another session claimed it, coordinate before pushing further."
  fi
fi

exit 0
