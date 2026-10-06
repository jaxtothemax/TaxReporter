#!/usr/bin/env bash
# scripts/check-gate-selftest-parity.sh — every CI gate proves it can still fail,
# IN ITS OWN JOB, or carries a recorded reason why it cannot.
#
# ## Why this exists
#
# `scripts/CLAUDE.md` already says a gate must be able to fail. Nothing
# asserted that every gate actually carried the proof, and a gate's failure mode
# is a *green pipeline* — so the count of gates in that state was written down
# nowhere.
#
# Upstream, a gate enforcing a licensing boundary the project called "sacred"
# passed a real violation, exit 0, for its entire life: the CI image's BusyBox
# grep rejected `--exclude-dir`, the script's `|| true` swallowed the option
# error, and empty read as "no violations".
#
# The part worth encoding is not that bug. It is that the blind gates **already
# had passing test suites**. The suites ran in a different job, on a different
# image, against a shell that behaved differently. They were evidence about that
# image and nothing else.
#
# So the requirement is SAME JOB, not same repo — because same job is the only
# way to say "same image" in a CI config, and the image is what differed.
#
# ## What this cannot do
#
# An opt-out is a rubber stamp, and a `--self-test` that asserts only the happy
# path passes this check while proving nothing. This removes the silence, not the
# possibility of a wrong answer.
#
# ## Usage
#
#   bash scripts/check-gate-selftest-parity.sh [--self-test]
#
# ## Exit codes
#
#   0  every CI gate self-tests in its own job, or is opted out with a reason
#   1  at least one is neither
#   2  no CI configuration found

set -euo pipefail

# ─── Opt-outs ────────────────────────────────────────────────────────────────
#
# ONE kind qualifies: EXTERNAL — the gate's input is not the repository, so no
# fixture can represent a violation (its oracle is an issue tracker, a package
# registry, a deployed environment).
#
# There is no second category, and in particular there is no "verified by hand
# once". Upstream tried that: twelve gates were parked in a PENDING bucket after
# a manual audit, and when each was later neutered on purpose, every one still
# passed on the real tree — because a compliant tree never executes the detection
# path at all. A snapshot nothing repeats is the standing this file refuses.
#
# Format: one "basename<TAB>reason" per line.
OPT_OUT="
"

# Reads OPT_OUT from a here-string, NOT a pipe. The `return` below fires on the
# FIRST match, so a piped writer still holding the rest takes SIGPIPE; `set -o
# pipefail` promotes that to 141 and `set -e` aborts before anything is printed —
# a red gate with an empty log and nothing pointing at the cause. The race is
# payload-sized, so a short list always fits in the pipe buffer and the broken
# form passes every other case in this file. See the self-test's padded case.
opt_out_reason() {
    while IFS=$'\t' read -r name reason; do
        [ -n "$name" ] || continue
        if [ "$name" = "$1" ]; then printf '%s' "$reason"; return; fi
    done <<< "$OPT_OUT"
}

# ─── Discover the CI files ───────────────────────────────────────────────────

discover_ci_files() {
    local f
    for f in .gitlab-ci.yml .gitlab-ci.yaml; do [ -f "$f" ] && echo "$f"; done
    for f in ci/*.yml ci/*.yaml .github/workflows/*.yml .github/workflows/*.yaml; do
        [ -f "$f" ] && echo "$f"
    done
    return 0
}

# ─── Attribute each gate invocation to the job that runs it ──────────────────
#
# Emits "job<TAB>script-basename<TAB>yes|no", where the third field says whether
# THAT SAME JOB also invokes the script with --self-test.
gate_invocations() {
    awk '
      # A job block starts either at column 0 (GitLab CI) or at two spaces under
      # a top-level `jobs:` key (GitHub Actions).
      /^jobs:[ \t]*$/                                  { in_jobs = 1; job = "jobs"; skip = 0; next }
      /^[A-Za-z_.][A-Za-z0-9_:.-]*:[ \t]*$/            { in_jobs = 0; job = $0; sub(/:[ \t]*$/, "", job); skip = 0; next }
      in_jobs && /^  [A-Za-z_][A-Za-z0-9_.-]*:[ \t]*$/ { job = $0; sub(/^  /, "", job); sub(/:[ \t]*$/, "", job); skip = 0; next }

      # A path under changes:/paths:/files:/exists: NAMES a file that triggers the
      # job; it is not an invocation of it. A workflow-level changes list can name
      # every gate script in the repo, and reading those as invocations attributes
      # them to a job that does not exist.
      /^[ \t]*-?[ \t]*(changes|paths|paths-ignore|files|exists):[ \t]*$/ { skip = 1; next }
      /^[ \t]*-?[ \t]*[A-Za-z_][A-Za-z0-9_-]*:/                          { skip = 0 }
      skip { next }

      # A path named in a comment is prose, not an invocation.
      /^[ \t]*#/ { next }

      {
        line = $0
        sub(/[ \t]#.*$/, "", line)
        while (match(line, /scripts\/[A-Za-z0-9_.\/-]+\.(sh|py|mjs)/)) {
          s    = substr(line, RSTART, RLENGTH)
          rest = substr(line, RSTART + RLENGTH)
          n = split(s, parts, "/"); base = parts[n]
          # scripts/tests/*.test.sh are test files, not gates.
          if (base ~ /\.test\.(sh|py|mjs)$/)                          { line = rest; continue }
          if (base !~ /^check[-_]/ && base !~ /-check\.(sh|py|mjs)$/)  { line = rest; continue }
          if (rest ~ /^[ \t]*--self-test/) selftest[job SUBSEP base] = 1
          else                             invoked[job SUBSEP base]  = 1
          line = rest
        }
      }
      END {
        for (k in invoked) {
          split(k, a, SUBSEP)
          print a[1] "\t" a[2] "\t" ((k in selftest) ? "yes" : "no")
        }
      }
    ' "$@" | sort
}

# ─── Scan ────────────────────────────────────────────────────────────────────

run_scan() {
    local proven=0 opted=0 missing=0 job script has reason
    while IFS=$'\t' read -r job script has; do
        [ -n "$script" ] || continue
        if [ "$has" = "yes" ]; then proven=$((proven + 1)); continue; fi
        reason="$(opt_out_reason "$script")"
        if [ -n "$reason" ]; then opted=$((opted + 1)); continue; fi
        missing=$((missing + 1))
        echo "check-gate-selftest-parity: FAIL  job '$job' runs scripts/$script but never runs it with --self-test"
    done <<< "$(gate_invocations "$@")"

    echo "check-gate-selftest-parity: ${proven} self-tested in-job, ${opted} opted out, ${missing} unproven."

    if [ "$missing" -gt 0 ]; then
        cat <<'MSG'

A gate that cannot be shown to fail is indistinguishable from one that works.
Fix by either:

  * adding a --self-test to the script and invoking it in the SAME job, before
    the real scan (the default — the job's own image is the only environment
    that counts); or
  * adding the script to OPT_OUT in this file WITH the reason a fixture cannot
    represent a violation.

Run the self-test FIRST in the job. A gate's failure mode is a green pipeline,
so "the gate passed" is not evidence that it can still fail.
MSG
        return 1
    fi
    return 0
}

# ─── Self-test ───────────────────────────────────────────────────────────────

self_test() {
    local tmp rc=0; tmp="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" EXIT

    _case() { # <name> <expect-pass|expect-fail> <ci-fixture>
        if run_scan "$3" >/dev/null 2>&1; then
            if [ "$2" = "expect-pass" ]; then echo "SELF-TEST OK: $1 accepted."
            else echo "SELF-TEST FAILED: $1 was accepted and must not be." >&2; rc=1; fi
        else
            if [ "$2" = "expect-fail" ]; then echo "SELF-TEST OK: $1 correctly rejected."
            else echo "SELF-TEST FAILED: $1 was rejected and must not be." >&2; rc=1; fi
        fi
    }

    printf 'lint:zz:\n  script:\n    - bash scripts/check-zz-probe.sh --self-test\n    - bash scripts/check-zz-probe.sh\n' > "$tmp/ok.yml"
    _case "gate self-tested in its own job" expect-pass "$tmp/ok.yml"

    printf 'lint:zz:\n  script:\n    - bash scripts/check-zz-probe.sh\n' > "$tmp/bare.yml"
    _case "gate with no self-test anywhere" expect-fail "$tmp/bare.yml"

    # The shape this gate exists for: the proof is real, but it lives in another
    # job — therefore in another image, which is what differed upstream.
    printf 'other:job:\n  script:\n    - bash scripts/check-zz-probe.sh --self-test\nlint:zz:\n  script:\n    - bash scripts/check-zz-probe.sh\n' > "$tmp/elsewhere.yml"
    _case "self-test in a DIFFERENT job" expect-fail "$tmp/elsewhere.yml"

    # GitHub Actions job blocks are two spaces under `jobs:`, not at column 0.
    printf 'name: ci\njobs:\n  lint:\n    steps:\n      - run: bash scripts/check-zz-probe.sh\n' > "$tmp/gha-bare.yml"
    _case "GitHub Actions job with no self-test" expect-fail "$tmp/gha-bare.yml"

    printf 'name: ci\njobs:\n  lint:\n    steps:\n      - run: bash scripts/check-zz-probe.sh --self-test\n      - run: bash scripts/check-zz-probe.sh\n' > "$tmp/gha-ok.yml"
    _case "GitHub Actions job self-tested in-job" expect-pass "$tmp/gha-ok.yml"

    # A non-gate script in CI must not be demanded to self-test.
    printf 'lint:zz:\n  script:\n    - bash scripts/assemble-changelog.sh\n' > "$tmp/nongate.yml"
    _case "non-gate script ignored" expect-pass "$tmp/nongate.yml"

    printf 'scripts:test:\n  script:\n    - bash scripts/tests/check-zz-probe.test.sh\n' > "$tmp/testfile.yml"
    _case "scripts/tests/*.test.sh ignored" expect-pass "$tmp/testfile.yml"

    printf 'pages:\n  script:\n    # enforced by scripts/check-zz-probe.sh, see above\n    - echo deploy\n' > "$tmp/comment.yml"
    _case "gate named only in a comment" expect-pass "$tmp/comment.yml"

    printf 'workflow:\n  rules:\n    - changes:\n        - scripts/check-zz-probe.sh\n' > "$tmp/changes.yml"
    _case "gate named in a changes: list" expect-pass "$tmp/changes.yml"

    # An OPT_OUT entry excuses a gate that cannot be given a fixture.
    if ( OPT_OUT=$'\ncheck-zz-probe.sh\tEXTERNAL: oracle is the issue tracker\n'; run_scan "$tmp/bare.yml" >/dev/null 2>&1 ); then
        echo "SELF-TEST OK: opted-out gate accepted."
    else
        echo "SELF-TEST FAILED: opted-out gate was rejected and must not be." >&2; rc=1
    fi

    # opt_out_reason must read OPT_OUT from a here-string, not a pipe. Its `return`
    # fires on the first match, leaving a piped writer blocked on a full buffer; it
    # takes SIGPIPE, pipefail promotes 141, set -e aborts with NO output. The race
    # is payload-sized, so every case above passes on the broken form. This one
    # plants a list past the pipe buffer to make the failure deterministic, and
    # asserts under `set -e` inside a command substitution — exactly how run_scan
    # calls it.
    local padded padded_out padded_rc=0
    padded="$(awk 'BEGIN{for(i=0;i<4000;i++) printf "filler-%05d.sh\tEXTERNAL: padding\n", i}')"
    padded_out="$( OPT_OUT=$'check-zz-probe.sh\tEXTERNAL: first entry\n'"$padded" ; opt_out_reason check-zz-probe.sh )" || padded_rc=$?
    if [ "$padded_rc" -eq 0 ] && [ "$padded_out" = "EXTERNAL: first entry" ]; then
        echo "SELF-TEST OK: OPT_OUT larger than the pipe buffer still resolves."
    else
        echo "SELF-TEST FAILED: OPT_OUT lookup returned rc=$padded_rc out='$padded_out' (expected 0 / 'EXTERNAL: first entry'). Is it reading from a pipe?" >&2
        rc=1
    fi

    [ "$rc" -eq 0 ] && echo "check-gate-selftest-parity: self-test passed."
    return "$rc"
}

# ─── Main ────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--self-test" ]; then
    self_test
    exit $?
fi

# Portable to bash 3.2 (macOS ships it); `mapfile` is bash 4+.
CI_FILES=()
while IFS= read -r _f; do
    [ -n "$_f" ] && CI_FILES+=("$_f")
done <<< "$(discover_ci_files)"

if [ "${#CI_FILES[@]}" -eq 0 ]; then
    echo "ERROR: no CI configuration found (.gitlab-ci.yml, ci/*.yml, .github/workflows/*)." >&2
    exit 2
fi

run_scan "${CI_FILES[@]}"
