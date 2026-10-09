#!/usr/bin/env bash
# scripts/check-pr-followups.sh — a pull request that admits a follow-up must name
# the issue that tracks it, and that issue must be open.
#
# Why this exists. Upstream, a post-merge audit of the twenty most recently merged
# MRs found three that said, in their own description, that part of the issue was
# left for "a follow-up" — and no follow-up issue existed for any of them. The
# sentence reads as a plan. With no issue behind it, it is the only record the
# work was owed, and it disappears the moment the PR merges.
#
# The rule: every line of the PR description that says follow-up / deferred / left
# open / out of scope / not yet fixed must carry an issue reference (`#NNN`, or a
# cross-repository `owner/repo#NNN`), and at least one same-repository reference on
# that line must be an OPEN issue — not a pull request, which GitHub numbers in the
# same `#N` space — that this PR does not itself close. Pointing the follow-up at
# the issue being closed is the same hole with extra steps.
#
# Opt-out, per line: `followup-ok` anywhere on the line (e.g. inside an HTML
# comment) for a line that uses the words without owing anything — "deferred
# broadcast via transaction.on_commit()" is not a promise. Like every opt-out in
# this repo it is a rubber stamp; what it removes is the silence.
#
# Code is not scanned: fenced blocks and `inline code` are stripped first.
#
# Input, first that applies:
#   --file <path>        a description in a local file (hand runs, self-test)
#   GitHub API           in a pull_request run (GITHUB_EVENT_PATH carries a
#                        .pull_request), the body is fetched at job time, so
#                        editing the description and re-running the job
#                        re-checks the new text (a re-run reuses the original
#                        event payload, whose copy of the body is frozen)
#   event payload        .pull_request.body from GITHUB_EVENT_PATH, when the
#                        API read fails
#
# Which repository: PR_FOLLOWUPS_REPO, else $GITHUB_REPOSITORY, else the github.com
# `origin` remote. With none of them (a fresh clone with no remote), a hand run
# can only check that each follow-up carries a reference, and says so.
#
# Auth: PR_FOLLOWUPS_TOKEN, else GH_TOKEN / GITHUB_TOKEN, else (outside CI)
# `gh auth token`. With no token, a public repository still answers; a private one
# returns 404 for everything, so the job's GITHUB_TOKEN (issues: read,
# pull-requests: read) is passed in CI. An unresolvable lookup fails the job;
# PR_FOLLOWUPS_ALLOW_UNRESOLVED=1 is the explicit escape hatch.
#
# Usage:  scripts/check-pr-followups.sh [--file <path>] | --self-test
# Exit:   0 clean or not a PR run · 1 an untracked follow-up · 2 usage/fetch error
set -euo pipefail

TRIGGER_RE='follow[- ]?ups?|deferr(ed|ing)|defer(s)? (to|until)|left open|out of (this|the) (mr|pr|issue|change)'"'"'s scope|out of scope (for|of|in) (this|the) (mr|pr|issue|change)|not (yet )?(fixed|addressed|covered)|tracked (separately|later)|punt(ed|ing)?'

API="${GITHUB_API_URL:-https://api.github.com}"

# owner/repo, never hardcoded. Empty when nothing names one.
resolve_repo() {
  local url
  if [ -n "${PR_FOLLOWUPS_REPO:-}" ]; then printf '%s' "$PR_FOLLOWUPS_REPO"; return; fi
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then printf '%s' "$GITHUB_REPOSITORY"; return; fi
  url="$(git remote get-url origin 2>/dev/null || true)"
  url="${url%.git}"
  case "$url" in
    *github.com[:/]*/*) printf '%s' "${url#*github.com[:/]}" ;;
  esac
}

# The token is handed to curl through a process-substitution header file, never
# as an argument, so it does not show up in `ps` on a developer's machine.
_TOKEN_RESOLVED=0 _TOKEN=""
api_get() { # <path> -> prints "<body>\n<http_code>"
  if [ "$_TOKEN_RESOLVED" -eq 0 ]; then
    _TOKEN="${PR_FOLLOWUPS_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"
    if [ -z "$_TOKEN" ] && [ -z "${GITHUB_ACTIONS:-}" ] && command -v gh >/dev/null 2>&1; then
      _TOKEN="$(gh auth token 2>/dev/null || true)"
    fi
    _TOKEN_RESOLVED=1
  fi
  if [ -n "$_TOKEN" ]; then
    curl -s -w $'\n%{http_code}' -H 'Accept: application/vnd.github+json' \
      -H @<(printf 'Authorization: Bearer %s\n' "$_TOKEN") "${API}/$1" || true
  else
    curl -s -w $'\n%{http_code}' -H 'Accept: application/vnd.github+json' "${API}/$1" || true
  fi
}

# Strip fenced code blocks and inline code spans, then join hard-wrapped lines into
# one logical line per bullet/paragraph/table row — PR bodies here are often wrapped
# at ~90 columns, and a reference on the next physical line is still the same claim.
# shellcheck disable=SC2016  # the backticks are literal, not an expansion
prose() {
  awk 'BEGIN{f=0} /^[[:space:]]*(```|~~~)/{f=!f; next} !f{print}' |
    sed -E 's/`[^`]*`//g' |
    awk '
      function flush() { if (buf != "") print buf; buf = "" }
      /^[[:space:]]*$/ { flush(); next }
      /^[[:space:]]{0,3}#+[[:space:]]/ { flush(); print; next }
      /^[[:space:]]*([-*+]|[0-9]+[.)])[[:space:]]|^[[:space:]]*(\||>)/ { flush(); buf = $0; next }
      { sub(/^[[:space:]]+/, ""); buf = (buf == "" ? $0 : buf " " $0) }
      END { flush() }'
}

# issue_state <n> -> prints open|closed|pull|missing, or returns 2 when unresolvable
issue_state() {
  local resp code body
  resp="$(api_get "repos/${REPO}/issues/$1")"
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  case "$code" in
    200) printf '%s' "$body" | jq -r 'if .pull_request then "pull" else (.state // "unknown") end' ;;
    404 | 410) echo missing ;;
    *) return 2 ;;
  esac
}

check_text() {
  local text="$1" closing line refs local_refs ok n fails=0 state
  # Every #N a GitHub closing keyword (close/fix/resolve and their -s/-d forms)
  # reaches, including the rest of a `Closes #1, #2` / `Fixes #1 and #2` chain.
  # GitHub itself only closes the first issue of such a chain, but a follow-up
  # pointed at any of them is the hole this gate exists for, so all count.
  closing="$(grep -oiE '(^|[^A-Za-z0-9_])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+#[0-9]+([[:space:]]*(,|and|&)[[:space:]]*#[0-9]+)*' <<<"$text" |
    grep -oE '#[0-9]+' | grep -oE '[0-9]+' | sort -u || true)"
  while IFS= read -r line; do
    grep -qiE "$TRIGGER_RE" <<<"$line" || continue
    grep -q 'followup-ok' <<<"$line" && continue
    # "Follow-up to !2805" / "follows up #4079" looks BACK at work already done; only a
    # forward-looking follow-up owes anything. Skip the backward form unless the line
    # also uses another trigger word.
    if grep -qiE 'follow[- ]?ups? (to|of|on) [!#]|follows up (on )?[!#]' <<<"$line" &&
      ! grep -qiE "$(sed -E 's/^follow\[- \]\?ups\?\|//' <<<"$TRIGGER_RE")" <<<"$line"; then
      continue
    fi
    refs="$(grep -oE '([A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]*#[0-9]+' <<<"$line" || true)"
    if [ -z "$refs" ]; then
      echo "UNTRACKED: ${line}" >&2
      fails=$((fails + 1))
      continue
    fi
    # A cross-repository reference is tracked somewhere this job cannot read; accept
    # it. It must be owner-qualified (owner/repo#N), or match PR_FOLLOWUPS_SIBLING_RE
    # for a sibling repository written short (e.g. `myapp-enterprise#N`) — a bare
    # `word#N` like `issue#42` is not one.
    if grep -qE "(/[A-Za-z0-9_.-]+${PR_FOLLOWUPS_SIBLING_RE:+|${PR_FOLLOWUPS_SIBLING_RE}})#[0-9]+" <<<"$refs"; then
      continue
    fi
    local_refs="$(grep -oE '#[0-9]+' <<<"$refs" | grep -oE '[0-9]+' | sort -u)"
    ok=0
    for n in $local_refs; do
      if grep -qx "$n" <<<"$closing"; then
        continue
      fi
      if [ -z "$REPO" ]; then
        ok=1 # no tracker to ask (hand run, no remote): a reference is the best we can check
        break
      fi
      if ! state="$(issue_state "$n")"; then
        if [ "${PR_FOLLOWUPS_ALLOW_UNRESOLVED:-}" = "1" ]; then
          ok=1
          break
        fi
        echo "ERROR: could not resolve #${n} against ${REPO} (set PR_FOLLOWUPS_ALLOW_UNRESOLVED=1 to override)" >&2
        return 2
      fi
      if [ "$state" = "open" ]; then
        ok=1
        break
      fi
    done
    if [ "$ok" -ne 1 ]; then
      echo "UNTRACKED (no open issue other than one this PR closes): ${line}" >&2
      fails=$((fails + 1))
    fi
  done < <(prose <<<"$text")
  if [ "$fails" -gt 0 ]; then
    echo "FAIL: ${fails} follow-up line(s) with no open tracking issue." >&2
    echo "      File the issue and reference it on the same line, or mark a line that owes nothing with 'followup-ok'." >&2
    return 1
  fi
  if [ -z "$REPO" ]; then
    echo "NOTE: no repository resolvable — references were checked for presence only, not issue state."
  fi
  echo "OK: every follow-up the PR description names has an open issue."
}

# Exit 0 with the body on stdout · 3 not a PR run · 4 a PR run with no readable body
fetch_description() {
  local event="${GITHUB_EVENT_PATH:-}" number resp code
  if [ -z "$event" ] || [ ! -f "$event" ] ||
    [ "$(jq -r 'has("pull_request")' "$event" 2>/dev/null)" != "true" ]; then
    return 3
  fi
  number="$(jq -r '.pull_request.number // empty' "$event")"
  if [ -n "$number" ] && [ -n "$REPO" ]; then
    resp="$(api_get "repos/${REPO}/pulls/${number}")"
    code="${resp##*$'\n'}"
    if [ "$code" = "200" ]; then
      printf '%s' "${resp%$'\n'*}" | jq -r '.body // ""'
      return 0
    fi
    echo "WARN: could not read PR #${number} from the API (HTTP ${code}); using the event payload's body, frozen when the run was triggered." >&2
  fi
  if jq -e '.pull_request | has("body")' "$event" >/dev/null 2>&1; then
    jq -r '.pull_request.body // ""' "$event"
    return 0
  fi
  echo "ERROR: pull_request run but no description could be read (API failed, event payload has no body)." >&2
  return 4
}

main_ci() {
  local rc=0 desc
  desc="$(fetch_description)" || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "SKIP: not a pull_request run (no .pull_request in GITHUB_EVENT_PATH) — nothing to check."
    return 0
  elif [ "$rc" -ne 0 ]; then
    return 2
  fi
  check_text "$desc"
}

REPO="$(resolve_repo)"

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/bin"
  # Fake tracker: #100 open, #200 closed, #300 and #45 missing, #400 an open PR,
  # PR #7's live body is clean, anything else unreachable.
  cat >"$tmp/bin/curl" <<'CURLMOCK'
#!/usr/bin/env bash
url="${*: -1}"
case "$url" in
  */issues/100) printf '{"state":"open"}\n200' ;;
  */issues/200) printf '{"state":"closed"}\n200' ;;
  */issues/300 | */issues/45) printf '{"message":"Not Found"}\n404' ;;
  */issues/400) printf '{"state":"open","pull_request":{"url":"x"}}\n200' ;;
  */pulls/7) printf '{"body":"- Follow-up: #100"}\n200' ;;
  *) printf '\n000' ;;
esac
CURLMOCK
  chmod +x "$tmp/bin/curl"
  st_fail() { echo "self-test FAIL: $1" >&2; exit 1; }
  # Every case pins its own repo and token, so neither the developer's remote nor
  # their gh login can leak in.
  run() { REPO=o/r PATH="$tmp/bin:$PATH" PR_FOLLOWUPS_TOKEN=self-test check_text "$1" >/dev/null 2>&1; }
  expect_pass() { run "$2" || st_fail "$1 was rejected"; }
  expect_fail() {
    local rc=0
    run "$2" || rc=$?
    [ "$rc" -eq 1 ] || st_fail "$1 — expected exit 1, got $rc"
  }

  expect_pass "no follow-up language" $'## Summary\n- Fixes the thing.\n\nCloses #200'
  expect_pass "follow-up with an open issue" $'- Demo copy is a follow-up: #100'
  expect_fail "follow-up with no reference" $'- A demo-specific message would be a small follow-up.'
  expect_fail "deferred to a closed issue" $'- The MSP confirmation is deferred to #200.'
  expect_fail "deferred to a missing issue" $'- Deferred: see #300.'
  expect_fail "deferred to an open pull request, not an issue" $'- Deferred to #400.'
  expect_fail "follow-up pointing at the issue this PR closes" $'- Rest is a follow-up in #100.\n\nCloses #100'
  expect_fail "follow-up at an issue closed mid-sentence" $'This PR resolves #100.\n\n- The rest is a follow-up in #100.'
  expect_pass "cross-repository reference" $'- Rate cards are out of scope for this PR (acme/other-project#45).'
  expect_fail "out of scope for this PR, untracked" $'- The mobile view is out of scope for this PR.'
  expect_pass "a different sense of scope" $'- The fixture is classified out of the web conformance scope.'
  expect_pass "opt-out marker" $'- The broadcast is deferred to on_commit. <!-- followup-ok -->'
  expect_pass "trigger words inside a code fence" $'```\n# follow-up later\n```'
  expect_pass "trigger words inside inline code" $'- Uses `deferred_until` from the model.'
  expect_pass "backward-looking follow-up to a PR" $'- Follow-up to #2805 / #2806, which changed the roadmap only.'
  expect_fail "backward form plus an untracked deferral" $'- Follow-up to #400; the mobile page is left open.'
  expect_pass "hard-wrapped bullet with the reference on the next line" $'- The demo copy is a small\n  follow-up, tracked in\n  #100.'
  expect_fail "follow-up at the SECOND issue this PR closes" $'- The rest is a follow-up in #100.\n\nCloses #200, #100'
  expect_fail "short sibling ref without PR_FOLLOWUPS_SIBLING_RE" $'- Deferred to myapp-enterprise#45.'
  PR_FOLLOWUPS_SIBLING_RE='myapp-[a-z]+' expect_pass "short sibling ref with PR_FOLLOWUPS_SIBLING_RE" $'- Deferred to myapp-enterprise#45.'
  expect_fail "bare word#N is not a cross-repository reference" $'- Left open, see issue#300.'
  expect_fail "second of two lines untracked" $'- Follow-up: #100\n- Left open: the mobile view.'
  # An unreachable tracker fails closed (exactly 2), and the escape hatch opens it.
  rc=0
  REPO=o/r PATH="$tmp/bin:$PATH" PR_FOLLOWUPS_TOKEN=self-test check_text $'- Follow-up in #999' >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 2 ] || st_fail "an unresolvable issue lookup gave exit $rc, not 2"
  REPO=o/r PATH="$tmp/bin:$PATH" PR_FOLLOWUPS_TOKEN=self-test PR_FOLLOWUPS_ALLOW_UNRESOLVED=1 \
    check_text $'- Follow-up in #999' >/dev/null 2>&1 ||
    st_fail "PR_FOLLOWUPS_ALLOW_UNRESOLVED=1 did not admit an unresolvable lookup"
  # No repository at all: presence of a reference is all that can be checked.
  REPO="" check_text $'- Follow-up in #999' >/dev/null 2>&1 ||
    st_fail "a hand run with no repository rejected a referenced follow-up"
  rc=0
  REPO="" check_text $'- A small follow-up.' >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 1 ] || st_fail "a hand run with no repository accepted an unreferenced follow-up (exit $rc)"
  # The CI path reads the LIVE body, not the event payload's frozen copy: the
  # payload here would fail, the API's current body passes.
  printf '{"pull_request":{"number":7,"body":"- A small follow-up."}}' >"$tmp/event.json"
  REPO=o/r PATH="$tmp/bin:$PATH" PR_FOLLOWUPS_TOKEN=self-test GITHUB_EVENT_PATH="$tmp/event.json" \
    main_ci >/dev/null 2>&1 || st_fail "the live PR body was not preferred over the frozen event payload"
  # ...and falls back to the payload when the API cannot answer.
  printf '{"pull_request":{"number":8,"body":"- A small follow-up."}}' >"$tmp/event8.json"
  rc=0
  REPO=o/r PATH="$tmp/bin:$PATH" PR_FOLLOWUPS_TOKEN=self-test GITHUB_EVENT_PATH="$tmp/event8.json" \
    main_ci >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 1 ] || st_fail "the event-payload fallback did not check the body (exit $rc)"
  printf '{"ref":"refs/heads/main"}' >"$tmp/push.json"
  GITHUB_EVENT_PATH="$tmp/push.json" main_ci >/dev/null 2>&1 || st_fail "a non-PR run did not skip"
  echo "self-test OK"
  exit 0
fi

if [ "${1:-}" = "--file" ]; then
  if [ -z "${2:-}" ] || [ ! -f "$2" ]; then
    echo "usage: $0 --file <path>" >&2
    exit 2
  fi
  check_text "$(cat "$2")"
  exit $?
fi

main_ci
