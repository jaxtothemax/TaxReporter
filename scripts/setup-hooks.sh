#!/usr/bin/env bash
# Install git hooks from hooks/ into the real git hooks directory, via symlinks.
# Run via: make setup (or directly: ./scripts/setup-hooks.sh)
#
# Resolves the hooks directory with `git rev-parse --git-common-dir` rather
# than assuming `.git/hooks` is a literal path, because it isn't one inside a
# `scripts/wt` worktree — `.git` there is a FILE pointing at the main
# checkout's git dir, not a directory (issue #49). Installing into the common
# dir is deliberate, not incidental: hooks are repo-wide policy, so one install
# from any worktree (or the main checkout) covers all of them.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/hooks"

# shellcheck source-path=SCRIPTDIR source=lib/git-hooks-dir.sh
. "$REPO_ROOT/scripts/lib/git-hooks-dir.sh"

if [[ ! -d "$HOOKS_SRC" ]]; then
  echo "No hooks/ directory found — skipping hook installation."
  exit 0
fi

if ! HOOKS_DST="$(git_hooks_dir "$REPO_ROOT")"; then
  echo "ERROR: not a git repository (git rev-parse --git-common-dir failed)." >&2
  exit 1
fi

if [[ ! -d "$HOOKS_DST" ]]; then
  echo "ERROR: git hooks directory ($HOOKS_DST) not found." >&2
  exit 1
fi

INSTALLED=0
for hook in "$HOOKS_SRC"/*; do
  [[ ! -f "$hook" ]] && continue
  name="$(basename "$hook")"

  # Back up existing non-symlink hooks
  if [[ -f "$HOOKS_DST/$name" && ! -L "$HOOKS_DST/$name" ]]; then
    echo "  Backing up existing $name → $name.bak"
    mv "$HOOKS_DST/$name" "$HOOKS_DST/$name.bak"
  fi

  ln -sf "$hook" "$HOOKS_DST/$name"
  chmod +x "$hook"
  INSTALLED=$((INSTALLED + 1))
done

echo "Installed $INSTALLED git hook(s) from hooks/ → $HOOKS_DST"
