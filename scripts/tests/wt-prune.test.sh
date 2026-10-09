#!/usr/bin/env bash
# scripts/tests/wt-prune.test.sh — how `wt prune` decides a worktree's branch merged.
#
# The bug: prune counted a branch as merged only when its local tip was an ancestor
# of the default branch. A tip rewritten after its last push — an amend, a local
# rebase, a forge-side rebase — never reaches the default branch by SHA even though
# its content did, and a squash merge never does at all. Prune warned "commits NOT in
# origin/main" and kept those worktrees forever, so merged worktrees piled up past
# the WIP cap.
#
# The fix must not trade a false keep for a false prune, so each widened path has a
# near-identical negative twin that must SURVIVE: a squash merge whose PR head is not
# the local tip, and a branch where only SOME patches reached the default branch.
# Each positive case also asserts its precondition — that the ancestor test really
# fails for it — or it would pass against the unfixed script and prove nothing.
#
# The forge CLI is stubbed: the sandbox has no GitHub, and a real gh would fail every
# merged-PR lookup, so the squash case could never pass.

set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # <label> <0 = pass>
  if [[ "$2" -eq 0 ]]; then echo "SELF-TEST OK: $1"
  else echo "SELF-TEST FAILED: $1" >&2; fail=1; fi
}

# `gh pr list …` answers from $GH_STUB_JSON (default: no merged PRs), applying the
# `--jq '.[].headRefOid'` filter wt passes the way real gh would; anything else is
# a no-op. The stub also records that it was asked for MERGED PRs of the right head
# branch — a lookup that drifted to another state or branch would otherwise still
# pass the squash case on the fixture alone.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-} ${2:-}" == "pr list" ]]; then
  printf '%s\n' "$*" >> "${GH_STUB_LOG:-/dev/null}"
  [[ "$*" == *"--state merged"* ]] || exit 0
  python3 -c '
import json, sys
for pr in json.loads(sys.argv[1]):
    print(pr.get("headRefOid", ""))
' "${GH_STUB_JSON:-[]}"
fi
exit 0
EOF
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export WT_FORGE=gh
export GH_STUB_LOG="$TMP/gh.log"
# Sandbox worktrees are seconds old; without this every case is a grace-window keep.
export WT_GRACE_MIN=0
# Hermetic git: no user or system config (hooks paths, default branch, signing).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# mk_repo <dir> — a repo on main with a bare origin holding main.
mk_repo() {
  local d="$1"
  mkdir -p "$d"
  ( cd "$d"
    git init -q -b main
    git config user.email t@example.com
    git config user.name t
    echo base > README.md
    git add -A
    git commit -qm init
    git init -q --bare "$d.origin.git"
    git remote add origin "$d.origin.git"
    git push -q origin main
    git fetch -q origin
  )
}

# commit_in <dir> <name> — one commit adding <name>.txt.
commit_in() {
  echo "$2" > "$1/$2.txt"
  git -C "$1" add "$2.txt"
  git -C "$1" commit -qm "$2"
}

# add_wt <repo> <branch> <commits> — a worktree on <branch> with N commits, pushed
# WITH an upstream (prune skips never-pushed branches). Prints the worktree path.
add_wt() {
  local d="$1" b="$2" n="$3" p i
  p="$d.wt.${b//\//-}"
  git -C "$d" worktree add -q -b "$b" "$p" main 2>/dev/null
  for (( i = 1; i <= n; i++ )); do commit_in "$p" "${b//\//-}-$i"; done
  git -C "$p" push -q -u origin "$b" 2>/dev/null
  printf '%s' "$p"
}

# land <repo> <branch> — publish main and delete the branch on origin: what a forge
# merge with "delete source branch" leaves behind.
land() {
  git -C "$1" push -q origin main 2>/dev/null
  git -C "$1" push -q origin --delete "$2" 2>/dev/null
}

RUN_OUT=""
prune_in() { # prune_in <repo> [stubbed merged-PR json]
  RUN_OUT="$( cd "$1" && GH_STUB_JSON="${2:-[]}" bash "$WT" prune 2>&1 )" || true
}

not_ancestor() { # 0 when the branch tip is NOT in main's history
  ! git -C "$1" merge-base --is-ancestor "$2" main
}

# --- Case 1 (control): a merge-commit merge is pruned -------------------------
D="$TMP/c1"; mk_repo "$D"
P="$(add_wt "$D" feat/1-merge 1)"
git -C "$D" merge -q --no-ff feat/1-merge -m "Merge feat/1-merge"
land "$D" feat/1-merge
prune_in "$D"
check "merge-commit merge: worktree removed" "$([[ ! -d "$P" ]] && echo 0 || echo 1)"
check "merge-commit merge: reported as removed" "$(grep -q 'removed (merged to main, remote gone' <<< "$RUN_OUT"; echo $?)"

# --- Case 2: tip rewritten after its last push (the reported bug) -------------
D="$TMP/c2"; mk_repo "$D"
P="$(add_wt "$D" chore/2-amended 1)"
git -C "$D" merge -q --no-ff chore/2-amended -m "Merge chore/2-amended"
land "$D" chore/2-amended
git -C "$P" commit -q --amend -m "reworded after the push"
check "rewritten tip: precondition — not an ancestor of main" "$(not_ancestor "$D" chore/2-amended; echo $?)"
prune_in "$D"
check "rewritten tip whose patch is in main: worktree removed" "$([[ ! -d "$P" ]] && echo 0 || echo 1)"
check "rewritten tip: the report says why" "$(grep -q 'every patch already in main' <<< "$RUN_OUT"; echo $?)"

# --- Case 3: squash merge, merged PR head == local tip ------------------------
D="$TMP/c3"; mk_repo "$D"
P="$(add_wt "$D" feat/3-squash 2)"
git -C "$D" merge -q --squash feat/3-squash >/dev/null && git -C "$D" commit -qm "squashed"
land "$D" feat/3-squash
TIP="$(git -C "$D" rev-parse feat/3-squash)"
CHERRY="$(git -C "$D" cherry main feat/3-squash)"
check "squash: precondition — not an ancestor" "$(not_ancestor "$D" feat/3-squash; echo $?)"
check "squash: precondition — git cherry cannot see it" "$([[ "$CHERRY" == *"+ "* ]] && echo 0 || echo 1)"
prune_in "$D" "[{\"number\": 1, \"headRefOid\": \"$TIP\"}]"
check "squash merge whose PR head is the tip: worktree removed" "$([[ ! -d "$P" ]] && echo 0 || echo 1)"
check "squash: the lookup asked for merged PRs of this head branch" \
  "$(grep -q -- '--state merged --head feat/3-squash' "$GH_STUB_LOG"; echo $?)"

# --- Case 4: squash merge, but the PR head is NOT the local tip ---------------
D="$TMP/c4"; mk_repo "$D"
P="$(add_wt "$D" feat/4-squash 2)"
git -C "$D" merge -q --squash feat/4-squash >/dev/null && git -C "$D" commit -qm "squashed"
land "$D" feat/4-squash
prune_in "$D" '[{"number": 1, "headRefOid": "0000000000000000000000000000000000000000"}]'
check "squash merge whose PR head differs: worktree kept" "$([[ -d "$P" ]] && echo 0 || echo 1)"
check "squash merge whose PR head differs: warns not-in-main" "$(grep -q 'NOT in origin/main' <<< "$RUN_OUT"; echo $?)"

# --- Case 5: only some of the branch's patches reached main -------------------
D="$TMP/c5"; mk_repo "$D"
P="$(add_wt "$D" fix/5-partial 2)"
git -C "$D" cherry-pick "$(git -C "$P" rev-parse HEAD~1)" >/dev/null
land "$D" fix/5-partial
prune_in "$D"
check "partially landed branch: worktree kept" "$([[ -d "$P" ]] && echo 0 || echo 1)"

# --- Case 6: no forge CLI answers — a lookup failure keeps the worktree -------
D="$TMP/c6"; mk_repo "$D"
P="$(add_wt "$D" feat/6-offline 2)"
git -C "$D" merge -q --squash feat/6-offline >/dev/null && git -C "$D" commit -qm "squashed"
land "$D" feat/6-offline
RUN_OUT="$( cd "$D" && WT_FORGE=none bash "$WT" prune 2>&1 )" || true
check "squash merge with no forge to ask: worktree kept" "$([[ -d "$P" ]] && echo 0 || echo 1)"

# --- Case 7: a tracked harness file is not work; a tracked source file is -----
D="$TMP/c7"; mk_repo "$D"
echo "export A=1" > "$D/.envrc"
git -C "$D" add .envrc && git -C "$D" commit -qm "track envrc" && git -C "$D" push -q origin main 2>/dev/null
P="$(add_wt "$D" feat/7-envrc 1)"
Q="$(add_wt "$D" feat/7-readme 1)"
git -C "$D" merge -q --no-ff feat/7-envrc  -m "Merge feat/7-envrc"
git -C "$D" merge -q --no-ff feat/7-readme -m "Merge feat/7-readme"
land "$D" feat/7-envrc
git -C "$D" push -q origin --delete feat/7-readme 2>/dev/null
echo "export A=2" > "$P/.envrc"
echo "local edit" >> "$Q/README.md"
prune_in "$D"
check "merged worktree with only a modified tracked .envrc: removed" "$([[ ! -d "$P" ]] && echo 0 || echo 1)"
check "merged worktree with a modified tracked source file: kept" "$([[ -d "$Q" ]] && echo 0 || echo 1)"

[[ "$fail" -eq 0 ]] && echo "wt-prune: all cases passed."
exit "$fail"
