#!/usr/bin/env bash
# scripts/tests/customize-e2e.test.sh — the first-run experience actually works.
#
# `make setup`, `scripts/customize.sh`, `scripts/doctor.sh`, and `/kickoff` are
# the entire onboarding path for a brand-new clone of this template, and
# nothing in CI ran any of them end-to-end (issue #53) — a change to any of
# those scripts, or to the files they check, could silently break the first
# thing every adopter does, on a green pipeline.
#
# `/kickoff` itself is out of reach here: it is an interactive Claude Code
# skill (`disable-model-invocation: true`) that has a model hold a
# conversation and hand-write CLAUDE.md / .claude/personas.md — there is no
# deterministic input surface to drive from a CI job, and faking one would
# test the fake, not the skill. `scripts/customize.sh` is what IS
# deterministic: it never prompts (it only ever scans and reports), so it is
# already fully non-interactive and needed no new flag. What this test
# verifies instead is the contract on the other side of `/kickoff` — that once
# the placeholders it's supposed to replace are gone, `customize.sh` agrees
# the project is set up, and that `doctor.sh` still runs cleanly against that
# same tree.
#
# Hermetic: builds the scratch tree from `git archive HEAD` (so it exercises
# what is actually COMMITTED, not this working tree's uncommitted edits —
# the same reason scripts/tests/setup-hooks.test.sh does it), never touches
# this checkout, and is torn down on exit.
#
# Cases:
#   1. A clone of this repo's own HEAD. While HEAD is still the uncustomized
#      template, customize.sh must report outstanding TODOs. Once the project
#      has run /kickoff, HEAD is no longer a "just cloned" tree, so only the
#      state-independent checks run (GitHub checklist, no GitLab leftovers) and
#      Case 3 carries the placeholder-detection proof.
#   2. A simulated completed /kickoff — customize.sh must report all clear,
#      no placeholder token survives in the templated files, CLAUDE.md still
#      reads as sane markdown, and doctor.sh runs to completion (exit 0, git
#      hooks installed, minimum prerequisites present).
#   3. Negative control (the FAILS-if-a-placeholder-survives proof, run
#      automatically rather than by hand-and-restore): starting from the
#      Case 2 tree, inject ONE placeholder — customize.sh must catch it. It is
#      injected (appended), not restored by swapping a filled-in value back,
#      so the control still bites after a real /kickoff replaced every
#      placeholder with project-specific text.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source-path=SCRIPTDIR source=../lib/git-hooks-dir.sh
. "$REPO_ROOT/scripts/lib/git-hooks-dir.sh"

fail=0
check() { # <label> <0 = pass>
  if [[ "$2" -eq 0 ]]; then echo "SELF-TEST OK: $1"
  else echo "SELF-TEST FAILED: $1" >&2; fail=1; fi
}

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# ─── Helpers ──────────────────────────────────────────────────────────────────

# sed with no in-place-flag ambiguity: GNU sed's `-i` and BSD/macOS sed's `-i`
# take the backup-suffix argument differently (BSD requires it, even if
# empty). Write to a temp file and move it instead of relying on either —
# but `mv` a fresh file over an executable one loses the exec bit, so
# preserve the original mode explicitly (stat's flag differs BSD vs GNU).
#
# GNU/BusyBox `-c` form goes FIRST. On both, `-f` means "report on the
# filesystem", not "use this format string" — only BSD/macOS stat overloads
# `-f` as a format flag. So on Linux CI, `stat -f '%Lp' "$f"` doesn't fail
# the way this needed: it silently stats the filesystem instead of the file
# and exits 0, so the `||` fallback never ran and `chmod` got a multi-line
# filesystem report as its mode argument. Trying `-c` first means the branch
# CI actually runs on succeeds directly; the `-f` form is the fallback for
# local macOS runs, where `-c` isn't recognized and fails cleanly.
sed_edit() { # <file> <sed-expr...>
  local f="$1"; shift
  local mode
  mode="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  sed -E "$@" "$f" > "$f.sedtmp"
  mv "$f.sedtmp" "$f"
  chmod "$mode" "$f"
}

# Replace only the FIRST line-match of a fixed string with another, portably
# (no GNU-only `0,/re/` sed address extension, which macOS/BSD sed rejects).
# Used by the negative control to reintroduce exactly one placeholder.
replace_first() { # <file> <find> <replace>
  # Same mode-preservation as sed_edit: this rewrites .claude/hooks/*.sh, and a
  # hook that loses its exec bit is one customize.sh rightly warns about.
  local mode
  mode="$(stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1")"
  awk -v find="$2" -v repl="$3" '
    !done {
      i = index($0, find)
      if (i) { $0 = substr($0, 1, i - 1) repl substr($0, i + length(find)); done = 1 }
    }
    { print }
  ' "$1" > "$1.awktmp"
  mv "$1.awktmp" "$1"
  chmod "$mode" "$1"
}

# Delete the FIRST HTML comment block in a file (CLAUDE.md's SETUP CHECKLIST
# block is the first one, per the template's own instructions to remove it
# once setup is complete).
delete_first_html_comment() { # <file>
  awk '
    !done && /<!--/ { indel = 1 }
    indel { if (/-->/) { indel = 0; done = 1 }; next }
    { print }
  ' "$1" > "$1.awktmp"
  mv "$1.awktmp" "$1"
}

# Build a git repo at <dir> from this repo's committed HEAD (git archive, not
# a working-tree copy — a local uncommitted edit must not be able to fake a
# pass here).
build_scratch_clone() { # <dir>
  mkdir -p "$1"
  (cd "$REPO_ROOT" && git archive HEAD) | tar -x -C "$1"
  git -C "$1" init -q -b main
  git -C "$1" config user.email t@example.com
  git -C "$1" config user.name t
  git -C "$1" add -A
  git -C "$1" commit -qm "scratch clone of HEAD" >/dev/null
}

# Simulate a completed /kickoff: replace every placeholder token
# scripts/customize.sh checks for, the way a real kickoff answer would.
simulate_kickoff() { # <dir>
  local d="$1"

  # CLAUDE.md
  delete_first_html_comment "$d/CLAUDE.md"
  sed_edit "$d/CLAUDE.md" 's/\[PROJECT NAME\]/Acme Widget/g'
  sed_edit "$d/CLAUDE.md" 's/\[FILL IN[^]]*\]/backend\/tests/g'
  sed_edit "$d/CLAUDE.md" 's/\[REMOVE IF NOT APPLICABLE\] ?//g'
  awk '
    /^- \*\*\[Name\]\*\* \(\[Role\]\): \[context, workflow, values, pain point\]$/ {
      n++
      if (n == 1) { print "- **Priya Shah** (Operations Lead): coordinates release timing, watches uptime dashboards. Values: reliability. Pain: alert fatigue from noisy monitors."; next }
      if (n == 2) { print "- **Devon Ruiz** (Backend Engineer): owns the billing service. Values: correctness. Pain: flaky staging environments."; next }
      print "- **Lena Kim** (Support Lead): triages customer tickets. Values: fast turnaround. Pain: missing context in bug reports."
      next
    }
    { print }
  ' "$d/CLAUDE.md" > "$d/CLAUDE.md.awktmp"
  mv "$d/CLAUDE.md.awktmp" "$d/CLAUDE.md"

  # .claude/personas.md — replace the example archetypes with real ones
  sed_edit "$d/.claude/personas.md" \
    -e 's/^## Alex —/## Priya Shah —/' \
    -e 's/^## Jordan —/## Devon Ruiz —/' \
    -e 's/^## Sam —/## Lena Kim —/' \
    -e 's/^## Maya —/## Taylor Brooks —/'

  # .github/workflows/ci.yml — the application's own lint/test/build workflow
  # is the one CI file the template cannot ship (the stack is the adopter's
  # choice), so a completed setup has added one. The harness workflows
  # (governance, security, docs, release), Dependabot and the issue/PR
  # templates ship with the template and must already be in HEAD — the
  # simulation deliberately does NOT create them, so a port that drops one, or
  # leaves .gitlab-ci.yml / renovate.json behind, fails Case 2 here.
  mkdir -p "$d/.github/workflows"
  cat > "$d/.github/workflows/ci.yml" <<'CIEOF'
name: ci
on: [pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "application tests run here"
CIEOF

  # Makefile — drop the commented Node/multi-stack example recipe lines that
  # trip the "uncomment your stack" check; a customized Makefile has either
  # picked one stack (uncommented) or deleted the unused examples.
  sed_edit "$d/Makefile" '/^#.*cd (frontend|backend)/d'

  # .github/ISSUE_TEMPLATE/config.yml — the security link's repository name.
  sed_edit "$d/.github/ISSUE_TEMPLATE/config.yml" 's#github\.com/OWNER/REPO/#github.com/acme/widget/#'

  # CONTRIBUTING.md
  sed_edit "$d/CONTRIBUTING.md" 's/\[PROJECT NAME\]/Acme Widget/g'
  sed_edit "$d/CONTRIBUTING.md" 's/\[FILL IN[^]]*\]/#support on Slack/g'

  # .claude/hooks/post-edit-checks.sh — retarget the example file patterns
  # at a real stack instead of the template's placeholder module names.
  replace_first "$d/.claude/hooks/post-edit-checks.sh" \
    'parser.py (Python), importer.ts (TypeScript)' 'ibkr_parser.py, edavki_writer.py'

  # scripts/release.sh and docs/adr/ already report clean on a pristine
  # checkout of this repo (no template placeholder left in either) — nothing
  # to simulate.

  # Git hooks + .env — the parts of "finish onboarding" that aren't a
  # placeholder-text edit.
  (cd "$d" && bash scripts/setup-hooks.sh >/dev/null)
  cp "$d/.env.example" "$d/.env"
}

# Every literal token scripts/customize.sh checks for, across the files it
# templates. Grep must find ZERO hits after a completed kickoff.
PLACEHOLDER_PATTERNS=(
  '\[PROJECT NAME\]'
  '\[FILL IN'
  'SETUP CHECKLIST'
  '\[REMOVE IF NOT APPLICABLE\]'
)

assert_no_placeholders() { # <dir> <relative files...>
  local d="$1"; shift
  local f hits=0
  for f in "$@"; do
    for pat in "${PLACEHOLDER_PATTERNS[@]}"; do
      if grep -qE "$pat" "$d/$f" 2>/dev/null; then
        echo "  (leftover '$pat' in $f)" >&2
        hits=$((hits + 1))
      fi
    done
  done
  return "$hits"
}

# A cheap, dependency-free "does this still read as sane markdown" check —
# this repo has no markdown parser installed (checked: no `markdown` or
# `mistune` module), and check-docs-internal-links.py's own convention is
# regex heuristics over the raw text, not a real parser. Balanced HTML
# comments, balanced code fences, non-empty, at least one heading.
assert_markdown_sane() { # <file>
  local f="$1" open close fences
  [[ -s "$f" ]] || return 1
  open="$(grep -c '<!--' "$f" || true)"
  close="$(grep -c -- '-->' "$f" || true)"
  [[ "$open" -eq "$close" ]] || return 1
  fences="$(grep -c '^```' "$f" || true)"
  [[ $((fences % 2)) -eq 0 ]] || return 1
  grep -q '^#' "$f" || return 1
  return 0
}

run_customize() { # <dir> -> prints combined stdout+stderr, returns customize.sh's exit code
  (cd "$1" && bash scripts/customize.sh) 2>&1
}

run_doctor() { # <dir> -> prints combined stdout+stderr, returns doctor.sh's exit code
  (cd "$1" && bash scripts/doctor.sh) 2>&1
}

# ─── Case 1: a fresh, uncustomized clone reports outstanding TODOs ────────────
#
# While HEAD is still the template, this is the baseline negative control: a
# "just cloned" tree must report TODOs, and if it ever silently passes
# (Remaining: 0), customize.sh stopped detecting the very placeholders it ships
# with. After /kickoff, HEAD is customized on purpose, so those two assertions
# would test the project's progress rather than the script; Case 3's injected
# placeholders prove detection instead.

D1="$TMP/fresh"
build_scratch_clone "$D1"

set +e
out_fresh="$(run_customize "$D1")"; rc_fresh=$?
set -e

if grep -qF '[PROJECT NAME]' "$D1/CLAUDE.md"; then
  r=1; [[ "$rc_fresh" -ne 0 ]] && r=0
  check "fresh clone: customize.sh exits non-zero (outstanding TODOs)" "$r"

  r=1
  case "$out_fresh" in
    *"Remaining: 0"*) ;;
    *"Remaining: "*) r=0 ;;
  esac
  check "fresh clone: at least one [ ] TODO item reported" "$r"
else
  echo "SKIP: fresh clone TODO assertions — HEAD has run /kickoff (no [PROJECT NAME] left); Case 3 proves detection."
fi

# The project is hosted on GitHub: the manual-settings checklist and the next
# steps must be GitHub's, and nothing may still point a new adopter at GitLab.
r=1
case "$out_fresh" in
  *"GitHub repository settings"*"Private vulnerability reporting"*"status:wip"*"gh auth login"*) r=0 ;;
esac
check "fresh clone: GitHub settings checklist and 'gh auth login' are printed" "$r"
r=0; grep -qiE 'glab|gitlab →|GitLab project settings' <<< "$out_fresh" && r=1
check "fresh clone: no GitLab settings or glab commands in the report" "$r"

# ─── Case 2: a simulated completed /kickoff reports all clear ────────────────

D2="$TMP/customized"
build_scratch_clone "$D2"
simulate_kickoff "$D2"

set +e
out_done="$(run_customize "$D2")"; rc_done=$?
set -e

r=1; [[ "$rc_done" -eq 0 ]] && r=0
check "customized clone: customize.sh exits 0" "$r"
[[ "$rc_done" -eq 0 ]] || echo "  (customize.sh output:)"$'\n'"$out_done" >&2

r=1
case "$out_done" in
  *"Remaining: 0"*) r=0 ;;
esac
check "customized clone: 'Remaining: 0' reported" "$r"
[[ "$r" -eq 0 ]] || echo "  (customize.sh output:)"$'\n'"$out_done" >&2

assert_no_placeholders "$D2" CLAUDE.md .claude/personas.md CONTRIBUTING.md Makefile
r=$?
check "customized clone: no leftover placeholder tokens in templated files" "$r"

r=1; assert_markdown_sane "$D2/CLAUDE.md" && r=0
check "customized clone: CLAUDE.md still reads as sane markdown" "$r"

# Git hooks actually landed where doctor.sh/customize.sh look for them —
# resolved with the same helper they use, not a literal .git/hooks path
# (git-common-dir can be relative, and relative to git's invocation dir, not
# whatever directory happens to be $PWD when this test reads it — see
# scripts/lib/git-hooks-dir.sh's own header on this exact pitfall).
r=1; [[ -L "$(git_hooks_dir "$D2")/pre-push" ]] && r=0
check "customized clone: pre-push hook installed" "$r"

set +e
out_doctor="$(run_doctor "$D2")"; rc_doctor=$?
set -e
r=1; [[ "$rc_doctor" -eq 0 ]] && r=0
check "customized clone: doctor.sh smoke run exits 0 (git/make/python3 present, hooks + .env in place)" "$r"
[[ "$r" -eq 0 ]] || echo "  (doctor.sh output:)"$'\n'"$out_doctor" >&2

# ─── Case 3: negative control — a surviving placeholder is caught ────────────
#
# Per issue #53: prove the gate FAILS if customize.sh leaves a placeholder
# behind. Done automatically here (not by hand-editing and restoring) so it
# reruns on every pipeline instead of proving something only once.

D3="$TMP/regressed"
cp -R "$D2" "$D3"
printf '\n[PROJECT NAME]\n' >> "$D3/CLAUDE.md"

set +e
out_regressed="$(run_customize "$D3")"; rc_regressed=$?
set -e

r=1; [[ "$rc_regressed" -ne 0 ]] && r=0
check "negative control: a reintroduced [PROJECT NAME] makes customize.sh fail again" "$r"

r=1
case "$out_regressed" in
  *"Replace [PROJECT NAME]"*) r=0 ;;
esac
check "negative control: customize.sh names the specific regression" "$r"

# Second instance of the same shape, on a different file/check, so the
# control isn't just proving one grep still works.
D4="$TMP/regressed-personas"
cp -R "$D2" "$D4"
printf '\n## Alex — Solo Developer\n' >> "$D4/.claude/personas.md"

set +e
out_regressed2="$(run_customize "$D4")"; rc_regressed2=$?
set -e

r=1; [[ "$rc_regressed2" -ne 0 ]] && r=0
check "negative control: a reintroduced example persona makes customize.sh fail again" "$r"

r=1
case "$out_regressed2" in
  *"Replace the example personas"*) r=0 ;;
esac
check "negative control: customize.sh names the persona regression" "$r"

[[ "$fail" -eq 0 ]] && echo "customize-e2e: self-test passed."
exit "$fail"
