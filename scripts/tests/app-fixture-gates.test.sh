#!/usr/bin/env bash
# scripts/tests/app-fixture-gates.test.sh — run the application-aware gates
# against a realistic application tree, not against Blueprint's own.
#
# ## Why this exists
#
# Blueprint's `backend/`, `frontend/` and `tests/` are placeholder stubs, so
# every gate that reasons about application code — OpenAPI/TypeScript parity,
# real-time event reachability, migration numbering, added-file coverage — has
# only ever run on this repository, where there is no application to find.
# Each gate's own --self-test synthesizes the smallest input that exercises
# its decision path; that proves the gate can say no, not that it reads the
# shapes a real project produces. The first adopter would have been the first
# real exercise of half the suite.
#
# The fixture is a small Django/DRF-and-React-shaped application, written in
# the shapes real tooling emits (a drf-spectacular OpenAPI 3.0 document, a
# coverage.py Cobertura report, a vitest v8 Cobertura report, Django
# migrations, a Channels routing file). It is GENERATED into a temp directory
# at run time by scripts/tests/lib/app-fixture.sh, never committed: Blueprint
# is stack-agnostic and every project starts as a clone of this tree, so a
# committed concrete app would ship into every downstream repo. Nothing in it
# is installed or executed; the gates parse it statically. Its first run found
# three gate bugs
# (a crash on drf-spectacular's NullEnum, `extends` dropping inherited fields,
# and squashed migrations reported as collisions) and one default pattern that
# could not see a two-argument group helper.
#
# ## Shape of each case
#
# Every gate gets the fixture as-is (it must PASS, with its own OK line) and at
# least one seeded violation (it must FAIL with exit 1 and name the violation).
# A mutation that does not apply is itself a failure — `replace_once` refuses
# when the text it was told to change is absent, so a fixture edit cannot turn a
# negative control into a silent copy of the good case.
#
# Demanding exit 1 exactly, not "non-zero", is deliberate: an uncaught Python
# exception also exits 1, which is why the verdict substring is asserted too.
# The NullEnum crash above exited 1 on a CLEAN fixture.
#
# ## Usage
#
#   bash scripts/tests/app-fixture-gates.test.sh
#
# Needs bash, git, python3 and node. Touches nothing outside a temp directory.

# File-wide, both deliberate and pervasive:
#   SC2016 — the expected verdicts quote event/field names in literal backticks.
#   SC2329 — parity/ws/mig/cov are invoked indirectly, as `expect`'s command.
# shellcheck disable=SC2016,SC2329

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

# fresh_copy <name> — a private copy of the fixture tree, echoes its path.
fresh_copy() {
  local dir="$TMP/$1"
  mkdir -p "$dir"
  cp -R "$FIX/." "$dir/"
  echo "$dir"
}

# ─── serializer-ts-parity ────────────────────────────────────────────────────

# shellcheck disable=SC2317  # invoked indirectly: `expect ... parity "$dir"`
# calls it via `"$@"`, which shellcheck's reachability analysis can't trace —
# a version drift, not a real dead-code finding (0.9.0 on the CI image flags
# it, 0.11.0 locally does not).
parity() { # <fixture-root>
  python3 "$ROOT/scripts/check-serializer-ts-parity.py" \
    --schema "$1/docs/api/openapi.json" --types "$1/frontend/src/types/index.ts"
}

echo "=== serializer-ts-parity ==="
expect "parity: fixture passes (NullEnum field, extends, nested, pagination)" 0 \
  "parity holds across 4 mapped pair(s)" parity "$FIX"

d="$(fresh_copy parity-type)"
replace_once "$d/frontend/src/types/index.ts" "readonly server_version: number;" "readonly server_version: string;"
expect "parity: number field typed as string is rejected" 1 \
  "schema says number; TypeScript says string" parity "$d"

d="$(fresh_copy parity-enum)"
replace_once "$d/frontend/src/types/index.ts" '"todo" | "in_progress" | "done"' '"todo" | "in_progress"'
expect "parity: enum member missing from a TS union alias is rejected" 1 \
  "schema allows done|in_progress|todo; TypeScript allows in_progress|todo" parity "$d"

d="$(fresh_copy parity-nullenum)"
replace_once "$d/frontend/src/types/index.ts" "priority: Priority | null;" "priority: Priority;"
expect "parity: NullEnum-nullable choice field typed non-null is rejected" 1 \
  "Task.priority" parity "$d"

d="$(fresh_copy parity-extends)"
replace_once "$d/frontend/src/types/index.ts" "  watchers: User[];"$'\n' ""
expect "parity: field missing from an extending interface is the ONLY finding" 1 \
  "PARITY DRIFT — 1 finding(s):
  TaskDetail.watchers" parity "$d"

d="$(fresh_copy parity-schema-added)"
replace_once "$d/docs/api/openapi.json" '"Task": {'$'\n''        "type": "object",'$'\n''        "properties": {' \
  '"Task": {"type": "object", "properties": {"archived_at": {"type": "string", "format": "date-time", "nullable": true},'
expect "parity: serializer field added without a TS field is rejected" 1 \
  'schema sends `archived_at`' parity "$d"

# ─── ws-event-reachability ───────────────────────────────────────────────────

# shellcheck disable=SC2317  # invoked indirectly via `expect ... ws "$dir"`;
# see the identical note above `parity()`.
ws() { # <fixture-root>
  python3 "$ROOT/scripts/check-ws-event-reachability.py" \
    --source-dir "$1/backend" --routing-file "$1/backend/routing.py" --doc-file "$1/docs/websockets.md" \
    --unreachable-class-pattern '"program"' --route-exists-pattern 'ws/programs/'
}

PROGRAM_ROUTE='    re_path(r"^ws/programs/(?P<program_id>[0-9a-f-]+)/$", ProgramConsumer.as_asgi()),'

echo "=== ws-event-reachability ==="
expect "ws: fixture passes (multi-line, lambda-wrapped, two-arg group helper)" 0 \
  "3 broadcast call site(s) scanned, 1 restricted-class event(s), route exists: False" ws "$FIX"

d="$(fresh_copy ws-unmarked)"
replace_once "$d/docs/websockets.md" "| not deliverable (no program route) |" "| |"
expect "ws: undeliverable event listed without the marker is rejected" 1 \
  'lists `program_rollup_changed` with no "not deliverable" marker' ws "$d"

d="$(fresh_copy ws-stale-marker)"
replace_once "$d/backend/routing.py" "ProjectConsumer.as_asgi()),"$'\n' "ProjectConsumer.as_asgi()),"$'\n'"$PROGRAM_ROUTE"$'\n'
expect "ws: marker left on after the route ships is rejected" 1 \
  'still marks `program_rollup_changed` "not deliverable"' ws "$d"

# ─── migration-numbering ─────────────────────────────────────────────────────

# mig_repo <name> — a git repo whose main holds the fixture backend; echoes path.
mig_repo() {
  local dir="$TMP/$1"
  mkdir -p "$dir"
  (
    cd "$dir" || exit 1
    git init --quiet -b main .
    git config user.email fixture@example.com && git config user.name fixture
    cp -R "$FIX/backend" .
    git add -A && git commit --quiet -m "main: fixture backend"
  ) >/dev/null || { echo "FATAL: could not build $dir" >&2; exit 2; }
  echo "$dir"
}

# on_branch <repo> <branch> <file-under-migrations> — commit one new migration.
on_branch() {
  (
    cd "$1" || exit 1
    git checkout --quiet -B "$2"
    echo "# $3" > "backend/tasks/migrations/$3"
    git add -A && git commit --quiet -m "$2: $3"
  ) >/dev/null || { echo "FATAL: could not commit $3 on $2" >&2; exit 2; }
}

# shellcheck disable=SC2317  # invoked indirectly via `expect ... mig "$r"`;
# see the identical note above `parity()`.
mig() { (cd "$1" && bash "$ROOT/scripts/check-migration-numbering.sh" --target-ref main --no-fetch); }

echo "=== migration-numbering ==="
r="$(mig_repo mig-next)"; on_branch "$r" feature 0003_task_estimate.py
expect "migrations: next free number passes" 0 "OK — no migration-number collisions" mig "$r"

r="$(mig_repo mig-squash)"; on_branch "$r" feature 0001_squashed_0002_task_priority.py
expect "migrations: a squashmigrations output beside its originals passes" 0 \
  "OK — no migration-number collisions" mig "$r"

r="$(mig_repo mig-collide)"
on_branch "$r" sibling 0003_task_watchers.py
(cd "$r" && git checkout --quiet main && git merge --quiet --ff-only sibling) >/dev/null
(cd "$r" && git checkout --quiet -b feature HEAD~1) >/dev/null
on_branch "$r" feature 0003_task_estimate.py
expect "migrations: two branches claiming 0003 is rejected" 1 \
  "Both claim migration number 0003 in backend/tasks/migrations" mig "$r"

# ─── added-files-covered ─────────────────────────────────────────────────────

# cov_repo <name> — main holds only the tooling config; the feature branch adds
# the whole application, as a first feature MR would. Coverage reports are
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

# shellcheck disable=SC2317  # invoked indirectly via `expect ... cov "$r"`;
# see the identical note above `parity()`.
cov() { (cd "$1" && node "$ROOT/scripts/check-added-files-covered.mjs" --target-ref main --no-fetch); }

echo "=== added-files-covered ==="
r="$(cov_repo cov-good)"
expect "coverage: every added file is in its report (tests/migrations/types omitted)" 0 \
  "OK — every added source file" cov "$r"

r="$(cov_repo cov-backend-missing)"
replace_once "$r/backend/coverage.xml" 'filename="tasks/events.py"' 'filename="tasks/events_renamed.py"'
expect "coverage: added backend module absent from coverage.py report is rejected" 1 \
  "new file has no coverage data at all: backend/tasks/events.py" cov "$r"

r="$(cov_repo cov-frontend-missing)"
(
  cd "$r" || exit 1
  printf 'export function TaskList() {\n  return null;\n}\n' > frontend/src/components/TaskList.tsx
  git add frontend/src/components/TaskList.tsx && git commit --quiet -m "feature: untested component"
) >/dev/null || { echo "FATAL: could not add TaskList.tsx" >&2; exit 2; }
expect "coverage: added component absent from vitest report is rejected" 1 \
  "new file has no coverage data at all: frontend/src/components/TaskList.tsx" cov "$r"

echo
if [ "$rc" -eq 0 ]; then
  echo "app-fixture-gates: all cases passed."
else
  echo "app-fixture-gates: FAILED." >&2
fi
exit "$rc"
