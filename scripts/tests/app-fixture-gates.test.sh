#!/usr/bin/env bash
# scripts/tests/app-fixture-gates.test.sh — run the application-aware gate
# (check-added-files-covered.mjs) against a realistic application tree, not
# against this repository's own.
#
# ## Why this exists
#
# Until the application lands, this repository has no added source files and
# no coverage reports, so check-added-files-covered skips on it: every layer
# has zero candidates or no report. Its own --self-test synthesizes the
# smallest input that exercises its decision path; that proves the gate can
# say no, not that it reads the shapes coverage.py and vitest actually emit.
# Without this runner, the first real feature PR would be the gate's first
# real exercise.
#
# The fixture is a small Python-and-TypeScript-shaped application, written in
# the shapes real tooling emits (a coverage.py Cobertura report, a vitest v8
# Cobertura report, a .coveragerc omit list, a vitest coverage.exclude list).
# It is GENERATED into a temp directory at run time by
# scripts/tests/lib/app-fixture.sh, never committed. Nothing in it is
# installed or executed; the gate parses it statically. Upstream (Blueprint
# #52) this runner's first run found three gate bugs its self-tests could not
# see.
#
# ## Shape of each case
#
# The gate gets the fixture as-is (it must PASS, with its own OK line) and
# seeded violations (it must FAIL with exit 1 and name the violation). A
# mutation that does not apply is itself a failure — `replace_once` refuses
# when the text it was told to change is absent, so a fixture edit cannot turn
# a negative control into a silent copy of the good case.
#
# Demanding exit 1 exactly, not "non-zero", is deliberate: a crash in the gate
# can also exit 1, which is why the verdict substring is asserted too.
#
# ## Usage
#
#   bash scripts/tests/app-fixture-gates.test.sh
#
# Needs bash, git, python3 and node. Touches nothing outside a temp directory.

# SC2329 — cov is invoked indirectly, as `expect`'s command.
# shellcheck disable=SC2329

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# mktemp -d lands in $TMPDIR, outside the working tree, so a run never leaves
# anything for git to see.
TMP="$(mktemp -d)"
# shellcheck disable=SC2064  # expand now: TMP is fixed for the life of the run
trap "rm -rf '$TMP'" EXIT

# shellcheck source=scripts/tests/lib/app-fixture.sh
. "$ROOT/scripts/tests/lib/app-fixture.sh"
FIX="$TMP/fixture"
generate_fixture "$FIX" || { echo "FATAL: could not generate the fixture" >&2; exit 2; }

# Hermetic git: no user config, no hooks, no signing.
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
# No repository but the fixture's. A git hook exports GIT_DIR and its kin to
# everything it runs, and pre-push runs this script: left set, every `git`
# below would commit on the branch being pushed and switch its worktree to
# the fixture's. Clear the variables git itself lists as local to a repo.
# shellcheck disable=SC2046  # one variable name per word, by design
unset $(git rev-parse --local-env-vars)

rc=0
pass() { echo "SELF-TEST OK: $1"; }
fail() { echo "SELF-TEST FAILED: $1" >&2; rc=1; }

# expect <label> <want-exit> <want-substring> <cmd...>
expect() {
  local label="$1" want_exit="$2" want_out="$3"; shift 3
  local out status
  out="$("$@" 2>&1)"; status=$?
  if [ "$status" != "$want_exit" ]; then
    fail "$label — exit $status, wanted $want_exit. Output:"
    printf '%s\n' "$out" >&2
    return
  fi
  case "$out" in
    *"$want_out"*) pass "$label" ;;
    *) fail "$label — exit $status as wanted, but output lacks '$want_out'. Output:"
       printf '%s\n' "$out" >&2 ;;
  esac
}

# replace_once <file> <old> <new> — exits the run if <old> is not in <file>.
replace_once() {
  python3 - "$1" "$2" "$3" <<'PY' || { echo "FATAL: mutation did not apply to $1" >&2; exit 2; }
import sys
path, old, new = sys.argv[1:4]
text = open(path, encoding="utf-8").read()
if text.count(old) != 1:
    sys.exit(f"expected exactly one occurrence of {old!r} in {path}, found {text.count(old)}")
open(path, "w", encoding="utf-8").write(text.replace(old, new))
PY
}

# ─── added-files-covered ─────────────────────────────────────────────────────

# cov_repo <name> — main holds only the tooling config; the feature branch adds
# the whole application, as a first feature PR would. Coverage reports are
# written after the commit (they are build output, never tracked). Uses the
# gate's SHIPPED default layers, so this also proves the defaults fit the
# `backend/` + `frontend/src/` layout they claim to.
cov_repo() {
  local dir="$TMP/$1"
  mkdir -p "$dir"
  (
    cd "$dir" || exit 1
    git init --quiet -b main .
    git config user.email fixture@example.com && git config user.name fixture
    mkdir -p backend frontend
    cp "$FIX/backend/.coveragerc" backend/
    cp "$FIX/frontend/vitest.config.ts" frontend/
    git add -A && git commit --quiet -m "main: tooling config"
    git checkout --quiet -b feature
    cp -R "$FIX/backend/." backend/
    cp -R "$FIX/frontend/." frontend/
    git add -A && git commit --quiet -m "feature: application"
    mkdir -p frontend/coverage
    cp "$FIX/reports/backend-coverage.xml" backend/coverage.xml
    cp "$FIX/reports/frontend-cobertura.xml" frontend/coverage/cobertura-coverage.xml
  ) >/dev/null || { echo "FATAL: could not build $dir" >&2; exit 2; }
  echo "$dir"
}

# shellcheck disable=SC2317  # invoked indirectly: `expect ... cov "$r"` calls
# it via `"$@"`, which shellcheck's reachability analysis can't trace — a
# version drift, not a real dead-code finding (0.9.0 on the CI image flags it,
# 0.11.0 locally does not).
cov() { (cd "$1" && node "$ROOT/scripts/check-added-files-covered.mjs" --target-ref main --no-fetch); }

echo "=== added-files-covered ==="
r="$(cov_repo cov-good)"
expect "coverage: every added file is in its report (tests/types omitted)" 0 \
  "OK — every added source file" cov "$r"

r="$(cov_repo cov-backend-missing)"
replace_once "$r/backend/coverage.xml" 'filename="app/parser.py"' 'filename="app/parser_renamed.py"'
expect "coverage: added backend module absent from coverage.py report is rejected" 1 \
  "new file has no coverage data at all: backend/app/parser.py" cov "$r"

r="$(cov_repo cov-frontend-missing)"
(
  cd "$r" || exit 1
  printf 'export function Upload() {\n  return null;\n}\n' > frontend/src/components/Upload.tsx
  git add frontend/src/components/Upload.tsx && git commit --quiet -m "feature: untested component"
) >/dev/null || { echo "FATAL: could not add Upload.tsx" >&2; exit 2; }
expect "coverage: added component absent from vitest report is rejected" 1 \
  "new file has no coverage data at all: frontend/src/components/Upload.tsx" cov "$r"

echo
if [ "$rc" -eq 0 ]; then
  echo "app-fixture-gates: all cases passed."
else
  echo "app-fixture-gates: FAILED." >&2
fi
exit "$rc"
