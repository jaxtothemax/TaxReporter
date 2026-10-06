# shellcheck shell=bash
#
# Shared "where do git hooks actually live?" resolver.
#
# Why this exists
# ---------------
# `$REPO_ROOT/.git/hooks` is only a real directory in the main checkout. Inside
# a `scripts/wt` worktree, `.git` is a FILE holding a `gitdir:` pointer at the
# main checkout's `.git/worktrees/<name>/` — so a literal `.git/hooks` path
# does not exist there even when hooks ARE installed, and every caller that
# assumed the literal path either errored (`scripts/setup-hooks.sh`, issue #49)
# or silently misreported hook state (`scripts/doctor.sh`, `scripts/customize.sh`).
#
# `git rev-parse --git-common-dir` gives the real, SHARED git dir from any
# worktree — installing there means one install serves the main checkout and
# every worktree, which is correct: hooks are repo-wide policy, not
# per-worktree state.
#
# The one subtlety: its output can be RELATIVE, and relative to the directory
# git was invoked in (the `-C` argument here), not to the caller's `$PWD`.
# Resolve against that same directory rather than assuming either "always
# absolute" or "relative to $PWD" — get either wrong and a caller elsewhere in
# the tree (a straight `cd` instead of `git -C`) silently resolves the wrong
# path again.
#
# Source this from any script that needs the hooks directory:
#
#     . "$(cd "$(dirname "$0")" && pwd)/lib/git-hooks-dir.sh"
#
# and call `git_hooks_dir <repo-root>`. It prints the resolved path on stdout
# and returns non-zero (printing nothing) if <repo-root> is not inside a git
# repository at all.

# Print the real hooks directory for the repo rooted at <repo-root>, resolving
# a relative `--git-common-dir` against <repo-root> itself.
git_hooks_dir() { # <repo-root>
  local repo_root="$1" common_dir
  common_dir="$(git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common_dir" in
    /*) : ;;
    *) common_dir="$repo_root/$common_dir" ;;
  esac
  printf '%s/hooks\n' "$common_dir"
}
