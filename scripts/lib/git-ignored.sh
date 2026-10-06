# shellcheck shell=bash
#
# Shared "is this path part of the repository?" predicate for file-scanning gates.
#
# Why this exists
# ---------------
# A gate that enumerates with `find` or `grep -r` and never consults git reads
# every ignored artifact inside its scan root as though it were committed. The
# result is a false RED, locally, on a file CI can never see — CI clones clean,
# so the identical gate passes there. That contradiction is the ONLY tell, and
# nothing in the failure output points at it: the gate names a real file with a
# real violation, and the developer goes looking for a bug in tracked code.
#
# The sharp cases are directories ignored on purpose — local audit output, agent
# scratch dirs, downloaded fixtures, generated reports. Whoever has files there
# is exactly the person the gate then blocks.
#
# Source this from any gate that scans the working tree:
#
#     . "$(cd "$(dirname "$0")" && pwd)/lib/git-ignored.sh"
#
# and then either guard a per-file loop with `is_ignored`, or pipe `grep -rn`
# output through `drop_ignored_lines`.

# True when git ignores <path>.
#
# False whenever the question cannot be asked: git absent (some jobs run on bare
# alpine), or the path outside any worktree (a gate's own mktemp self-test
# fixtures). Both leave the scan exactly as wide as it was, which is the safe
# direction, and is why CI behavior is unchanged — a clean clone has nothing
# ignored to skip. Answering "ignored" in those cases instead would pass every
# expect-fail fixture in every self-test and hollow out every gate at once,
# while looking green.
is_ignored() { # <path>
  command -v git >/dev/null 2>&1 || return 1
  git check-ignore -q -- "$1" 2>/dev/null
}

# Filter `path:...` lines on stdin (grep -rn / grep -rl output) down to those
# whose path is part of the repository. For gates that COUNT matches rather than
# loop over them, where there is no per-file loop to guard.
#
# One `git check-ignore --stdin` for the whole batch rather than one process per
# line: these gates run over thousands of matches and are budgeted in seconds.
# Same degradation contract as is_ignored — if git cannot answer, every line
# passes through unchanged.
drop_ignored_lines() {
  local input paths ignored
  input="$(cat)"
  [ -n "$input" ] || return 0

  if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s\n' "$input"
    return 0
  fi

  paths="$(printf '%s\n' "$input" | sed 's/:.*//' | sort -u)"
  ignored="$(printf '%s\n' "$paths" | git check-ignore --stdin 2>/dev/null || true)"

  if [ -z "$ignored" ]; then
    printf '%s\n' "$input"
    return 0
  fi

  # Match on the path prefix up to the first colon, not a substring anywhere in
  # the line — a grep hit whose *content* happens to contain an ignored path
  # must not be dropped.
  printf '%s\n' "$input" | while IFS= read -r line; do
    case "$line" in
      *:*) p="${line%%:*}" ;;
      *)   p="$line" ;;
    esac
    grep -qxF -- "$p" <<<"$ignored" || printf '%s\n' "$line"
  done
}
