#!/usr/bin/env bash
# scripts/check-tag-only-jobs.sh — inventory tag-only CI jobs that changed
# since the last release tag; they run for the first time when the tag lands.
#
# WHY: a tag push runs whatever `.github/workflows/*.yml` says AT the tagged
# commit. A job that only runs on a tag never runs on a pull request or a push
# to main, so editing one and merging it proves nothing — the edit is unproven
# until the next tag. This was prompt-only guidance in
# `.claude/skills/release/SKILL.md` Step 1 ("inventory every tag-only job that
# changed since the last tag") with no fixture behind it — a coverage gap the
# 2026-09-27 pre-release audit named explicitly. This script makes the
# comparison mechanical and self-testable; the skill still owns the judgment
# call of whether an unproven job was actually probed before the next tag.
#
# WHAT IT CHECKS (static): a job is tag-only when
#   - its workflow's only automatic triggers are tag pushes (`on.push` with
#     `tags:`/`tags-ignore:` and no `branches:`/`branches-ignore:`) or `release`
#     events — `workflow_dispatch` is ignored, since a manual run is how such a
#     job gets probed, not a run it gets for free; or
#   - anything in the job's own definition (`if:` on the job or a step) tests
#     for a tag: `refs/tags/`, `ref_type == 'tag'`, or `event_name == 'release'`;
#   - or it is named in TAG_ONLY_JOBS (space-separated `job` or `file:job`).
# Each such job's definition — plus the workflow-level `on`, `env`,
# `defaults`, `permissions` and `concurrency` it inherits — is compared,
# parsed and normalized, against the same job at the last `v*` tag (or
# --base). New or changed tag-only jobs are reported as unproven.
#
# WHAT IT CANNOT CHECK: whether a flagged job was actually probed by hand (a
# `workflow_dispatch` run, a dry run on a fork) before the next tag lands — that
# judgment belongs to the release skill, not this script. A job whose tag
# condition lives in a reusable workflow or composite action it calls is
# invisible to this scan beyond its own `uses:` line; name it in TAG_ONLY_JOBS.
#
# Usage: check-tag-only-jobs.sh [--base <tag>] [WORKFLOW_FILE...] | --self-test
#        (default base: `git describe --tags --abbrev=0 --match 'v*'`;
#         default files: .github/workflows/*.yml and *.yaml)
# Exit:  0 nothing unproven · 1 at least one unproven job · 2 no base tag found
#        · 3 a workflow does not parse, or PyYAML is missing
set -euo pipefail

# One line per tag-only job in FILE: name\x1fnormalized-definition, where the
# definition is the parsed job re-serialized with sorted keys — so a comment,
# quoting or key-order edit is not reported as a change. Exit 3 on a parse
# failure. An empty FILE (the workflow did not exist at the base) prints nothing.
parse() { # <file> <display-name>
  TAG_ONLY_JOBS="${TAG_ONLY_JOBS:-}" python3 - "$1" "$2" <<'PY'
import json, os, re, sys

try:
    import yaml
except ImportError:
    sys.stderr.write("check-tag-only-jobs: ERROR — PyYAML is not installed (pip install pyyaml).\n")
    sys.exit(3)

path, shown = sys.argv[1], sys.argv[2]
named = set(os.environ["TAG_ONLY_JOBS"].split())
text = open(path, encoding="utf-8").read()
if not text.strip():
    sys.exit(0)  # absent at the base: every job is new
try:
    doc = yaml.safe_load(text)
except yaml.YAMLError as exc:
    sys.stderr.write("check-tag-only-jobs: ERROR — cannot parse %s: %s\n" % (shown, exc))
    sys.exit(3)
if not isinstance(doc, dict):
    sys.exit(0)

# PyYAML (YAML 1.1) reads a bare `on:` key as boolean True.
on = doc.get("on", doc.get(True))
if isinstance(on, str):
    on = {on: None}
elif isinstance(on, list):
    on = {e: None for e in on}
elif not isinstance(on, dict):
    on = {}


def tag_trigger(event, cfg):
    if event == "release":
        return True
    if event != "push" or not isinstance(cfg, dict):
        return False
    has_tags = "tags" in cfg or "tags-ignore" in cfg
    has_branches = "branches" in cfg or "branches-ignore" in cfg
    return has_tags and not has_branches


auto = {e: c for e, c in on.items() if e != "workflow_dispatch"}
workflow_tag_only = bool(auto) and all(tag_trigger(e, c) for e, c in auto.items())

TAG_TEST = re.compile(r"refs/tags/|ref_type\s*==\s*'tag'|event_name\s*==\s*'release'")
inherited = {k: doc.get(k) for k in ("env", "defaults", "permissions", "concurrency")}
inherited["on"] = on
wf = shown.rsplit("/", 1)[-1]
for job_id, job in (doc.get("jobs") or {}).items():
    body = json.dumps(job, sort_keys=True, default=str)
    if not (workflow_tag_only or TAG_TEST.search(body)
            or job_id in named or "%s:%s" % (wf, job_id) in named):
        continue
    canon = json.dumps({"job": job, "workflow": inherited}, sort_keys=True, default=str)
    print("%s\x1f%s" % (job_id, canon))
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
    files=(.github/workflows/*.yml .github/workflows/*.yaml)
    shopt -u nullglob
  fi

  # Accumulated as a string, never through a pipe: a `for ... | { ... }`
  # pipeline runs the loop in a subshell in bash, and rc set inside it would
  # never reach this function's `return`. Old/new jobs are matched via a temp
  # file + awk, not an associative array — macOS ships bash 3.2, which has no
  # associative arrays, and this repo's scripts run on both.
  local f raw="" rc=0
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    local old_file; old_file="$(mktemp)"
    git show "${base}:${f}" >"$old_file" 2>/dev/null || : >"$old_file"

    local old_parsed new_parsed; old_parsed="$(mktemp)"; new_parsed="$(mktemp)"
    parse "$old_file" "$f@${base}" >"$old_parsed" || rc=$?
    rm -f "$old_file"
    [ "$rc" -eq 0 ] && { parse "$f" "$f" >"$new_parsed" || rc=$?; }
    if [ "$rc" -ne 0 ]; then
      rm -f "$old_parsed" "$new_parsed"
      return 3
    fi

    local name text old_text
    while IFS=$'\x1f' read -r name text; do
      [ -z "$name" ] && continue
      old_text="$(awk -F$'\x1f' -v n="$name" '$1==n{print $2; exit}' "$old_parsed")"
      if [ -z "$old_text" ]; then
        raw+="$f"$'\t'"$name"$'\t'"new"$'\n'
      elif [ "$old_text" != "$text" ]; then
        raw+="$f"$'\t'"$name"$'\t'"changed"$'\n'
      fi
    done <"$new_parsed"
    rm -f "$old_parsed" "$new_parsed"
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
  local fail=0 out rc
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

  (
    cd "$d"
    git init -q -b main
    git config user.email t@example.com
    git config user.name t
    mkdir -p .github/workflows
    # release.yml is tag-only by its trigger; ci.yml runs on branches AND tags,
    # so only a job that tests for a tag itself is in scope there.
    cat >.github/workflows/release.yml <<'Y'
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo publish v1
Y
    cat >.github/workflows/ci.yml <<'Y'
name: ci
on:
  push:
    branches: [main]
    tags: ['v*']
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
Y
    git add .github
    git commit -q -m base
    git tag v1.0.0

    sed -i.bak 's/echo publish v1/echo publish v2/' .github/workflows/release.yml
    sed -i.bak 's/echo lint$/echo lint v2/' .github/workflows/ci.yml
    rm -f .github/workflows/*.bak
    cat >>.github/workflows/ci.yml <<'Y'
  publish-extra:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - run: echo extra
Y
    git add .github
    git commit -q -m changes
  ) >/dev/null 2>&1

  set +e
  out="$(cd "$d" && run --base v1.0.0 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 1 ] || { echo "self-test: expected rc=1 for changed+new tag-only jobs, got $rc" >&2; fail=1; }
  case "$out" in *"release.yml: publish (changed)"*) ;; *) echo "self-test: changed tag-triggered workflow job not detected" >&2; fail=1 ;; esac
  case "$out" in *"ci.yml: publish-extra (new)"*) ;; *) echo "self-test: new job with a refs/tags/ condition not detected" >&2; fail=1 ;; esac
  case "$out" in *"lint"*) echo "self-test: non-tag job flagged" >&2; fail=1 ;; esac

  # A cosmetic edit (comment, quoting, key order) is not a change to the job.
  (
    cd "$d"
    git tag v1.0.1
    sed -i.bak "s/tags: \['v\*'\]/tags: [\"v*\"]  # release tags/" .github/workflows/release.yml
    rm -f .github/workflows/*.bak
    git commit -q -am cosmetic
  ) >/dev/null 2>&1
  set +e
  out="$(cd "$d" && run --base v1.0.1 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 0 ] || { echo "self-test: expected rc=0 after a cosmetic-only edit, got $rc: $out" >&2; fail=1; }
  case "$out" in *"OK"*) ;; *) echo "self-test: clean run did not report OK" >&2; fail=1 ;; esac

  # TAG_ONLY_JOBS forces a job into scope.
  ( cd "$d" && sed -i.bak 's/echo lint v2/echo lint v3/' .github/workflows/ci.yml && rm -f .github/workflows/*.bak && git commit -q -am lint3 ) >/dev/null 2>&1
  set +e
  out="$(cd "$d" && TAG_ONLY_JOBS=ci.yml:lint run --base v1.0.1 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 1 ] || { echo "self-test: TAG_ONLY_JOBS not honored (rc=$rc)" >&2; fail=1; }

  # An unparseable workflow is "could not check" (3), never OK.
  ( cd "$d" && printf 'jobs: [unclosed\n' >.github/workflows/broken.yml ) >/dev/null 2>&1
  set +e
  ( cd "$d" && run --base v1.0.1 >/dev/null 2>&1 ); rc=$?
  set -e
  [ "$rc" -eq 3 ] || { echo "self-test: expected rc=3 for an unparseable workflow, got $rc" >&2; fail=1; }

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
