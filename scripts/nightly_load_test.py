#!/usr/bin/env python3
"""Nightly load test — measures p50/p95/p99 latency for a configurable list of
read endpoints and fails if any exceeds its committed p95 budget.

Ported and genericized from Visiban's ``scripts/nightly_load_test.py`` (#1082)
for issue #40. Blueprint ships no application, so this version replaces the
upstream script's hard-coded, framework-specific endpoint list (a "board" with
seeded cards) with a **targets file**: a small JSON document naming which URLs
to hit and what each one's p95 budget is. See ``nightly-load-test-budgets.json``
at the repo root for the shipped default and its rationale.

## Why this exists

A static N+1 review and an on-demand query-count check both measure query
*count*, which is correlated with but not equivalent to latency — a regression
from a missing index or a data-volume change can leave the query count and
query text identical while making the same queries slower. This script
measures wall-clock latency directly, against whatever fixture the CI job's
own boot script seeds, so that class of regression has somewhere to show up
before a user notices it.

## The budget is the point

"The load test states an explicit p95 budget and fails when it is exceeded" is
issue #40's own acceptance criterion, because a load test with no threshold is
a number nobody acts on. Every target's ``budget_p95_ms`` is read from the
targets file (falling back to that file's ``default_budget_p95_ms``, then to
``--default-budget-ms``); a target with no budget resolved from any of the
three is measured and reported but never fails the run — see ``--measure-only``
below for deriving a real one.

## Deriving/re-deriving budgets

    python scripts/nightly_load_test.py --measure-only \\
        --base-url http://localhost:8000 \\
        --targets-file nightly-load-test-budgets.json \\
        --output nightly-load-test-results.json
    # Then hand-set each target's "budget_p95_ms" to roughly 1.3-1.5x the
    # "p95_ms" this run measured, rounded UP to the nearest 5ms — never a bare
    # round number invented without a measurement behind it. See
    # nightly-load-test-budgets.json's own "budget_formula" field.

Usage (CI — python-nightly-load-test job in ci/python.yml):
    python scripts/nightly_load_test.py \\
        --base-url http://localhost:8000 \\
        --token-file /tmp/load-test-token \\
        --targets-file nightly-load-test-budgets.json \\
        --output nightly-load-test-results.json

Exit codes
----------
    0  every target with a resolved budget stayed within it (or --measure-only)
    1  at least one target exceeded its budget, or a fatal error occurred
"""

import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests

# Only GET is supported. Targets are hit `iterations` times in a row with no
# cleanup between requests — safe for an idempotent read, not for a write that
# would need its own fixture and teardown. A future write-path load test is a
# deliberately separate, harder problem (see nightly-load-test-budgets.json's
# _readme), not an oversight here.
_SUPPORTED_METHOD = "GET"


def _wait_for_url(url, timeout=60):
    """Poll *url* until it returns a non-5xx status or *timeout* seconds elapse.

    Optional — the CI job's own boot script (``LOAD_TEST_API_BOOT_SCRIPT``) is
    the primary readiness contract and is expected to block until the API can
    serve, but a cheap extra poll here is a defense-in-depth safety net when
    ``--health-url`` is given, not a substitute for that contract.
    """
    deadline = time.monotonic() + timeout
    attempt = 0
    while time.monotonic() < deadline:
        try:
            r = requests.get(url, timeout=5)
            if r.status_code < 500:
                return
        except requests.exceptions.RequestException:
            pass
        attempt += 1
        print(f"  Waiting for {url} … ({attempt})", flush=True)
        time.sleep(2)
    raise RuntimeError(f"Service at {url} did not become ready within {timeout}s")


def _percentile(samples_ms, pct):
    """Nearest-rank percentile — no interpolation, so the reported number is
    always a value that was actually observed, never a synthetic average of two."""
    ordered = sorted(samples_ms)
    idx = max(0, min(len(ordered) - 1, round(pct / 100 * len(ordered)) - 1))
    return ordered[idx]


def _check_budget(p95_ms, budget_ms):
    """Return True if p95_ms is within budget_ms, False otherwise.

    Isolated from run() so --self-test can exercise the exact detection logic
    the nightly job's pass/fail verdict depends on, without needing a live
    server — same house rule as every other gate in scripts/CLAUDE.md: prove
    the detection logic can fail, in this same job, before trusting a green.
    """
    return p95_ms <= budget_ms


def _resolve_budget_ms(target, file_default_ms, cli_default_ms):
    """Resolve a target's budget with a defined precedence, so a clone can set
    a budget per-endpoint, once for the whole file, or leave both unset.

    Precedence: the target's own ``budget_p95_ms`` wins if present, then the
    targets file's ``default_budget_p95_ms``, then ``--default-budget-ms``.
    Returns None (no enforcement — the target is measured but cannot fail the
    run) only when none of the three is set.
    """
    if target.get("budget_p95_ms") is not None:
        return target["budget_p95_ms"]
    if file_default_ms is not None:
        return file_default_ms
    return cli_default_ms


def _self_test():
    """Build known-bad and known-good latency samples and prove the detection
    logic (percentile calculation, budget comparison, budget resolution
    precedence) still fires correctly.

    Touches no network, no database, no files — pure function checks.
    """
    failures = []

    # --- _percentile: nearest-rank, deterministic on a known distribution ---
    samples = list(range(1, 101))  # 1..100 ms, one sample per integer
    p50 = _percentile(samples, 50)
    p95 = _percentile(samples, 95)
    p99 = _percentile(samples, 99)
    if p50 != 50:
        failures.append(f"_percentile(1..100, 50) = {p50}, expected 50")
    if p95 != 95:
        failures.append(f"_percentile(1..100, 95) = {p95}, expected 95")
    if p99 != 99:
        failures.append(f"_percentile(1..100, 99) = {p99}, expected 99")

    # --- KNOWN-BAD: p95 clearly over budget must be flagged as a violation ---
    # 40 samples, top 5 (indices 35-39 once sorted) are 2000ms — nearest-rank
    # p95 (idx = round(0.95*40)-1 = 37) lands inside that top block.
    bad_p95 = _percentile([500] * 35 + [2000] * 5, 95)  # p95 lands on 2000
    if _check_budget(bad_p95, 1000):
        failures.append(
            f"KNOWN-BAD case not flagged: p95={bad_p95}ms passed a 1000ms budget"
        )

    # --- KNOWN-GOOD: p95 clearly under budget must NOT be flagged ---
    good_p95 = _percentile([50] * 40, 95)
    if not _check_budget(good_p95, 1000):
        failures.append(
            f"KNOWN-GOOD case incorrectly flagged: p95={good_p95}ms failed a 1000ms budget"
        )

    # --- Boundary: p95 exactly at budget must pass (<=, not <) ---
    if not _check_budget(1000, 1000):
        failures.append("boundary case failed: p95 == budget must be within budget (<=)")

    # --- Budget resolution precedence: target > file default > CLI default ---
    if _resolve_budget_ms({"budget_p95_ms": 42}, 999, 888) != 42:
        failures.append("target-level budget_p95_ms did not take precedence")
    if _resolve_budget_ms({}, 999, 888) != 999:
        failures.append("file-level default_budget_p95_ms did not apply when target had none")
    if _resolve_budget_ms({}, None, 888) != 888:
        failures.append("--default-budget-ms did not apply when file had no default either")
    if _resolve_budget_ms({}, None, None) is not None:
        failures.append("resolution must return None (no enforcement) when nothing is configured")

    if failures:
        print("SELF-TEST FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(
        "SELF-TEST OK: percentile calculation, budget comparison, and budget "
        "resolution precedence all fire correctly."
    )
    return 0


def _load_targets(path):
    """Load the targets file (see nightly-load-test-budgets.json's own
    ``_readme`` for the full shape). Only the ``targets`` list and
    ``default_budget_p95_ms`` are read functionally; every other key
    (``_readme``, ``status``, ``status_note``, ``budget_formula``, ``fixture``)
    is documentation the file carries for humans re-deriving a budget, and is
    ignored here on purpose.
    """
    with open(path, encoding="utf-8") as fh:
        config = json.load(fh)
    targets = config.get("targets", [])
    for t in targets:
        method = t.get("method", _SUPPORTED_METHOD).upper()
        if method != _SUPPORTED_METHOD:
            raise ValueError(
                f"target '{t.get('name', '?')}' declares method {method!r} — only "
                f"{_SUPPORTED_METHOD} is supported (a write needs its own fixture "
                "and cleanup, out of scope for this generic load test)"
            )
        if "path" not in t or "name" not in t:
            raise ValueError(f"every target needs 'name' and 'path': {t!r}")
    return targets, config.get("default_budget_p95_ms")


def _time_requests(session, url, iterations, warmup):
    """GET *url* `warmup` times (discarded) then `iterations` times, timed.

    Returns a list of elapsed times in milliseconds. Raises on any non-2xx
    response — a failed request has no meaningful latency and must not be
    silently averaged in with the successful ones.
    """
    for _ in range(warmup):
        r = session.get(url, timeout=30)
        r.raise_for_status()

    samples_ms = []
    for _ in range(iterations):
        start = time.perf_counter()
        r = session.get(url, timeout=30)
        elapsed_ms = (time.perf_counter() - start) * 1000
        r.raise_for_status()
        samples_ms.append(elapsed_ms)
    return samples_ms


def run(args):
    session = requests.Session()
    if args.token_file:
        with open(args.token_file, encoding="utf-8") as fh:
            token = fh.read().strip()
        header_value = f"{args.auth_scheme} {token}".strip() if args.auth_scheme else token
        session.headers[args.auth_header] = header_value

    base_url = args.base_url.rstrip("/") + "/"

    if args.health_url:
        _wait_for_url(args.health_url, timeout=args.startup_timeout)

    targets, file_default_budget_ms = _load_targets(args.targets_file)
    if not targets:
        print(
            f"No targets configured in {args.targets_file} — nothing to measure. "
            "See that file's \"_readme\" for how to add one."
        )
        return 0

    results = {}
    violations = []
    for target in targets:
        name = target["name"]
        url = urljoin(base_url, target["path"].lstrip("/"))
        print(f"Measuring {name} ({args.iterations} requests, {args.warmup} warmup)...")
        samples_ms = _time_requests(session, url, args.iterations, args.warmup)
        p50 = _percentile(samples_ms, 50)
        p95 = _percentile(samples_ms, 95)
        p99 = _percentile(samples_ms, 99)
        entry = {
            "url": url,
            "n": len(samples_ms),
            "p50_ms": round(p50, 1),
            "p95_ms": round(p95, 1),
            "p99_ms": round(p99, 1),
            "mean_ms": round(statistics.mean(samples_ms), 1),
            "max_ms": round(max(samples_ms), 1),
        }
        if not args.measure_only:
            budget_ms = _resolve_budget_ms(target, file_default_budget_ms, args.default_budget_ms)
            if budget_ms is not None:
                within_budget = _check_budget(p95, budget_ms)
                entry["budget_p95_ms"] = budget_ms
                entry["within_budget"] = within_budget
                if not within_budget:
                    violations.append(f"{name}: p95={p95:.1f}ms exceeds budget {budget_ms}ms")
        results[name] = entry
        budget_suffix = (
            f" (budget {entry['budget_p95_ms']}ms)" if "budget_p95_ms" in entry else " (no budget)"
        )
        print(f"  p50={entry['p50_ms']}ms p95={entry['p95_ms']}ms p99={entry['p99_ms']}ms" + budget_suffix)

    output = {
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "base_url": base_url,
        "iterations": args.iterations,
        "warmup": args.warmup,
        "results": results,
    }
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            json.dump(output, fh, indent=2)
        print(f"Wrote results to {args.output}")

    if args.measure_only:
        print(
            "\n--measure-only: not evaluating budgets. Use these p95 numbers "
            "(x1.3-1.5, rounded up to the nearest 5ms) to (re-)derive "
            f"{args.targets_file}'s per-target budget_p95_ms values."
        )
        return 0

    if violations:
        print("\nFAIL — budget exceeded:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        return 1

    print("\nAll endpoints within budget.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token-file", default=None, help="Path to a raw auth token. Omit for an unauthenticated target set.")
    parser.add_argument("--auth-header", default="Authorization", help="Header name to carry the token (default: Authorization).")
    parser.add_argument(
        "--auth-scheme",
        default="Bearer",
        help="Scheme prefix before the token, e.g. 'Bearer' or 'Token' (default: Bearer). "
             "Pass an empty string to send the raw token as the header value with no scheme.",
    )
    parser.add_argument("--targets-file", default="nightly-load-test-budgets.json", help="JSON file naming targets and their p95 budgets.")
    parser.add_argument("--default-budget-ms", type=float, default=None, help="Fallback p95 budget (ms) for a target with none of its own and no file-level default.")
    parser.add_argument("--output", default="nightly-load-test-results.json")
    parser.add_argument("--iterations", type=int, default=40, help="Timed requests per target (default: 40).")
    parser.add_argument("--warmup", type=int, default=5, help="Untimed requests per target before measuring (default: 5).")
    parser.add_argument("--health-url", default=None, help="Optional URL to poll before measuring; the CI boot script is the primary readiness contract.")
    parser.add_argument("--startup-timeout", type=int, default=60)
    parser.add_argument(
        "--measure-only",
        action="store_true",
        help="Print/record p50/p95/p99 without evaluating any budget. "
             "Used to (re-)derive the committed targets file, never in the gating nightly job.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Prove the percentile/budget-comparison/budget-resolution detection logic still "
             "fires on known-bad and known-good input, then exit. Touches no network or files.",
    )
    args = parser.parse_args()

    if args.self_test:
        sys.exit(_self_test())

    try:
        sys.exit(run(args))
    except (RuntimeError, ValueError, requests.exceptions.RequestException, OSError) as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
