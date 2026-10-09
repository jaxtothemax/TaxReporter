#!/usr/bin/env bash
# scripts/tests/hook-env.test.sh — the fixture gate never touches the
# repository a hook runs it for.
#
# ## Why
#
# A git hook exports GIT_DIR (and GIT_WORK_TREE, GIT_INDEX_FILE, …) to every
# process it starts. app-fixture-gates.test.sh builds a scratch repository
# with `git init` and commits; with GIT_DIR inherited, those commands acted on
# the repository being pushed instead: they committed the fixture onto its
# checked-out branch, created a `feature` branch and switched the worktree to
# it. This runs the gate with GIT_DIR and GIT_WORK_TREE aimed at a sentinel
# repository, as pre-push would, and fails if the sentinel changed at all.
#
# Usage:  bash scripts/tests/hook-env.test.sh
# Exit:   0 the sentinel is untouched · 1 it changed · 2 setup failed
# Needs bash, git, python3 and node, as the gate does.

set -uo pipefail

# This test runs inside a hook too (pre-push): clear what the hook exported
# first, or the sentinel below would be made in the repository being pushed.
# shellcheck disable=SC2046  # one variable name per word, by design
unset $(git rev-parse --local-env-vars)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
# shellcheck disable=SC2064  # expand now: TMP is fixed for the life of the run
trap "rm -rf '$TMP'" EXIT

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null

SENTINEL="$TMP/sentinel"
mkdir -p "$SENTINEL" || exit 2
(
  cd "$SENTINEL" || exit 2
  git init --quiet -b main . &&
    git config user.email sentinel@example.com &&
    git config user.name sentinel &&
    printf 'sentinel\n' >README &&
    git add README &&
    git commit --quiet -m sentinel
) || { echo "FATAL: could not make the sentinel repository" >&2; exit 2; }

state() {
  git -C "$SENTINEL" for-each-ref --format='%(refname) %(objectname)'
  git -C "$SENTINEL" symbolic-ref HEAD
  git -C "$SENTINEL" status --porcelain
}
before="$(state)"

# As a hook would run it: the sentinel's GIT_DIR and work tree exported.
GIT_DIR="$SENTINEL/.git" GIT_WORK_TREE="$SENTINEL" \
  bash "$ROOT/scripts/tests/app-fixture-gates.test.sh" >/dev/null 2>&1

after="$(state)"
if [ "$before" != "$after" ]; then
  echo "SELF-TEST FAILED: the fixture gate changed the repository of the hook that ran it" >&2
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2
  exit 1
fi
echo "SELF-TEST OK: the fixture gate leaves the hook's repository untouched"
