#!/usr/bin/env bash
# scripts/check-compose-project-names.sh — every standalone Docker Compose file
# at the repo root pins its own, distinct top-level `name:`.
#
# ## Why this exists
#
# An unpinned Compose project name is derived from the CHECKOUT DIRECTORY, not
# from the file. Two consequences, both reachable just by following ordinary
# workflow:
#
#   1. Two compose files meant to run independently (a dev stack and a prod
#      stack, say, or two worktrees of the same repo) that both declare bare
#      volume names (`postgres_data`, `redis_data`, ...) resolve to the SAME
#      volume once both derive the same project name, and whichever stack
#      starts second inherits the first one's data and secrets.
#   2. Two compose files sharing service names (`db`, `api`, `web`, ...) in
#      the same project RECREATE each other's containers in place on `up`.
#
# A project that pins `name:` in every standalone compose file never hits
# either failure mode, no matter what directory it is checked out into.
#
# ## Scope: standalone vs. override
#
# "Standalone" means a file an operator runs on its own or explicitly
# combines with `-f`: `docker-compose.yml`, `docker-compose.prod.yml`,
# `compose.ci.yaml`, and so on — every discovered compose file EXCEPT the
# override ones below.
#
# "Override" means a file matching Compose's own auto-merge naming
# convention — `*.override.yml` / `*.override.yaml` (e.g.
# `docker-compose.override.yml`, `compose.override.yaml`) — which `docker
# compose up` merges into the base file automatically, with no `-f` needed.
# An override file must NOT declare `name:`: a second file's `name:` overrides
# the first, which would silently rename the very stack the override extends.
#
# A project with more than one non-override overlay (an observability
# add-on, a test-only compose file always combined with `-f a -f b`) should
# follow the same *.override.* convention, or this gate will — correctly —
# demand it pin its own distinct name, since nothing else in a compose file
# says "this one is never run alone."
#
# ## What this cannot see
#
# `COMPOSE_PROJECT_NAME` in the environment. Compose's precedence is `-p` >
# `COMPOSE_PROJECT_NAME` > `name:` > directory basename, so an exported
# variable defeats every pin here. If your project's dev workflow exports one
# (for parallel worktrees, say), document that alongside this gate rather than
# relying on it to catch a missing `name:`.
#
# ## Projects without Docker
#
# This repo ships no compose files of its own — it is a stack-agnostic
# template. A consuming project that never uncomments `ci/docker.yml` never
# runs this gate at all, and a project that does but genuinely has no compose
# files (image-only, Dockerfile + kaniko/buildx) gets a clean pass with
# nothing scanned, not a failure — see run_check below.
#
# Usage:  scripts/check-compose-project-names.sh [--self-test]
# Exit:   0 every standalone file pins a distinct name, or none exist · 1 otherwise

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Every compose file the Compose spec recognizes by convention, root-level
# only. Discovery is a glob, not a hand-maintained list — a project renaming
# or adding a stack file must not have to remember to register it here (the
# same "walk, not a list" reasoning as check-sigpipe-readers.sh).
COMPOSE_GLOB_PATTERNS=(
  'docker-compose.yml' 'docker-compose.yaml'
  'docker-compose.*.yml' 'docker-compose.*.yaml'
  'compose.yml' 'compose.yaml'
  'compose.*.yml' 'compose.*.yaml'
)

# True when `$1` (a basename) is Compose's own auto-merge override
# convention — the ONE naming pattern Compose itself treats as "never run
# alone."
is_override_file() {
  case "$1" in
    *.override.yml | *.override.yaml) return 0 ;;
    *) return 1 ;;
  esac
}

# Print every compose file at the root of worktree `$1`, one per line,
# de-duplicated (a file can match more than one glob pattern, e.g.
# `docker-compose.yml` matches both the literal and the `*.yml` wildcard
# pattern in some shells' glob expansion order).
list_compose_files() {
  local root="$1" pattern f
  (
    cd "$root"
    shopt -s nullglob
    for pattern in "${COMPOSE_GLOB_PATTERNS[@]}"; do
      for f in $pattern; do
        [ -f "$f" ] && printf '%s\n' "$f"
      done
    done
  ) | sort -u
}

# Print the value of the top-level `name:` key (empty if none). Not a YAML
# parse: the key must be at column 0, which is where Compose requires it.
project_name_of() {
  local file="$1"
  sed -n -e 's/^name:[[:space:]]*//p' "$file" \
    | sed -e 's/[[:space:]]*#.*$//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//" \
    | sed -n '1p'
}

run_check() {
  local root="$1" violations=0 scanned=0 overlays=0 f name seen=""
  local files
  files="$(list_compose_files "$root")"

  if [ -z "$files" ]; then
    echo "OK: no docker-compose/compose files found at the repository root — nothing to check."
    return 0
  fi

  while IFS= read -r f; do
    if is_override_file "$f"; then
      overlays=$((overlays + 1))
      name="$(project_name_of "$root/$f")"
      if [ -n "$name" ]; then
        printf '  %-28s override file declares name: %s — it would rename the stack it extends\n' "$f" "$name"
        violations=$((violations + 1))
      else
        printf '  %-28s override (no name: — correct)\n' "$f"
      fi
      continue
    fi

    scanned=$((scanned + 1))
    name="$(project_name_of "$root/$f")"
    if [ -z "$name" ]; then
      printf '  %-28s no top-level name: — project name falls back to the checkout directory\n' "$f"
      violations=$((violations + 1))
      continue
    fi
    if grep -qxF "$name" <<<"$seen"; then
      printf '  %-28s name %s is already used by another compose file\n' "$f" "$name"
      violations=$((violations + 1))
    fi
    seen+="$name"$'\n'
    printf '  %-28s name: %s\n' "$f" "$name"
  done <<<"$files"

  printf '\n  scanned %d standalone compose file(s), %d override file(s)\n' "$scanned" "$overlays"
  return $(( violations > 0 ? 1 : 0 ))
}

# --self-test: plant each violation in a throwaway fixture tree and assert the
# gate reports it. A gate observed only on a clean tree is indistinguishable
# from one that always passes. This repo ships no compose files of its own, so
# every fixture is synthesized here rather than copied from the tree.
self_test() {
  echo "self-test: nothing-to-scan, missing, duplicate and override names must all resolve correctly"
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand $tmp now, not at trap time — it is a
  # local that goes out of scope once self_test returns, and a single-quoted
  # trap would then fire against an unbound variable.
  trap "rm -rf '$tmp'" EXIT

  reset() {
    rm -rf "$tmp/repo"
    mkdir -p "$tmp/repo"
    printf 'name: myapp-dev\nservices:\n  api: {}\n' > "$tmp/repo/docker-compose.yml"
    printf 'name: myapp\nservices:\n  api: {}\n' > "$tmp/repo/docker-compose.prod.yml"
  }

  # Case 1: no compose files at all — must pass, not error. This is the
  # template repo's own steady state.
  rm -rf "$tmp/repo"
  mkdir -p "$tmp/repo"
  if ! run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a tree with no compose files should pass, not fail." >&2
    exit 1
  fi

  # Case 2: two distinctly-named, pinned files — clean tree passes.
  reset
  if ! run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: two distinctly pinned compose files should pass." >&2
    exit 1
  fi

  # Case 3: a missing pin is caught.
  reset
  sed -i.bak '/^name:/d' "$tmp/repo/docker-compose.prod.yml" && rm -f "$tmp/repo/docker-compose.prod.yml.bak"
  if run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a compose file with no name: was not reported." >&2
    exit 1
  fi

  # Case 4: two files sharing a name is caught.
  reset
  sed -i.bak 's/^name:.*/name: myapp-dev/' "$tmp/repo/docker-compose.prod.yml" && rm -f "$tmp/repo/docker-compose.prod.yml.bak"
  if run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a duplicate project name was not reported." >&2
    exit 1
  fi

  # Case 5: an override file that declares a name is caught, regardless of
  # which of Compose's two spellings (docker-compose.* / compose.*) is used.
  reset
  printf 'name: myapp-o11y\nservices:\n  otel: {}\n' > "$tmp/repo/docker-compose.override.yml"
  if run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: an override file declaring name: was not reported." >&2
    exit 1
  fi

  # Case 6: an override file with NO name: is correct and must not be flagged
  # or counted as a standalone file needing its own pin.
  reset
  printf 'services:\n  otel: {}\n' > "$tmp/repo/docker-compose.override.yml"
  if ! run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: a nameless override file should pass, it is not standalone." >&2
    exit 1
  fi

  # Case 7: the `compose.yaml` spelling (the newer Compose Spec default, not
  # just the legacy `docker-compose.yml` name) is discovered too.
  rm -rf "$tmp/repo"
  mkdir -p "$tmp/repo"
  printf 'services:\n  api: {}\n' > "$tmp/repo/compose.yaml"
  if run_check "$tmp/repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: an unpinned compose.yaml (Compose Spec spelling) was not reported." >&2
    exit 1
  fi

  echo "self-test OK: no-compose-files, a clean pair, a missing name, a duplicate name, a naming override, a clean override, and the compose.yaml spelling all resolved correctly."
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

echo "compose project names — every standalone compose file pins a distinct name"
echo
if run_check "$REPO_ROOT"; then
  echo "OK: every standalone compose file pins its own project name (or none exist)."
else
  cat >&2 <<'MSG'

FAIL: see the file(s) above.

Two compose files sharing an unpinned (directory-derived) project name share
volumes and recreate each other's containers in place. Give each standalone
file its own top-level `name:`, and keep override files (`*.override.yml`)
free of one — Compose merges them into the base file automatically, and a
`name:` there would silently rename the stack the override extends.
MSG
  exit 1
fi
