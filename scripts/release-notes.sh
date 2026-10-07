#!/usr/bin/env bash
# scripts/release-notes.sh <version> — generate release notes for a version.
#
# Writes docs/releases/v<version>.md and prints it. Called by scripts/release.sh
# after the CHANGELOG rotation, and safe to run by hand to preview.
#
# ## Why this exists
#
# `release.sh` used to compute a RELEASE_NOTES variable and then never use it —
# a dead assignment, so every release shipped with whatever notes someone pasted
# into the forge UI by hand, or none. The notes are derivable from artifacts the
# release already produces; deriving them is the difference between notes that
# match the release and notes that describe what someone remembered.
#
# ## What it produces
#
#   1. **What's included** — the version's own CHANGELOG section, verbatim. This
#      is the human-authored, curated part: it is what the fragments said.
#   2. **Changes since <previous release>** — the merge/commit list between the
#      previous release tag and HEAD. This is the mechanical part: it catches
#      what shipped without a fragment, which is exactly what a curated list
#      cannot tell you about itself.
#
# Both, deliberately. (1) alone hides anything that skipped a fragment; (2) alone
# is a commit dump nobody reads.
#
# ## Previous-release detection
#
# Only tags matching v<major>.<minor>.<patch> count. A tag that is not semver was
# not produced by this release process, so it cannot be assumed to mark a release
# — but its existence is reported rather than ignored, because "there is no
# previous release" and "there is an older tag that was never a release" are
# different facts and the reader needs the second one.
#
# ## Usage
#
#   scripts/release-notes.sh 0.2.0
#   scripts/release-notes.sh 0.2.0 --stdout      # do not write the file
#   scripts/release-notes.sh --self-test

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Self-test ───────────────────────────────────────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  rc=0

  mkdir -p "$tmp/scripts"
  cp "${BASH_SOURCE[0]}" "$tmp/scripts/release-notes.sh"
  cat > "$tmp/CHANGELOG.md" <<'FIXTURE'
# Changelog

## [Unreleased]

---

## [9.9.9] — 2099-01-01

### Added
- A thing that was added

### Fixed
- A thing that was fixed

---
FIXTURE
  (cd "$tmp" && git init -q -b main && git config user.email t@t && git config user.name t \
     && git add -A && git commit -qm "init")

  out="$(cd "$tmp" && bash scripts/release-notes.sh 9.9.9 --stdout 2>/dev/null)" || true
  case "$out" in
    *"A thing that was added"*) echo "SELF-TEST OK: the version's CHANGELOG section is extracted." ;;
    *) echo "SELF-TEST FAILED: notes do not contain the version's changelog entries." >&2; rc=1 ;;
  esac
  case "$out" in
    *"[Unreleased]"*)
      echo "SELF-TEST FAILED: notes leaked the [Unreleased] section." >&2; rc=1 ;;
    *) echo "SELF-TEST OK: the [Unreleased] section is not included." ;;
  esac
  case "$out" in
    *"first release"*|*"No previous release"*) echo "SELF-TEST OK: absent predecessor is stated, not silently omitted." ;;
    *) echo "SELF-TEST FAILED: no statement about the previous release." >&2; rc=1 ;;
  esac

  # A version with no CHANGELOG section must FAIL, not emit empty notes.
  if (cd "$tmp" && bash scripts/release-notes.sh 1.2.3 --stdout >/dev/null 2>&1); then
    echo "SELF-TEST FAILED: a version with no CHANGELOG section produced notes." >&2; rc=1
  else
    echo "SELF-TEST OK: a version with no CHANGELOG section fails."
  fi

  [ "$rc" -eq 0 ] && echo "SELF-TEST: all cases passed."
  exit "$rc"
fi

VERSION="${1:-}"
STDOUT_ONLY=""
[ "${2:-}" = "--stdout" ] && STDOUT_ONLY=1

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [--stdout]" >&2
  exit 2
fi

cd "$REPO_ROOT"
CHANGELOG="CHANGELOG.md"
TMP_NOTES="$(mktemp)"
# shellcheck disable=SC2064
trap "rm -f '$TMP_NOTES'" EXIT
TAG="v${VERSION}"

[ -f "$CHANGELOG" ] || { echo "ERROR: $CHANGELOG not found." >&2; exit 2; }

# ─── 1. The version's own CHANGELOG section ─────────────────────────────────
#
# Matched on the exact version so [Unreleased] can never be picked up by
# accident — shipping the next release's notes as this one's is a silent and
# very confusing error.
SECTION="$(awk -v v="$VERSION" '
  $0 ~ "^## \\[" v "\\]" { found=1; next }
  found && /^## \[/       { exit }
  found                   { print }
' "$CHANGELOG" | sed '/^---[[:space:]]*$/d')"

# Strip leading/trailing blank lines without collapsing the interior.
SECTION="$(printf '%s\n' "$SECTION" | sed -e '/./,$!d' | awk 'NF {p=NR} {l[NR]=$0} END {for(i=1;i<=p;i++) print l[i]}')"

if [ -z "$SECTION" ]; then
  echo "ERROR: no '## [${VERSION}]' section in $CHANGELOG." >&2
  echo "       Run the CHANGELOG rotation first (scripts/release.sh does this)." >&2
  exit 1
fi

# ─── 2. Previous release, and the commit range since it ─────────────────────
PREV_TAG="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | grep -vxF "$TAG" \
  | sort -V | tail -n 1 || true)"

# Tags that exist but were not produced by this process. Reported, not assumed.
NONCONFORMING="$(git tag -l | grep -vE '^v[0-9]+\.[0-9]+\.[0-9]+$' | tr '\n' ' ' | sed 's/ *$//' || true)"

if [ -n "$PREV_TAG" ]; then
  RANGE_HEADING="Changes since ${PREV_TAG}"
  RANGE_BODY="$(git log --no-merges --pretty='- %s' "${PREV_TAG}..HEAD" 2>/dev/null || true)"
  [ -n "$RANGE_BODY" ] || RANGE_BODY="- (no commits between ${PREV_TAG} and HEAD)"
  PREV_NOTE=""
else
  RANGE_HEADING="Changes in this release"
  RANGE_BODY="$(git log --no-merges --pretty='- %s' 2>/dev/null | sed -n '1,100p' || true)"
  if [ -n "$NONCONFORMING" ]; then
    PREV_NOTE="No previous release: this is the first release cut through this process. The repository does carry earlier tag(s) — \`${NONCONFORMING}\` — which were markers rather than releases (no changelog section, no release notes, and not \`vMAJOR.MINOR.PATCH\`). They are left in place as history."
  else
    PREV_NOTE="No previous release: this is the first release."
  fi
fi

# ─── 3. Emit ────────────────────────────────────────────────────────────────
#
# Assembled with printf rather than a heredoc: the notes body contains backticks,
# apostrophes, and `$(...)`-shaped text from the changelog, and an unquoted
# heredoc would try to expand them.
{
  printf '# %s — %s\n\n' "$TAG" "$(date +%Y-%m-%d)"
  if [ -n "$PREV_NOTE" ]; then
    printf '> %s\n\n' "$PREV_NOTE"
  fi
  printf '## What is included\n\n'
  printf '%s\n\n' "$SECTION"
  printf '## %s\n\n' "$RANGE_HEADING"
  printf '%s\n' "<!-- Mechanical: every non-merge commit in the range. A change listed"
  printf '%s\n\n' "     here with no entry above shipped without a changelog fragment. -->"
  printf '%s\n' "$RANGE_BODY"
} > "$TMP_NOTES"

cat "$TMP_NOTES"

if [ -z "$STDOUT_ONLY" ]; then
  mkdir -p docs/releases
  cp "$TMP_NOTES" "docs/releases/${TAG}.md"
  echo "" >&2
  echo "Wrote docs/releases/${TAG}.md" >&2
  # Publishing is release.yml's job once the tag is pushed (it reads this exact
  # file); the gh command is the manual fallback and the preview of what it runs.
  echo "Published on tag push by .github/workflows/release.yml; by hand:" >&2
  echo "  gh release create ${TAG} --verify-tag --title ${TAG} --notes-file docs/releases/${TAG}.md" >&2
fi
