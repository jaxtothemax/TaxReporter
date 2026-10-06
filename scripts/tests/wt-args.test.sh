#!/usr/bin/env bash
# scripts/tests/wt-args.test.sh — the wt argument guard rejects what the
# subcommand parsers would otherwise swallow.
#
# Every cmd_* parser in scripts/wt ends by taking an unrecognised token as a
# branch name, issue, or needle. Without the guard, `wt new --help` creates a
# branch called `feat/help` and a worktree to go with it. These cases assert the
# guard runs BEFORE the parser, for every subcommand, and that it is not merely
# a special case for `--help`.
#
# Each case asserts on exit status and output only. Nothing here creates a
# worktree — that is the point: a case that reached cmd_new would.

set -uo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wt"
rc=0
pass() { echo "SELF-TEST OK: $1"; }
fail() { echo "SELF-TEST FAILED: $1" >&2; rc=1; }

# <label> <expected-exit> <expect-substring> <args...>
case_() {
  local label="$1" want_exit="$2" want_out="$3"; shift 3
  local out status
  out="$("$WT" "$@" 2>&1)"; status=$?
  if [ "$status" != "$want_exit" ]; then
    fail "$label — exit $status, wanted $want_exit (output: ${out%%$'\n'*})"; return
  fi
  case "$out" in
    *"$want_out"*) pass "$label" ;;
    *) fail "$label — output did not contain '$want_out' (got: ${out%%$'\n'*})" ;;
  esac
}

for sub in new claim release list remove prune stash doctor; do
  case_ "wt $sub --help prints usage and exits 0" 0 "usage: wt $sub" "$sub" --help
  case_ "wt $sub -h prints usage and exits 0"     0 "usage: wt $sub" "$sub" -h
done

# The case that matters more than --help: a typo'd flag must not become a
# positional. `--forse` reaching cmd_remove's parser would be read as a worktree
# name, and reaching cmd_new's would become a branch.
case_ "a typo'd flag is rejected, not taken as a name" 2 "unknown option: --forse" remove --forse
case_ "an undeclared flag on new is rejected"          2 "unknown option: --forse" new --forse
case_ "an undeclared flag on release is rejected"      2 "unknown option: --force" release --force

# A flag the subcommand DOES declare must survive the guard. This case fails if the
# flag table drifts from the parser it is supposed to mirror.
#
# It is phrased against a needle that matches nothing on purpose: the assertion is
# that the guard let --force through (so cmd_remove ran and reported the needle),
# not that the removal happened. No case in this file may have a side effect, and
# in particular none may reach `cmd_prune`, which fetches from origin.
case_ "a declared flag passes the guard" 1 "no worktree matches 'zzz-nonexistent'" \
  remove zzz-nonexistent --force

# `--` ends option parsing; a dashed token after it is data.
case_ "-- ends option parsing" 1 "no worktree matches" remove -- --literal-name

[ "$rc" -eq 0 ] && echo "wt-args: self-test passed."
exit "$rc"
