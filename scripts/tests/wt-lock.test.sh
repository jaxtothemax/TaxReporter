#!/usr/bin/env bash
# scripts/tests/wt-lock.test.sh — the `wt` issue check-out lock.
#
# The bug: every agent shares one forge identity, so nothing stopped two sessions
# (or two `/batch` waves) from taking the same issue and opening duplicate PRs.
# `wt new` / `wt claim` now apply a `status:wip` label plus a check-out comment and
# refuse an issue that already carries it; `wt remove` / `wt prune` / `wt release`
# clear it.
#
# The forge CLI is stubbed with a small stateful gh, because the sandbox has no
# GitHub. Each positive case has a negative twin: a locked issue is refused but
# --force takes it over; remove clears the label on a CLOSED issue and leaves it on
# an OPEN one; with no forge CLI the worktree is still created.

set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/wt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # <label> <0 = pass>
  if [[ "$2" -eq 0 ]]; then echo "SELF-TEST OK: $1"
  else echo "SELF-TEST FAILED: $1" >&2; fail=1; fi
}

# Stateful gh stub. State lives in $STUB_DIR/<issue>.{labels,state,notes} plus a
# repo-wide $STUB_DIR/repo.labels. `issue view --json …` emits the shape real gh
# does (label objects, OPEN/CLOSED, comment objects); a `--jq '.labels[].name'` /
# `'.comments[].body'` read — the collision gate's — gets the already-filtered lines.
mkdir -p "$TMP/bin" "$TMP/state"
export STUB_DIR="$TMP/state"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
d="$STUB_DIR"
printf '%s|%s\n' "${1:-} ${2:-}" "${GH_REPO:-}" >> "$d/calls.log"
case "${1:-} ${2:-}" in
  "issue view")
    n="$3"
    fields=""; shift 3
    while [[ $# -gt 0 ]]; do
      case "$1" in --json) fields="$2"; shift 2 ;; *) shift ;; esac
    done
    case "$fields" in
      title)    echo "Issue $n" ;;
      labels)   cat "$d/$n.labels" 2>/dev/null || true ;;
      comments) cat "$d/$n.notes" 2>/dev/null || true ;;
      *)
        python3 - "$d" "$n" <<'PY'
import json, os, sys
d, n = sys.argv[1], sys.argv[2]
def rd(ext):
    p = f"{d}/{n}.{ext}"
    return open(p).read().splitlines() if os.path.exists(p) else []
state = (rd("state") or ["open"])[0].upper()
print(json.dumps({"labels": [{"name": l} for l in rd("labels")], "state": state,
                  "comments": [{"body": b} for b in rd("notes")]}))
PY
        ;;
    esac ;;
  "issue edit")
    n="$3"; shift 3
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --add-label)    # real gh refuses a label the repo does not have
                        grep -qxF "$2" "$d/repo.labels" 2>/dev/null || exit 1
                        echo "$2" >> "$d/$n.labels"; shift 2 ;;
        --remove-label) { grep -vxF "$2" "$d/$n.labels" 2>/dev/null || true; } > "$d/$n.labels.tmp"
                        mv "$d/$n.labels.tmp" "$d/$n.labels"; shift 2 ;;
        *) shift ;;
      esac
    done ;;
  "issue comment")
    n="$3"; shift 3
    while [[ $# -gt 0 ]]; do
      case "$1" in --body) echo "$2" >> "$d/$n.notes"; shift 2 ;; *) shift ;; esac
    done ;;
  "label list")   cat "$d/repo.labels" 2>/dev/null || true ;;
  "label create") echo "$3" >> "$d/repo.labels" ;;
  "api "*)        printf '%s\n' "${GH_REPO:-}" >> "$d/api.ghrepo"; echo '[]' ;;
  *) ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export WT_FORGE=gh
export WT_GRACE_MIN=0
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

REPO="$TMP/repo"
mkdir -p "$REPO"
( cd "$REPO"
  git init -q -b main
  git config user.email t@example.com; git config user.name t
  echo base > README.md; git add -A; git commit -qm init
  git init -q --bare "$REPO.origin.git"
  git remote add origin "$REPO.origin.git"
  git push -q origin main; git fetch -q origin )
export WT_BASE="$TMP/wts"
wt() { ( cd "$REPO" && "$WT" "$@" ) 2>&1; }

# shellcheck disable=SC2317,SC2329  # invoked indirectly, through expect/expect_not
labels() { cat "$STUB_DIR/$1.labels" 2>/dev/null || true; }
# shellcheck disable=SC2317,SC2329
contains() { [[ "$1" == *"$2"* ]]; }
# shellcheck disable=SC2317,SC2329
has_label() { grep -qxF 'status:wip' <<<"$(labels "$1")"; }

# Assertions are written as `if` blocks so a failing condition is a recorded result
# rather than an errexit, and `$?` is never read stale.
# <label> <cmd...> — pass when the command succeeds / fails.
expect()     { local l="$1"; shift; if "$@"; then check "$l" 0; else check "$l" 1; fi; }
expect_not() { local l="$1"; shift; if "$@"; then check "$l" 1; else check "$l" 0; fi; }
# <label> <want-exit> <want-substring> <got-exit> <got-output>
expect_run() {
  if [[ "$4" -eq "$2" && "$5" == *"$3"* ]]; then check "$1" 0; else check "$1" 1; fi
}
# Run wt, capturing combined output in $out and exit status in $rc.
run() { rc=0; out="$(wt "$@")" || rc=$?; }
out="" rc=0

# new on a free issue applies the lock and records a check-out comment.
run new 11
expect "wt new applies status:wip to a free issue" has_label 11
expect "wt new posts a check-out comment" grep -q 'checked out' "$STUB_DIR/11.notes"
# gh refuses --add-label for a label the repository lacks, so wt creates it first —
# once: a second check-out must not create (and so re-color) it again.
expect "wt creates the missing lock label in the repository" grep -qxF 'status:wip' "$STUB_DIR/repo.labels"

# Negative twin: the same issue again is refused, and the refusal names the holder.
run new 11
expect_run "wt new refuses an issue that is already checked out" 1 "already checked out" "$rc" "$out"
expect_run "the refusal quotes the existing check-out comment" 1 "worktree" "$rc" "$out"

# --force takes it over (remove the first worktree so the path is free).
run remove 11 --force
run new 11 --force
expect_run "wt new --force takes over a locked issue" 0 "took over check-out of #11" "$rc" "$out"

# remove on an OPEN issue keeps the label; on a CLOSED issue clears it.
run remove 11
expect "wt remove leaves the label while the issue is still open" has_label 11
echo closed > "$STUB_DIR/11.state"
run new 11 --force
run remove 11
expect_not "wt remove clears the label once the issue is closed" has_label 11
expect_run "wt remove reports the release" 0 "released check-out of #11" "$rc" "$out"

# claim / release without a worktree.
run claim 22
expect "wt claim applies the label without a worktree" has_label 22
run claim 22
expect_run "wt claim refuses an already-claimed issue" 1 "already checked out" "$rc" "$out"
run claim 22 --force
expect_run "wt claim --force takes over" 0 "took over check-out of #22" "$rc" "$out"
run release 22
expect_not "wt release clears the label" has_label 22

# Fail-open: with no forge CLI the worktree is still created, with a warning.
rc=0; out="$(WT_FORGE=none wt new feat/33-no-forge)" || rc=$?
expect_run "wt new warns that the label will not be set, and still succeeds" 0 "no forge CLI" "$rc" "$out"
expect "wt new creates the worktree when no forge CLI is available" \
  grep -q 'feat/33-no-forge' <<<"$(git -C "$REPO" worktree list)"
expect_not "no label is applied without a forge CLI" has_label 33

expect "the lock label is created only once" \
  test "$(grep -cxF 'status:wip' "$STUB_DIR/repo.labels")" -eq 1

# A non-GitHub origin (here a local bare repo, as in a fresh scaffold with no
# GitHub remote yet) selects no forge at all — wt must not call gh against it.
rc=0; out="$(WT_FORGE='' wt new feat/34-local-origin)" || rc=$?
expect_run "a non-GitHub origin degrades to the no-forge warning" 0 "no forge CLI" "$rc" "$out"
expect_not "no label is applied for a non-GitHub origin" has_label 34

# With a GitHub origin, wt pins every gh call to that repository (GH_REPO), so a
# fork's `upstream` remote can never receive the lock. Nothing contacts the URL.
git -C "$REPO" remote set-url origin https://github.com/acme/widget.git
run claim 77
git -C "$REPO" remote set-url origin "$REPO.origin.git"
expect "wt pins gh to origin's repository when labeling (GH_REPO)" \
  grep -qxF 'issue edit|acme/widget' "$STUB_DIR/calls.log"
run release 77

# prune releases the lock of a merged-and-deleted branch.
B="feat/44-prune-lock"
wt new "$B" >/dev/null
expect "wt new on a numbered branch applies the label" has_label 44
P="$(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}' | grep '44-prune-lock')"
echo x > "$P/x.txt"; git -C "$P" add x.txt; git -C "$P" commit -qm x
git -C "$P" push -q -u origin "$B" 2>/dev/null
git -C "$REPO" fetch -q origin
git -C "$REPO" merge -q --no-ff "$B" -m merge 2>/dev/null; git -C "$REPO" push -q origin main
git -C "$REPO" push -q origin --delete "$B" 2>/dev/null
wt prune >/dev/null || true
expect_not "wt prune releases the check-out of a pruned branch" has_label 44

# The arg guard knows the new flags and rejects typos.
run claim --forse 5
expect_run "claim rejects a typo'd flag" 2 "unknown option: --forse" "$rc" "$out"

# The push-time collision gate must stay quiet for the claimant and speak for anyone
# else. It runs for real here (not in its fixture mode, which skips the label
# lookup): a scratch repo whose origin URL merely LOOKS like GitHub, so the gate
# picks the stubbed gh. Nothing contacts that URL.
CG="$(cd "$(dirname "$WT")" && pwd)/check-issue-collision.sh"
CGREPO="$TMP/cg"
mkdir -p "$CGREPO"
( cd "$CGREPO"
  git init -q -b main; git config user.email t@example.com; git config user.name t
  git remote add origin https://github.example.invalid/x/y.git
  git commit -q --allow-empty -m init; git checkout -q -b feat/55-claimant )
collide() { ( cd "$CGREPO" && bash "$CG" 2>&1 ); }
printf '%s\n' 'status:wip' > "$STUB_DIR/55.labels"
# shellcheck disable=SC2016  # literal backticks, as wt writes them
printf '%s\n' '🔒 checked out T · branch `feat/55-claimant` · worktree `/x`' > "$STUB_DIR/55.notes"
expect_not "collision gate is quiet when the check-out names this branch" \
  contains "$(collide)" "labelled"
# shellcheck disable=SC2016
printf '%s\n' '🔒 checked out T2 · branch `feat/55-someone-else` · worktree `/y`' >> "$STUB_DIR/55.notes"
expect "collision gate warns after a takeover by another branch" \
  contains "$(collide)" "labelled"
: > "$STUB_DIR/55.notes"
expect "collision gate warns on a hand-applied label with no check-out comment" \
  contains "$(collide)" "labelled"

# The collision gate pins gh to origin's repository via GH_REPO (a GitHub
# Enterprise-shaped host here, so the HOST/ prefix is kept).
expect "collision gate pins gh to origin's repository (GH_REPO)" \
  grep -qxF 'github.example.invalid/x/y' "$STUB_DIR/api.ghrepo"

# scripts/lib/gh-repo.sh — the one place owner/repo is derived from a remote URL.
# Every shape a GitHub origin takes resolves; anything else resolves to nothing,
# so a non-GitHub or local origin never pins gh to a made-up repository.
# shellcheck source-path=SCRIPTDIR source=../lib/gh-repo.sh
. "$(dirname "$WT")/lib/gh-repo.sh"
# shellcheck disable=SC2317,SC2329  # invoked indirectly, through expect
slug_is() { [[ "$(gh_repo_from_url "$1")" == "$2" ]]; }
expect "gh-repo: scp-style github.com URL"      slug_is 'git@github.com:acme/widget.git' 'acme/widget'
expect "gh-repo: https URL with .git"           slug_is 'https://github.com/acme/widget.git' 'acme/widget'
expect "gh-repo: https URL, no .git, trailing /" slug_is 'https://github.com/acme/widget/' 'acme/widget'
expect "gh-repo: ssh:// URL with a port"        slug_is 'ssh://git@github.com:22/acme/widget.git' 'acme/widget'
expect "gh-repo: https URL with credentials"    slug_is 'https://x-access-token:t@github.com/acme/widget' 'acme/widget'
expect "gh-repo: GitHub Enterprise keeps its host" slug_is 'git@github.corp.example:acme/widget.git' 'github.corp.example/acme/widget'
expect "gh-repo: a non-GitHub host is not a GitHub repo" slug_is 'git@codeberg.org:acme/widget.git' ''
expect "gh-repo: a local path is not a GitHub repo"     slug_is '/tmp/origin.git' ''
expect "gh-repo: a nested path is not OWNER/REPO"       slug_is 'https://github.com/acme/widget/tree/main' ''
expect "gh-repo: an explicit GH_REPO wins over origin" \
  test "$(GH_REPO=keep/me bash -c '. "$1"; gh_export_repo "$2"; printf %s "$GH_REPO"' _ "$(dirname "$WT")/lib/gh-repo.sh" "$CGREPO")" = keep/me

[[ "$fail" -eq 0 ]] && echo "wt-lock: self-test passed."
exit "$fail"
