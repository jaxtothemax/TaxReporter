#!/usr/bin/env sh
# scripts/osv-severity-gate.sh — severity gate for the osv-scan CI job.
#
# OSV-Scanner has no native severity threshold (confirmed on v2.3.8: no
# --severity / --fail-on / --audit-level flag), so it exits non-zero on *any*
# non-ignored advisory. Left alone, a single fixable LOW would red-wall the
# whole pipeline exactly as hard as a CRITICAL — no way to distinguish "block"
# from "worth knowing about".
#
# This gate reads OSV-Scanner's `--format json` output and classifies each
# advisory group against a configurable threshold:
#   - FAIL (exit 1)  → at or above OSV_SEVERITY_THRESHOLD: CVSS base score at
#                      or above the threshold's floor, or — when no CVSS score
#                      is published — the GitHub advisory label
#                      (database_specific.severity) ranks at or above it.
#   - WARN (exit 2)  → below the threshold: printed, non-blocking. The CI job
#                      maps exit 2 to `allow_failure`, so the pipeline shows a
#                      yellow warning (surfacing dependency debt) instead of a
#                      silent green pass.
#
# Exit-code contract (the whole pipeline's OSV verdict):
#   0 → clean: no advisories survived suppression, or nothing was found to
#       scan (no lockfiles in the tree — see below).
#   1 → an advisory at or above the threshold is present, OR fail-safe
#       (missing/empty/unparseable results): the scan verdict is bad or the
#       scan itself did not complete — block.
#   2 → only below-threshold advisories, OR a scan that could not complete
#       with ALLOW_UNRESOLVED=1 set — non-blocking warning (allow_failure).
#   3 → usage or configuration error (bad invocation, unrecognized
#       OSV_SEVERITY_THRESHOLD). A hard block, kept distinct from 2 so a
#       misconfigured gate can never be mistaken for a benign warning.
#
# ## "No advisories" is not one situation — it is two, and they must not
#    collapse into the same code path
#
# A template clone with no dependency manifests yet, and a scan that could not
# reach the advisory database, both produce "no findings" on the surface — but
# only one of them is safe to treat as clean.
#
#   - No lockfiles in the tree: the CI job runs OSV-Scanner with
#     --allow-no-lockfiles, which exits 0 and writes `{"results": null}` (not
#     an error). This gate treats a null/absent `results` array the same as an
#     empty one — TOTAL 0, clean, exit 0. There is genuinely nothing to scan,
#     so there is nothing to be unresolved about.
#   - The advisory database is unreachable (network down, blocked egress):
#     OSV-Scanner exits non-zero and writes NO output file at all (verified
#     against a broken proxy: no partial, no empty file — nothing). The
#     missing-file branch below is what catches this, and it fails closed.
#
# Accepted risks are suppressed via an osv-scanner.toml next to the relevant
# lockfile (auto-discovered by osv-scanner — do not pass --config, which would
# force a single global file), with a documented, expiring `IgnoredVulns`
# entry giving a reason. Tag the reason with SUPPRESSED-UNTIL(#N) when the
# exemption should not outlive a tracked cleanup issue —
# scripts/check-stale-references.sh reads that marker wherever it appears in
# the tree, osv-scanner.toml included, and fails once #N closes.
# OSV-Scanner drops a suppressed advisory before writing the JSON, so it never
# reaches this gate; this gate only decides *severity banding* for advisories
# that survive suppression.
#
# ## Configuration
#
#   OSV_SEVERITY_THRESHOLD  Minimum severity that blocks the pipeline. One of
#                           LOW, MEDIUM, HIGH, CRITICAL. Default: HIGH (CVSS
#                           >= 7.0, or an unscored HIGH/CRITICAL label) —
#                           matches the CVSS v3 severity bands.
#   ALLOW_UNRESOLVED=1      Per scripts/CLAUDE.md's "a gate that cannot reach
#                           its oracle must go RED": a missing/empty/
#                           unparseable results file means the scan did not
#                           complete, and the default is to fail closed (exit
#                           1). This is the one explicit, named opt-out —
#                           downgrades that case to a non-blocking warning
#                           (exit 2) instead. Set it only where the advisory
#                           database is known to be genuinely unreachable
#                           (e.g. an air-gapped runner), and remove it once
#                           that stops being true — it is visible in whatever
#                           diff or job config sets it, which is the point.
#
# --self-test: builds synthetic OSV-Scanner JSON fixtures in a temp directory
# and asserts the classification logic still fires correctly — an advisory at
# the threshold blocks, one below it warns non-blocking, a missing file fails
# safe (and ALLOW_UNRESOLVED=1 can name that as an explicit exception), the
# threshold itself is configurable in both directions, and an unrecognized
# threshold is a hard configuration error rather than a silent default. Run by
# the osv-scan CI job on the same image, immediately before the real
# invocation, per scripts/CLAUDE.md's "same job is the only way to say 'same
# image'" — a self-test that ran in a different job would not have caught the
# class of bug this gate exists to avoid (a JSON parser missing from the job
# image, dying silently before printing anything).
#
# Usage: sh scripts/osv-severity-gate.sh <osv-results.json>
#        sh scripts/osv-severity-gate.sh --self-test
set -eu

# jq filter: flatten OSV JSON to one record per advisory group. The numeric
# severity is group.max_severity (a CVSS base score string, "" when unscored).
# The fallback label is the max database_specific.severity across the group's
# member vulnerabilities (matched by id OR alias). $threshold_cvss and
# $threshold_rank are supplied per-invocation via `jq --argjson` so the same
# static filter serves every configured threshold. `.results // []` guards
# against `results: null`, which is exactly what OSV-Scanner writes for a
# clean scan of a tree with no lockfiles at all (--allow-no-lockfiles) — never
# `.results` being absent entirely, which would be a malformed file this
# filter should still fail to parse.
#
# Defined before run_gate/self_test below so it is set before either can be
# called, including on the --self-test path which returns before the normal
# argument-parsing section that used to define it.
# shellcheck disable=SC2016  # $-vars below are jq variables, not shell — single-quote intentionally.
FILTER='
[ (.results // [])[]
  | .source.path as $src
  | .packages[]
  | .package as $pkg
  | (.vulnerabilities // []) as $vulns
  | (.groups // [])[]
  | . as $g
  | ((.max_severity // "") | if . == "" then null else tonumber end) as $cvss
  | ([ $vulns[]
       | select(([.id] + (.aliases // [])) as $names
                | ($g.ids // []) | any(. as $id | $names | index($id)))
       | (.database_specific.severity // "" | ascii_upcase) ]) as $labels
  | ($labels | map({"LOW":1,"MEDIUM":2,"HIGH":3,"CRITICAL":4}[.] // 0) | (max // 0)) as $label_rank
  | (($cvss != null and $cvss >= $threshold_cvss) or ($label_rank >= $threshold_rank)) as $fail
  | { src: $src, pkg: $pkg.name, version: $pkg.version,
      ids: ($g.ids | join(",")),
      cvss: ($cvss // "n/a"),
      label: ($labels | map(select(. != "")) | (first // "UNSCORED")),
      bucket: (if $fail then "FAIL" else "WARN" end) }
]'

# threshold_to_bounds <LABEL> — sets THRESHOLD_CVSS and THRESHOLD_RANK for the
# jq filter above, or prints a usage error and returns 1 for an unrecognized
# label. The CVSS floors are the standard CVSS v3 severity band boundaries.
threshold_to_bounds() {
  case "$1" in
    LOW) THRESHOLD_CVSS=0.1; THRESHOLD_RANK=1 ;;
    MEDIUM) THRESHOLD_CVSS=4.0; THRESHOLD_RANK=2 ;;
    HIGH) THRESHOLD_CVSS=7.0; THRESHOLD_RANK=3 ;;
    CRITICAL) THRESHOLD_CVSS=9.0; THRESHOLD_RANK=4 ;;
    *)
      echo "osv-severity-gate: OSV_SEVERITY_THRESHOLD must be one of LOW, MEDIUM, HIGH, CRITICAL (got '$1')." >&2
      return 1
      ;;
  esac
}

# run_gate <results-file>
#
# Core classification logic, extracted into a function so --self-test can
# call it in-process against synthetic fixtures without a second process.
# Prints the report to stdout/stderr; returns 0 (clean), 1 (block: at or above
# threshold, or fail-safe), 2 (non-blocking warn: below threshold, or an
# unresolved scan with ALLOW_UNRESOLVED=1), or 3 (usage/config error) per the
# exit-code contract above.
run_gate() {
  RESULTS="$1"
  THRESHOLD="${OSV_SEVERITY_THRESHOLD:-HIGH}"
  threshold_to_bounds "$THRESHOLD" || return 3

  if [ ! -s "$RESULTS" ]; then
    if [ "${ALLOW_UNRESOLVED:-}" = "1" ]; then
      echo "osv-severity-gate: WARN — results file '$RESULTS' is missing or empty (the scan did not complete), but ALLOW_UNRESOLVED=1 is set; treating this as a non-blocking warning instead of a fail-closed block." >&2
      echo "osv-severity-gate: this is an explicit, named opt-out, not a default — unset ALLOW_UNRESOLVED once the advisory database is reachable again." >&2
      return 2
    fi
    echo "osv-severity-gate: results file '$RESULTS' is missing or empty — treating as scan failure (fail closed; set ALLOW_UNRESOLVED=1 to override)." >&2
    return 1
  fi

  FINDINGS="$(jq -c --argjson threshold_cvss "$THRESHOLD_CVSS" --argjson threshold_rank "$THRESHOLD_RANK" "$FILTER" "$RESULTS")" || {
    echo "osv-severity-gate: could not parse '$RESULTS' as OSV-Scanner JSON." >&2
    return 1
  }

  TOTAL="$(printf '%s' "$FINDINGS" | jq 'length')"
  FAILS="$(printf '%s' "$FINDINGS" | jq '[.[] | select(.bucket == "FAIL")] | length')"
  WARNS="$(printf '%s' "$FINDINGS" | jq '[.[] | select(.bucket == "WARN")] | length')"

  if [ "$TOTAL" -eq 0 ]; then
    echo "osv-severity-gate: no advisories — clean."
    return 0
  fi

  echo "osv-severity-gate: $TOTAL advisory group(s) — $FAILS blocking (>= $THRESHOLD), $WARNS warning (< $THRESHOLD)."
  echo ""
  printf '%-6s  %-9s  %-24s  %-6s  %-9s  %s\n' "BUCKET" "SEVERITY" "PACKAGE@VERSION" "CVSS" "SOURCE" "ADVISORY"
  printf '%s' "$FINDINGS" | jq -r '
    sort_by(.bucket == "WARN", .cvss)
    | .[]
    | [ .bucket, .label, (.pkg + "@" + .version),
        (.cvss | tostring), (.src | sub(".*/"; "")), .ids ]
    | @tsv' \
    | while IFS="$(printf '\t')" read -r bucket label pv cvss src ids; do
        printf '%-6s  %-9s  %-24s  %-6s  %-9s  %s\n' "$bucket" "$label" "$pv" "$cvss" "$src" "$ids"
      done
  echo ""

  if [ "$FAILS" -gt 0 ]; then
    echo "osv-severity-gate: FAIL — $FAILS advisory group(s) at or above the configured threshold ($THRESHOLD) block the pipeline." >&2
    echo "Fix the dependency, or (only for an accepted risk) add a documented, expiring" >&2
    echo "IgnoredVulns entry to an osv-scanner.toml next to the affected lockfile." >&2
    return 1
  fi

  echo "osv-severity-gate: WARN — only advisories below the configured threshold ($THRESHOLD) are present (non-blocking)." >&2
  return 2
}

# self_test — synthetic OSV JSON fixtures covering the classification
# boundaries a silent regression would most plausibly erase: an advisory at
# the threshold blocks, a clean scan passes, a missing file fails safe (rather
# than silently passing), a below-threshold advisory warns without blocking,
# ALLOW_UNRESOLVED=1 names the missing-file case as an explicit exception, the
# threshold moves the same fixture across the block/warn line in both
# directions, and a bad threshold value is a configuration error rather than a
# silent fallback to some default. Each case demands the EXACT exit code and
# the gate's own verdict line — not merely "non-zero" — per scripts/CLAUDE.md:
# a probe that accepts any failure cannot tell a real rejection from a crash.
self_test() {
  ST_TMP=$(mktemp -d)
  trap 'rm -rf "$ST_TMP"' EXIT

  command -v jq >/dev/null 2>&1 || {
    echo "osv-severity-gate --self-test: jq not installed — cannot self-test (same dependency the real gate needs)." >&2
    exit 1
  }

  echo "=== osv-severity-gate.sh --self-test ==="

  cat > "$ST_TMP/high.json" <<'JSON'
{"results":[{"source":{"path":"backend/requirements.txt"},"packages":[
 {"package":{"name":"bad-pkg","version":"1.0.0","ecosystem":"PyPI"},
  "vulnerabilities":[{"id":"GHSA-x","database_specific":{"severity":"HIGH"}}],
  "groups":[{"ids":["GHSA-x"],"max_severity":"7.5"}]}
]}]}
JSON

  cat > "$ST_TMP/low.json" <<'JSON'
{"results":[{"source":{"path":"frontend/package-lock.json"},"packages":[
 {"package":{"name":"low-pkg","version":"1.0.0","ecosystem":"npm"},
  "vulnerabilities":[{"id":"GHSA-y","database_specific":{"severity":"LOW"}}],
  "groups":[{"ids":["GHSA-y"],"max_severity":"2.1"}]}
]}]}
JSON

  echo '{"results":[]}' > "$ST_TMP/clean.json"
  echo '{"results":null}' > "$ST_TMP/null-results.json"

  ST_CASE_OUT="$ST_TMP/case-out"

  # assert_case <name> <fixture> <expect-rc> <expect-text> [env-assignment]
  #
  # env-assignment, if given, is eval'd inside the subshell BEFORE run_gate is
  # called, so it scopes to that one case and never leaks to the next —
  # simpler and more portable than exporting/unsetting around each call.
  assert_case() {
    _name="$1"; _fixture="$2"; _want_rc="$3"; _want_text="$4"; _env="${5:-}"
    _rc=0
    if [ -n "$_env" ]; then
      ( eval "$_env"; run_gate "$_fixture" ) >"$ST_CASE_OUT" 2>&1 || _rc=$?
    else
      ( run_gate "$_fixture" ) >"$ST_CASE_OUT" 2>&1 || _rc=$?
    fi
    if [ "$_rc" -ne "$_want_rc" ]; then
      echo "SELF-TEST FAILED: $_name — expected exit $_want_rc, got $_rc. Output:" >&2
      sed 's/^/    /' "$ST_CASE_OUT" >&2
      exit 1
    fi
    if ! grep -qF "$_want_text" "$ST_CASE_OUT"; then
      echo "SELF-TEST FAILED: $_name — exit $_rc matched but the gate's own verdict line ('$_want_text') is missing. A matching exit code alone cannot tell a real rejection from a crash. Output:" >&2
      sed 's/^/    /' "$ST_CASE_OUT" >&2
      exit 1
    fi
    echo "Case OK: $_name (exit $_rc)."
  }

  assert_case "HIGH advisory blocks at the default threshold" \
    "$ST_TMP/high.json" 1 "block the pipeline"

  assert_case "clean scan passes" \
    "$ST_TMP/clean.json" 0 "no advisories — clean"

  assert_case "results: null (no lockfiles found) is clean, not unresolved" \
    "$ST_TMP/null-results.json" 0 "no advisories — clean"

  assert_case "missing results file fails safe" \
    "$ST_TMP/does-not-exist.json" 1 "missing or empty — treating as scan failure"

  assert_case "LOW-only advisory warns non-blocking at the default threshold" \
    "$ST_TMP/low.json" 2 "non-blocking"

  assert_case "ALLOW_UNRESOLVED=1 downgrades a failed scan to a non-blocking warning" \
    "$ST_TMP/does-not-exist.json" 2 "ALLOW_UNRESOLVED=1 is set" \
    "ALLOW_UNRESOLVED=1"

  assert_case "raising the threshold to CRITICAL demotes a HIGH advisory to a warning" \
    "$ST_TMP/high.json" 2 "non-blocking" \
    "OSV_SEVERITY_THRESHOLD=CRITICAL"

  assert_case "lowering the threshold to LOW promotes a LOW advisory to blocking" \
    "$ST_TMP/low.json" 1 "block the pipeline" \
    "OSV_SEVERITY_THRESHOLD=LOW"

  assert_case "an unrecognized threshold is a configuration error, not a scan verdict" \
    "$ST_TMP/clean.json" 3 "must be one of LOW, MEDIUM, HIGH, CRITICAL" \
    "OSV_SEVERITY_THRESHOLD=BOGUS"

  echo "=== osv-severity-gate.sh --self-test: PASSED ==="
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

RESULTS="${1:-}"
if [ -z "$RESULTS" ]; then
  echo "osv-severity-gate: usage: sh scripts/osv-severity-gate.sh <osv-results.json>" >&2
  echo "                          sh scripts/osv-severity-gate.sh --self-test" >&2
  # exit 3 (not 2): a usage error must hard-block. Exit 2 is reserved for the
  # non-blocking warning states.
  exit 3
fi

run_gate "$RESULTS"
exit $?
