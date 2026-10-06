#!/usr/bin/env bash
# scripts/check-artifact-assertions.sh — every tag-triggered job that declares
# artifacts:paths must assert, in its own script, that each path is non-empty.
#
# WHY: GitLab passes a job that uploaded nothing ("ERROR: No files to upload",
# "Job succeeded"). Upstream, three tag publish jobs did exactly that in a single
# release. One had `cd`-ed away from the path it declared, and one exited before
# building. The failure surfaced only in a downstream job. A tag-only job runs
# nowhere but on a tag, so the first time anyone learns it produces nothing is
# the release itself.
#
# WHAT IT CHECKS (static): a job is in scope when its own lines mention
# CI_COMMIT_TAG (a `rules:` or `only: variables:` on the tag), when its `only:`
# lists `tags` (`only: [tags]` or `only:` + `- tags`), or when it is named in
# ARTIFACT_ASSERT_JOBS (space-separated). Every artifacts:paths entry of an
# in-scope job must appear as an argument of a `ci-assert-artifacts.sh` line in
# that job's script. The helper itself anchors at $CI_PROJECT_DIR and fails the
# job at runtime.
#
# WHAT IT CANNOT CHECK: that the producing command really writes there (only the
# runtime helper can); that the assertion line is reached (an earlier `exit 0`
# bypasses it); or a job that inherits its tag rule through `extends:` or a YAML
# anchor. Name such a job in ARTIFACT_ASSERT_JOBS. Tag-only jobs cannot run
# before a tag, so this proves the wiring statically and the behavior only at the
# next tag.
#
# Usage: check-artifact-assertions.sh [CI_FILE...] | --self-test
#        (default: .gitlab-ci.yml and ci/*.yml)
# Exit:  0 clean · 1 an unasserted path
set -euo pipefail

scan() {
  ARTIFACT_ASSERT_JOBS="${ARTIFACT_ASSERT_JOBS:-}" python3 - "$1" <<'PY'
import os, re, sys
named = set(os.environ["ARTIFACT_ASSERT_JOBS"].split())
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
jobs, job, state = {}, None, None
for raw in lines:
    if not raw.strip() or raw.lstrip().startswith("#"):
        continue
    ind = len(raw) - len(raw.lstrip(" "))
    c = raw.strip()
    if ind == 0:
        m = re.match(r"^(\S.*?):\s*$", c)
        job = m.group(1) if m else None
        if job:
            jobs.setdefault(job, {"paths": [], "assert": [], "tag": False})
        state = None
        continue
    if job is None:
        continue
    if "CI_COMMIT_TAG" in c:
        jobs[job]["tag"] = True
    if "ci-assert-artifacts.sh" in c:
        jobs[job]["assert"].append(c)
    if ind == 2:
        if c.startswith("only:"):
            state = "only"
            if re.search(r"\btags\b", c):
                jobs[job]["tag"] = True
            continue
        state = "artifacts" if c == "artifacts:" else None
        continue
    if state == "only" and ind >= 4 and re.match(r"^-\s*['\"]?tags['\"]?\s*$", c):
        jobs[job]["tag"] = True
        continue
    if state == "artifacts" and ind == 4:
        if c == "paths:":
            state = "paths"
        elif c.startswith("paths: [") and c.endswith("]"):
            jobs[job]["paths"] += [p.strip().strip("\"'") for p in c[8:-1].split(",") if p.strip()]
        continue
    if state == "paths" and ind >= 6 and c.startswith("- "):
        jobs[job]["paths"].append(c[2:].strip().strip("\"'"))
        continue
    if state == "paths" and ind <= 4:
        state = "artifacts"
for n, d in jobs.items():
    if (d["tag"] or n in named) and d["paths"]:
        print(n + "\t" + "\t".join(d["paths"]) + "\t\x1f\t" + " ".join(d["assert"]))
PY
}

run() {
  local rc=0 f line job rest paths asserts p n=0
  for f in "$@"; do
    [ -f "$f" ] || continue
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      n=$((n + 1))
      job="${line%%$'\t'*}"; rest="${line#*$'\t'}"
      paths="${rest%%$'\t'$'\x1f'*}"; asserts="${rest#*$'\x1f'$'\t'}"
      IFS=$'\t' read -ra arr <<<"$paths"
      for p in "${arr[@]}"; do
        case " $asserts " in
          *" $p "*) : ;;
          *) printf 'VIOLATION: %s (%s) declares artifacts:paths %s but its script has no "ci-assert-artifacts.sh %s"\n' "$job" "$f" "$p" "$p" >&2; rc=1 ;;
        esac
      done
    done < <(scan "$f")
  done
  [ "$rc" -eq 0 ] && echo "check-artifact-assertions: OK — ${n} tag-triggered job(s) with artifacts, every declared path asserted."
  return "$rc"
}

self_test() {
  local d; d="$(mktemp -d)"; trap 'rm -rf "$d"' RETURN
  cat >"$d/good.yml" <<'Y'
publish:
  rules:
    - if: '$CI_COMMIT_TAG'
  script:
    - cd sub
    - sh scripts/ci-assert-artifacts.sh sbom/ dist/app.tar
  artifacts:
    paths:
      - sbom/
      - dist/app.tar
Y
  sed 's#sbom/ dist/app.tar$#sbom/#' "$d/good.yml" >"$d/bad.yml"
  cat >"$d/branch.yml" <<'Y'
build:
  artifacts:
    paths: [dist/]
Y
  cat >"$d/flow.yml" <<'Y'
publish:
  rules:
    - if: '$CI_COMMIT_TAG'
  artifacts:
    paths: [dist/]
Y
  cat >"$d/only.yml" <<'Y'
publish:
  only:
    - tags
  artifacts:
    paths: [dist/]
Y
  printf 'publish:\n  only: [tags]\n  artifacts:\n    paths: [dist/]\n' >"$d/only-flow.yml"
  local fail=0
  if run "$d/only.yml" >/dev/null 2>&1; then echo "self-test: only: - tags job not treated as a tag job" >&2; fail=1; fi
  if run "$d/only-flow.yml" >/dev/null 2>&1; then echo "self-test: only: [tags] job not treated as a tag job" >&2; fail=1; fi
  run "$d/good.yml" >/dev/null 2>&1 || { echo "self-test: asserted tag job rejected" >&2; fail=1; }
  if run "$d/bad.yml" >/dev/null 2>&1; then echo "self-test: one unasserted path NOT caught" >&2; fail=1; fi
  run "$d/branch.yml" >/dev/null 2>&1 || { echo "self-test: non-tag job flagged" >&2; fail=1; }
  if ARTIFACT_ASSERT_JOBS=build run "$d/branch.yml" >/dev/null 2>&1; then echo "self-test: ARTIFACT_ASSERT_JOBS not honored" >&2; fail=1; fi
  if run "$d/flow.yml" >/dev/null 2>&1; then echo "self-test: flow-style paths not caught" >&2; fail=1; fi
  # runtime helper: a populated dir passes; an empty dir and a missing path fail.
  mkdir -p "$d/p/empty" "$d/p/full"; echo x >"$d/p/full/f"
  CI_PROJECT_DIR="$d/p" sh scripts/ci-assert-artifacts.sh full/ 2>/dev/null || { echo "self-test: helper rejected populated dir" >&2; fail=1; }
  if CI_PROJECT_DIR="$d/p" sh scripts/ci-assert-artifacts.sh empty/ 2>/dev/null; then echo "self-test: helper passed empty dir" >&2; fail=1; fi
  if CI_PROJECT_DIR="$d/p" sh scripts/ci-assert-artifacts.sh nope/ 2>/dev/null; then echo "self-test: helper passed missing path" >&2; fail=1; fi
  [ "$fail" -eq 0 ] && echo "check-artifact-assertions: self-test OK"
  return "$fail"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
elif [ "$#" -gt 0 ]; then
  run "$@"
else
  shopt -s nullglob
  run .gitlab-ci.yml ci/*.yml
fi
