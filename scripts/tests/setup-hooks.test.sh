#!/usr/bin/env bash
# scripts/tests/setup-hooks.test.sh — scripts/setup-hooks.sh installs hooks
# correctly from BOTH a main checkout and a `scripts/wt`-style worktree.
#
# The bug (issue #49): the script assumed `.git/hooks` was a literal directory
# path from the repo root. That's only true in the main checkout — inside a
# worktree, `.git` is a FILE holding a `gitdir:` pointer at the main checkout's
# `.git/worktrees/<name>/`, so the literal path never exists and the script
# errored (exit 1, "ERROR: .git/hooks/ not found") on every worktree, silently
# for nobody: it was loud, but wrong — hooks are repo-wide, and a worktree is a
# perfectly good place to install them from.
#
# The fix resolves the real hooks directory with `git rev-parse
# --git-common-dir` (scripts/lib/git-hooks-dir.sh), which is deliberately
# SHARED across the main checkout and every worktree — hooks are repo-wide
# policy, not per-worktree state, so one install from anywhere should cover
# all of them. This is the case that exercises that: install from the
# worktree, then assert the hook is visible from the main checkout's own
# .git/hooks, and vice versa.
#
# Hermetic: builds its own throwaway repo + worktree under mktemp, copies the
# real scripts under test into it (so a regression in the shipped script is
# what this test would catch, not a hand-written stand-in), and never touches
# this checkout's own .git/hooks.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # <label> <0 = pass>
  if [[ "$2" -eq 0 ]]; then echo "SELF-TEST OK: $1"
  else echo "SELF-TEST FAILED: $1" >&2; fail=1; fi
}

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

D="$TMP/repo"
mkdir -p "$D/scripts/lib" "$D/hooks"
cp "$REPO_ROOT/scripts/setup-hooks.sh" "$D/scripts/setup-hooks.sh"
cp "$REPO_ROOT/scripts/lib/git-hooks-dir.sh" "$D/scripts/lib/git-hooks-dir.sh"
chmod +x "$D/scripts/setup-hooks.sh"

cat > "$D/hooks/pre-commit" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$D/hooks/pre-push" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$D/hooks/pre-commit" "$D/hooks/pre-push"

(
  cd "$D"
  git init -q -b main
  git config user.email t@example.com
  git config user.name t
  git add -A
  git commit -qm init
)

# --- Case 1: main checkout ---------------------------------------------------
out_main="$(cd "$D" && bash scripts/setup-hooks.sh 2>&1)"; status_main=$?
r=1; [[ "$status_main" -eq 0 ]] && r=0
check "main checkout: exit 0" "$r"
case "$out_main" in
  *"Installed 2 git hook(s)"*) ;;
  *) echo "  (main checkout output: $out_main)" ;;
esac
r=1; [[ -L "$D/.git/hooks/pre-commit" ]] && r=0
check "main checkout: pre-commit symlinked into .git/hooks" "$r"
r=1; [[ -L "$D/.git/hooks/pre-push" ]] && r=0
check "main checkout: pre-push symlinked into .git/hooks" "$r"

# Remove them again — the worktree case below must not depend on this having
# already run, so it starts from a clean (uninstalled) state too.
rm -f "$D/.git/hooks/pre-commit" "$D/.git/hooks/pre-push"

# --- Case 2: a scripts/wt-style worktree -------------------------------------
W="$TMP/wt"
git -C "$D" worktree add -q --no-track -b wt-branch "$W" main

# Precondition: this is genuinely the broken environment — .git is a FILE, not
# a directory, from inside the worktree. If this ever stops being true (a git
# behavior change), the case below proves nothing, so assert it explicitly.
r=1; [[ -f "$W/.git" && ! -d "$W/.git" ]] && r=0
check "precondition: worktree's .git is a file, not a directory" "$r"

out_wt="$(cd "$W" && bash scripts/setup-hooks.sh 2>&1)"; status_wt=$?
r=1; [[ "$status_wt" -eq 0 ]] && r=0
check "worktree: exit 0 (was exit 1 before the fix)" "$r"
[[ "$status_wt" -ne 0 ]] && echo "  (worktree output: $out_wt)"

# The install target is the SHARED common dir — visible from the main
# checkout's own .git/hooks, not stashed somewhere under the worktree.
r=1; [[ -L "$D/.git/hooks/pre-commit" ]] && r=0
check "worktree install lands in the shared common hooks dir" "$r"

# And resolvable from the worktree's own git-common-dir too, confirming it's
# genuinely the SAME file, not a coincidental second copy.
common_dir_from_wt="$(git -C "$W" rev-parse --git-common-dir)"
case "$common_dir_from_wt" in
  /*) : ;;
  *) common_dir_from_wt="$W/$common_dir_from_wt" ;;
esac
r=1; [[ -L "$common_dir_from_wt/hooks/pre-commit" ]] && r=0
check "worktree's own --git-common-dir resolves to the same install" "$r"

git -C "$D" worktree remove -f "$W" 2>/dev/null || true

[[ "$fail" -eq 0 ]] && echo "setup-hooks: self-test passed."
exit "$fail"
