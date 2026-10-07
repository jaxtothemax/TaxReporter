#!/usr/bin/env bash
# scripts/check-artifact-assertions.sh — every tag-triggered job that uploads an
# artifact must assert, in an earlier step of its own, that each path is non-empty.
#
# WHY: actions/upload-artifact passes a job that uploaded nothing — its default
# `if-no-files-found: warn` prints a warning and the step succeeds. Upstream (on
# GitLab, which has the same hole), three tag publish jobs did exactly that in a
# single release. One had `cd`-ed away from the path it declared, and one exited
# before building. The failure surfaced only in a downstream job. A tag-only job
# runs nowhere but on a tag, so the first time anyone learns it produces nothing
# is the release itself.
#
# WHAT IT CHECKS (static, over the parsed workflow): a job is in scope when its
# workflow's only automatic triggers are tag pushes or `release` events, when
# anything in its own definition tests for a tag (`refs/tags/`,
# `ref_type == 'tag'`, `event_name == 'release'`), or when it is named in
# ARTIFACT_ASSERT_JOBS (space-separated `job` or `file:job`) — the same scope
# rule as scripts/check-tag-only-jobs.sh. For every `uses:` step of an in-scope
# job that uploads (`actions/upload-artifact`, `actions/upload-pages-artifact`),
# each line of its `with.path` (exclusions starting with `!` aside) must appear
# as an argument of a `ci-assert-artifacts.sh` call in an EARLIER `run:` step of
# the same job. The helper itself anchors at $GITHUB_WORKSPACE and fails the job
# at runtime.
#
# WHAT IT CANNOT CHECK: that the producing command really writes there (only the
# runtime helper can); that the assertion step is reached (an earlier
# `if:`-skipped step or `exit 0` bypasses it); an upload done by a third-party
# action other than the two above, or by `gh release upload` (which fails on a
# missing file by itself, but not on an empty one); or a job whose tag condition
# lives in a reusable workflow. Name such a job in ARTIFACT_ASSERT_JOBS. Tag-only
# jobs cannot run before a tag, so this proves the wiring statically and the
# behavior only at the next tag.
#
# Usage: check-artifact-assertions.sh [WORKFLOW_FILE...] | --self-test
#        (default: .github/workflows/*.yml and *.yaml)
# Exit:  0 clean · 1 an unasserted path · 2 a workflow does not parse, or PyYAML
#        is missing
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prints one VIOLATION line per unasserted path and a final "SCANNED <n>" line
# (in-scope jobs that upload). Exit 2 when the file cannot be read.
scan() {
  ARTIFACT_ASSERT_JOBS="${ARTIFACT_ASSERT_JOBS:-}" python3 - "$1" <<'PY'
import json, os, re, sys

try:
    import yaml
except ImportError:
    sys.stderr.write("check-artifact-assertions: ERROR — PyYAML is not installed (pip install pyyaml).\n")
    sys.exit(2)

path = sys.argv[1]
named = set(os.environ["ARTIFACT_ASSERT_JOBS"].split())
try:
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
except (OSError, yaml.YAMLError) as exc:
    sys.stderr.write("check-artifact-assertions: ERROR — cannot parse %s: %s\n" % (path, exc))
    sys.exit(2)
if not isinstance(doc, dict):
    sys.stderr.write("check-artifact-assertions: ERROR — %s is not a workflow mapping\n" % path)
    sys.exit(2)

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
    return ("tags" in cfg or "tags-ignore" in cfg) and not ("branches" in cfg or "branches-ignore" in cfg)


auto = {e: c for e, c in on.items() if e != "workflow_dispatch"}
workflow_tag_only = bool(auto) and all(tag_trigger(e, c) for e, c in auto.items())
TAG_TEST = re.compile(r"refs/tags/|ref_type\s*==\s*'tag'|event_name\s*==\s*'release'")
UPLOAD = re.compile(r"^actions/upload(-pages)?-artifact@")
wf = path.rsplit("/", 1)[-1]

scanned = 0
for job_id, job in (doc.get("jobs") or {}).items():
    if not isinstance(job, dict):
        continue
    body = json.dumps(job, sort_keys=True, default=str)
    if not (workflow_tag_only or TAG_TEST.search(body)
            or job_id in named or "%s:%s" % (wf, job_id) in named):
        continue
    asserted = set()
    uploads = 0
    for step in job.get("steps") or []:
        if not isinstance(step, dict):
            continue
        run = step.get("run")
        if isinstance(run, str):
            for line in run.splitlines():
                toks = line.split()
                for i, t in enumerate(toks):
                    if t.endswith("ci-assert-artifacts.sh"):
                        asserted.update(x.strip("\"'") for x in toks[i + 1:])
        uses = step.get("uses")
        if not (isinstance(uses, str) and UPLOAD.match(uses)):
            continue
        uploads += 1
        raw = (step.get("with") or {}).get("path")
        if raw is None and "upload-pages-artifact" in uses:
            raw = "_site/"  # the action's documented default
        paths = [p.strip() for p in str(raw or "").splitlines() if p.strip() and not p.strip().startswith("!")]
        if not paths:
            print("VIOLATION: %s (%s) uploads with no `path:` this gate can read" % (job_id, path))
        for p in paths:
            if p not in asserted:
                print('VIOLATION: %s (%s) uploads %s but no earlier step runs "ci-assert-artifacts.sh %s"'
                      % (job_id, path, p, p))
    if uploads:
        scanned += 1
print("SCANNED %d" % scanned)
PY
}

run() {
  local rc=0 f line n=0 out scan_rc
  for f in "$@"; do
    [ -f "$f" ] || continue
    scan_rc=0
    out="$(scan "$f")" || scan_rc=$?
    if [ "$scan_rc" -ne 0 ]; then
      echo "check-artifact-assertions: could not read $f (exit ${scan_rc}) — nothing was checked." >&2
      return 2
    fi
    while IFS= read -r line; do
      case "$line" in
        "SCANNED "*) n=$((n + ${line#SCANNED })) ;;
        VIOLATION:*) printf '%s\n' "$line" >&2; rc=1 ;;
      esac
    done <<<"$out"
  done
  echo "check-artifact-assertions: ${n} tag-triggered job(s) with artifact uploads scanned."
  [ "$rc" -eq 0 ] && echo "check-artifact-assertions: OK — every uploaded path is asserted."
  return "$rc"
}

self_test() {
  local d; d="$(mktemp -d)"; trap 'rm -rf "$d"' RETURN
  cat >"$d/good.yml" <<'Y'
name: release
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: make sbom dist
        working-directory: sub
      - run: sh scripts/ci-assert-artifacts.sh sbom/ dist/app.tar
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v0
        with:
          path: |
            sbom/
            dist/app.tar
            !dist/*.tmp
Y
  sed 's#ci-assert-artifacts.sh sbom/ dist/app.tar$#ci-assert-artifacts.sh sbom/#' "$d/good.yml" >"$d/bad.yml"
  # Asserting AFTER the upload is too late to stop the empty upload.
  cat >"$d/late.yml" <<'Y'
name: release
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v0
        with:
          path: dist/
      - run: sh scripts/ci-assert-artifacts.sh dist/
Y
  cat >"$d/branch.yml" <<'Y'
name: ci
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@0000000000000000000000000000000000000000 # v0
        with:
          path: dist/
Y
  # A job that runs on branches AND tags is in scope when it tests for a tag itself.
  cat >"$d/job-if.yml" <<'Y'
name: ci
on:
  push:
    branches: [main]
    tags: ['v*']
jobs:
  publish:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-pages-artifact@0000000000000000000000000000000000000000 # v0
        with:
          path: website/dist
Y
  printf 'name: rel\non:\n  release:\n    types: [published]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/upload-artifact@0000000000000000000000000000000000000000\n        with: {path: dist/}\n' >"$d/release-event.yml"
  printf 'name: ci\njobs:\n  lint: [unclosed\n' >"$d/broken.yml"

  local fail=0 rc
  _expect() { # <description> <expected-exit> <file> [env-assignment]
    local desc="$1" want="$2" file="$3" envset="${4:-}" got=0 out
    if [ -n "$envset" ]; then
      out="$(env "$envset" bash "${BASH_SOURCE[0]}" "$file" 2>&1)" || got=$?
    else
      out="$(bash "${BASH_SOURCE[0]}" "$file" 2>&1)" || got=$?
    fi
    if [ "$got" -ne "$want" ]; then
      echo "self-test: $desc — expected exit $want, got $got: $out" >&2; fail=1; return
    fi
    if [ "$want" -ne 2 ] && ! grep -q 'job(s) with artifact uploads scanned' <<<"$out"; then
      echo "self-test: $desc — no verdict line; the scan never finished: $out" >&2; fail=1
    fi
  }
  _expect "asserted tag job"                         0 "$d/good.yml"
  _expect "one unasserted path"                      1 "$d/bad.yml"
  _expect "assertion after the upload"               1 "$d/late.yml"
  _expect "non-tag job"                              0 "$d/branch.yml"
  _expect "ARTIFACT_ASSERT_JOBS"                     1 "$d/branch.yml" ARTIFACT_ASSERT_JOBS=build
  _expect "job-level refs/tags/ condition"           1 "$d/job-if.yml"
  _expect "release-event workflow, flow-style with"  1 "$d/release-event.yml"
  _expect "unparseable workflow"                     2 "$d/broken.yml"

  # runtime helper: a populated dir passes; an empty dir and a missing path fail.
  mkdir -p "$d/p/empty" "$d/p/full"; echo x >"$d/p/full/f"
  GITHUB_WORKSPACE="$d/p" sh "$REPO_ROOT/scripts/ci-assert-artifacts.sh" full/ 2>/dev/null || { echo "self-test: helper rejected populated dir" >&2; fail=1; }
  rc=0; GITHUB_WORKSPACE="$d/p" sh "$REPO_ROOT/scripts/ci-assert-artifacts.sh" empty/ 2>/dev/null || rc=$?
  [ "$rc" -eq 1 ] || { echo "self-test: helper did not exit 1 on an empty dir (got $rc)" >&2; fail=1; }
  rc=0; GITHUB_WORKSPACE="$d/p" sh "$REPO_ROOT/scripts/ci-assert-artifacts.sh" nope/ 2>/dev/null || rc=$?
  [ "$rc" -eq 1 ] || { echo "self-test: helper did not exit 1 on a missing path (got $rc)" >&2; fail=1; }
  [ "$fail" -eq 0 ] && echo "check-artifact-assertions: self-test OK"
  return "$fail"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
elif [ "$#" -gt 0 ]; then
  run "$@"
else
  cd "$REPO_ROOT"
  shopt -s nullglob
  files=(.github/workflows/*.yml .github/workflows/*.yaml)
  shopt -u nullglob
  run "${files[@]+"${files[@]}"}"
fi
