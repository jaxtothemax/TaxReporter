#!/usr/bin/env bash
# scripts/customize.sh — guided setup for a new project from this template
#
# Run once after cloning: bash scripts/customize.sh
# Re-running is safe — it re-checks and reports the current state.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source-path=SCRIPTDIR source=lib/git-hooks-dir.sh
. "$REPO_ROOT/scripts/lib/git-hooks-dir.sh"

# ─── Helpers ──────────────────────────────────────────────────────────────────

DONE=0
TODO=0
WARN=0

ok()   { printf "  [✓] %s\n" "$1"; DONE=$((DONE + 1)); }
todo() { printf "  [ ] %s\n" "$1"; TODO=$((TODO + 1)); }
warn() { printf "  [!] %s\n" "$1"; WARN=$((WARN + 1)); }

heading() { echo ""; echo "── $1 ──────────────────────────────────────────"; }

# ─── CLAUDE.md ────────────────────────────────────────────────────────────────

heading "CLAUDE.md"

if grep -q "\[PROJECT NAME\]" CLAUDE.md 2>/dev/null; then
  todo "Replace [PROJECT NAME] with your actual project name in CLAUDE.md"
else
  ok "Project name set in CLAUDE.md"
fi

if grep -q "SETUP CHECKLIST" CLAUDE.md 2>/dev/null; then
  todo "Remove the SETUP CHECKLIST comment block from CLAUDE.md (top of file)"
fi

if grep -q "\[FILL IN" CLAUDE.md 2>/dev/null; then
  COUNT=$(grep -c "\[FILL IN" CLAUDE.md)
  todo "Fill in $COUNT placeholder(s) marked [FILL IN ...] in CLAUDE.md"
else
  ok "No [FILL IN] placeholders remain in CLAUDE.md"
fi

if grep -qE "^\- \*\*\[Name\]\*\*" CLAUDE.md 2>/dev/null; then
  todo "Define your project's personas in CLAUDE.md (Personas section)"
else
  ok "Personas defined in CLAUDE.md"
fi

if grep -q "\[REMOVE IF NOT APPLICABLE\]" CLAUDE.md 2>/dev/null; then
  COUNT=$(grep -c "\[REMOVE IF NOT APPLICABLE\]" CLAUDE.md)
  todo "Review and remove/keep $COUNT optional section(s) marked [REMOVE IF NOT APPLICABLE] in CLAUDE.md"
fi

# ─── Personas ─────────────────────────────────────────────────────────────────

heading ".claude/personas.md"

if [[ ! -f ".claude/personas.md" ]]; then
  warn ".claude/personas.md not found — create it from the template"
elif grep -qE "^## (Alex|Jordan|Sam|Maya) —" .claude/personas.md 2>/dev/null; then
  todo "Replace the example personas (Alex, Jordan, Sam, Maya) in .claude/personas.md with your project's actual user personas"
  echo "       Tip: 3–5 personas is ideal. See .claude/personas.md for the format."
else
  ok "Custom personas defined in .claude/personas.md"
fi

# ─── CI pipeline ──────────────────────────────────────────────────────────────

heading ".gitlab-ci.yml"

if grep -qE "^#.*- local: ci/(python|node|docker|go)\.yml" .gitlab-ci.yml 2>/dev/null; then
  todo "Uncomment the relevant stack includes in .gitlab-ci.yml (ci/python.yml, ci/node.yml, etc.)"
else
  ok "CI stack includes configured in .gitlab-ci.yml"
fi

# Check if any ci/*.yml files have been customized beyond the template
if [[ -d "ci" ]]; then
  UNCONFIGURED=0
  for f in ci/python.yml ci/node.yml ci/go.yml; do
    if [[ -f "$f" ]] && grep -q "FILL IN\|your_" "$f" 2>/dev/null; then
      UNCONFIGURED=$((UNCONFIGURED + 1))
    fi
  done
  if [[ $UNCONFIGURED -gt 0 ]]; then
    todo "Configure variables (paths, thresholds) at the top of the active ci/*.yml file(s)"
  else
    ok "CI stack file(s) look configured"
  fi
fi

# ─── Makefile ─────────────────────────────────────────────────────────────────

heading "Makefile"

if grep -qE "^#.*cd (frontend|backend)" Makefile 2>/dev/null; then
  todo "Uncomment and configure lint/test/build targets in the Makefile for your stack"
else
  ok "Makefile targets configured"
fi

# ─── scripts/release.sh ───────────────────────────────────────────────────────

heading "scripts/release.sh"

if grep -q "RELEASE_FILES=\[\]" scripts/release.sh 2>/dev/null || \
   grep -q "# Add version-bearing files" scripts/release.sh 2>/dev/null || \
   grep -q "# Uncomment and customize" scripts/release.sh 2>/dev/null; then
  todo "Add your version-bearing files to RELEASE_FILES in scripts/release.sh (e.g. package.json, pyproject.toml)"
else
  ok "scripts/release.sh has version files configured"
fi

# ─── CONTRIBUTING.md ──────────────────────────────────────────────────────────

heading "CONTRIBUTING.md"

if [[ ! -f "CONTRIBUTING.md" ]]; then
  todo "CONTRIBUTING.md not found — it was included in the template"
elif grep -q "\[PROJECT NAME\]" CONTRIBUTING.md 2>/dev/null; then
  todo "Replace [PROJECT NAME] in CONTRIBUTING.md"
elif grep -q "\[FILL IN" CONTRIBUTING.md 2>/dev/null; then
  todo "Fill in [FILL IN] placeholder(s) in CONTRIBUTING.md (support channels, coverage threshold)"
else
  ok "CONTRIBUTING.md configured"
fi

# ─── ADR directory ────────────────────────────────────────────────────────────

heading "docs/adr/"

if [[ ! -d "docs/adr" ]]; then
  todo "docs/adr/ not found — run /adr to record your first architecture decision"
elif [[ -n "$(find docs/adr -maxdepth 1 -name '*.md' \
  ! -name '0001-record-architecture-decisions.md' 2>/dev/null)" ]]; then
  ok "Architecture decisions recorded in docs/adr/"
else
  todo "No project-specific ADRs yet — run '/adr <decision title>' to record your first decision"
  echo "       Tip: good first ADRs cover your stack choice, data storage, and auth approach"
fi

# ─── Git hooks ────────────────────────────────────────────────────────────────

heading "Git hooks"

# Resolved via git-hooks-dir.sh, not a literal ".git/hooks" — inside a
# `scripts/wt` worktree, .git is a file, not that directory, so the literal
# path would report "not installed" even when the shared common-dir hooks ARE
# installed (issue #49).
HOOKS_DIR="$(git_hooks_dir "$REPO_ROOT" 2>/dev/null)" || HOOKS_DIR=""

if [[ -n "$HOOKS_DIR" ]] && { [[ -L "$HOOKS_DIR/pre-push" ]] || [[ -f "$HOOKS_DIR/pre-push" ]]; }; then
  ok "pre-push hook installed"
else
  todo "Install git hooks: run 'make setup'"
fi

if [[ -n "$HOOKS_DIR" ]] && { [[ -L "$HOOKS_DIR/pre-commit" ]] || [[ -f "$HOOKS_DIR/pre-commit" ]]; }; then
  ok "pre-commit hook installed"
else
  todo "Install git hooks: run 'make setup'"
fi

# ─── Post-edit hooks ──────────────────────────────────────────────────────────

heading ".claude/hooks/post-edit-checks.sh"

if [[ -f ".claude/hooks/post-edit-checks.sh" ]]; then
  if grep -q "# Add your project" .claude/hooks/post-edit-checks.sh 2>/dev/null || \
     grep -q "models\.py\|schema\.prisma" .claude/hooks/post-edit-checks.sh 2>/dev/null; then
    todo "Customize .claude/hooks/post-edit-checks.sh with file patterns relevant to your stack"
    echo "       Examples: models.py → migration-check, schema.prisma → prisma migrate"
  else
    ok "Post-edit hook configured"
  fi
fi

# ─── Claude Code hook scripts executable ──────────────────────────────────────

heading ".claude/hooks/ (executable bit)"

if [[ -d ".claude/hooks" ]]; then
  NONEXEC=0
  for h in .claude/hooks/*.sh; do
    [[ -f "$h" ]] || continue
    if [[ ! -x "$h" ]]; then
      warn "$h is not executable — Claude Code will silently skip it. Run: chmod +x $h"
      NONEXEC=$((NONEXEC + 1))
    fi
  done
  [[ $NONEXEC -eq 0 ]] && ok "All .claude/hooks/*.sh are executable"
  # The pre-MR security gate references /rbac-check and /security-review — remind to tune it.
  if [[ -f ".claude/hooks/pre-mr-security-gate.sh" ]] && grep -q "CUSTOMIZE" .claude/hooks/pre-mr-security-gate.sh 2>/dev/null; then
    echo "       Tip: tune sensitive-path patterns in .claude/hooks/pre-mr-security-gate.sh for your stack."
  fi
fi

# ─── GitLab project settings ──────────────────────────────────────────────────

heading "GitLab project settings (manual — cannot verify automatically)"

echo "  Verify these in GitLab → Settings:"
echo ""
echo "  [ ] Merge requests → Only allow merge if pipeline succeeds"
echo "  [ ] Repository → Protected branches: protect 'main' (no direct push)"
echo "  [ ] Repository → Default branch: 'main'"
echo "  [ ] Merge requests → Delete source branch by default (optional)"
echo ""
echo "  See the docs → 'Start a project' → 'GitLab project settings' for the full list:"
echo "  https://docs.blueprint.macrodream.co/getting-started/start-a-project/#3-gitlab-project-settings"

# ─── .env ─────────────────────────────────────────────────────────────────────

heading "Environment"

if [[ -f ".env.example" ]] && [[ ! -f ".env" ]]; then
  todo "Copy .env.example → .env and fill in local values"
elif [[ -f ".env" ]]; then
  ok ".env present"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════"
echo "  Done: $DONE   Remaining: $TODO   Warnings: $WARN"
echo "══════════════════════════════════════════════════"
echo ""

if [[ $TODO -gt 0 ]]; then
  echo "  Complete the [ ] items above, then re-run to confirm."
  echo ""
  echo "  Quick reference:"
  echo "    make setup    — install git hooks"
  echo "    make doctor   — verify prerequisites"
  echo ""
  exit 1
else
  echo "  All setup steps complete. You're ready to build."
  echo ""
  echo "  Suggested next steps:"
  echo "    make doctor         — verify all prerequisites are installed"
  echo "    glab auth login     — authenticate the GitLab CLI"
  echo "    git checkout -b feat/first-feature && /mr"
fi
