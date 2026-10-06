#!/usr/bin/env bash
# Block a push that would open a second merge request for an issue someone else
# is already working.
#
# Why this exists
# ---------------
# `wt new <issue>` refuses an issue that another worktree has already claimed.
# That guard is bypassed completely by a plain `git checkout -b feat/<issue>-…`,
# which is exactly how duplicate work happens: two sessions pick the same issue,
# neither sees the other, and the collision is only discovered when the second
# merge request appears against an issue that already has one.
#
# `git push` is the one chokepoint every branch passes through regardless of how
# it was created. Re-checking the claim here catches the duplicate before it can
# become a second MR — the cheapest possible moment to find out.
#
# Behavior
# --------
#   BLOCK  the issue already has an open MR from a *different* branch. This is
#          the strong, authoritative signal: someone has already published work.
#          Override with ALLOW_DUP_MR=1 for legitimate stacked or
#          multiple-MR-per-issue work.
#   WARN   the issue carries the work-in-progress label but has no MR yet. A
#          claim without published work is weaker evidence — it may be a stale
#          label — so this informs rather than blocks. Silent when the issue's
#          latest `wt` check-out comment names THIS branch: that is the claimant
#          pushing its own work, not a collision.
#   PASS   the branch carries no issue number, or the issue is unclaimed.
#
# Wire into the pre-push gate so it runs before the slower code checks:
#   pre-push-checks: ; scripts/check-issue-collision.sh && <lint/typecheck/…>
#
# Configure:
#   WIP_LABEL        label that marks a claimed issue   (default status::wip)
#   ALLOW_DUP_MR=1   allow a second MR for the issue    (stacked-MR escape hatch)
#   COLLISION_MR_LIST  self-test and dry-run only: a command that prints the
#                      open-MR payload instead of calling the forge. Setting it
#                      also lifts the `command -v <cli>` requirement, since the
#                      payload no longer comes from the CLI, and skips the
#                      weak-signal label lookup, which has no fixture.
set -euo pipefail

# ─── Reading the open-MR list ────────────────────────────────────────────────
#
# Use each CLI's structured output, never the human-readable table: glab renders
# the source branch parenthesized ("(main) ← (feat/123-thing)"), so scraping it
# with a whitespace-anchored regex silently matches nothing and the gate passes
# when it should block. A gate that fails open is worse than no gate.
#
# PAGINATE. `glab mr list --per-page 100` and `gh pr list --limit 100` are not
# "the open MRs", they are the FIRST HUNDRED of them — and the gate's own
# failure mode is a clean pass, so a project that crosses that line loses the
# duplicate check with no signal anywhere that it happened. `glab api
# --paginate` emits one JSON array PER PAGE, concatenated, which plain
# `json.load` rejects; `read_source_branches` below decodes the stream with
# `raw_decode` instead. The same reader takes GitHub's shape (`head.ref`,
# already merged into one array by `gh api --paginate`), so both CLIs run the
# one decision path the self-test exercises.
mr_payload() {
  if [ -n "${COLLISION_MR_LIST:-}" ]; then
    $COLLISION_MR_LIST
    return
  fi
  case "$CLI" in
    glab) glab api --paginate "projects/:id/merge_requests?state=opened&per_page=100" 2>/dev/null ;;
    gh)   gh   api --paginate "repos/:owner/:repo/pulls?state=open&per_page=100"      2>/dev/null ;;
  esac
}

# Reads the payload on stdin, prints one source-branch name per line.
# Exit 3 means the payload was not JSON — the caller reports that rather than
# treating it as "no open MRs", which is how a parse error becomes a silent pass.
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

for mr in pages:
    if not isinstance(mr, dict):
        continue
    head = mr.get("head") if isinstance(mr.get("head"), dict) else {}
    branch = mr.get("source_branch") or head.get("ref") or ""
    if branch:
        print(branch)
'
}

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# Runs the real script end to end in a throwaway repo — branch parsing, CLI
# selection, the reader, and the block/pass decision — with the forge call
# replaced by a fixture. The case that matters is a collision on page TWO: the
# single-page read this replaced passed it, cleanly, forever.
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
    git remote add origin git@gitlab.com:example/project.git
  )

  # One page, one unrelated MR: nothing to block on.
  cat > "$tmp/fx/clean.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"source_branch":"feat/999-other"}]'
EOF
  # TWO pages, concatenated exactly as `glab api --paginate` emits them, with
  # the collision on the second. This is the regression.
  cat > "$tmp/fx/page-two.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"source_branch":"feat/999-other"}]'
echo '[{"source_branch":"fix/123-someone-elses"}]'
EOF
  # Our own branch is expected — an updated MR must never block its own push.
  cat > "$tmp/fx/only-mine.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"source_branch":"feat/123-mine"}]'
EOF
  # GitHub's shape, already merged into one array by `gh api --paginate`.
  cat > "$tmp/fx/github.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"head":{"ref":"feat/999-other"}},{"head":{"ref":"chore/123-theirs"}}]'
EOF
  # An unreachable or broken oracle must SAY so, not read as "no open MRs".
  cat > "$tmp/fx/garbage.sh" <<'EOF'
#!/usr/bin/env bash
echo '<html>401 Unauthorized</html>'
EOF
  # Whitespace-only output (no MRs, or a CLI that prints a blank line and
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
printf '[{"source_branch":"feat/999-other","description":"%s"},{"source_branch":"fix/123-someone-elses"}]\n' "$filler"
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

  st_case "an unrelated issue's MR does not block"              0 clean.sh
  st_case "a collision on page TWO of the payload blocks"       1 page-two.sh "fix/123-someone-elses"
  st_case "our own branch's MR does not block its own push"     0 only-mine.sh
  st_case "GitHub's head.ref shape blocks the same way"         1 github.sh "chore/123-theirs"
  st_case "an unparseable payload warns instead of passing"     0 garbage.sh "could not be read"
  st_case "whitespace-only output degrades like empty output"   0 blank.sh "could not be read"
  st_case "a multi-KB field still resolves the collision"       1 large-payload.sh "fix/123-someone-elses"

  ALLOW_DUP_MR=1 st_case "ALLOW_DUP_MR=1 downgrades a block to a warning" 0 page-two.sh

  if [ "$rc" -eq 0 ]; then echo "SELF-TEST: all cases passed."; fi
  exit "$rc"
fi

cd "$(git rev-parse --show-toplevel)"

WIP_LABEL="${WIP_LABEL:-status::wip}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Extract the issue number from a branch named like feat/1234-short-description.
# No number → nothing to check; this is not an error.
ISSUE="$(printf '%s' "$BRANCH" | sed -nE 's@^[a-z]+/([0-9]+)-.*@\1@p')"
if [[ -z "$ISSUE" ]]; then
  exit 0
fi

# Pick the forge CLI from origin's host. Absent CLI is not a failure — the gate
# degrades to a no-op rather than blocking a push on a missing optional tool.
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
case "$ORIGIN_URL" in
  *gitlab*) CLI=glab ;;
  *github*) CLI=gh ;;
  *)        exit 0 ;;
esac
if [[ -z "${COLLISION_MR_LIST:-}" ]]; then
  command -v "$CLI" >/dev/null 2>&1 || exit 0
fi

say()  { printf '%s\n' "$*" >&2; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# --- Strong signal: an open MR for this issue from a different branch ---------
#
# Match the same issue-number prefix in the source branch name. A hit on our
# *own* branch is expected (an updated MR) and must not block.
payload="$(mr_payload || true)"
all_branches=""
# "Is the payload blank" used to be a bash ${payload//[[:space:]]/} global
# substitution. Bash's pattern-removal re-matches the glob across the whole
# remaining string at every hit, which is quadratic in payload size — and under
# a multibyte-aware locale (en_US.UTF-8) each character comparison is also
# locale-decoded, multiplying that cost further. Measured on this payload
# shape: 0.031s/0.144s (C/en_US.UTF-8) at 1KB, 3.76s/35.0s at 8KB — the curve,
# not just the locale gap, is the problem, since a paginated 100-MR page can
# run to hundreds of KB (#48). `tr -d` is a single linear pass with no such
# blowup at any size tested (~0.005s at 50KB in either locale), so it fixes
# the class rather than pinning one locale against a cost that still grows
# with input size.
if [[ -z "$(printf '%s' "$payload" | tr -d '[:space:]')" ]]; then
  # No output at all: the CLI errored (offline, unauthenticated, no access).
  # The gate degrades rather than blocking the push — but it says so, because a
  # silent degradation is indistinguishable from a clean pass.
  warn "note: the open merge request list could not be read — duplicate-MR check skipped."
elif ! all_branches="$(printf '%s' "$payload" | read_source_branches)"; then
  warn "note: the open merge request list could not be read (unparseable response)."
  warn "      duplicate-MR check skipped."
  all_branches=""
fi

other_branches="$(
  printf '%s\n' "$all_branches" \
    | { grep -E "^[a-z]+/${ISSUE}-" || true; } \
    | { grep -v "^${BRANCH}$" || true; } | sort -u
)"

if [[ -n "$other_branches" ]]; then
  if [[ "${ALLOW_DUP_MR:-}" == "1" ]]; then
    warn "collision: issue #${ISSUE} already has an open MR from:"
    while IFS= read -r b; do [[ -n "$b" ]] && warn "    $b"; done <<< "$other_branches"
    warn "ALLOW_DUP_MR=1 set — proceeding (stacked / multi-MR work)."
    exit 0
  fi
  fail ""
  fail "  Push blocked — issue #${ISSUE} already has an open merge request."
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
  labels=""
  case "$CLI" in
    glab) labels="$(glab issue view "$ISSUE" 2>/dev/null | sed -n 's/^labels:[[:space:]]*//p' || true)" ;;
    gh)   labels="$(gh issue view "$ISSUE" --json labels --jq '[.labels[].name] | join(", ")' 2>/dev/null || true)" ;;
  esac

  if [[ -n "$labels" && "$labels" == *"$WIP_LABEL"* ]]; then
    # `wt new` labels the issue itself and records this branch in its check-out
    # comment, so a push from that branch is the claimant, not a collision. Only a
    # label held by a DIFFERENT branch (or by hand, with no comment) is worth a warning.
    notes=""
    case "$CLI" in
      glab) notes="$(glab issue view "$ISSUE" --comments 2>/dev/null || true)" ;;
      gh)   notes="$(gh issue view "$ISSUE" --comments 2>/dev/null || true)" ;;
    esac
    # Only the LAST check-out note counts: after a forced takeover by another
    # branch, an earlier note naming this one must not silence the warning.
    # Assumes `--comments` prints oldest-first, and keys on wt's `🔒 checked out`
    # marker so an ordinary comment saying "checked out" is never mistaken for one.
    last_note="$(grep -F '🔒 checked out' <<<"$notes" | tail -n 1 || true)"
    if [[ "$last_note" == *"branch \`${BRANCH}\`"* ]]; then
      exit 0
    fi
    warn "note: issue #${ISSUE} is labelled '${WIP_LABEL}' but has no open MR yet."
    warn "      If another session claimed it, coordinate before pushing further."
  fi
fi

exit 0
