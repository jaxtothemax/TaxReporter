#!/usr/bin/env bash
# assemble-changelog.sh — Collect changelog.d/ fragments into CHANGELOG.md
#
# Called by scripts/release.sh before the version rotation step, or manually
# when you want to preview what the assembled changelog will look like.
#
# Usage:
#   scripts/assemble-changelog.sh            # assemble and delete fragments
#   scripts/assemble-changelog.sh --dry-run  # preview without modifying files
#
# Fragment files must be named: <slug>.<type>.md
# where <type> is one of: added, changed, fixed, security
#
# The script appends entries to the existing [Unreleased] section headings in
# CHANGELOG.md (creating subsection headings as needed) and removes the
# consumed fragment files.

set -euo pipefail

# Normalise a fragment on stdin into well-formed markdown bullets.
#
# Three authoring styles all have to survive this, and the naive version
# ("prefix `- ` unless the line already starts with `- ` or two spaces")
# silently destroyed the third: a fragment written as a wrapped paragraph got
# EVERY line turned into its own bullet. The output was still valid markdown, so
# nothing downstream complained and the mangling surfaced only in the published
# release notes.
#
#   1. `- bullet` with two-space-indented continuations  -> passed through
#   2. `- bullet` with UNINDENTED continuations          -> continuations indented
#   3. a wrapped paragraph with no bullet marker at all  -> one bullet, wrapped
#
# The rule: a new bullet starts only at the top of the fragment or after a blank
# line. Anything else continues the bullet above it.
#
# `|| [[ -n "$line" ]]`: `read` returns non-zero on a final line with no trailing
# newline, and the loop would otherwise drop it — silently losing the last bullet
# of any fragment saved without one.
normalize_fragment_bullets() {
  local line prev_blank=1
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" ]]; then prev_blank=1; continue; fi
    if [[ "$line" == "- "* || "$line" == "* "* || "$line" == "  "* ]]; then
      echo "$line"
    elif (( prev_blank )); then
      echo "- $line"
    else
      echo "  $line"
    fi
    prev_blank=0
  done
}

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$REPO_ROOT/CHANGELOG.md"
FRAG_DIR="$REPO_ROOT/changelog.d"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# ── Self-test ─────────────────────────────────────────────────────────────────
#
# Covers the bullet normaliser only — the part that silently produced wrong
# output rather than failing. Run with: scripts/assemble-changelog.sh --self-test
if [[ "${1:-}" == "--self-test" ]]; then
  rc=0
  _case() { # <label> <input> <expected>
    local got; got="$(printf '%s' "$2" | normalize_fragment_bullets)"
    if [[ "$got" == "$3" ]]; then
      echo "SELF-TEST OK: $1"
    else
      echo "SELF-TEST FAILED: $1" >&2
      echo "--- got ---"      >&2; printf '%s\n' "$got" >&2
      echo "--- wanted ---"   >&2; printf '%s\n' "$3"   >&2
      rc=1
    fi
  }

  _case "bullets with indented continuations pass through" \
    '- first line
  wrapped
- second' \
    '- first line
  wrapped
- second'

  _case "an unindented continuation is indented, not made a bullet" \
    '- first line
wrapped' \
    '- first line
  wrapped'

  # The regression this self-test exists for: a fragment written as a wrapped
  # paragraph became one bullet per LINE, and shipped that way in the release
  # notes because the result was still valid markdown.
  _case "a wrapped paragraph becomes ONE bullet" \
    'a paragraph that
wraps across
three lines' \
    '- a paragraph that
  wraps across
  three lines'

  _case "a blank line starts a new bullet" \
    'first para
wrapped

second para' \
    '- first para
  wrapped
- second para'

  _case "an asterisk bullet is respected" '* starred' '* starred'

  [[ $rc -eq 0 ]] && echo "assemble-changelog: self-test passed."
  exit $rc
fi

# ── Validate ──────────────────────────────────────────────────────────────────

if [[ ! -f "$CHANGELOG" ]]; then
  echo "ERROR: $CHANGELOG not found." >&2
  exit 1
fi

if ! grep -q "## \[Unreleased\]" "$CHANGELOG"; then
  echo "ERROR: CHANGELOG.md has no [Unreleased] section." >&2
  exit 1
fi

# Collect fragment files (ignore README.md and .gitkeep)
FRAGMENTS=()
for f in "$FRAG_DIR"/*.md; do
  [[ ! -f "$f" ]] && continue
  [[ "$(basename "$f")" == "README.md" ]] && continue
  FRAGMENTS+=("$f")
done

if [[ ${#FRAGMENTS[@]} -eq 0 ]]; then
  echo "No changelog fragments to assemble."
  exit 0
fi

# ── Validate fragment filenames ───────────────────────────────────────────────

VALID_TYPES="added changed fixed security"
ERRORS=0

for f in "${FRAGMENTS[@]}"; do
  base="$(basename "$f")"
  # The slug may contain dots (e.g. `audit-1.1-followup.changed.md`). The type
  # parser below already reads the LAST dot-separated field, so rejecting a
  # dotted slug here made the validator stricter than the parser it guards —
  # a fragment the assembler could handle perfectly still aborted the release.
  if ! grep -qE '^[a-zA-Z0-9._-]+\.(added|changed|fixed|security)\.md$' <<<"$base"; then
    echo "ERROR: Invalid fragment filename: $base" >&2
    echo "  Expected: <issue-or-slug>.<type>.md" >&2
    echo "  Valid types: $VALID_TYPES" >&2
    echo "  Examples: 434.fixed.md, my-feature.added.md" >&2
    ERRORS=$((ERRORS + 1))
  fi
  if [[ ! -s "$f" ]]; then
    echo "ERROR: Empty fragment file: $base" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [[ $ERRORS -gt 0 ]]; then
  echo "Aborting — fix the $ERRORS error(s) above." >&2
  exit 1
fi

# ── Group fragments by type ──────────────────────────────────────────────────

TMP_ADDED=$(mktemp)
TMP_CHANGED=$(mktemp)
TMP_FIXED=$(mktemp)
TMP_SECURITY=$(mktemp)
trap 'rm -f "$TMP_ADDED" "$TMP_CHANGED" "$TMP_FIXED" "$TMP_SECURITY"' EXIT

for f in "${FRAGMENTS[@]}"; do
  base="$(basename "$f")"
  type="$(echo "$base" | sed 's/\.md$//' | rev | cut -d. -f1 | rev)"

  normalize_fragment_bullets < "$f" >> "$(eval echo "\$TMP_$(echo "$type" | tr '[:lower:]' '[:upper:]')")"
done

# ── Preview mode ──────────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo "=== Dry run — entries that would be added ==="
  echo
  for type in added changed fixed security; do
    tmpfile="$(eval echo "\$TMP_$(echo "$type" | tr '[:lower:]' '[:upper:]')")"
    if [[ -s "$tmpfile" ]]; then
      case "$type" in
        added)    echo "### Added" ;;
        changed)  echo "### Changed" ;;
        fixed)    echo "### Fixed" ;;
        security) echo "### Security" ;;
      esac
      cat "$tmpfile"
      echo
    fi
  done
  echo "=== ${#FRAGMENTS[@]} fragment(s) would be consumed ==="
  exit 0
fi

# ── Insert entries into CHANGELOG.md ──────────────────────────────────────────

python3 - "$CHANGELOG" "$TMP_ADDED" "$TMP_CHANGED" "$TMP_FIXED" "$TMP_SECURITY" << 'PYEOF'
import sys, os, re

changelog_path = sys.argv[1]
tmp_files = {
    "### Added":    sys.argv[2],
    "### Changed":  sys.argv[3],
    "### Fixed":    sys.argv[4],
    "### Security": sys.argv[5],
}

HEADING_ORDER = ["### Added", "### Changed", "### Fixed", "### Security"]

new_entries = {}
for heading, path in tmp_files.items():
    content = open(path).read().strip()
    if content:
        new_entries[heading] = content

if not new_entries:
    sys.exit(0)

with open(changelog_path) as f:
    lines = f.readlines()

unreleased_start = None
unreleased_end = None
for i, line in enumerate(lines):
    if line.startswith("## [Unreleased]"):
        unreleased_start = i
        continue
    if unreleased_start is not None and line.startswith("## ["):
        unreleased_end = i
        break

if unreleased_start is None:
    print("ERROR: No [Unreleased] section found.", file=sys.stderr)
    sys.exit(1)

if unreleased_end is None:
    unreleased_end = len(lines)

block = lines[unreleased_start:unreleased_end]

for heading in HEADING_ORDER:
    if heading not in new_entries:
        continue
    entry_lines = new_entries[heading] + "\n"

    heading_idx = None
    for i, line in enumerate(block):
        if line.strip() == heading:
            heading_idx = i
            break

    if heading_idx is not None:
        last_bullet = heading_idx
        for i in range(heading_idx + 1, len(block)):
            stripped = block[i]
            if stripped.startswith("- ") or stripped.startswith("  "):
                last_bullet = i
            elif stripped.strip() == "":
                continue
            else:
                break
        block.insert(last_bullet + 1, entry_lines)
    else:
        insert_before = None
        my_order = HEADING_ORDER.index(heading)
        for i, line in enumerate(block):
            if line.strip() in HEADING_ORDER:
                their_order = HEADING_ORDER.index(line.strip())
                if their_order > my_order:
                    insert_before = i
                    break

        new_section = "\n" + heading + "\n" + entry_lines
        if insert_before is not None:
            block.insert(insert_before, new_section)
        else:
            block.append(new_section)

result = lines[:unreleased_start] + block + lines[unreleased_end:]

with open(changelog_path, "w") as f:
    f.writelines(result)
PYEOF

# ── Clean up fragments ───────────────────────────────────────────────────────

for f in "${FRAGMENTS[@]}"; do
  rm "$f"
done

echo "Assembled ${#FRAGMENTS[@]} fragment(s) into CHANGELOG.md and removed them from changelog.d/."
