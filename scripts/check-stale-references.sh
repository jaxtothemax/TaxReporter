#!/usr/bin/env bash
# Fail when a marker in the source outlives the issue it points at.
#
# Three rules:
#
#   1. `STUB` and `WIP` (colon-suffixed) fail unconditionally. They never ship.
#      Prose about this gate — here, in the README, in the Makefile — writes them
#      WITHOUT the colon on purpose. This file is in its own scan range, and every
#      doc that describes the gate would otherwise be reported as a violation. The
#      alternative, excluding `*.md` and config from the scan, would blind the gate
#      to real debt in exactly the files nobody re-reads.
#
#   2. `TODO(#N)` and `SUPPRESSED-UNTIL(#N)` must reference an OPEN issue in this
#      project. A reference to a CLOSED issue means the work landed and the
#      placeholder — or the test exclusion — stayed behind.
#
#   3. A bare `TODO` with no issue reference warns only. It is often legitimate
#      mid-branch.
#
# ## Why rule 2 is the one that matters
#
# A suppression's justification decays silently, on the day someone closes an
# unrelated issue, with no diff to review. A real audit found six accessibility
# rule exclusions citing a closed issue — one of them read "remove this last
# exclusion when #NNNN lands". It had landed. The gate suite was green partly by
# hiding failures that no open issue tracked, and nothing could have noticed.
#
# So this gate runs on merge requests (a newly added marker must name a real,
# open issue) AND on the default branch on a schedule — because the interesting
# case is not a diff event at all.
#
# ## The marker is opt-in on purpose
#
# It deliberately does not scan for a bare `#NNNN` near a suppression. Most such
# references are explanatory history ("#123 landed, so its exclusions were
# dropped"), which a bare-reference gate would flag on the day they became MOST
# accurate. A gate whose findings are mostly noise gets deleted, taking the real
# signal with it. `SUPPRESSED-UNTIL(#N)` means exactly one thing: this
# suppression should not outlive that issue.
#
# Not every suppression needs one. A permanent, reasoned exclusion (a verified
# false positive, a library quirk) is not waiting on anything — explain it in
# prose and leave it unmarked. The marker is for debt with an owner.
#
# ## Failing closed
#
# A gate that cannot reach its oracle must go RED, not silently skip. An issue
# lookup that fails (network, auth, a private tracker with no token) is a hard
# failure. `ALLOW_UNRESOLVED=1` is the explicit, reviewable escape hatch.
#
# ## Usage
#
#   bash scripts/check-stale-references.sh              # scan default roots
#   bash scripts/check-stale-references.sh path ...     # scan given paths
#   bash scripts/check-stale-references.sh --list [dir] # print markers, no network
#   bash scripts/check-stale-references.sh --self-test  # prove the gate still bites
#
# ## Exit codes
#
#   0  no violations (warnings may have been emitted)
#   1  a STUB:/WIP: marker, a reference to a closed issue, or an unresolved lookup
#   2  invocation error (no scan roots exist, no tracker configured)
#
# ## Configuration
#
#   FORGE               glab | gh   (default: auto-detect from the git remote)
#   ISSUE_REPO          owner/repo or GitLab path; default: inferred from remote
#   ALLOW_UNRESOLVED=1  downgrade an unresolvable lookup to a warning
#   SCAN_ROOTS          space-separated default roots (default: every tracked dir)
#   EXCLUDE_DIRS        extra --exclude-dir names

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/git-ignored.sh
. "${SCRIPT_DIR}/lib/git-ignored.sh"

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# A gate can only be trusted if it can still fail. This synthesizes a tree for
# each rule and asserts the gate rejects what it claims to reject — including
# the DISCOVERY half, which is the half that drifts silently. (A real instance:
# a CI image shipped BusyBox grep, which rejects --exclude-dir; the `|| true`
# swallowed the error and the gate reported "no markers found" on a tree
# carrying five of them, forever.)
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now, not at trap time
  trap "rm -rf '$tmp'" EXIT
  rc=0

  mkdir -p "$tmp/stub"
  printf 'def f():\n    # STUB: replace me\n    pass\n' > "$tmp/stub/bad.py"
  if bash "$0" "$tmp/stub" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a STUB: marker was accepted." >&2; rc=1
  else
    echo "SELF-TEST OK: STUB: marker rejected."
  fi

  mkdir -p "$tmp/marked"
  printf '// SUPPRESSED-UNTIL(#4242) verified still failing\n' > "$tmp/marked/a.ts"
  case "$(bash "$0" --list "$tmp/marked" 2>/dev/null || true)" in
    *'SUPPRESSED-UNTIL(#4242)'*) echo "SELF-TEST OK: a marker in the tree is discovered." ;;
    *) echo "SELF-TEST FAILED: discovery found nothing in a tree that carries a marker." >&2
       echo "                  The gate is BLIND — it would report OK on any tree." >&2; rc=1 ;;
  esac

  mkdir -p "$tmp/clean"
  printf 'nothing to see here\n' > "$tmp/clean/b.ts"
  case "$(bash "$0" --list "$tmp/clean" 2>/dev/null || true)" in
    *'no issue-referencing markers found'*) echo "SELF-TEST OK: a clean tree reports none." ;;
    *) echo "SELF-TEST FAILED: a clean tree did not report clean." >&2; rc=1 ;;
  esac

  # A closed-issue reference must fail, and an unresolvable lookup must fail
  # closed. Both drive the real decision path through a stubbed resolver.
  mkdir -p "$tmp/closed" "$tmp/bin"
  printf '# TODO(#1): references a closed issue in the stub\n' > "$tmp/closed/bad.py"
  cat > "$tmp/bin/issue-state" <<'STUBRESOLVER'
#!/usr/bin/env bash
[ "${MOCK_MODE:-}" = "fail" ] && exit 3
[ "$1" = "1" ] && { echo closed; exit 0; }
echo opened
STUBRESOLVER
  chmod +x "$tmp/bin/issue-state"

  if ISSUE_STATE_CMD="$tmp/bin/issue-state" bash "$0" "$tmp/closed" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a reference to a CLOSED issue was accepted." >&2; rc=1
  else
    echo "SELF-TEST OK: reference to a closed issue rejected."
  fi

  mkdir -p "$tmp/open"
  printf '# TODO(#2): references an open issue in the stub\n' > "$tmp/open/good.py"
  if ISSUE_STATE_CMD="$tmp/bin/issue-state" bash "$0" "$tmp/open" >/dev/null 2>&1; then
    echo "SELF-TEST OK: reference to an open issue accepted."
  else
    echo "SELF-TEST FAILED: a reference to an OPEN issue was rejected." >&2; rc=1
  fi

  if MOCK_MODE=fail ISSUE_STATE_CMD="$tmp/bin/issue-state" bash "$0" "$tmp/open" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: an unresolvable lookup did not fail the gate." >&2; rc=1
  else
    echo "SELF-TEST OK: an unresolvable lookup fails closed."
  fi

  [ "$rc" -eq 0 ] && echo "SELF-TEST: all cases passed."
  exit "$rc"
fi

# ─── Scan roots ──────────────────────────────────────────────────────────────

LIST_ONLY=""
if [ "${1:-}" = "--list" ]; then LIST_ONLY=1; shift; fi

if [ "$#" -gt 0 ]; then
  ROOTS=("$@")
else
  # shellcheck disable=SC2206  # word splitting is the intended interface here
  ROOTS=(${SCAN_ROOTS:-.})
fi

EXCLUDES=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv
          --exclude-dir=dist --exclude-dir=build --exclude-dir=target
          --exclude-dir=coverage --exclude-dir=vendor)
#
# changelog.d/ is deliberately NOT excluded. It was, and that exclusion is what
# let this gate red its own release: a fragment written months earlier carried a
# literal marker, invisible here, and the release assembled it into CHANGELOG.md
# and docs/releases/ — both of which ARE scanned. An excluded directory whose
# content is later copied into a scanned one does not avoid the violation, it
# defers it to the least convenient moment.
for d in ${EXCLUDE_DIRS:-}; do EXCLUDES+=("--exclude-dir=$d"); done

# BusyBox grep rejects --exclude-dir. Detect it here and say so, rather than
# letting a `|| true` turn an unsupported flag into a permanent clean report.
if ! echo x | grep --exclude-dir=nope -q x 2>/dev/null; then
  echo "ERROR: this grep does not support --exclude-dir (BusyBox?)." >&2
  echo "       Install GNU grep in the job image; a silent fallback would" >&2
  echo "       disarm this gate rather than degrade it." >&2
  exit 2
fi

scan() { # <pattern>
  grep -rnE "$1" "${ROOTS[@]}" "${EXCLUDES[@]}" 2>/dev/null | drop_ignored_lines || true
}

# This file documents the markers it hunts, so it must not report itself. Match
# on the path component, because grep prints `./scripts/x.sh` here and `$0` may
# be any of several spellings of the same file.
SELF_BASE="$(basename "$0")"
drop_self()  { grep -vE "(^|/)${SELF_BASE}:" || true; }
drop_blank() { grep -v '^[[:space:]]*$' || true; }

# ─── Rule 1: STUB: / WIP: never ship ─────────────────────────────────────────

if [ -z "$LIST_ONLY" ]; then
  stubs="$(scan '(^|[^A-Za-z])(STUB|WIP):' | drop_self | drop_blank)"
  if [ -n "$stubs" ]; then
    echo "BLOCKED: STUB:/WIP: markers never merge. Use TODO(#N) against an open issue."
    printf '%s\n' "$stubs" | sed 's/^/  /'
    exit 1
  fi
fi

# ─── Rules 2 and 3: issue-referencing markers ────────────────────────────────

markers="$(scan 'TODO\(#[0-9]+\)|SUPPRESSED-UNTIL\(#[0-9]+\)' | drop_self | drop_blank)"

if [ -z "$markers" ]; then
  echo "OK: no issue-referencing markers found."
  [ -n "$LIST_ONLY" ] && exit 0
else
  if [ -n "$LIST_ONLY" ]; then printf '%s\n' "$markers"; exit 0; fi
fi

bare="$(scan '(^|[^(#[:alnum:]])TODO([^(]|$)' | grep -vE 'TODO\(#' || true)"
if [ -n "$(printf '%s' "$bare")" ]; then
  count="$(printf '%s\n' "$bare" | grep -c . || true)"
  echo "WARNING: ${count} bare TODO(s) with no issue reference. Prefer TODO(#N)."
fi

[ -z "$markers" ] && exit 0

# ─── Resolve issue state ─────────────────────────────────────────────────────
#
# ISSUE_STATE_CMD lets the self-test drive the real decision path with a stub.
# Contract: called with an issue number, prints `opened` or `closed`, exits
# non-zero when it cannot answer.

resolve_forge() {
  local remote; remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in
    *gitlab*) echo glab ;;
    *github*) echo gh ;;
    *) command -v glab >/dev/null 2>&1 && echo glab || echo gh ;;
  esac
}

default_issue_state() { # <number> -> opened|closed
  local n="$1" forge="${FORGE:-$(resolve_forge)}"
  case "$forge" in
    glab)
      command -v glab >/dev/null 2>&1 || return 3
      glab issue view "$n" --output json ${ISSUE_REPO:+--repo "$ISSUE_REPO"} 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])' 2>/dev/null || return 3
      ;;
    gh)
      command -v gh >/dev/null 2>&1 || return 3
      local s
      s="$(gh issue view "$n" --json state ${ISSUE_REPO:+--repo "$ISSUE_REPO"} \
             -q .state 2>/dev/null)" || return 3
      [ "$s" = "OPEN" ] && echo opened || echo closed
      ;;
    *) return 3 ;;
  esac
}

issue_state() { # <number>
  if [ -n "${ISSUE_STATE_CMD:-}" ]; then "$ISSUE_STATE_CMD" "$1"; else default_issue_state "$1"; fi
}

numbers="$(printf '%s\n' "$markers" | grep -oE '\(#[0-9]+\)' | tr -d '(#)' | sort -un)"

stale=0
unresolved=0
for n in $numbers; do
  if ! state="$(issue_state "$n" 2>/dev/null)" || [ -z "$state" ]; then
    echo ""
    echo "UNRESOLVED: issue #${n} could not be read (network, auth, or missing)."
    printf '%s\n' "$markers" | grep -E "\(#${n}\)" | sed 's/^/  /'
    unresolved=$((unresolved + 1))
    continue
  fi
  if [ "$state" != "opened" ]; then
    echo ""
    echo "STALE REFERENCE: issue #${n} is ${state}."
    printf '%s\n' "$markers" | grep -E "\(#${n}\)" | sed 's/^/  /'
    stale=$((stale + 1))
  fi
done

if [ "$unresolved" -gt 0 ] && [ "${ALLOW_UNRESOLVED:-}" != "1" ]; then
  echo ""
  echo "A gate that cannot reach its oracle fails closed. Set ALLOW_UNRESOLVED=1"
  echo "only where issue-state resolution is genuinely unavailable."
  exit 1
fi

if [ "$stale" -gt 0 ]; then
  echo ""
  echo "${stale} marker group(s) outlived their issue."
  echo "Either the work is done — delete the marker and the code it guards —"
  echo "or the issue closed early: reopen it, or point the marker at its successor."
  exit 1
fi

echo "OK: every marker references an open issue."
