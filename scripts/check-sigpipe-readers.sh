#!/usr/bin/env bash
# scripts/check-sigpipe-readers.sh — no shell script may put an early-exit
# reader (`grep -q`, `grep -m`, `head`) on the far side of a pipe.
#
# ## Why
#
# Every script here runs under `set -o pipefail`. An early-exiting reader closes
# the pipe the moment it has what it wants; if the writer is still writing it
# takes SIGPIPE, the pipeline's status becomes 141, and a PRESENT match is
# reported as a failed one.
#
# It is a race on how much the writer has flushed, so it passes in every small
# local run and fails once, on a loaded runner or a grown input, with a message
# that names the wrong cause.
#
# Upstream this class red-flagged a repo twice before the third instance was
# found in `release.sh` — the script that gates immutable release tags:
#
#     git tag | grep -q "^${TAG}$" && die "tag exists"
#
# reads a spurious 141 as "tag not found" and lets the release proceed against a
# tag that already exists. Blueprint shipped that exact line.
#
# ## Why a walk, and not a list
#
# This replaces the two hand-fixed sites in `scripts/wt`, which carry comments
# explaining the class at the point it was understood. Fixing the sites you have
# already found is exactly how `release.sh` stayed outside the guard: a
# hand-listed scan covers the files that have already been bitten. This one
# walks every shell script under each root, so the next new script is covered
# without anyone remembering to add it.
#
# The fix at each site is a here-string — `grep -q PAT <<<"$(cmd)"` — or, for
# `head`, a reader that drains its input (`sed -n 1p`, `awk 'NR==1'`).
#
# ## Scope
#
# A file is scanned if it has a `.sh` extension or a bash/sh shebang, and git
# does not ignore it. Comment lines are skipped (a `#` earlier on the line), so
# the docstrings that explain this very pattern — here, and in the README — are
# not offenders. This file is in its own scan range.
#
# ## Deliberate exceptions
#
# A line whose input is provably tiny and bounded can carry an inline
# `# sigpipe-ok: <reason>` marker. The reason is REQUIRED — a bare marker is
# still an offender — so the exception is read by the next person instead of
# being a silent switch. Prefer converting the site.
#
# ## What this cannot see
#
# `sed q`, `awk … exit`, `read -r x < <(…)` and the like exit early too, and a
# pipe split across a `\` continuation is only caught on the line carrying the
# reader. `grep -q` and `head` are the forms that have actually recurred;
# widening this is cheap if another does.
#
# Usage:  scripts/check-sigpipe-readers.sh [ROOT ...]   # defaults to the roots below
#         scripts/check-sigpipe-readers.sh --self-test
# Exit:   0 no offenders · 1 at least one offender · 2 invocation error / nothing scanned

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/git-ignored.sh
. "$REPO_ROOT/scripts/lib/git-ignored.sh"

# Every tree in this repo that holds shell. `hooks/` and `.claude/hooks/` are in
# deliberately: a hook that misreads its own grep fails a commit for the wrong
# reason, and hook output is the output nobody reads closely.
DEFAULT_ROOTS=(scripts hooks .claude/hooks)

# `(^|[^|])` and the absence of a following `|` keep `a || head` (an OR-list,
# not a pipe) out. `[^#]*` before the pipe skips comment lines.
OFFENDER_RE='^([^#]*[^|#])?\|[[:space:]]*(grep[[:space:]]+(-[A-Za-z-]+[[:space:]]+)*(-[A-Za-z]*[qm][A-Za-z0-9]*|--quiet|--silent|--max-count)([[:space:]=]|$)|head([[:space:]]|$))'

# Files under ROOT that count as shell: .sh extension or a sh/bash shebang.
list_shell_files() { # <root>
  local f
  while IFS= read -r f; do
    is_ignored "$f" && continue
    case "$f" in
      *.sh) printf '%s\n' "$f" ;;
      *.py | *.txt | *.md | *.json | *.yml | *.yaml) ;;
      *)
        if grep -qE '^#!.*[[:space:]/](ba)?sh([[:space:]]|$)' <<<"$(sed -n 1p "$f" 2>/dev/null || true)"; then
          printf '%s\n' "$f"
        fi
        ;;
    esac
  done < <(find "$1" -type f | sort)
}

scan_root() { # <root> -> prints offenders, returns 0 clean / 1 offenders / 2 nothing scanned
  local root="$1" files f hits found=0 nfiles=0
  files="$(list_shell_files "$root")"
  [ -z "$files" ] && return 2
  while IFS= read -r f; do
    nfiles=$((nfiles + 1))
    # Drop lines carrying a `sigpipe-ok: <reason>` marker with a real reason.
    hits="$(grep -nE "$OFFENDER_RE" "$f" | grep -vE 'sigpipe-ok:[[:space:]]*[^[:space:]]' || true)"
    if [ -n "$hits" ]; then
      found=1
      printf '%s\n' "$hits" | sed "s|^|  $f:|" >&2
    fi
  done <<<"$files"
  SCANNED=$((SCANNED + nfiles))
  return "$found"
}

run_scan() { # <root...>
  local root found=0 scanned_any=0 rc
  SCANNED=0
  for root in "$@"; do
    [ -e "$root" ] || continue
    rc=0
    scan_root "$root" || rc=$?
    case "$rc" in
      0) scanned_any=1 ;;
      1)
        scanned_any=1
        found=1
        ;;
      2) ;; # root held no shell files — not an error on its own
    esac
  done

  if [ "$scanned_any" -eq 0 ]; then
    echo "check-sigpipe-readers: no shell scripts found under: $* — refusing to report a clean scan of nothing." >&2
    return 2
  fi

  if [ "$found" -eq 1 ]; then
    cat >&2 <<'MSG'

check-sigpipe-readers: FAIL — an early-exit reader (grep -q / grep -m / head) sits behind a pipe.
Under `set -o pipefail` it can SIGPIPE the writer and report a PRESENT match as missing.
Use a here-string:      grep -q PATTERN <<<"$(cmd)"        (or <<<"$var")
For `head`, drain:      … | sed -n 1p   or   awk 'NR==1'
A provably tiny, bounded input may carry an inline `# sigpipe-ok: <reason>` marker instead.
MSG
    return 1
  fi
  echo "check-sigpipe-readers: OK — $SCANNED shell scripts, no early-exit reader behind a pipe."
}

self_test() {
  local tmp rc=0 pipe='|'
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now, not at trap time
  trap "rm -rf '$tmp'" EXIT

  # Fixtures are assembled with printf so this file never contains the pattern
  # it polices — the gate is scanned by itself.
  probe() { # <name> <accept|reject> <root>
    local want got=0
    case "$2" in accept) want=0 ;; reject) want=1 ;; *)
      echo "SELF-TEST: bad expectation" >&2
      rc=1
      return
      ;;
    esac
    run_scan "$3" >/dev/null 2>&1 || got=$?
    if [ "$got" -eq "$want" ]; then
      echo "SELF-TEST OK: $1 — $2 (exit $got)."
    else
      echo "SELF-TEST FAILED: $1 — expected $2 (exit $want), got exit $got." >&2
      rc=1
    fi
  }
  fixture() { # <name> <file> <line>
    local d="$tmp/$1"
    mkdir -p "$d"
    printf '#!/usr/bin/env bash\nset -euo pipefail\n%s\n' "$3" >"$d/$2"
  }

  # shellcheck disable=SC2016  # $TAG is fixture text, not an expansion.
  fixture clean a.sh 'grep -qxF "$TAG" <<<"$(git tag)" && exit 1'
  probe "here-string reader" accept "$tmp/clean"

  fixture bad_q a.sh "git tag $pipe grep -qxF \"\$TAG\" && exit 1"
  probe "the release.sh tag guard (grep -qxF)" reject "$tmp/bad_q"

  fixture bad_q2 a.sh "echo \"\$x\" $pipe grep -q foo"
  probe "plain grep -q" reject "$tmp/bad_q2"

  fixture bad_qi a.sh "echo \"\$x\" $pipe grep -qi foo"
  probe "grep -qi" reject "$tmp/bad_qi"

  fixture bad_eq a.sh "echo \"\$x\" $pipe grep -Eq foo"
  probe "grep -Eq (q not first)" reject "$tmp/bad_eq"

  fixture bad_sep a.sh "echo \"\$x\" $pipe grep -E -q foo"
  probe "grep -E -q (separate flags)" reject "$tmp/bad_sep"

  fixture bad_m a.sh "echo \"\$x\" $pipe grep -m1 foo"
  probe "grep -m1 (also exits early)" reject "$tmp/bad_m"

  fixture bad_head a.sh "grep '^version' f $pipe head -1"
  probe "head -1" reject "$tmp/bad_head"

  fixture bad_headn a.sh "ls $pipe head -n 5"
  probe "head -n 5" reject "$tmp/bad_headn"

  fixture bad_bare a.sh "ls $pipe head"
  probe "bare head at end of line" reject "$tmp/bad_bare"

  mkdir -p "$tmp/bad_cont"
  printf '#!/usr/bin/env bash\nset -euo pipefail\nfoo \\\n  %s head -n1\n' "$pipe" >"$tmp/bad_cont/a.sh"
  probe "reader on a continuation line" reject "$tmp/bad_cont"

  mkdir -p "$tmp/bad_shebang"
  printf '#!/usr/bin/env bash\nset -euo pipefail\nls %s head -1\n' "$pipe" >"$tmp/bad_shebang/wt"
  probe "extensionless script found by its shebang" reject "$tmp/bad_shebang"

  fixture ok_comment a.sh "# uses \`x $pipe grep -q y\` in prose"
  probe "comment line" accept "$tmp/ok_comment"

  fixture ok_or a.sh "cmd || head -1 f"
  probe "OR-list, not a pipe" accept "$tmp/ok_or"

  fixture ok_sed a.sh "ls $pipe sed -n 1p"
  probe "draining reader (sed -n 1p)" accept "$tmp/ok_sed"

  fixture ok_grep_plain a.sh "ls $pipe grep foo"
  probe "grep without -q" accept "$tmp/ok_grep_plain"

  fixture ok_marker a.sh "echo hi $pipe grep -q hi # sigpipe-ok: one-word literal, far below PIPE_BUF"
  probe "sigpipe-ok marker with a reason" accept "$tmp/ok_marker"

  fixture bad_marker a.sh "echo hi $pipe grep -q hi # sigpipe-ok:"
  probe "sigpipe-ok marker with NO reason" reject "$tmp/bad_marker"

  mkdir -p "$tmp/ok_data"
  printf 'x %s grep -q y\n' "$pipe" >"$tmp/ok_data/notes.txt"
  printf '#!/usr/bin/env python3\nprint("x %s head")\n' "$pipe" >"$tmp/ok_data/tool.py"
  printf '#!/usr/bin/env bash\ntrue\n' >"$tmp/ok_data/a.sh"
  probe "non-shell files are not scanned" accept "$tmp/ok_data"

  # A root that exists but holds no shell, and a root that does not exist at
  # all, must both refuse to report a pass — this is the check that keeps the
  # gate from going quietly vacuous when a tree is renamed.
  mkdir -p "$tmp/empty"
  printf 'nothing\n' >"$tmp/empty/notes.txt"
  local empty_rc=0
  run_scan "$tmp/empty" >/dev/null 2>&1 || empty_rc=$?
  if [ "$empty_rc" -eq 2 ]; then
    echo "SELF-TEST OK: a root with no shell exits 2 (never a vacuous pass)."
  else
    echo "SELF-TEST FAILED: empty root expected exit 2, got $empty_rc." >&2
    rc=1
  fi

  local missing_rc=0
  run_scan "$tmp/does-not-exist" >/dev/null 2>&1 || missing_rc=$?
  if [ "$missing_rc" -eq 2 ]; then
    echo "SELF-TEST OK: a missing root exits 2 (a renamed tree cannot pass silently)."
  else
    echo "SELF-TEST FAILED: missing root expected exit 2, got $missing_rc." >&2
    rc=1
  fi

  # Multi-root: one clean root and one offending root must still fail. A loop
  # that returned on its first clean root would pass this repo forever.
  local multi_rc=0
  run_scan "$tmp/clean" "$tmp/bad_q" >/dev/null 2>&1 || multi_rc=$?
  if [ "$multi_rc" -eq 1 ]; then
    echo "SELF-TEST OK: an offender in the second of two roots still fails."
  else
    echo "SELF-TEST FAILED: multi-root scan expected exit 1, got $multi_rc." >&2
    rc=1
  fi

  return $rc
}

main() {
  case "${1:-}" in
    --self-test) self_test ;;
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d' ;;
    *)
      if [ "$#" -gt 0 ]; then
        run_scan "$@"
      else
        cd "$REPO_ROOT"
        run_scan "${DEFAULT_ROOTS[@]}"
      fi
      ;;
  esac
}

main "$@"
