#!/usr/bin/env bash
# scripts/check-memory-index.sh — size and integrity check for the Claude memory index.
#
# ## Why this exists
#
# The index at `~/.claude/projects/<encoded-repo-path>/memory/MEMORY.md` is loaded into
# context on EVERY turn and has a hard read limit of roughly 24.4 KB. Past it the
# harness loads only part of the file and says so once, in a notice nobody is required
# to read — so indexed memories stop arriving with nothing failing anywhere.
#
# Upstream hit that limit and hand-compacted the index five times in four weeks. Each
# pass bought 1-2 KB and it refilled in about eight days. A recurring manual ritual with
# no check is the exact shape every other scripts/check-*.sh here was written to replace.
#
# Two silent failures, neither visible without looking:
#   1. Over the limit  -> truncated load, memories silently absent.
#   2. A dangling link -> the memory file still exists and is still rankable by its
#      `description:`, but nothing points at it.
#
# ## NOT a pre-push or CI gate, deliberately
#
# Its input is a per-user, per-machine directory outside the repo: it does not exist for
# contributors who do not use Claude Code, nor on CI runners. Only its --self-test runs
# in CI (hermetic, temp dirs only). Run the real check with `make memory-check` at each
# release close, beside `/memory-audit`.
#
# What it cannot do: decide WHICH memories deserve the index. That stays a judgment
# call. This removes the silence, not the possibility of a wrong answer.
#
# ## Usage
#
#   scripts/check-memory-index.sh [--self-test] [--quiet]
#
# ## Exit codes
#
#   0  healthy (or no memory store — skipped)
#   1  over budget, or a dangling link
#   2  bad argument

set -euo pipefail

# Budget sits below the ~24.4 KB read limit so there is room to notice before the
# harness starts truncating.
#
# If this ever fires and the fix looks like "raise the number", keep upstream's order:
# run a full demotion pass FIRST (every entry against "would a session that never opens
# the file still make the right call?"), record what it yielded, and only then move the
# threshold. A floor raised INSTEAD of looking launders a regression; a floor corrected
# AFTER looking is calibration. The two are identical in the diff and opposite in
# meaning. Upstream's pass yielded 310 B against a 1.4 KB shortfall — the content was at
# its natural size and the threshold was what was wrong — and it settled at 23800.
MEMORY_MAX_BYTES="${MEMORY_MAX_BYTES:-23800}"

# Memory types whose whole purpose is to be reachable. `project_*` is exempt: per-issue
# records are file-only by design (see "Memory discipline" in global-claude-md.example).
INDEXED_PREFIXES_RE='^(feedback|user|reference|env)[_-]'

resolve_memory_dir() {
  if [[ -n "${MEMORY_DIR:-}" ]]; then printf '%s\n' "$MEMORY_DIR"; return; fi
  local root base
  # The store is keyed to the MAIN checkout's path, so resolving from $BASH_SOURCE
  # silently misses it in a worktree — the default workflow with scripts/wt, so the
  # naive form would skip exactly where it is most often run. `git worktree list` prints
  # the main worktree first; fall back to the script's own parent outside git.
  root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" worktree list 2>/dev/null | awk 'NR==1 {print $1}')"
  [[ -n "$root" ]] || root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  # Claude Code encodes the project path by replacing path separators with '-'. Paths
  # containing other punctuation have been seen encoded both ways, so prefer whichever
  # directory actually exists.
  base="$HOME/.claude/projects"
  if [[ -d "$base/${root//\//-}/memory" ]]; then
    printf '%s\n' "$base/${root//\//-}/memory"
  else
    printf '%s\n' "$base/${root//[^a-zA-Z0-9]/-}/memory"
  fi
}

run_check() {
  local dir="$1" quiet="${2:-0}" rc=0
  local index="$dir/MEMORY.md" archive="$dir/MEMORY-archive.md"

  if [[ ! -d "$dir" || ! -f "$index" ]]; then
    [[ "$quiet" == "1" ]] || echo "check-memory-index: no memory store at $dir — skipped"
    return 0
  fi

  local bytes; bytes=$(wc -c < "$index" | tr -d ' ')
  if [[ "$bytes" -gt "$MEMORY_MAX_BYTES" ]]; then
    echo "FAIL: MEMORY.md is ${bytes}B, over the ${MEMORY_MAX_BYTES}B budget (~24.4KB is the hard read limit)."
    echo "      Demote entries to MEMORY-archive.md under a dated '## Archived' heading — do not delete."
    rc=1
  else
    [[ "$quiet" == "1" ]] || echo "ok: MEMORY.md ${bytes}B / ${MEMORY_MAX_BYTES}B budget"
  fi

  # Dangling links, in both the index and the archive. grep reads the whole file, so
  # there is no early-exiting reader here to SIGPIPE a writer (scripts/CLAUDE.md).
  local f target dangling=0
  for f in "$index" "$archive"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r target; do
      [[ -n "$target" ]] || continue
      [[ "$target" == "MEMORY-archive.md" || "$target" == "MEMORY.md" ]] && continue
      if [[ ! -e "$dir/$target" ]]; then
        echo "FAIL: $(basename "$f") links a memory that does not exist: $target"
        dangling=$((dangling + 1))
      fi
    done < <(grep -oE '\]\([^)]+\.md\)' "$f" | sed -E 's/^\]\(//; s/\)$//' || true)
  done
  [[ "$dangling" -eq 0 ]] || rc=1
  [[ "$quiet" == "1" || "$dangling" -ne 0 ]] || echo "ok: no dangling index links"

  # Unindexed durable memories — a warning, never a failure: an orphan is still rankable
  # by its `description:`, so this is lost discoverability, not lost data.
  local indexed orphans=0 path base
  indexed="$(cat "$index" "$archive" 2>/dev/null | grep -oE '\]\([^)]+\.md\)' | sed -E 's/^\]\(//; s/\)$//' | sort -u || true)"
  # A glob, not `ls | grep`: a memory whose filename begins with '-' would be read as an
  # option by ls.
  for path in "$dir"/*.md; do
    [[ -e "$path" ]] || continue
    base="${path##*/}"
    [[ "$base" == "MEMORY.md" || "$base" == "MEMORY-archive.md" ]] && continue
    [[ "$base" =~ $INDEXED_PREFIXES_RE ]] || continue
    grep -qxF "$base" <<< "$indexed" || orphans=$((orphans + 1))
  done
  if [[ "$orphans" -gt 0 ]]; then
    echo "warn: $orphans durable (non-project_) memories are indexed by neither file — reachable only by description ranking"
  elif [[ "$quiet" != "1" ]]; then
    echo "ok: every durable memory is indexed"
  fi

  return "$rc"
}

self_test() {
  # Proves the check can still FAIL — a gate that only ever passes is indistinguishable
  # from one that does not work.
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  local fail=0
  # run_check returns non-zero BY DESIGN in the detection cases below. Under `set -e` a
  # bare call would abort the whole self-test at the first one — which is how upstream's
  # version silently printed nothing and passed on its first run. rc() captures instead.
  rc() { local c=0; "$@" >/dev/null 2>&1 || c=$?; printf '%s' "$c"; }
  t() {
    if [[ "$2" == "$3" ]]; then echo "SELF-TEST OK: $1"
    else echo "SELF-TEST FAILED: $1 (got $2, wanted $3)" >&2; fail=1; fi
  }

  t "absent memory dir is skipped" "$(rc run_check "$tmp/nope" 1)" 0

  mkdir -p "$tmp/ok"
  printf -- '- [hook](feedback_a.md)\n' > "$tmp/ok/MEMORY.md"
  : > "$tmp/ok/MEMORY-archive.md"; : > "$tmp/ok/feedback_a.md"
  t "healthy store passes" "$(rc run_check "$tmp/ok" 1)" 0

  # Comfortably over the default rather than clearing it by a few hundred bytes, so a
  # future budget bump cannot silently turn this detection case into a no-op.
  mkdir -p "$tmp/big"
  head -c 40000 /dev/zero | tr '\0' 'x' > "$tmp/big/MEMORY.md"
  : > "$tmp/big/MEMORY-archive.md"
  t "over-budget index is rejected" "$(rc run_check "$tmp/big" 1)" 1

  mkdir -p "$tmp/dangle"
  printf -- '- [hook](feedback_missing.md)\n' > "$tmp/dangle/MEMORY.md"
  : > "$tmp/dangle/MEMORY-archive.md"
  t "dangling index link is rejected" "$(rc run_check "$tmp/dangle" 1)" 1

  local out
  mkdir -p "$tmp/orph"
  printf -- '- [hook](feedback_a.md)\n' > "$tmp/orph/MEMORY.md"
  : > "$tmp/orph/MEMORY-archive.md"; : > "$tmp/orph/feedback_a.md"; : > "$tmp/orph/feedback_orphan.md"
  t "orphaned durable memory warns but passes" "$(rc run_check "$tmp/orph" 1)" 0
  out="$(run_check "$tmp/orph" 1 2>&1 || true)"
  t "orphan warning is printed" "$(grep -q 'indexed by neither' <<< "$out" && echo yes || echo no)" yes

  mkdir -p "$tmp/proj"
  printf -- '- [hook](feedback_a.md)\n' > "$tmp/proj/MEMORY.md"
  : > "$tmp/proj/MEMORY-archive.md"; : > "$tmp/proj/feedback_a.md"; : > "$tmp/proj/project_orphan.md"
  out="$(run_check "$tmp/proj" 1 2>&1 || true)"
  t "project_* orphan is exempt" "$(grep -q 'indexed by neither' <<< "$out" && echo yes || echo no)" no

  [[ "$fail" -eq 0 ]] && echo "check-memory-index: self-test passed."
  return "$fail"
}

main() {
  local quiet=0 a
  for a in "$@"; do
    case "$a" in
      --self-test) self_test; exit $? ;;
      --quiet) quiet=1 ;;
      -h|--help) sed -n '2,38p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) echo "unknown argument: $a" >&2; exit 2 ;;
    esac
  done
  run_check "$(resolve_memory_dir)" "$quiet"
}

main "$@"
