#!/usr/bin/env bash
# scripts/check-migration-numbering.sh — DB migration-number collisions that
# exist only on the MERGED tree.
#
# ## Why this exists
#
# Two branches cut from the same point on `main` can each generate a migration
# at the same next sequential number (both add `0042_...` in the same app's
# migrations directory). Each branch is green in isolation — the collision
# does not exist until both land, and most migration frameworks (Django's
# included) apply whichever one merges first without complaint. The second
# migration silently never runs, and nothing short of a runtime error on a
# column that was never added tells you.
#
# This is a direct consequence of a `scripts/wt`-style parallel-worktree
# workflow: two agents or two developers, each on their own worktree branched
# from the same `main`, each generating a migration independently. Blueprint
# already catches the *sibling* problem — two branches for the same tracked
# issue — with `check-issue-collision.sh`. Nothing catches this class, which
# is a numbering collision between otherwise-unrelated branches.
#
# ## What counts as a "migration"
#
# Stack-agnostic on purpose: rather than assuming a specific ORM's directory
# layout (Django's `<app>/migrations/NNNN_name.py`), this scans the whole
# tracked tree for any file whose immediate parent directory is literally
# named `migrations` and whose basename starts with a run of digits — that
# covers Django, and any other framework that follows the same
# numbered-file-per-migration convention (Rails-style timestamp migrations
# don't collide the same way and are out of scope). A repo with no directory
# named `migrations` anywhere has nothing to check and this script exits 0.
#
# ## Catches it on rebase, not only at merge
#
# The comparison is always against the CURRENT state of the target ref (by
# default `origin/main`, freshly fetched). Running this after rebasing your
# branch onto an updated `main` — which is exactly when a sibling branch's
# just-merged migration would collide with yours — is what makes this a
# rebase-time gate rather than a merge-time surprise. It is intentionally NOT
# a `pre-push-checks` mirror for the same reason `check-issue-collision.sh`
# runs first there: like that gate, its answer depends on the state of
# `origin`, not just the working tree, so `--no-fetch` exists for callers
# (this script's own --self-test, and CI jobs that already fetched) that want
# a hermetic run.
#
# ## Usage
#
#   scripts/check-migration-numbering.sh [--target-ref <ref>] [--no-fetch] [--self-test]
#
#   --target-ref <ref>  Git ref to compare against (default: origin/main, or
#                        origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME in CI).
#   --no-fetch           Skip the `git fetch` step (assumes the target ref is
#                        already up to date locally).
#   --self-test          Build a synthetic git repo in a temp directory, prove
#                        the check fires on a genuine collision and passes on
#                        a clean tree, then exit. Never touches the real repo.
#
# ## Exit codes
#
#   0  no collision (including "no migrations directory anywhere" — a clean
#      skip, not a pass on a technicality)
#   1  a migration-number collision was found

set -euo pipefail

TARGET_REF=""
NO_FETCH=0
SELF_TEST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --target-ref)
      TARGET_REF="$2"
      shift 2
      ;;
    --no-fetch)
      NO_FETCH=1
      shift
      ;;
    --self-test)
      SELF_TEST=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# A tracked path whose immediate parent directory is named "migrations" and
# whose basename starts with a run of digits, excluding __init__.py (Django's
# package marker, never a migration itself). Framework-agnostic: no assumed
# prefix like "backend/" or "packages/api/".
MIGRATION_PATH_RE='(^|/)migrations/[0-9][^/]*\.py$'

# Prints "<migrations-dir>/<file>" for every migration file tracked at git ref
# $1. `git ls-tree` pathspecs are literal/prefix matches, not wildmatch, so we
# list everything and filter with a regex instead.
list_migrations_at_ref() {
  local ref="$1"
  git ls-tree -r --name-only "$ref" 2>/dev/null \
    | grep -E "$MIGRATION_PATH_RE" \
    | grep -v '/__init__\.py$' || true
}

# Runs the actual collision check. Assumes the target ref is already fetched
# and reachable locally. Prints findings and returns 1 on collision.
run_check() {
  local target_ref="$1"

  local base
  base=$(git merge-base "$target_ref" HEAD 2>/dev/null || true)
  if [ -z "$base" ]; then
    echo "INFO — could not determine merge base with $target_ref; skipping migration-numbering check."
    return 0
  fi

  local new_files
  new_files=$(git diff --name-only --diff-filter=A "$base" HEAD \
    | grep -E "$MIGRATION_PATH_RE" \
    | grep -v '/__init__\.py$' || true)

  if [ -z "$new_files" ]; then
    echo "INFO — no new migration files on this branch (or no migrations/ directory in this repo); nothing to check."
    return 0
  fi

  local target_files
  target_files=$(list_migrations_at_ref "$target_ref")

  local found_collision=0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local migrations_dir base_name number
    migrations_dir=$(dirname "$f")
    base_name=$(basename "$f")
    number=$(echo "$base_name" | grep -oE '^[0-9]+' || true)
    if [ -z "$number" ]; then
      # Not a numbered migration — skip.
      continue
    fi
    # Django's `squashmigrations` writes `NNNN_squashed_MMMM_<name>.py` NEXT TO
    # the originals it replaces, so it shares its leading number with an
    # existing migration by design, not by collision. Reading it as one failed
    # every squash branch. Found by the app-fixture-gates suite.
    case "$base_name" in
      [0-9]*_squashed_*) continue ;;
    esac

    local match
    match=$(echo "$target_files" | grep -E "^${migrations_dir}/${number}_" || true)
    if [ -n "$match" ]; then
      while IFS= read -r m; do
        [ -z "$m" ] && continue
        if [ "$(basename "$m")" != "$base_name" ]; then
          echo "ERROR — migration number collision detected:"
          echo "  branch:      $f"
          echo "  $target_ref: $m"
          echo "  Both claim migration number $number in $migrations_dir. Renumber the" \
               "branch's migration to the next free number in that directory before merging."
          found_collision=1
        fi
      done <<< "$match"
    fi
  done <<< "$new_files"

  if [ "$found_collision" -eq 1 ]; then
    return 1
  fi

  echo "OK — no migration-number collisions against $target_ref."
  return 0
}

self_test() {
  local tmp
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064  # intentional early expansion — see check-nul-bytes.sh
  trap "rm -rf '$tmp'" EXIT

  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null

  echo "=== self-test: setting up synthetic repo in $tmp ==="
  git init --quiet -b main "$tmp"
  (
    cd "$tmp"
    git config user.email "self-test@example.com"
    git config user.name "self-test"

    mkdir -p app/testapp/migrations
    touch app/testapp/migrations/__init__.py
    echo "# initial" > app/testapp/migrations/0001_initial.py
    git add -A
    git commit --quiet -m "initial migration"

    # Branch A (simulates the feature branch under test): adds 0002_add_a.py
    git checkout --quiet -b branch-a main
    echo "# add a" > app/testapp/migrations/0002_add_a.py
    git add -A
    git commit --quiet -m "branch-a: add field a"

    # main moves on: a different branch merges first and lands 0002_add_b.py
    git checkout --quiet main
    echo "# add b" > app/testapp/migrations/0002_add_b.py
    git add -A
    git commit --quiet -m "main: add field b"

    echo "--- Case 1: expect COLLISION (both branch-a and main claim 0002) ---"
    git checkout --quiet branch-a
    if run_check main; then
      echo "SELF-TEST FAILED: expected a collision to be detected, but check passed." >&2
      exit 1
    else
      echo "Collision correctly detected."
    fi

    echo "--- Case 2: expect CLEAN (branch-c adds a non-colliding number) ---"
    git checkout --quiet -b branch-c main
    echo "# add c" > app/testapp/migrations/0003_add_c.py
    git add -A
    git commit --quiet -m "branch-c: add field c"
    if run_check main; then
      echo "Clean tree correctly passed."
    else
      echo "SELF-TEST FAILED: expected no collision, but check failed." >&2
      exit 1
    fi

    echo "--- Case 3: expect SKIP (repo has no migrations directory at all) ---"
    git checkout --quiet -b branch-d main
    rm -rf app
    mkdir -p src
    echo "print('hi')" > src/main.py
    git add -A
    git commit --quiet -m "branch-d: unrelated change, no migrations dir"
    out="$(run_check main)"
    if ! grep -q "nothing to check" <<< "$out"; then
      echo "SELF-TEST FAILED: expected a clean skip with no migrations dir, got:" >&2
      echo "$out" >&2
      exit 1
    else
      echo "No-migrations-directory tree correctly skipped."
    fi
  )

  echo "=== self-test: PASSED ==="
}

if [ "$SELF_TEST" -eq 1 ]; then
  self_test
  exit 0
fi

if [ -z "$TARGET_REF" ]; then
  BRANCH="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
  TARGET_REF="origin/${BRANCH}"
  if [ "$NO_FETCH" -eq 0 ]; then
    git fetch origin "$BRANCH" --depth=100
  fi
fi

run_check "$TARGET_REF"
