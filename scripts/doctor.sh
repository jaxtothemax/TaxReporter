#!/usr/bin/env bash
# Verify prerequisites and environment health.
# Add project-specific checks in the "Project-specific" section below.
set -euo pipefail

ERRORS=0
WARNINGS=0

check() {
  local name="$1" cmd="$2"
  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$("$cmd" --version 2>&1 | sed -n 1p)
    printf "  %-20s %s\n" "$name" "$ver"
  else
    printf "  %-20s %s\n" "$name" "MISSING"
    ERRORS=$((ERRORS + 1))
  fi
}

warn() {
  printf "  %-20s %s\n" "$1" "WARNING: $2"
  WARNINGS=$((WARNINGS + 1))
}

# A soft check: the harness degrades rather than breaks without it, so a miss is a
# WARNING with the consequence named — not a hard error the user must clear before
# they can do anything.
check_soft() {
  local name="$1" cmd="$2" consequence="$3"
  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$("$cmd" --version 2>&1 | sed -n 1p)
    printf "  %-20s %s\n" "$name" "$ver"
  else
    warn "$name" "missing — $consequence"
  fi
}

echo "=== Prerequisites ==="
check "git" "git"
check "make" "make"
check "python3" "python3"

echo ""
echo "=== Harness tooling ==="
#
# These are what the harness itself runs on, as opposed to what your application
# needs. They were unchecked until 0.2.0 — and worse, the README claimed
# `make doctor` verified `glab`, which it did not. A prerequisite check that
# quietly omits a prerequisite is the same failure class as a gate that reports OK
# on a violating tree: the green is believed, and it was never evidence.

# Claude Code — every skill and agent in .claude/ is invoked through it. The git,
# CI, and changelog machinery all work without it; the review gates do not exist
# without it.
check_soft "claude" "claude" "the .claude/ skills and agents cannot run; git + CI still work"

# A forge CLI — REQUIRED for the duplicate-work gate, worktree issue claims, and
# stale-reference resolution. Either one satisfies it; the scripts pick based on
# the origin remote's host.
if command -v glab &>/dev/null; then
  printf "  %-20s %s\n" "glab" "$(glab --version 2>&1 | sed -n 1p)"
elif command -v gh &>/dev/null; then
  printf "  %-20s %s\n" "gh (GitHub)" "$(gh --version 2>&1 | sed -n 1p)"
else
  warn "glab / gh" "missing — check-issue-collision, wt issue claims, and stale-reference \
resolution all degrade or fail closed"
fi

# jq — the pre-MR security hook parses forge JSON with it, and the OSV severity
# gate's --self-test parses its synthetic advisory fixtures with it. (The
# collision gate and the version-lockstep gate use python3, checked above.)
check_soft "jq" "jq" "the pre-MR security hook and the OSV severity gate's --self-test cannot parse JSON"

# The shellcheck binary — the pre-push mirror of the shellcheck CI job. Without
# it locally, a bashism in a #!/bin/sh hook (see issue #14) isn't caught until CI.
check_soft "shellcheck" "shellcheck" "check-shellcheck degrades to a no-op locally; CI still runs it"

# gitleaks — the pre-commit secret scan (hooks/pre-commit -> `make
# gitleaks-check` -> scripts/gitleaks-precommit.sh). Without it, the hook
# no-ops with a warning on every commit; the merge-blocking gitleaks-scan CI
# job is the hard gate regardless, so this is a local convenience, not a
# correctness requirement.
check_soft "gitleaks" "gitleaks" "the pre-commit hook no-ops locally; the gitleaks-scan CI job still enforces it"

# direnv — optional. Without it, `source .envrc` by hand in each worktree.
check_soft "direnv" "direnv" "worktree .envrc files must be sourced manually"

# Git hooks installed?
#
# Resolved via git-hooks-dir.sh, not a literal "$REPO_ROOT/.git/hooks" — inside
# a `scripts/wt` worktree, .git is a file, not that directory, so the literal
# path would report "not installed" even when the shared common-dir hooks ARE
# installed (issue #49).
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/git-hooks-dir.sh
. "$REPO_ROOT/scripts/lib/git-hooks-dir.sh"
HOOKS_DIR="$(git_hooks_dir "$REPO_ROOT" 2>/dev/null)" || HOOKS_DIR=""
if [[ -n "$HOOKS_DIR" && -L "$HOOKS_DIR/pre-push" ]]; then
  printf "  %-20s %s\n" "git hooks" "installed"
else
  warn "git hooks" "not installed — run 'make setup'"
fi

# .env file exists?
if [[ -f "$REPO_ROOT/.env" ]]; then
  printf "  %-20s %s\n" ".env" "present"
else
  warn ".env" "missing — copy from .env.example"
fi

echo ""

# ─── Project-specific checks (customize below) ──────────────────────────────
#
# Uncomment and add checks for your stack:
#
# echo "=== Python ==="
# check "pip" "pip"
# check "ruff" "ruff"
# if [[ -d "$REPO_ROOT/.venv" ]]; then
#   printf "  %-20s %s\n" "virtualenv" "present"
# else
#   warn "virtualenv" "missing — run 'python3 -m venv .venv'"
# fi
#
# echo "=== Node.js ==="
# check "node" "node"
# check "npm" "npm"
#
# echo "=== Docker ==="
# check "docker" "docker"
# check "docker compose" "docker"  # docker compose --version
#
# echo "=== Go ==="
# check "go" "go"
# check "golangci-lint" "golangci-lint"
# ─────────────────────────────────────────────────────────────────────────────

echo "=== Summary ==="
if [[ $ERRORS -gt 0 ]]; then
  echo "  $ERRORS missing prerequisite(s). Install them before proceeding."
  exit 1
elif [[ $WARNINGS -gt 0 ]]; then
  echo "  All hard prerequisites present. $WARNINGS warning(s) — see above."
  echo "  Warnings are things the harness degrades without, not things it dies without."
else
  echo "  All prerequisites present. Environment looks good."
fi
