#!/usr/bin/env bash
# scripts/check-release-pipeline.sh — refuse to publish from a tag whose commit
# never passed its own main-branch CI.
#
# ## Why this exists
#
# A forge triggers CI per REF. Pushing a tag at a commit that is already on
# `main` starts a run for the TAG that is independent of the runs `main` got for
# the same commit: on GitHub, the tag push triggers only the workflows whose `on:`
# matches a tag push — here, `.github/workflows/release.yml` — and none of the
# governance, security or docs workflows that gate `main`. So a tag run is not
# "the same checks again"; it is the publish job and nothing else.
#
# Nothing links the two. A red `main` run has never blocked a tag run from
# publishing, and upstream (on GitLab, where pipelines split the same way) this
# shipped a broken release twice: the tag pipeline finished and published while
# the branch pipeline for the same commit was still red, and the first anyone
# knew was after the artifact was public. The informal rule ("tag after a green
# pipeline") was written in a comment above the publish job, where nothing could
# enforce it.
#
# This makes that rule load-bearing. Give every tag-triggered publish/deploy job
# `needs: [release-pipeline-gate]` on the job that runs this, and it fails closed
# unless the workflow runs for the release ref, at this exact commit, all
# concluded `success`.
#
# ## The oracle: workflow runs, not check-runs
#
# It reads `GET /repos/{owner}/{repo}/actions/runs?head_sha=<sha>&branch=<ref>`
# and keeps the newest run of each workflow file. The commit's check-runs
# (`/commits/{sha}/check-runs`) are the wrong oracle: the tag's own release run
# is at the same SHA, so this gate would find itself in_progress there and wait
# on its own result. Filtering on `branch` drops the tag's runs (their
# head_branch is the tag name), and pull_request runs are dropped explicitly — a
# PR run proves the branch, not the commit that landed on main.
#
# The verdict:
#   success  every workflow seen concluded `success`, and every workflow named
#            in RELEASE_PIPELINE_WORKFLOWS was seen
#   failure  any newest run concluded anything else (failure, cancelled,
#            skipped, timed_out, action_required, startup_failure, stale, ...)
#   pending  a run is still queued/in_progress, or a required workflow has not
#            reported yet — polled until RELEASE_PIPELINE_TIMEOUT_SECONDS
#
# ## Usage
#
#   bash scripts/check-release-pipeline.sh [sha]   # sha defaults to $GITHUB_SHA
#   bash scripts/check-release-pipeline.sh --self-test
#
# Run by hand with a SHA, it answers "is main green at this commit?" against the
# repository the `origin` remote points at — useful before pushing a tag.
#
# ## Configure
#
#   RELEASE_PIPELINE_REF   the branch whose runs are the proof. Default `main`
#                          ($GITHUB_EVENT_REPOSITORY_DEFAULT_BRANCH if the
#                          caller exports it).
#   RELEASE_PIPELINE_WORKFLOWS  space-separated workflow file names that MUST
#                          have a run at this SHA. Default `governance.yml`.
#                          Every OTHER workflow that ran on the ref at this SHA
#                          must also have succeeded; this list only adds "and
#                          these must have run at all", so a workflow that never
#                          started is not mistaken for one that passed.
#   RELEASE_PIPELINE_REPO  owner/repo. Default $GITHUB_REPOSITORY, else derived
#                          from the `origin` remote, else `gh repo view`.
#   RELEASE_PIPELINE_LIST  self-test / dry-run only: a command that, given a SHA
#                          as $1, prints the JSON the runs endpoint would
#                          return. This is what makes the decision path testable
#                          without a live API or a real wait.
#   RELEASE_PIPELINE_TIMEOUT_SECONDS (default 1800)
#   RELEASE_PIPELINE_POLL_SECONDS    (default 20)
#     Read fresh on every call, so the self-test can drive them down per case.
#
#   GH_TOKEN authenticates `gh api`; in CI it is the job's GITHUB_TOKEN, which
#   needs `actions: read`.
#
# ## Exit codes
#
#   0  every workflow run for the release ref at this SHA concluded "success"
#   1  one concluded otherwise, or the wait timed out
#   2  invocation error (no SHA available, or no way to reach the API), or the
#      API answered with something that is not a runs listing

set -euo pipefail

release_ref() { printf '%s' "${RELEASE_PIPELINE_REF:-${GITHUB_EVENT_REPOSITORY_DEFAULT_BRANCH:-main}}"; }

# owner/repo, never hardcoded: env first, then the origin remote, then gh.
resolve_repo() {
  local url
  if [ -n "${RELEASE_PIPELINE_REPO:-}" ]; then printf '%s' "$RELEASE_PIPELINE_REPO"; return 0; fi
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then printf '%s' "$GITHUB_REPOSITORY"; return 0; fi
  url="$(git remote get-url origin 2>/dev/null || true)"
  if [ -n "$url" ]; then
    url="${url%.git}"
    case "$url" in
      *github.com[:/]*/*) printf '%s' "${url#*github.com[:/]}"; return 0 ;;
    esac
  fi
  if command -v gh >/dev/null 2>&1; then
    gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null && return 0
  fi
  return 1
}

# list_runs SHA — print the runs-endpoint JSON for the release ref at SHA.
# RELEASE_PIPELINE_LIST overrides the API call for self-test / dry runs.
list_runs() {
  local sha="$1" repo
  if [ -n "${RELEASE_PIPELINE_LIST:-}" ]; then
    $RELEASE_PIPELINE_LIST "$sha"
    return
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: gh is not installed — this gate reads the GitHub Actions API." >&2
    exit 2
  fi
  if ! repo="$(resolve_repo)"; then
    echo "ERROR: cannot tell which GitHub repository to ask (no GITHUB_REPOSITORY," >&2
    echo "       no github.com origin remote, and gh repo view failed)." >&2
    echo "       This gate reads the forge API; there is nothing for it to check locally." >&2
    exit 2
  fi
  if ! gh api -X GET "repos/${repo}/actions/runs" \
      -f head_sha="$sha" -f branch="$(release_ref)" -F per_page=100; then
    echo "ERROR: the GitHub API did not answer for ${repo}@${sha} — failing closed." >&2
    exit 2
  fi
}

# verdict SHA — one line: "success<TAB>workflows", "failure<TAB>why",
# "pending<TAB>why", or "none" when no qualifying run exists yet. Returns 2 when
# the runs could not be listed or parsed: a lookup failure is a failure, never
# "nothing yet, keep waiting" (scripts/CLAUDE.md, "A gate that cannot reach its
# oracle must go RED").
verdict() {
  local json
  json="$(list_runs "$1")" || return 2
  RELEASE_PIPELINE_WORKFLOWS="${RELEASE_PIPELINE_WORKFLOWS-governance.yml}" python3 -c '
import json, os, sys
try:
    runs = json.load(sys.stdin).get("workflow_runs") or []
except (ValueError, AttributeError) as exc:
    sys.stderr.write("ERROR: the runs listing is not the JSON object expected: %s\n" % exc)
    sys.exit(2)
newest = {}
for r in runs:
    if str(r.get("event", "")).startswith("pull_request"):
        continue
    wf = str(r.get("path", "")).split("@", 1)[0].rsplit("/", 1)[-1] or str(r.get("name"))
    if wf not in newest or r.get("id", 0) > newest[wf].get("id", 0):
        newest[wf] = r
required = os.environ["RELEASE_PIPELINE_WORKFLOWS"].split()
bad = sorted("%s=%s" % (w, r.get("conclusion")) for w, r in newest.items()
             if r.get("status") == "completed" and r.get("conclusion") != "success")
waiting = sorted("%s=%s" % (w, r.get("status")) for w, r in newest.items() if r.get("status") != "completed")
absent = [w for w in required if w not in newest]
if bad:
    print("failure\t" + ", ".join(bad))
elif not newest:
    print("none")
elif waiting or absent:
    why = waiting + ["%s never reported" % w for w in absent]
    print("pending\t" + ", ".join(why))
else:
    print("success\t" + ", ".join(sorted(newest)))
' <<<"$json" || return 2
}

wait_for_pipeline() {
  local sha="$1"
  local ref timeout_seconds poll_seconds elapsed=0 line state detail
  ref="$(release_ref)"
  timeout_seconds="${RELEASE_PIPELINE_TIMEOUT_SECONDS:-1800}"
  poll_seconds="${RELEASE_PIPELINE_POLL_SECONDS:-20}"

  while true; do
    if ! line="$(verdict "$sha")"; then
      echo "ERROR: could not read ${ref} CI state for ${sha} — failing closed." >&2
      return 2
    fi
    state="${line%%$'\t'*}"
    detail=""
    case "$line" in *$'\t'*) detail="${line#*$'\t'}" ;; esac

    case "$state" in
      success)
        echo "OK: every ${ref} workflow run at ${sha} succeeded (${detail}) — publishing may proceed."
        return 0
        ;;
      failure)
        echo "ERROR: ${ref} CI at ${sha} finished with a non-success conclusion: ${detail}." >&2
        echo "       Refusing to publish a release built from a commit whose own" >&2
        echo "       ${ref} CI did not pass. Fix ${ref} and re-tag." >&2
        return 1
        ;;
    esac

    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      if [ "$state" = "none" ]; then
        echo "ERROR: no ${ref} workflow runs found for ${sha} after ${timeout_seconds}s." >&2
        echo "       This tag's commit may not be on ${ref}, or its runs were never" >&2
        echo "       created. Refusing to publish without proof they passed." >&2
      else
        echo "ERROR: ${ref} CI at ${sha} is still pending after ${timeout_seconds}s (${detail})." >&2
        echo "       Refusing to publish before it reaches a result." >&2
      fi
      return 1
    fi

    sleep "$poll_seconds"
    elapsed=$((elapsed + poll_seconds))
  done
}

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# The fixture stands in for the API, so the polling and decision logic run for
# real without a network or a thirty-minute wait.
run_case() { # <fixture> <timeout> <poll> <sha>
  (
    export RELEASE_PIPELINE_LIST="$1"
    export RELEASE_PIPELINE_TIMEOUT_SECONDS="$2"
    export RELEASE_PIPELINE_POLL_SECONDS="$3"
    export RELEASE_PIPELINE_WORKFLOWS="governance.yml"
    export RELEASE_PIPELINE_REF="main"
    wait_for_pipeline "$4"
  )
}

self_test() {
  local failures=0 fixtures
  fixtures="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$fixtures'" EXIT

  # Asserts the exit code AND the reason. Exit code alone cannot tell a rejection
  # apart from a timeout — both are 1 — so a mutation that stops recognizing a
  # terminal failure conclusion still "passes" a code-only check, by waiting out
  # the clock instead of deciding. The message is what distinguishes them.
  check() { # <description> <expected-exit> <expected-output-substring> <command...>
    local desc="$1" want="$2" expect="$3"; shift 3
    local got=0 out
    out="$("$@" 2>&1)" || got=$?
    if [ "$got" != "$want" ]; then
      echo "SELF-TEST FAILED: $desc (expected exit $want, got $got)" >&2
      echo "  got: $out" >&2
      failures=$((failures + 1)); return
    fi
    if [ -n "$expect" ] && ! grep -qF "$expect" <<<"$out"; then
      echo "SELF-TEST FAILED: $desc (output did not mention '$expect')" >&2
      echo "  got: $out" >&2
      failures=$((failures + 1)); return
    fi
    echo "SELF-TEST OK: $desc."
  }

  # fixture <name> <json> — a stand-in for the runs endpoint.
  fixture() {
    printf '#!/usr/bin/env bash\ncat <<'"'"'JSON'"'"'\n%s\nJSON\n' "$2" >"$fixtures/$1.sh"
    chmod +x "$fixtures/$1.sh"
  }
  local G='"path":".github/workflows/governance.yml"' S='"path":".github/workflows/security.yml"'
  fixture success  '{"workflow_runs":[{"id":2,'"$G"',"event":"push","status":"completed","conclusion":"success"},{"id":3,'"$S"',"event":"push","status":"completed","conclusion":"success"}]}'
  fixture failed   '{"workflow_runs":[{"id":2,'"$G"',"event":"push","status":"completed","conclusion":"success"},{"id":3,'"$S"',"event":"push","status":"completed","conclusion":"failure"}]}'
  fixture none     '{"total_count":0,"workflow_runs":[]}'
  fixture pr-only  '{"workflow_runs":[{"id":2,'"$G"',"event":"pull_request","status":"completed","conclusion":"success"}]}'
  fixture missing  '{"workflow_runs":[{"id":3,'"$S"',"event":"push","status":"completed","conclusion":"success"}]}'
  fixture stuck    '{"workflow_runs":[{"id":2,'"$G"',"event":"push","status":"completed","conclusion":"success"},{"id":3,'"$S"',"event":"push","status":"in_progress","conclusion":null}]}'
  fixture rerun    '{"workflow_runs":[{"id":2,'"$G"',"event":"push","status":"completed","conclusion":"failure"},{"id":9,'"$G"',"event":"push","status":"completed","conclusion":"success"}]}'
  fixture skipped  '{"workflow_runs":[{"id":2,'"$G"',"event":"push","status":"completed","conclusion":"skipped"}]}'
  # The real race: the tag run starts before main's runs are even visible, then
  # they go in_progress, then they succeed. Proves the loop RE-CHECKS rather than
  # deciding on the first answer it gets.
  cat > "$fixtures/eventual.sh" <<EOF2
#!/usr/bin/env bash
state="\$0.calls"
calls="\$( [ -f "\$state" ] && cat "\$state" || echo 0 )"
calls=\$((calls + 1)); echo "\$calls" > "\$state"
if   [ "\$calls" -eq 1 ]; then echo '{"workflow_runs":[]}'
elif [ "\$calls" -eq 2 ]; then echo '{"workflow_runs":[{"id":3,$G,"event":"push","status":"in_progress","conclusion":null}]}'
else                            echo '{"workflow_runs":[{"id":3,$G,"event":"push","status":"completed","conclusion":"success"}]}'
fi
EOF2
  chmod +x "$fixtures/eventual.sh"

  check "every main run green at this commit is accepted" \
        0 "publishing may proceed"            run_case "$fixtures/success.sh"  5 1 abc123
  check "one failed workflow is rejected AS a failure, not waited out" \
        1 "non-success conclusion"            run_case "$fixtures/failed.sh"   5 1 abc123
  check "a skipped run is not a pass" \
        1 "governance.yml=skipped"            run_case "$fixtures/skipped.sh"  5 1 abc123
  check "no runs at this commit is rejected, not ignored" \
        1 "no main workflow runs found"       run_case "$fixtures/none.sh"     2 1 abc123
  check "a pull_request run is not proof for main" \
        1 "no main workflow runs found"       run_case "$fixtures/pr-only.sh"  2 1 abc123
  check "a required workflow that never ran is not a pass" \
        1 "governance.yml never reported"     run_case "$fixtures/missing.sh"  2 1 abc123
  check "a run still in progress at the deadline is rejected" \
        1 "security.yml=in_progress"          run_case "$fixtures/stuck.sh"    2 1 abc123
  check "the newest run of a workflow wins over an older failure" \
        0 "publishing may proceed"            run_case "$fixtures/rerun.sh"    5 1 abc123
  printf '#!/usr/bin/env bash\necho "HTTP 502" >&2\nexit 1\n' >"$fixtures/down.sh"; chmod +x "$fixtures/down.sh"
  check "an API that does not answer fails closed (2), not 'keep waiting'" \
        2 "failing closed"                    run_case "$fixtures/down.sh"     5 1 abc123
  fixture garbage  '<html>rate limited</html>'
  check "a non-JSON answer fails closed (2)" \
        2 "failing closed"                    run_case "$fixtures/garbage.sh"  5 1 abc123
  check "polling waits through 'absent' and 'in_progress' to green" \
        0 "publishing may proceed"            run_case "$fixtures/eventual.sh" 10 1 abc123

  if [ "$failures" -eq 0 ]; then
    echo "SELF-TEST: all cases passed."
    return 0
  fi
  echo "SELF-TEST: $failures case(s) failed." >&2
  return 1
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    exit $?
  fi

  local sha="${1:-${GITHUB_SHA:-}}"
  if [ -z "$sha" ]; then
    echo "ERROR: no SHA given and GITHUB_SHA is not set." >&2
    echo "       Outside CI, pass the commit to check: $0 \$(git rev-parse HEAD)" >&2
    exit 2
  fi

  wait_for_pipeline "$sha"
}

main "$@"
