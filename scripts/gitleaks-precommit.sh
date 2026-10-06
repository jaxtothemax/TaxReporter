#!/usr/bin/env bash
# scripts/gitleaks-precommit.sh — block a staged secret before it enters a commit.
#
# ## Why a hook, not just CI
#
# The GitLab secret-detection component and the gitleaks-scan job (both in
# .gitlab-ci.yml) only fire once a branch has already been pushed — by which
# point rotation, not prevention, is the only remedy. A pre-commit hook is the
# only placement in this pipeline that can stop a secret before it ever
# leaves a contributor's machine.
#
# ## Why it degrades instead of failing when gitleaks is missing
#
# gitleaks is "optional but recommended" locally (see scripts/doctor.sh). A
# contributor without it installed must still be able to commit — the
# merge-blocking gitleaks-scan CI job is the hard gate regardless of what
# runs on any given machine. When gitleaks IS installed, this enforces it
# against staged changes only (`--staged`), so the hook stays fast.
#
# ## Suppressing a false positive
#
# Config is auto-discovered from .gitleaks.toml at the repo root — the same
# file both this hook and the CI job read, so a false positive is fixed once,
# not twice. Add a path or regex entry under [allowlist] with a comment
# explaining why the match is safe. Give the comment a SUPPRESSED-UNTIL(#N)
# marker (see scripts/check-stale-references.sh) when the exemption is
# temporary and should not outlive a tracked cleanup issue — that gate scans
# the whole tree for the marker, .gitleaks.toml included, and fails once #N
# closes. A permanent, reasoned exclusion (a checksum column, a doc example)
# needs no marker; explain it in prose and leave it unmarked.
#
# ## Wiring
#
# Installed by scripts/setup-hooks.sh (`make setup`) into hooks/pre-commit,
# which runs `make gitleaks-check` → this script, on every commit. Skip a
# single commit with `git commit --no-verify`.
#
# Usage: scripts/gitleaks-precommit.sh
#        scripts/gitleaks-precommit.sh --self-test
set -euo pipefail

run_scan() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "gitleaks-precommit: gitleaks not installed — skipping local secret scan (CI still enforces it)."
    echo "  Install: brew install gitleaks  (or https://github.com/gitleaks/gitleaks/releases)"
    return 0
  fi
  gitleaks git --staged --redact --no-banner
}

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md, a gate must be able to fail. This builds a throwaway
# git repo, stages a synthetic secret that is obviously fake but still
# matches gitleaks' default ruleset shape (an AWS access key ID — never a
# real credential), and asserts run_scan rejects it with gitleaks' own exit
# code and its own "leaks found" verdict line — not merely a non-zero exit,
# which a broken invocation could produce just as easily. It also proves a
# clean staged change is accepted, and that gitleaks missing from PATH
# degrades to a non-blocking pass rather than silently doing nothing while
# LOOKING like a pass for the wrong reason.
self_test() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "gitleaks-precommit --self-test: gitleaks not installed — cannot prove the detection path" >&2
    echo "  (same dependency the real hook needs). Install it to self-test: brew install gitleaks" >&2
    exit 1
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  out="$tmp/case-out"

  (
    cd "$tmp" && git init -q \
      && git config user.email self-test@example.invalid \
      && git config user.name self-test
  )

  echo "=== gitleaks-precommit.sh --self-test ==="

  # Case 1: a synthetic secret shaped like a real AWS access key ID is staged
  # and must be rejected with gitleaks' own exit code (1) and verdict line.
  printf 'AWS_ACCESS_KEY_ID = "AKIAABCDEFGHIJKLMNOP"\n' > "$tmp/leaky.env"
  (cd "$tmp" && git add leaky.env)
  rc=0
  (cd "$tmp" && run_scan) >"$out" 2>&1 || rc=$?
  if [ "$rc" -ne 1 ]; then
    echo "SELF-TEST FAILED: a staged AWS-key-shaped secret was not rejected (expected exit 1, got $rc). Output:" >&2
    sed 's/^/    /' "$out" >&2
    exit 1
  fi
  if ! grep -qi "leaks found" "$out"; then
    echo "SELF-TEST FAILED: exit 1 matched but gitleaks' own 'leaks found' verdict line is missing — a coincidental exit 1 cannot tell a real rejection from a crash. Output:" >&2
    sed 's/^/    /' "$out" >&2
    exit 1
  fi
  echo "Case 1 OK: a staged secret is rejected (exit 1, leak reported)."

  # Case 2: unstage it and stage something unremarkable instead — must pass.
  (cd "$tmp" && git rm --cached -q leaky.env && rm leaky.env)
  printf 'hello world\n' > "$tmp/clean.txt"
  (cd "$tmp" && git add clean.txt)
  rc=0
  (cd "$tmp" && run_scan) >"$out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "SELF-TEST FAILED: a clean staged change was rejected (expected exit 0, got $rc). Output:" >&2
    sed 's/^/    /' "$out" >&2
    exit 1
  fi
  echo "Case 2 OK: a clean staged change is accepted (exit 0)."

  # Case 3: gitleaks missing from PATH must degrade to a non-blocking pass —
  # the merge-blocking CI job is the hard gate, not this hook — and must say
  # so, not silently exit 0 for an unrelated reason.
  mkdir -p "$tmp/empty-bin"
  rc=0
  (cd "$tmp" && PATH="$tmp/empty-bin" run_scan) >"$out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "SELF-TEST FAILED: gitleaks missing from PATH should degrade to a pass (expected exit 0, got $rc). Output:" >&2
    sed 's/^/    /' "$out" >&2
    exit 1
  fi
  if ! grep -qF "gitleaks not installed" "$out"; then
    echo "SELF-TEST FAILED: exit 0 matched but the 'gitleaks not installed' skip message is missing. Output:" >&2
    sed 's/^/    /' "$out" >&2
    exit 1
  fi
  echo "Case 3 OK: gitleaks missing from PATH degrades to a non-blocking pass (exit 0, skip reported)."

  echo "=== gitleaks-precommit.sh --self-test: PASSED ==="
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

run_scan
exit $?
