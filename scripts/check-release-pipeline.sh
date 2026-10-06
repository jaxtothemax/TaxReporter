#!/usr/bin/env bash
# scripts/check-release-pipeline.sh — refuse to publish from a tag whose commit
# never passed its own branch pipeline.
#
# ## Why this exists
#
# GitLab triggers pipelines per REF. Pushing the release branch and the release
# tag at the same commit starts TWO INDEPENDENT pipelines: one for the branch,
# which runs the lint/test/security suite, and one for the tag, which runs only
# what its rules match. Every job whose rule reads `$CI_COMMIT_BRANCH ==
# $CI_DEFAULT_BRANCH` or `$CI_PIPELINE_SOURCE == "merge_request_event"` DOES NOT
# EXIST in a tag pipeline — so a tag pipeline is not "the same checks again", it
# is the publish jobs and nothing else.
#
# Nothing links the two. A failing branch pipeline has never blocked a tag
# pipeline from publishing, and upstream this shipped a broken release twice:
# the tag pipeline finished and published while the branch pipeline for the same
# commit was still red, and the first anyone knew was after the artifact was
# public. The informal rule ("tag after a green pipeline") was written in a
# comment above the publish job, where nothing could enforce it.
#
# This makes that rule load-bearing. Give every tag-triggered publish/deploy job
# a `needs:` on the job that runs this, and it fails closed unless a pipeline for
# the release ref, at this exact commit, reached `success`.
#
# ## Usage
#
#   bash scripts/check-release-pipeline.sh [sha]   # sha defaults to $CI_COMMIT_SHA
#   bash scripts/check-release-pipeline.sh --self-test
#
# ## Configure
#
#   RELEASE_PIPELINE_REF   the ref whose pipeline is the proof. Default
#                          $CI_DEFAULT_BRANCH, else `main`. On the GitLab Flow
#                          variant, where the tag is cut on `production`, set it
#                          to `production` — the tagged commit's pipeline there
#                          is the one that gates its own deploy.
#   RELEASE_PIPELINE_LIST  self-test / dry-run only: a command that, given a SHA
#                          as $1, prints the JSON array the pipelines endpoint
#                          would return. This is what makes the decision path
#                          testable without a live API or a real wait.
#   RELEASE_PIPELINE_TIMEOUT_SECONDS (default 1800)
#   RELEASE_PIPELINE_POLL_SECONDS    (default 20)
#     Read fresh on every call, so the self-test can drive them down per case.
#
#   CI_API_V4_URL / CI_PROJECT_ID / CI_JOB_TOKEN come from GitLab CI.
#
# ## Exit codes
#
#   0  a pipeline for the release ref at this SHA reached "success"
#   1  it reached a non-success terminal status, or the wait timed out
#   2  invocation error (no SHA available, or no way to reach the API)
#
# ## Porting to GitHub Actions
#
# The shape holds — a tag workflow is not the branch workflow — but the oracle
# changes: ask the commit's check-runs (`GET /repos/{o}/{r}/commits/{sha}/
# check-runs`) for a conclusion, and keep the fail-closed and polling behavior
# below. Do not assume a tag workflow re-runs the branch's checks; on both
# forges, what runs is whatever the tag's own rules match.

set -euo pipefail

TERMINAL_FAILURE_STATUSES="failed canceled skipped"

release_ref() { printf '%s' "${RELEASE_PIPELINE_REF:-${CI_DEFAULT_BRANCH:-main}}"; }

# list_pipelines SHA — print the JSON array of pipelines for the release ref at
# SHA. RELEASE_PIPELINE_LIST overrides the API call for self-test / dry runs.
list_pipelines() {
  local sha="$1"
  if [ -n "${RELEASE_PIPELINE_LIST:-}" ]; then
    $RELEASE_PIPELINE_LIST "$sha"
    return
  fi
  if [ -z "${CI_API_V4_URL:-}" ] || [ -z "${CI_PROJECT_ID:-}" ]; then
    echo "ERROR: CI_API_V4_URL / CI_PROJECT_ID are not set — not running in GitLab CI?" >&2
    echo "       This gate reads the forge API; there is nothing for it to check locally." >&2
    exit 2
  fi
  curl -sSf --header "JOB-TOKEN: ${CI_JOB_TOKEN:-}" \
    "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/pipelines?ref=$(release_ref)&sha=${sha}&order_by=id&sort=desc"
}

# latest_status SHA — status of the newest pipeline for the release ref at SHA,
# empty when none exists yet.
latest_status() {
  list_pipelines "$1" | python3 -c '
import json, sys
pipelines = json.load(sys.stdin)
print(pipelines[0]["status"] if pipelines else "")
'
}

wait_for_pipeline() {
  local sha="$1"
  local ref timeout_seconds poll_seconds elapsed=0 status=""
  ref="$(release_ref)"
  timeout_seconds="${RELEASE_PIPELINE_TIMEOUT_SECONDS:-1800}"
  poll_seconds="${RELEASE_PIPELINE_POLL_SECONDS:-20}"

  while true; do
    status="$(latest_status "$sha")"

    if [ "$status" = "success" ]; then
      echo "OK: the ${ref} pipeline at ${sha} succeeded — publishing may proceed."
      return 0
    fi

    for bad in $TERMINAL_FAILURE_STATUSES; do
      if [ "$status" = "$bad" ]; then
        echo "ERROR: the ${ref} pipeline at ${sha} finished with status '${status}'." >&2
        echo "       Refusing to publish a release built from a commit whose own" >&2
        echo "       branch pipeline did not pass. Fix ${ref} and re-tag." >&2
        return 1
      fi
    done

    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      if [ -z "$status" ]; then
        echo "ERROR: no ${ref} pipeline found for ${sha} after ${timeout_seconds}s." >&2
        echo "       This tag's commit may not be on ${ref}, or that pipeline was" >&2
        echo "       never created. Refusing to publish without proof it passed." >&2
      else
        echo "ERROR: the ${ref} pipeline at ${sha} is still '${status}' after ${timeout_seconds}s." >&2
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
  # terminal failure status still "passes" a code-only check, by waiting out the
  # clock instead of deciding. The message is what distinguishes them.
  check() { # <description> <expected-exit> <expected-output-substring> <command...>
    local desc="$1" want="$2" expect="$3"; shift 3
    local got=0 out
    out="$("$@" 2>&1)" || got=$?
    if [ "$got" != "$want" ]; then
      echo "SELF-TEST FAILED: $desc (expected exit $want, got $got)" >&2
      failures=$((failures + 1)); return
    fi
    if [ -n "$expect" ] && ! grep -qF "$expect" <<<"$out"; then
      echo "SELF-TEST FAILED: $desc (output did not mention '$expect')" >&2
      echo "  got: $out" >&2
      failures=$((failures + 1)); return
    fi
    echo "SELF-TEST OK: $desc."
  }

  cat > "$fixtures/success.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"status":"success","id":1}]'
EOF
  cat > "$fixtures/failed.sh" <<'EOF'
#!/usr/bin/env bash
echo '[{"status":"failed","id":2}]'
EOF
  cat > "$fixtures/none.sh" <<'EOF'
#!/usr/bin/env bash
echo '[]'
EOF
  # The real race: the tag pipeline starts before the branch pipeline is even
  # visible, then it goes running, then it succeeds. Proves the loop RE-CHECKS
  # rather than deciding on the first answer it gets.
  cat > "$fixtures/eventual.sh" <<'EOF'
#!/usr/bin/env bash
state="$0.calls"
calls="$( [ -f "$state" ] && cat "$state" || echo 0 )"
calls=$((calls + 1)); echo "$calls" > "$state"
if   [ "$calls" -eq 1 ]; then echo '[]'
elif [ "$calls" -eq 2 ]; then echo '[{"status":"running","id":3}]'
else                          echo '[{"status":"success","id":3}]'
fi
EOF
  chmod +x "$fixtures"/*.sh

  check "a green pipeline at this commit is accepted" \
        0 "publishing may proceed"     run_case "$fixtures/success.sh"  5 1 abc123
  check "a failed pipeline is rejected AS a failure, not waited out" \
        1 "finished with status"       run_case "$fixtures/failed.sh"   5 1 abc123
  check "no pipeline at this commit is rejected, not ignored" \
        1 "no main pipeline found"     run_case "$fixtures/none.sh"     2 1 abc123
  check "polling waits through 'absent' and 'running' to green" \
        0 "publishing may proceed"     run_case "$fixtures/eventual.sh" 10 1 abc123

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

  local sha="${1:-${CI_COMMIT_SHA:-}}"
  if [ -z "$sha" ]; then
    echo "ERROR: no SHA given and CI_COMMIT_SHA is not set." >&2
    exit 2
  fi

  wait_for_pipeline "$sha"
}

main "$@"
