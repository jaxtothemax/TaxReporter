#!/usr/bin/env bash
# scripts/check-shellcheck.sh — every tracked shell script passes `shellcheck`
# at its default severity (error, warning, info, and style).
#
# ## Why this exists
#
# Every shell file this repo gates with (`scripts/**`) was clean at
# `warning` severity or above. The two files that were not —
# `hooks/pre-commit` and `hooks/pre-push` — were the ones no gate read, and
# they are the two that run on every contributor's machine. `shellcheck`
# would have flagged the bug on day one (SC3020, "In POSIX sh, `&>` is
# undefined", severity `warning`) — see issue #14. A repo whose product is
# shell gate scripts should not be the repo that does not lint its shell.
#
# ## Why this started at `--severity=warning`, not the default
#
# This gate opened with a backlog at the default (every severity, including
# `info` and `style`): two pre-existing `SC2015` (`info`) findings in
# `scripts/customize.sh` and `scripts/release-notes.sh`, neither touched by
# the change that added this gate, and neither visible locally — a version
# of the shellcheck binary newer than the CI image's Alpine 3.19 package
# (0.9.0) apparently changed what SC2015 reports at the same severity. Per
# the "stage a backlog by rule severity" rule: block at `error`/`warning`
# from day one (a clean tree today, since that class has none), and promote
# to the default severity in its own change once the info/style backlog is
# cleared — do not ship a new gate `allow_failure` to "be safe" instead.
#
# Issue #27 cleared that backlog: both `SC2015` findings were rewritten as
# explicit `if`/`then` (neither was a live if-then-else bug — both trailing
# `|| true`s exist to force a successful exit regardless of the left side,
# not to run a conditional "else" branch), and a full-repo scan at default
# severity — against both the local shellcheck and the CI image's Alpine
# 3.19 package (0.9.0) — came back with zero findings. This gate has run at
# the default severity, with no staged backlog, since #27.
#
# ## Scope
#
# `scripts/**`, `hooks/**`, `.claude/hooks/**` — the same roots
# check-sigpipe-readers.sh walks, for the same reason: hook output is the
# output nobody reads closely, so bugs there survive longest.
#
# Usage:  scripts/check-shellcheck.sh
#         scripts/check-shellcheck.sh --self-test
# Exit:   0 clean (or shellcheck unavailable) · 1 at least one finding at
#         default severity

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/git-ignored.sh
. "$REPO_ROOT/scripts/lib/git-ignored.sh"

DEFAULT_ROOTS=(scripts hooks .claude/hooks)

# Files under ROOT that count as shell: .sh extension or a sh/bash shebang.
# (Same predicate as check-sigpipe-readers.sh, kept independent on purpose —
# these two gates should not have to change in lockstep.)
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

run_check() { # <root...>
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "check-shellcheck: shellcheck not installed — skipping (install it: https://www.shellcheck.net)." >&2
    return 0
  fi

  local root files all_files=() nfiles=0
  for root in "$@"; do
    [ -e "$root" ] || continue
    files="$(list_shell_files "$root")"
    [ -z "$files" ] && continue
    while IFS= read -r f; do
      all_files+=("$f")
      nfiles=$((nfiles + 1))
    done <<<"$files"
  done

  if [ "$nfiles" -eq 0 ]; then
    echo "check-shellcheck: no shell scripts found under: $* — refusing to report a clean scan of nothing." >&2
    return 2
  fi

  if ! shellcheck -x "${all_files[@]}"; then
    echo "" >&2
    echo "check-shellcheck: FAIL — shellcheck found issues above. Fix them or, for a" >&2
    echo "specific line that is a deliberate exception, disable that one rule inline:" >&2
    echo "  # shellcheck disable=SCxxxx" >&2
    return 1
  fi
  echo "check-shellcheck: OK — $nfiles shell script(s), no shellcheck findings at default severity."
}

self_test() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  mkdir -p "$tmp/hooks"

  # A `#!/bin/sh` script using `&>` is exactly the class this gate exists to
  # catch (SC3020). Assembled with printf, not a heredoc containing the
  # literal bytes, so this file is never itself an offender.
  printf '#!/bin/sh\nif make -n lint &>/dev/null 2>&1; then\n  echo ok\nfi\n' > "$tmp/hooks/pre-commit"

  if (cd "$tmp" && shellcheck hooks/pre-commit >/dev/null 2>&1); then
    echo "SELF-TEST FAILED: a bashism in a #!/bin/sh file was accepted." >&2
    rc=1
  else
    echo "SELF-TEST OK: a bashism in a #!/bin/sh file is rejected."
  fi

  printf '#!/bin/sh\nif make -n lint >/dev/null 2>&1; then\n  echo ok\nfi\n' > "$tmp/hooks/pre-commit"
  if (cd "$tmp" && shellcheck hooks/pre-commit >/dev/null 2>&1); then
    echo "SELF-TEST OK: the fixed script is accepted."
  else
    echo "SELF-TEST FAILED: a clean script was rejected." >&2
    rc=1
  fi

  [ "$rc" -eq 0 ] && echo "SELF-TEST: all cases passed."
  exit "$rc"
}

if [ "${1:-}" = "--self-test" ]; then
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "check-shellcheck --self-test: shellcheck not installed — cannot self-test." >&2
    exit 2
  fi
  self_test
fi

cd "$REPO_ROOT"
run_check "${DEFAULT_ROOTS[@]}"
