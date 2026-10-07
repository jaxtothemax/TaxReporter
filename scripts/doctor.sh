#!/usr/bin/env bash
# Verify prerequisites and environment health.
# Add project-specific checks in the clearly marked "Project-specific checks"
# section near the bottom; everything above it is the harness's own toolchain.
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
# needs. Upstream they were unchecked until Blueprint 0.2.0 — and worse, the
# README claimed `make doctor` verified the forge CLI, which it did not. A prerequisite check that
# quietly omits a prerequisite is the same failure class as a gate that reports OK
# on a violating tree: the green is believed, and it was never evidence.

# Claude Code — every skill and agent in .claude/ is invoked through it. The git,
# CI, and changelog machinery all work without it; the review gates do not exist
# without it.
check_soft "claude" "claude" "the .claude/ skills and agents cannot run; git + CI still work"

# gh — the GitHub CLI. The duplicate-work gate (check-issue-collision), the
# `scripts/wt` issue check-out lock and merged-PR detection, stale-reference
# resolution, and the /mr, /fix-mr, /mass-merge, /batch and /release skills all
# talk to GitHub through it. Installed is not enough: an unauthenticated gh makes
# every one of those degrade (or, for check-stale-references, fail closed), so
# the login is checked too. `gh auth status` exits non-zero when no host is
# logged in; GH_TOKEN in the environment counts as logged in.
if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null; then
    printf "  %-20s %s\n" "gh (GitHub)" "$(gh --version 2>&1 | sed -n 1p) — logged in"
  else
    warn "gh (GitHub)" "installed but not logged in — run 'gh auth login'; until then \
check-issue-collision, wt issue claims and the PR skills degrade, and stale-reference resolution fails closed"
  fi
else
  warn "gh (GitHub)" "missing — check-issue-collision, wt issue claims, the PR skills and \
stale-reference resolution all degrade or fail closed (https://cli.github.com)"
fi

# jq — the pre-MR security hook parses tool-call JSON with it, and the OSV
# severity gate's --self-test parses its synthetic advisory fixtures with it. (The
# collision gate and the version-lockstep gate use python3, checked above.)
check_soft "jq" "jq" "the pre-MR security hook and the OSV severity gate's --self-test cannot parse JSON"

# The shellcheck binary — the pre-push mirror of the shellcheck CI job. Without
# it locally, a bashism in a #!/bin/sh hook (see issue #14) isn't caught until CI.
check_soft "shellcheck" "shellcheck" "check-shellcheck degrades to a no-op locally; CI still runs it"

# actionlint — lints .github/workflows/*.yml. A workflow typo (a bad `needs:`, an
# undefined expression, a mis-indented `on:`) does not fail any test: GitHub
# simply refuses the file on push and the gates in it never run, which reads as
# "no checks" rather than "red". Catching it before the push is the only cheap
# moment. (`actionlint` also runs shellcheck over `run:` blocks when both exist.)
check_soft "actionlint" "actionlint" "GitHub Actions workflows cannot be linted locally; a broken workflow is only seen after the push"

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

# ═══ Project-specific checks ═══════════════════════════════════════════════════
#
# EVERYTHING ABOVE is the harness's own toolchain and stays as-is. Below: the
# application's — the TypeScript pnpm workspace under packages/ and apps/. Use
# `check` for a hard prerequisite (doctor exits 1 without it) and `check_soft`
# for one the project degrades without.
#
# Node.js and pnpm are reported as WARNINGS for now, although every application
# target (make setup/lint/format-check/typecheck/test/build, and the pre-commit
# hook that runs three of them) needs both: scripts/tests/customize-e2e.test.sh,
# run by the onboarding-customize-e2e job in .github/workflows/governance.yml,
# requires this script to exit 0 on a stock ubuntu-latest runner, which ships
# Node.js 22 and no pnpm. Promote both to hard checks once that job installs
# them (actions/setup-node with .nvmrc, pnpm/action-setup).

echo "=== Application ==="

# Node.js >= 24, the major .nvmrc and package.json "engines" pin.
NODE_VERSION="$(node --version 2>/dev/null || true)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ -z "$NODE_VERSION" ]]; then
  warn "node" "missing — Node.js >= 24 (.nvmrc) is required by every application make target"
elif [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 24 )); then
  warn "node" "$NODE_VERSION found — Node.js >= 24 (.nvmrc) is required; application targets may fail"
else
  printf "  %-20s %s\n" "node" "$NODE_VERSION"
fi

# pnpm — any recent version: it switches itself to the version the root
# package.json "packageManager" field pins.
check_soft "pnpm" "pnpm" "make setup/lint/format-check/typecheck/test/build cannot run (https://pnpm.io/installation, or 'corepack enable pnpm')"

# xmllint — optional: validating generated eDavki XML against the vendored FURS
# schemas (packages/furs/schemas/) by hand, outside the test suite.
check_soft "xmllint" "xmllint" "generated eDavki XML cannot be checked against the FURS XSDs locally"
echo ""

# ═══ End of project-specific checks ═══════════════════════════════════════════

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
