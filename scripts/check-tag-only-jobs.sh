#!/usr/bin/env bash
# scripts/check-tag-only-jobs.sh — inventory tag-only CI jobs that changed
# since the last release tag; they run for the first time when the tag lands.
#
# WHY: a tag pipeline runs whatever `.gitlab-ci.yml` says AT the tag commit. A
# job scoped to `$CI_COMMIT_TAG` (or `only: tags`) never runs on a branch or MR
# pipeline, so editing one and merging to main proves nothing — the edit is
# unproven until the next tag. This was prompt-only guidance in
# `.claude/skills/release/SKILL.md` Step 1 ("inventory every tag-only job that
# changed since the last tag") with no fixture behind it — a coverage gap the
# 2026-09-27 pre-release audit named explicitly. This script makes the
# comparison mechanical and self-testable; the skill still owns the judgment
# call of whether an unproven job was actually probed before the next tag.
#
# WHAT IT CHECKS (static): for every job in .gitlab-ci.yml / ci/*.yml whose own
# block mentions CI_COMMIT_TAG, or whose `only:` lists `tags` (`only: [tags]`
# or `only:` + `- tags`), compare its full raw block text against the same job
# at the last `v*` tag (or --base). New or textually-changed tag-only jobs are
# reported as unproven.
#
# WHAT IT CANNOT CHECK: whether a flagged job was actually probed by hand (a
# manual job, a variable-gated MR dry run) before the next tag lands — that
# judgment belongs to the release skill, not this script. A job that inherits
# its tag rule only through `extends:` or a YAML anchor is invisible to this
# scan; name it directly with CI_COMMIT_TAG or `only: tags` in its own block,
# or list it in TAG_ONLY_JOBS (space-separated) to force it into scope.
#
# Usage: check-tag-only-jobs.sh [--base <tag>] [CI_FILE...] | --self-test
#        (default base: `git describe --tags --abbrev=0 --match 'v*'`;
#         default files: .gitlab-ci.yml and ci/*.yml)
# Exit:  0 nothing unproven · 1 at least one unproven job · 2 no base tag found
set -euo pipefail

# name\x1fblock-text(\x1e-joined lines), one per tag-only job, for FILE.
parse() {
  TAG_ONLY_JOBS="${TAG_ONLY_JOBS:-}" python3 - "$1" <<'PY'
import os, re, sys

named = set(os.environ["TAG_ONLY_JOBS"].split())
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
jobs, job, start = {}, None, 0


def flush(end):
    if job is not None:
        jobs[job] = "\n".join(lines[start:end])


for i, raw in enumerate(lines):
    if not raw.strip() or raw.lstrip().startswith("#"):
        continue
    ind = len(raw) - len(raw.lstrip(" "))
    if ind == 0:
        m = re.match(r"^(\S.*?):\s*$", raw.strip())
        flush(i)
        job = m.group(1) if m else None
        start = i
flush(len(lines))


def is_tag_only(name, text):
    if name in named or "CI_COMMIT_TAG" in text:
        return True
    state = None
    for raw in text.splitlines()[1:]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        ind = len(raw) - len(raw.lstrip(" "))
        c = raw.strip()
        if ind == 2:
            if c.startswith("only:"):
                state = "only"
                if re.search(r"\btags\b", c):
                    return True
                continue
            state = None
            continue
        if state == "only" and ind >= 4 and re.match(r"^-\s*['\"]?tags['\"]?\s*$", c):
            return True
    return False


for n, text in jobs.items():
    if is_tag_only(n, text):
        print(n + "\x1f" + text.replace("\n", "\x1e"))
PY
}

run() {
  local base="" files=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --base) base="$2"; shift 2 ;;
      *) files+=("$1"); shift ;;
    esac
  done
  if [ -z "$base" ]; then
    base="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
  fi
  if [ -z "$base" ]; then
    echo "check-tag-only-jobs: no v* tag found" >&2
    return 2
  fi
  if [ "${#files[@]}" -eq 0 ]; then
    shopt -s nullglob
    files=(.gitlab-ci.yml ci/*.yml)
    shopt -u nullglob
  fi

  # Accumulated as a string, never through a pipe: a `for ... | { ... }`
  # pipeline runs the loop in a subshell in bash, and rc set inside it would
  # never reach this function's `return`. Old/new jobs are matched via a temp
  # file + awk, not an associative array — macOS ships bash 3.2, which has no
  # associative arrays, and this repo's scripts run on both.
  local f raw=""
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    local old_file; old_file="$(mktemp)"
    git show "${base}:${f}" >"$old_file" 2>/dev/null || : >"$old_file"

    local old_parsed; old_parsed="$(mktemp)"
    parse "$old_file" >"$old_parsed"
    rm -f "$old_file"

    local name text old_text
    while IFS=$'\x1f' read -r name text; do
      [ -z "$name" ] && continue
      old_text="$(awk -F$'\x1f' -v n="$name" '$1==n{print $2; exit}' "$old_parsed")"
      if [ -z "$old_text" ]; then
        raw+="$f"$'\t'"$name"$'\t'"new"$'\n'
      elif [ "$old_text" != "$text" ]; then
        raw+="$f"$'\t'"$name"$'\t'"changed"$'\n'
      fi
    done < <(parse "$f")
    rm -f "$old_parsed"
  done

  if [ -n "$raw" ]; then
    echo "Tag-only CI job(s) changed since ${base} — never run in this form until the next tag:" >&2
    local name reason
    while IFS=$'\t' read -r f name reason; do
      [ -z "$f" ] && continue
      printf '  %s: %s (%s)\n' "$f" "$name" "$reason" >&2
    done <<<"$raw"
    return 1
  fi
  echo "check-tag-only-jobs: OK — no tag-only job changed since ${base}."
  return 0
}

self_test() {
  local d; d="$(mktemp -d)"; trap 'rm -rf "$d"' RETURN
  local fail=0
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

  (
    cd "$d"
    git init -q -b main
    git config user.email t@example.com
    git config user.name t
    cat >.gitlab-ci.yml <<'Y'
lint:
  script:
    - echo lint

publish:
  rules:
    - if: '$CI_COMMIT_TAG'
  script:
    - echo publish v1
Y
    git add .gitlab-ci.yml
    git commit -q -m base
    git tag v1.0.0

    sed -i.bak 's/echo publish v1/echo publish v2/' .gitlab-ci.yml
    sed -i.bak 's/echo lint/echo lint v2/' .gitlab-ci.yml
    rm -f .gitlab-ci.yml.bak
    cat >>.gitlab-ci.yml <<'Y'

publish-extra:
  only:
    - tags
  script:
    - echo extra
Y
    git add .gitlab-ci.yml
    git commit -q -m changes
  ) >/dev/null 2>&1

  set +e
  out="$(cd "$d" && run --base v1.0.0 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 1 ] || { echo "self-test: expected rc=1 for changed+new tag-only jobs, got $rc" >&2; fail=1; }
  case "$out" in *"publish (changed)"*) ;; *) echo "self-test: changed CI_COMMIT_TAG job not detected" >&2; fail=1 ;; esac
  case "$out" in *"publish-extra (new)"*) ;; *) echo "self-test: new 'only: - tags' job not detected" >&2; fail=1 ;; esac
  case "$out" in *"lint"*) echo "self-test: non-tag job flagged" >&2; fail=1 ;; esac

  ( cd "$d" && git tag v1.0.1 ) >/dev/null 2>&1
  set +e
  out="$(cd "$d" && run --base v1.0.1 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 0 ] || { echo "self-test: expected rc=0 with no changes since new tag, got $rc" >&2; fail=1; }
  case "$out" in *"OK"*) ;; *) echo "self-test: clean run did not report OK" >&2; fail=1 ;; esac

  local d2; d2="$(mktemp -d)"
  ( cd "$d2" && git init -q -b main ) >/dev/null 2>&1
  set +e
  ( cd "$d2" && run >/dev/null 2>&1 ); rc=$?
  set -e
  rm -rf "$d2"
  [ "$rc" -eq 2 ] || { echo "self-test: expected rc=2 with no tags at all, got $rc" >&2; fail=1; }

  [ "$fail" -eq 0 ] && echo "check-tag-only-jobs: self-test OK"
  return "$fail"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
else
  run "$@"
fi
