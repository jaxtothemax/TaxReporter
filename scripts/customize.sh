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
# shellcheck source-path=SCRIPTDIR source=lib/gh-repo.sh
. "$REPO_ROOT/scripts/lib/gh-repo.sh"

# owner/repo (or HOST/owner/repo on GitHub Enterprise) from origin — never
# hardcoded. Empty on a fresh scaffold with no GitHub remote yet.
GH_REPO_SLUG="$(gh_repo_from_url "$(git remote get-url origin 2>/dev/null || true)")"

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

# ─── CI: GitHub Actions ───────────────────────────────────────────────────────
#
# This project is hosted on GitHub. Blueprint ships GitLab CI; a scaffold that
# still carries .gitlab-ci.yml (or Renovate, which only served GitLab here) next
# to the workflows is half-ported, and the half nobody runs is the half that
# rots — every gate in it reads as configured while never executing.

heading ".github/ (GitHub Actions, Dependabot)"

# The four harness workflows by name, not "any *.yml": an adopter's own ci.yml
# would otherwise satisfy a check that exists to catch a dropped gate workflow.
MISSING_WF=""
for wf in governance security docs release; do
  [[ -f ".github/workflows/${wf}.yml" ]] || MISSING_WF="$MISSING_WF ${wf}.yml"
done
if [[ -z "$MISSING_WF" ]]; then
  ok "Harness workflows present (.github/workflows/: governance, security, docs, release)"
else
  todo "Add the missing harness workflow(s) to .github/workflows/:${MISSING_WF}"
fi

if [[ -f ".github/workflows/ci.yml" || -f ".github/workflows/ci.yaml" ]]; then
  ok "Application CI workflow present (.github/workflows/ci.yml)"
else
  todo "Add .github/workflows/ci.yml with your stack's lint/typecheck/test/build jobs once the stack is chosen"
fi

if grep -lq "\[FILL IN" .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null; then
  todo "Fill in the [FILL IN ...] placeholder(s) in .github/workflows/*.yml"
fi

if [[ -e ".gitlab-ci.yml" ]]; then
  todo "Delete .gitlab-ci.yml — this project runs CI on GitHub Actions (.github/workflows/)"
else
  ok "No .gitlab-ci.yml (CI is GitHub Actions only)"
fi

if [[ -d ".gitlab" ]]; then
  todo "Delete .gitlab/ — issue and PR templates live in .github/ISSUE_TEMPLATE/ and .github/pull_request_template.md"
fi

if [[ -f ".github/dependabot.yml" ]]; then
  ok "Dependabot configured (.github/dependabot.yml)"
else
  todo "Add .github/dependabot.yml (github-actions ecosystem at minimum)"
fi

if [[ -e "renovate.json" || -e ".renovaterc" || -e ".renovaterc.json" ]]; then
  todo "Delete the Renovate config — Dependabot (.github/dependabot.yml) owns dependency updates here"
else
  ok "No Renovate config (Dependabot owns dependency updates)"
fi

if [[ -f ".github/pull_request_template.md" ]] && compgen -G ".github/ISSUE_TEMPLATE/*.yml" >/dev/null; then
  ok "Issue forms and PR template present in .github/"
else
  todo "Add .github/ISSUE_TEMPLATE/*.yml issue forms and .github/pull_request_template.md"
fi

# The issue chooser's security link is static YAML — the one place the repo name
# cannot be derived at runtime — so it ships as an OWNER/REPO placeholder.
if grep -q "github.com/OWNER/REPO/" .github/ISSUE_TEMPLATE/config.yml 2>/dev/null; then
  todo "Replace OWNER/REPO in .github/ISSUE_TEMPLATE/config.yml's security link with ${GH_REPO_SLUG:-<owner>/<repo>}"
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
     grep -q "parser\.py (Python), importer\.ts (TypeScript)" .claude/hooks/post-edit-checks.sh 2>/dev/null; then
    todo "Customize .claude/hooks/post-edit-checks.sh with file patterns relevant to your stack"
    echo "       Examples: your broker-export parser module → security-review, your XML writer → security-review"
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
  # The pre-MR security gate requires the security-review agent — remind to tune its paths.
  if [[ -f ".claude/hooks/pre-mr-security-gate.sh" ]] && grep -q "CUSTOMIZE" .claude/hooks/pre-mr-security-gate.sh 2>/dev/null; then
    echo "       Tip: tune sensitive-path patterns in .claude/hooks/pre-mr-security-gate.sh for your stack."
  fi
fi

# ─── GitHub repository settings ───────────────────────────────────────────────

heading "GitHub repository settings (manual — cannot verify automatically)"

# The links point at THIS repository (a fork or a rename included) because the
# slug comes from origin; a GitHub Enterprise slug already carries its host.
if [[ -n "$GH_REPO_SLUG" ]]; then
  case "$GH_REPO_SLUG" in
    */*/*) SETTINGS_URL="https://${GH_REPO_SLUG}/settings" ;;
    *)     SETTINGS_URL="https://github.com/${GH_REPO_SLUG}/settings" ;;
  esac
  echo "  Repository: ${GH_REPO_SLUG}  (${SETTINGS_URL})"
else
  SETTINGS_URL="https://github.com/<owner>/<repo>/settings"
  echo "  No GitHub origin yet — create the repository first:"
  echo "    gh repo create <owner>/<repo> --public --source . --remote origin"
fi
echo ""
echo "  Verify these in GitHub → Settings:"
echo ""
echo "  [ ] Rules → Rulesets (or Branches → branch protection) for 'main':"
echo "        require a pull request before merging (no direct pushes),"
echo "        require status checks to pass (the governance and security workflow jobs),"
echo "        block force pushes and deletion"
echo "  [ ] General → Pull Requests: 'Automatically delete head branches' on"
echo "        (scripts/wt prune reaps a worktree only once its branch is gone from origin)"
echo "  [ ] Rules → Rulesets: a tag ruleset for 'v*' — only maintainers create, update"
echo "        or delete release tags (release.yml publishes on a v* tag push)"
echo "  [ ] Pages → Build and deployment → Source: 'GitHub Actions' (docs.yml deploys the site)"
echo "  [ ] Security → Private vulnerability reporting: enabled"
echo "        (the issue chooser's security link points reporters there)"
echo "  [ ] General → Default branch: 'main'"
echo "  [ ] Issues → labels exist (scripts and skills apply them; GitHub labels are"
echo "        not scoped, so release:* exclusivity is kept by the tools, not GitHub):"
echo "        release:committed  release:reserve  release:stretch  status:wip"
echo "        no-changelog  feature  bug  task  feedback"
echo "      Create any that are missing with, e.g.:"
echo "        gh label create release:committed --color 0e8a16 --description 'Ships, or the release slips'"
echo "        gh label create release:reserve   --color fbca04 --description 'Slot held for inbound work from real users'"
echo "        gh label create release:stretch   --color c5def5 --description 'Ships if there is time; moves at feature freeze'"
echo "        gh label create status:wip        --color ec9a29 --description 'Checked out by an agent/worktree (scripts/wt)'"
echo "        gh label create no-changelog      --color ededed --description 'PR needs no changelog fragment'"
echo "        gh label create feature; gh label create bug; gh label create task; gh label create feedback"
echo ""
echo "  Settings: ${SETTINGS_URL}"

# Best effort, never a TODO: with an authenticated gh and a GitHub origin, name
# the labels that are actually missing. Offline, logged out, or no origin, this
# says nothing rather than guessing — the manual checklist above still stands.
if [[ -n "$GH_REPO_SLUG" ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  HAVE_LABELS="$(gh label list --repo "$GH_REPO_SLUG" --limit 1000 --json name --jq '.[].name' 2>/dev/null || true)"
  if [[ -n "$HAVE_LABELS" ]]; then
    MISSING_LABELS=""
    for l in release:committed release:reserve release:stretch status:wip no-changelog feature bug task feedback; do
      grep -qxF "$l" <<< "$HAVE_LABELS" || MISSING_LABELS="$MISSING_LABELS $l"
    done
    if [[ -n "$MISSING_LABELS" ]]; then
      warn "GitHub labels missing on ${GH_REPO_SLUG}:${MISSING_LABELS}"
    else
      ok "All harness labels exist on ${GH_REPO_SLUG}"
    fi
  fi
fi

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
  echo "    gh auth login — authenticate the GitHub CLI"
  echo ""
  exit 1
else
  echo "  All setup steps complete. You're ready to build."
  echo ""
  echo "  Suggested next steps:"
  echo "    make doctor         — verify all prerequisites are installed"
  echo "    gh auth login       — authenticate the GitHub CLI"
  if [[ -z "$GH_REPO_SLUG" ]]; then
    echo "    gh repo create <owner>/<repo> --source . --remote origin --push"
    echo "                        — create the GitHub repository (no origin yet)"
  fi
  echo "    git checkout -b feat/first-feature && /mr   — /mr opens a GitHub pull request"
fi
