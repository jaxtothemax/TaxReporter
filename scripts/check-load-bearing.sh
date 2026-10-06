#!/usr/bin/env bash
# scripts/check-load-bearing.sh — a guard wired in by ONE call site needs its
# own gate, because deleting that single line leaves the whole suite green.
#
# ## Why
#
# Some guards protect everything and are themselves protected by nothing. The
# shape recurs: a validator, a schema check, a safety hook, an ignore filter —
# installed by one line at the top of a shared helper, or one entry in a config
# file. Every test still passes when that line is deleted. The guard simply
# stops guarding, silently, forever.
#
# Upstream the instance was `installSchemaGuard(page)`, one call at the top of a
# shared Playwright setup helper, which is what made ~290 e2e specs validate
# their mock payloads against the OpenAPI schema. Delete it and all 290 specs
# still pass. The gate that watched that one line existed for no other purpose.
#
# This is the generic form. A project declares which call sites are load-bearing
# in a manifest; this gate asserts each one is still there.
#
# ## Why a manifest and not a marker at the call site
#
# The obvious alternative — annotate the line itself, `# load-bearing: <reason>`,
# and have the gate grep for the marker — cannot work, and the reason is
# structural rather than a matter of taste. **Deleting the call deletes the
# marker.** The gate then finds zero markers, which is exactly what a repo with
# no declarations looks like, and reports OK. A marker can only detect its own
# *presence*; the event this gate exists to catch is an *absence*.
#
# So the declaration has to outlive the line it describes, which means it has to
# live somewhere else. That is the manifest's whole justification, and it is
# also its cost: a declaration sitting away from the code can rot in the other
# direction. Both rot directions that a text scan can actually see are errors
# here — a declared file that no longer exists, and a declared call that no
# longer appears in it — so the manifest cannot quietly accumulate entries that
# point at nothing.
#
# `scripts/CLAUDE.md`'s "prefer a marker that means one thing" still applies, to
# the manifest's own format: `call:` is opt-in and unambiguous, and `why:` is
# REQUIRED, so a declaration with no stated reason is an offender rather than a
# silent switch.
#
# ## What this cannot see
#
# That the declared file is still *reached*. A text match proves the line exists,
# not that anything executes it — a declared call inside a module nobody imports
# any more passes. Reachability is a per-language question no shared text gate
# can answer; the verdict line says so on every run rather than letting a green
# read as more than it is.
#
# ## Usage
#
#   bash scripts/check-load-bearing.sh [MANIFEST]   # default: load-bearing.declarations
#   bash scripts/check-load-bearing.sh --list       # discovery half, offline, never judges
#   bash scripts/check-load-bearing.sh --self-test
#
# Override the manifest path with $LOAD_BEARING_MANIFEST.
#
# ## Exit codes
#
#   0  every declaration resolves (or nothing is declared yet)
#   1  at least one declaration is broken or malformed
#   2  the gate itself could not run (unreadable manifest, grep failure)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/git-ignored.sh
. "$REPO_ROOT/scripts/lib/git-ignored.sh"

DEFAULT_MANIFEST="load-bearing.declarations"

# ─── Parsing ─────────────────────────────────────────────────────────────────
#
# Stanza format, blank-line separated:
#
#     path: hooks/pre-push
#     call: if ! make pre-push-checks 2>&1; then
#     why:  Deleting this line disables every local gate; nothing fails.
#
# Stanzas rather than a delimited table because a `call:` value is a snippet of
# somebody's source: it can contain colons, pipes, quotes and backslashes, and
# any single-character delimiter eventually lands inside one. Everything after
# the first colon on the line is the value, verbatim apart from leading blanks.

# Emits one record per stanza:
#   OK<TAB>path<TAB>call<TAB>why<TAB>firstline
#   BAD<TAB>firstline<TAB>message
_emit_stanza() { # <path> <call> <why> <firstline>
  if [ -z "$1$2$3" ]; then return 0; fi
  if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    printf 'BAD\t%s\t%s\n' "$4" \
      "incomplete stanza — every declaration needs path:, call: and why: (why: is required, not optional)"
    return 0
  fi
  printf 'OK\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"
}

parse_manifest() { # <file>  -> records on stdout
  local file="$1" line trimmed key val lineno=0
  local p='' c='' w='' start=0

  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))

    # Leading-blank trim. `${line%%[![:space:]]*}` is the run of leading
    # whitespace; stripping it as a prefix leaves the rest untouched.
    trimmed="${line#"${line%%[![:space:]]*}"}"

    if [ -z "${trimmed//[[:space:]]/}" ]; then
      _emit_stanza "$p" "$c" "$w" "$start"
      p=''
      c=''
      w=''
      start=0
      continue
    fi

    case "$trimmed" in '#'*) continue ;; esac

    case "$trimmed" in
      *:*) ;;
      *)
        printf 'BAD\t%s\t%s\n' "$lineno" "not a 'key: value' line: ${trimmed}"
        continue
        ;;
    esac

    key="${trimmed%%:*}"
    val="${trimmed#*:}"
    val="${val#"${val%%[![:space:]]*}"}"

    [ "$start" -eq 0 ] && start="$lineno"

    # A literal tab inside a value would split the record this parser emits.
    # Reject it here rather than silently truncating a declaration.
    case "$val" in
      *"$(printf '\t')"*)
        printf 'BAD\t%s\t%s\n' "$lineno" "value contains a literal tab — use spaces in a declaration"
        continue
        ;;
    esac

    case "$key" in
      path)
        if [ -n "$p" ]; then
          printf 'BAD\t%s\t%s\n' "$lineno" "duplicate 'path:' in one stanza (blank line missing between declarations?)"
        fi
        p="$val"
        ;;
      call)
        if [ -n "$c" ]; then
          printf 'BAD\t%s\t%s\n' "$lineno" "duplicate 'call:' in one stanza (blank line missing between declarations?)"
        fi
        c="$val"
        ;;
      why)
        if [ -n "$w" ]; then
          printf 'BAD\t%s\t%s\n' "$lineno" "duplicate 'why:' in one stanza (blank line missing between declarations?)"
        fi
        w="$val"
        ;;
      *)
        printf 'BAD\t%s\t%s\n' "$lineno" "unknown key '${key}:' — only path:, call: and why: are recognized"
        ;;
    esac
  done <"$file"

  _emit_stanza "$p" "$c" "$w" "$start"
}

# ─── Resolution ──────────────────────────────────────────────────────────────

# Prints one of: "ok <count>" | "missing-file" | "ignored" | "unsafe-path" |
# "missing-call". Returns 2 only when grep itself failed, which is the gate
# being broken rather than the tree being wrong.
resolve_one() { # <path> <call>
  local path="$1" call="$2" cnt rc=0

  case "$path" in
    /* | *'..'*)
      printf 'unsafe-path'
      return 0
      ;;
  esac

  if [ ! -f "$path" ]; then
    printf 'missing-file'
    return 0
  fi

  # A declared path git ignores is present here and ABSENT in CI's clean clone,
  # so the gate would disagree with itself across environments. Refuse the
  # declaration instead of letting one side of that pair be the answer.
  if is_ignored "$path"; then
    printf 'ignored'
    return 0
  fi

  cnt="$(grep -cF -e "$call" -- "$path")" || rc=$?
  if [ "$rc" -ge 2 ]; then
    return 2
  fi
  if [ "${cnt:-0}" -eq 0 ]; then
    printf 'missing-call'
    return 0
  fi
  printf 'ok %s' "$cnt"
}

# ─── Scan ────────────────────────────────────────────────────────────────────

manifest_path() {
  printf '%s' "${1:-${LOAD_BEARING_MANIFEST:-$DEFAULT_MANIFEST}}"
}

no_manifest_note() { # <manifest>
  echo "check-load-bearing: 0 declarations (no $1)."
  echo "check-load-bearing: OK — nothing is declared load-bearing yet, so nothing is protected."
  echo "  A repo with no declarations and a broken gate look identical from here; --self-test is what"
  echo "  tells them apart. To declare a call site, create $1 — see the header of"
  echo "  scripts/check-load-bearing.sh, or the shipped file in this template, for the stanza format."
}

coverage_note() {
  echo "check-load-bearing: not covered — whether a declared file is still loaded or executed."
  echo "  A text match proves the line exists, not that anything runs it."
}

run_scan() { # <manifest>
  local manifest records kind a b c d
  local total=0 broken=0 occurrences=0 seen='' key
  manifest="$(manifest_path "${1:-}")"

  if [ ! -e "$manifest" ]; then
    no_manifest_note "$manifest"
    return 0
  fi
  if [ ! -r "$manifest" ]; then
    echo "check-load-bearing: ERROR — $manifest exists but is not readable." >&2
    return 2
  fi

  records="$(parse_manifest "$manifest")"

  if [ -z "$records" ]; then
    echo "check-load-bearing: 0 declarations in $manifest (comments only)."
    echo "check-load-bearing: OK — nothing is declared load-bearing yet, so nothing is protected."
    coverage_note
    return 0
  fi

  local rrc
  while IFS=$'\t' read -r kind a b c d; do
    [ -n "$kind" ] || continue
    if [ "$kind" = "BAD" ]; then
      total=$((total + 1))
      broken=$((broken + 1))
      echo "check-load-bearing: FAIL  $manifest:$a — $b"
      continue
    fi

    total=$((total + 1))

    key="$a"$'\x1f'"$b"
    if grep -qxF -- "$key" <<<"$seen"; then
      broken=$((broken + 1))
      echo "check-load-bearing: FAIL  $manifest:$d — duplicate declaration of '$b' in $a"
      continue
    fi
    seen="${seen}${key}"$'\n'

    rrc=0
    local verdict
    verdict="$(resolve_one "$a" "$b")" || rrc=$?
    if [ "$rrc" -ge 2 ]; then
      echo "check-load-bearing: ERROR — grep failed reading '$a' (the gate is broken, not the tree)." >&2
      return 2
    fi

    case "$verdict" in
      ok\ *)
        occurrences=$((occurrences + ${verdict#ok }))
        ;;
      missing-call)
        broken=$((broken + 1))
        echo "check-load-bearing: FAIL  $a no longer contains the declared call site"
        echo "    call: $b"
        echo "    why:  $c"
        echo "    ($manifest:$d)"
        ;;
      missing-file)
        broken=$((broken + 1))
        echo "check-load-bearing: FAIL  $a does not exist — declaration at $manifest:$d points at nothing"
        echo "    why:  $c"
        ;;
      ignored)
        broken=$((broken + 1))
        echo "check-load-bearing: FAIL  $a is git-ignored — CI's clean clone cannot see it, so this"
        echo "    declaration would resolve locally and vanish in CI ($manifest:$d)"
        ;;
      unsafe-path)
        broken=$((broken + 1))
        echo "check-load-bearing: FAIL  $manifest:$d — path must be repo-relative with no '..' segment: $a"
        ;;
    esac
  done <<<"$records"

  echo "check-load-bearing: $total declaration(s), $broken broken, $occurrences occurrence(s) matched."

  if [ "$broken" -gt 0 ]; then
    cat <<'MSG'

check-load-bearing: FAIL — a call site this repo declared load-bearing is gone, or its
declaration is malformed. Nothing else in the suite goes red when such a line is deleted;
that is the entire reason the declaration exists.

Three ways out, in order of likelihood:
  1. The deletion was accidental — restore the call.
  2. The guard moved — update the declaration's path:/call: to the new site.
  3. The guard is genuinely gone — delete the whole stanza, and say in the MR what now
     covers what it covered. Removing the declaration is a reviewable one-line diff; that
     is the point.
MSG
    coverage_note
    return 1
  fi

  echo "check-load-bearing: OK — every declared call site is still present."
  coverage_note
  return 0
}

# ─── Discovery half, offline ─────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md the half that rots is discovery, not judgment: judgment
# either answers or errors loudly, while a scan that stops matching fails open
# and silently. `--list` never judges — it prints what the manifest resolves to,
# including the entries that resolve to nothing, so "the gate sees it at all"
# can be asserted separately from "the gate said no".
list_declarations() { # <manifest>
  local manifest records kind a b c d verdict lines rrc n=0
  manifest="$(manifest_path "${1:-}")"

  if [ ! -e "$manifest" ]; then
    no_manifest_note "$manifest"
    return 0
  fi

  records="$(parse_manifest "$manifest")"
  while IFS=$'\t' read -r kind a b c d; do
    [ -n "$kind" ] || continue
    n=$((n + 1))
    if [ "$kind" = "BAD" ]; then
      printf '  %s:%s  MALFORMED  %s\n' "$manifest" "$a" "$b"
      continue
    fi
    rrc=0
    verdict="$(resolve_one "$a" "$b")" || rrc=$?
    if [ "$rrc" -ge 2 ]; then
      printf '  %s  UNREADABLE  %s\n' "$a" "$b"
      continue
    fi
    case "$verdict" in
      ok\ *)
        lines="$(grep -nF -e "$b" -- "$a" | cut -d: -f1 | tr '\n' ',')"
        printf '  %s:%s  ok  %s\n' "$a" "${lines%,}" "$b"
        ;;
      *)
        printf '  %s  %s  %s\n' "$a" "$(echo "$verdict" | tr '[:lower:]-' '[:upper:]_')" "$b"
        ;;
    esac
    printf '      why: %s  (declared at %s:%s)\n' "$c" "$manifest" "$d"
  done <<<"$records"

  echo "check-load-bearing: $n declaration(s) listed from $manifest (discovery only — no verdict)."
  return 0
}

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Demands the EXACT exit code and the gate's own verdict line in both
# directions. A probe that reads any non-zero as "correctly rejected" cannot
# tell a gate that said no from one that died at 127 before running a check.

self_test() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now, not at trap time
  trap "rm -rf '$tmp'" EXIT

  probe() { # <name> <want-exit> <want-substring> <dir> [--list]
    local name="$1" want="$2" needle="$3" dir="$4" mode="${5:-scan}"
    local out got=0
    if [ "$mode" = "--list" ]; then
      out="$(cd "$dir" && list_declarations "$DEFAULT_MANIFEST" 2>&1)" || got=$?
    else
      out="$(cd "$dir" && run_scan "$DEFAULT_MANIFEST" 2>&1)" || got=$?
    fi
    if [ "$got" -ne "$want" ]; then
      echo "SELF-TEST FAILED: $name — expected exit $want, got exit $got." >&2
      printf '%s\n' "$out" | sed 's/^/    | /' >&2
      rc=1
      return
    fi
    if ! grep -qF -- "$needle" <<<"$out"; then
      echo "SELF-TEST FAILED: $name — exit $got was right but the gate never printed its verdict (looked for: $needle)." >&2
      printf '%s\n' "$out" | sed 's/^/    | /' >&2
      rc=1
      return
    fi
    echo "SELF-TEST OK: $name — exit $got, verdict present."
  }

  # <name> <source-line> <stanza-body>
  fixture() { # <dir> <file-content> <manifest-content>
    local d="$tmp/$1"
    mkdir -p "$d"
    printf '%s\n' "$2" >"$d/guarded.sh"
    printf '%s\n' "$3" >"$d/$DEFAULT_MANIFEST"
    printf '%s' "$d"
  }

  local d

  d="$(fixture clean 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)
why: One call installs the guard; removing it leaves every test green.")"
  probe "a declared call site that is still present" 0 "check-load-bearing: OK" "$d"

  # The whole point of the gate: the line is gone, nothing else notices.
  d="$(fixture removed 'const page = await newPage()' \
    "path: guarded.sh
call: installGuard(page)
why: One call installs the guard; removing it leaves every test green.")"
  probe "the declared call site deleted" 1 "no longer contains the declared call site" "$d"

  d="$(fixture gonefile 'x' \
    "path: not-here.sh
call: installGuard(page)
why: Dangling declaration must not read as satisfied.")"
  probe "a declaration pointing at a file that does not exist" 1 "does not exist" "$d"

  # why: is required — a declaration with no stated reason is an offender, not a
  # silent switch (scripts/CLAUDE.md, "prefer a marker that means one thing").
  d="$(fixture noreason 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)")"
  probe "a declaration with no why:" 1 "incomplete stanza" "$d"

  d="$(fixture badkey 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)
reason: wrong key name")"
  probe "an unrecognized key" 1 "unknown key" "$d"

  d="$(fixture notkv 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)
why: fine
this line has no colon")"
  probe "a line that is not key: value" 1 "not a 'key: value' line" "$d"

  d="$(fixture dupe 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)
why: first

path: guarded.sh
call: installGuard(page)
why: second")"
  probe "the same call declared twice" 1 "duplicate declaration" "$d"

  d="$(fixture runon 'installGuard(page)' \
    "path: guarded.sh
call: installGuard(page)
why: first
path: guarded.sh")"
  probe "two stanzas with no blank line between them" 1 "duplicate 'path:'" "$d"

  d="$(fixture abspath 'installGuard(page)' \
    "path: /etc/passwd
call: root
why: absolute paths are not repo-relative.")"
  probe "an absolute path" 1 "repo-relative" "$d"

  d="$(fixture dotdot 'installGuard(page)' \
    "path: ../outside/guarded.sh
call: installGuard(page)
why: escaping the repo is not a declaration.")"
  probe "a path escaping the repo with .." 1 "repo-relative" "$d"

  # -F, not -E: a declared call is a literal snippet, and treating it as a
  # regex would let `a.c` be "satisfied" by an unrelated `abc`.
  d="$(fixture literal 'abc' \
    "path: guarded.sh
call: a.c
why: the pattern must be matched literally, never as a regex.")"
  probe "a regex metacharacter matched literally, not as a pattern" 1 "no longer contains" "$d"

  d="$(fixture metaok 'guard(a.c, {strict: true})' \
    "path: guarded.sh
call: guard(a.c, {strict: true})
why: parentheses, braces, dots and a colon all survive verbatim.")"
  probe "a call containing (){}.: characters" 0 "check-load-bearing: OK" "$d"

  d="$(fixture commentsonly 'x' \
    "# nothing declared yet
# just a header")"
  probe "a manifest holding only comments" 0 "nothing is declared load-bearing yet" "$d"

  mkdir -p "$tmp/nomanifest"
  probe "no manifest at all" 0 "0 declarations (no $DEFAULT_MANIFEST)" "$tmp/nomanifest"

  # Scan the repository, not the working directory. This gate does not walk the
  # tree, so the rule lands differently: a DECLARED path git ignores is present
  # locally and absent in CI's clean clone, and the gate must refuse it rather
  # than let one side of that pair be the answer.
  local gd="$tmp/ignored"
  mkdir -p "$gd"
  git init -q "$gd" 2>/dev/null || true
  printf 'installGuard(page)\n' >"$gd/guarded.sh"
  printf 'local-only.sh\n' >"$gd/.gitignore"
  printf 'installGuard(page)\n' >"$gd/local-only.sh"
  printf 'path: local-only.sh\ncall: installGuard(page)\nwhy: ignored paths vanish in CI.\n' >"$gd/$DEFAULT_MANIFEST"
  if [ -d "$gd/.git" ]; then
    probe "a declared path that git ignores" 1 "git-ignored" "$gd"
  else
    echo "SELF-TEST SKIP: git unavailable — cannot build the ignored-path fixture." >&2
  fi

  # …and an ignored file that is NOT declared stays invisible: this gate reads
  # named paths only, so a local scratch file carrying the same text is a
  # non-event rather than a false RED that CI would never reproduce.
  local gd2="$tmp/ignored_undeclared"
  mkdir -p "$gd2"
  git init -q "$gd2" 2>/dev/null || true
  printf 'installGuard(page)\n' >"$gd2/guarded.sh"
  printf 'scratch/\n' >"$gd2/.gitignore"
  mkdir -p "$gd2/scratch"
  printf 'nothing here resembles a declaration\n' >"$gd2/scratch/report.txt"
  printf 'path: guarded.sh\ncall: installGuard(page)\nwhy: real declaration.\n' >"$gd2/$DEFAULT_MANIFEST"
  probe "an ignored file that nobody declared" 0 "check-load-bearing: OK" "$gd2"

  # The discovery half, asserted separately: a tree carrying a violation must be
  # SEEN, not merely judged. A --list that silently printed nothing would leave
  # the judgment half testing an empty set.
  probe "--list names a broken declaration" 0 "MISSING_CALL" "$tmp/removed" --list
  probe "--list resolves a present declaration to a line number" 0 "guarded.sh:1  ok" "$tmp/clean" --list

  # A manifest far past the pipe buffer. The parse loop reads from a file
  # redirect and the record loop from a here-string; had either been a pipe with
  # an early-exiting reader, every case above would still pass — the race is
  # payload-sized — and this one would fail deterministically.
  local big="$tmp/big"
  mkdir -p "$big"
  awk 'BEGIN{for(i=0;i<4000;i++) printf "marker-%05d\n", i}' >"$big/guarded.sh"
  awk -v m="$DEFAULT_MANIFEST" 'BEGIN{
        for(i=0;i<4000;i++) printf "path: guarded.sh\ncall: marker-%05d\nwhy: padding past the pipe buffer.\n\n", i
      }' >"$big/$DEFAULT_MANIFEST"
  probe "a manifest far larger than the pipe buffer" 0 "4000 declaration(s), 0 broken" "$big"

  # A last stanza with no trailing newline must still be parsed. `read` returns
  # non-zero on the final partial line, and a loop that trusted that would drop
  # the declaration — reporting OK for a manifest whose last entry is broken.
  local nl="$tmp/nonewline"
  mkdir -p "$nl"
  printf 'nothing\n' >"$nl/guarded.sh"
  printf 'path: guarded.sh\ncall: installGuard(page)\nwhy: last line has no newline.' >"$nl/$DEFAULT_MANIFEST"
  probe "a final stanza with no trailing newline" 1 "no longer contains" "$nl"

  if [ "$rc" -eq 0 ]; then
    echo "check-load-bearing: self-test passed — the gate rejects a removed call site with exit 1 and accepts a present one with exit 0."
  fi
  return "$rc"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  case "${1:-}" in
    --self-test)
      self_test
      ;;
    --list)
      cd "$REPO_ROOT"
      list_declarations "${2:-}"
      ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d'
      ;;
    *)
      cd "$REPO_ROOT"
      run_scan "${1:-}"
      ;;
  esac
}

main "$@"
