#!/usr/bin/env bash
# scripts/tests/wt-ports.test.sh — every worktree gets its own E2E server ports.
#
# Playwright's `reuseExistingServer` identifies "an existing server" by PORT ALONE.
# With one hardcoded port, every worktree on the machine shares one preview server,
# and a local E2E run silently asserts against whichever checkout started it —
# including in the direction that PASSES. `wt new` therefore exports a per-worktree
# pair into `.envrc`, derived from the worktree slug and probed forward past ports a
# sibling already claims.
#
# The probe is the part worth testing. A bare hash over the band is a birthday
# problem (~26% chance of some collision at 25 worktrees over 800 slots), so the case
# below deliberately picks two slugs whose hash ALONE lands on the same port, and
# asserts that precondition — otherwise the test would pass with the probe deleted.

set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # <label> <0 = pass>
  if [[ "$2" -eq 0 ]]; then echo "SELF-TEST OK: $1"
  else echo "SELF-TEST FAILED: $1" >&2; fail=1; fi
}

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
# A two-slot band far from anything a developer runs, so a collision is forced.
export WT_BASE="$TMP/wts" WT_PREVIEW_PORT_BASE=47310 WT_DEV_PORT_BASE=48310 WT_PORT_SPAN=2

D="$TMP/repo"
mkdir -p "$D"
( cd "$D"
  git init -q -b main
  git config user.email t@example.com
  git config user.name t
  echo base > README.md
  git add -A
  git commit -qm init
  git init -q --bare "$TMP/origin.git"
  git remote add origin "$TMP/origin.git"
  git push -q origin main
  git fetch -q origin
)

offset() { printf '%s' "$1" | cksum | awk -v s="$WT_PORT_SPAN" '{print $1 % s}'; }
envport() { awk -F= -v k="$2" '$0 ~ ("^export " k "=") { print $2; exit }' "$WT_BASE/$1/.envrc"; }
new_wt() { ( cd "$D" && bash "$WT" new "feat/$1" ) >/dev/null 2>&1; }

A="ports-a"
A_OFF="$(offset "$A")"
B=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if [[ "$(offset "ports-b$i")" == "$A_OFF" ]]; then B="ports-b$i"; break; fi
done
check "precondition: two slugs whose hash alone lands on the same port" "$([[ -n "$B" ]] && echo 0 || echo 1)"

new_wt "$A"
new_wt "$B"
PA="$(envport "$A" WT_E2E_PORT)"
PB="$(envport "$B" WT_E2E_PORT)"
DA="$(envport "$A" WT_E2E_DEV_PORT)"

check ".envrc exports WT_E2E_PORT for each worktree" "$([[ -n "$PA" && -n "$PB" ]] && echo 0 || echo 1)"
check "a free slug port is used as-is" "$([[ "$PA" == "$((WT_PREVIEW_PORT_BASE + A_OFF))" ]] && echo 0 || echo 1)"
check "a port a sibling already claims is probed past" "$([[ -n "$PA" && "$PA" != "$PB" ]] && echo 0 || echo 1)"
check "preview and dev ports share one offset" "$([[ -n "$DA" && $((DA - WT_DEV_PORT_BASE)) -eq $((PA - WT_PREVIEW_PORT_BASE)) ]] && echo 0 || echo 1)"

( cd "$D" && bash "$WT" remove "$A" ) >/dev/null 2>&1
new_wt "$A"
check "recreating a worktree gives it the same port" "$([[ -n "$PA" && "$(envport "$A" WT_E2E_PORT)" == "$PA" ]] && echo 0 || echo 1)"

[[ "$fail" -eq 0 ]] && echo "wt-ports: all cases passed."
exit "$fail"
