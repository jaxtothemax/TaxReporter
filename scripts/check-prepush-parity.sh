#!/usr/bin/env bash
# Every CI gate script has a pre-push mirror, or a recorded reason it cannot.
#
# ## Why this exists
#
# `pre-push` mirrored eight bespoke CI gates. A ninth — of exactly that shape —
# was not among them, so the one gate policing a design-token ratchet was the
# one nobody could run before pushing. A breach passed `make pre-push` cleanly
# and failed the PR's CI run: precisely the round trip `pre-push` exists to
# prevent.
#
# It was not missed through carelessness. Two Make targets one character apart
# (`lint-web`, which ran it, and `web-lint`, which did not) meant the invocation
# EXISTED, sitting in a target `pre-push` never called. Nobody reading either
# target could see the hole.
#
# The real defect is that the mirror list was a HISTORICAL ACCRETION: each gate
# added by hand as it was written, with nothing asserting the list stayed
# complete. Fixing the one missing entry would leave that intact and the next
# gate would fall behind the same way. So this script DERIVES the CI set from
# the CI configuration (.github/workflows/*.yml) rather than restating it, and
# fails when a script appears there with neither a Makefile mirror nor an entry in
# OPT_OUT below.
#
# Discovery is a plain text match over the whole workflow file, comments
# included, on purpose: a script named anywhere in a workflow — a commented-out
# opt-in job, a `paths:` filter — is one uncomment away from running in CI, and
# over-matching here costs one Makefile line, while under-matching is the
# silent gap this script exists to close.
#
# ## Usage
#
#   bash scripts/check-prepush-parity.sh
#
# ## Exit codes
#
#   0  every CI gate script is mirrored or opted out
#   1  at least one is neither
#   2  no CI configuration found

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# This builds a throwaway repo where one CI-invoked script has no Makefile
# mirror, and asserts the gate rejects it — then adds the mirror and asserts it
# passes. Both directions, because a gate that always fails is as useless as one
# that always passes.
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  rc=0

  mkdir -p "$tmp/scripts"
  cp "${BASH_SOURCE[0]}" "$tmp/scripts/check-prepush-parity.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/scripts/check-example.sh"
  mkdir -p "$tmp/.github/workflows"
  printf 'name: ci\non: [pull_request]\njobs:\n  example-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash scripts/check-example.sh\n' \
    > "$tmp/.github/workflows/ci.yml"
  printf 'all:\n\t@true\n' > "$tmp/Makefile"

  if (cd "$tmp" && bash scripts/check-prepush-parity.sh >/dev/null 2>&1); then
    echo "SELF-TEST FAILED: an unmirrored CI gate script was accepted." >&2; rc=1
  else
    echo "SELF-TEST OK: an unmirrored CI gate script is rejected."
  fi

  printf 'check-example:\n\tbash scripts/check-example.sh\n' >> "$tmp/Makefile"
  if (cd "$tmp" && bash scripts/check-prepush-parity.sh >/dev/null 2>&1); then
    echo "SELF-TEST OK: a mirrored CI gate script is accepted."
  else
    echo "SELF-TEST FAILED: a mirrored CI gate script was rejected." >&2; rc=1
  fi

  [ "$rc" -eq 0 ] && echo "SELF-TEST: all cases passed."
  exit "$rc"
fi

MAKEFILE="Makefile"

# ─── Opt-outs ────────────────────────────────────────────────────────────────
#
# `pre-push` is a seconds-scale, offline, repo-only gate. Two things disqualify
# a check: it reads state OUTSIDE the working tree (so no commit can fix a
# failure, and a red would block an unrelated push), or it needs a build
# artifact pre-push does not produce.
#
# Both are RECORDED rather than assumed, because "this one is different" is
# exactly the reasoning that produced the gap in the first place. Keep the list
# short, and re-check an entry whenever its script changes.
#
# Format: one "basename<TAB>reason" per line.
#
# The OSV severity gate is the clearest legitimate case (#37): its oracle is the
# OSV.dev advisory database, reached only by running the osv-scanner binary over
# network — not the repository. Per scripts/CLAUDE.md's "a gate that cannot
# reach its oracle must go RED" corollary, that disqualifies it from pre-push:
# no commit can fix a lookup failure, and a red here would block an unrelated
# push. Its --self-test IS hermetic (synthetic JSON fixtures, no network) and is
# proven in its own CI job before the real scan — see .github/workflows/security.yml — but is
# deliberately not given its own Makefile line either, so this OPT_OUT stays
# the single place that explains the constraint instead of a text-match
# technicality doing it silently.
OPT_OUT="
ci-assert-artifacts.sh	runtime helper a publish job calls on the artifacts IT just built; there is nothing to assert before the job runs. Its behavior is proven by check-artifact-assertions.sh --self-test, which pre-push runs
check-pr-followups.sh	reads the PR description from the GitHub API, which does not exist before the push that opens the PR; run it by hand with --file <description.md>
osv-severity-gate.sh	oracle is the OSV.dev advisory database (network), not the repository — see scripts/CLAUDE.md 'a gate that cannot reach its oracle must go RED'
"

# ─── Discover the CI gate scripts ────────────────────────────────────────────

CI_FILES=()
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] && CI_FILES+=("$f")
done

if [ "${#CI_FILES[@]}" -eq 0 ]; then
  echo "ERROR: no CI configuration found (.github/workflows/*.yml)." >&2
  exit 2
fi

# Any scripts/*.sh, scripts/*.py, or scripts/*.mjs invoked from CI is a gate
# that a developer should be able to run before pushing. (.mjs added for #44's
# Node-based added-files-covered gate — the first non-sh/py gate script in
# this template.)
ci_scripts="$(grep -ohE 'scripts/[A-Za-z0-9_.-]+\.(sh|py|mjs)' "${CI_FILES[@]}" 2>/dev/null \
  | sed 's|scripts/||' | sort -u || true)"

if [ -z "$ci_scripts" ]; then
  echo "OK: CI invokes no scripts/ gates yet — nothing to mirror."
  exit 0
fi

# ─── Compare against the Makefile ────────────────────────────────────────────

missing=""
mirrored=0
optedout=0

for s in $ci_scripts; do
  [ -f "scripts/$s" ] || continue          # referenced but absent: a different bug

  if grep -qF "scripts/$s" "$MAKEFILE" 2>/dev/null; then
    mirrored=$((mirrored + 1))
    continue
  fi

  reason="$(printf '%s\n' "$OPT_OUT" | awk -F'\t' -v n="$s" '$1 == n {print $2}')"
  if [ -n "$reason" ]; then
    optedout=$((optedout + 1))
    continue
  fi

  missing="${missing}${s}"$'\n'
done

if [ -n "$missing" ]; then
  echo "PRE-PUSH PARITY GAP"
  echo ""
  echo "These scripts run in CI but are not reachable from the Makefile, so no"
  echo "developer can run them before pushing:"
  printf '%s' "$missing" | sed '/^$/d;s/^/  scripts\//'
  echo ""
  echo "Fix one of two ways:"
  echo "  1. Wire it into a Makefile target that pre-push-checks depends on."
  echo "  2. If it genuinely cannot run offline in seconds, add it to OPT_OUT in"
  echo "     $(basename "$0") WITH THE REASON. An unexplained entry is how the"
  echo "     list rotted the first time."
  exit 1
fi

echo "OK: ${mirrored} CI gate script(s) mirrored in ${MAKEFILE}, ${optedout} opted out with reasons."
