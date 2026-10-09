#!/usr/bin/env python3
"""Find open issues whose scope may predate the ADR they name.

Run this when an ADR moves to **Accepted**. It is the mechanical half of the
"When an ADR moves to Accepted" checklist in `.claude/skills/adr/SKILL.md`.

An issue that says *"implements ADR-NNNN"* is almost always written **before**
the ADR is accepted — that is its job, to argue for it. The ADR then gets
negotiated and options are **rejected**, and the issue is never re-read. The
delta between the issue that proposed it and the ADR that settled it is exactly
the set of rejected options: the most expensive thing to accidentally implement.

Nothing else in the pipeline reads an issue body against an ADR.

This is deliberately **not** a CI gate. It cannot distinguish a genuine
divergence from an issue that legitimately implements one section of an ADR, and
an advisory gate that fires on every pipeline gets muted. Exit status is always
0: this reports, a human decides.

Usage:
    python3 scripts/adr-accepted-issue-sweep.py                 # whole corpus
    python3 scripts/adr-accepted-issue-sweep.py --adr 42        # one ADR
    python3 scripts/adr-accepted-issue-sweep.py --since 2026-06-29
    python3 scripts/adr-accepted-issue-sweep.py --show-unrankable
    python3 scripts/adr-accepted-issue-sweep.py --self-test

The repository (`owner/repo`) is read from $GITHUB_REPOSITORY (set by GitHub
Actions), else from the `origin` remote; it is never hardcoded. Issues are read
through `gh api`, so `gh auth login` (or GH_TOKEN) must be in place. With no
GitHub repository to ask, the sweep says so instead of reporting zero issues.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from glob import glob

ADR_REF = re.compile(r"ADR-(\d{3,4})")
# Two ADR template shapes: a `## Status` section (heading style) and a
# `**Status:** …` field line (Nygard style, which this repo's template uses).
STATUS_SECTION = re.compile(r"^##\s*Status\s*$(.*?)(?=(?:^##\s)|\Z)", re.M | re.S)
STATUS_FIELD = re.compile(r"^\*\*Status:\*\*\s*(.+)$", re.M)
ACCEPTED = re.compile(r"\bAccepted\b|\bRatified\b", re.I)
DATE = re.compile(r"(20\d\d-\d\d-\d\d)")

# A Status date is NOT always an acceptance date. A bulk audit that rewrites
# statuses to read "Accepted — implemented; status corrected <date> after audit"
# stamps ADRs that were accepted, and usually implemented, long before the date
# they now carry. Ranking issues against a correction date produces a false
# positive every time: upstream it inflated 2 real candidates to 40. This is the
# single thing any future automation of this check must not get wrong.
CORRECTION = re.compile(r"correct|audit|reconcil|back-?fill|restat", re.I)


def repo_slug() -> str:
    """`owner/repo` from $GITHUB_REPOSITORY, else a GitHub origin remote; "" if neither."""
    p = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if p:
        return p
    url = subprocess.run(
        ["git", "remote", "get-url", "origin"], capture_output=True, text=True
    ).stdout.strip()
    if "github" not in url:
        return ""
    m = re.search(r"[:/]([^:/]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else ""


def adr_index(root: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for path in glob(os.path.join(root, "docs/adr/*.md")):
        m = re.match(r"(\d{4})-", os.path.basename(path))
        if m:
            out[int(m.group(1))] = path
    return out


def adr_status(path: str) -> tuple[str, str | None, bool, str]:
    """Return (state, date, date_is_correction, headline)."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    m = STATUS_SECTION.search(text)
    if m:
        # Skip blockquote errata: an `Implementation status` blockquote carries
        # its own, later date and is not the acceptance date.
        stripped = (line.strip() for line in m.group(1).split("\n"))
        lines = [line for line in stripped if line and not line.startswith(">")]
        head = " ".join(lines[:2])[:240]
    else:
        f = STATUS_FIELD.search(text)
        if not f:
            return ("UNPARSED", None, False, "")
        head = f.group(1).strip()[:240]

    if not ACCEPTED.search(head):
        return ("not-accepted", None, False, head)
    d = DATE.search(head)
    return ("Accepted", d.group(1) if d else None, bool(CORRECTION.search(head)), head)


def only_issues(batch: list) -> list[dict]:
    """Drop pull requests: GitHub's issues endpoint returns PRs too, marked by a
    `pull_request` key. A PR body that says "implements ADR-NNNN" is the branch
    doing the work, not an issue whose scope predates the ADR."""
    return [i for i in batch if isinstance(i, dict) and "pull_request" not in i]


def open_issues(repo: str) -> list[dict]:
    issues: list[dict] = []
    # Explicit pages rather than `gh api --paginate`: older gh versions emit one
    # JSON array per page, concatenated, which json.loads rejects — and a sweep
    # that silently read page one only would under-report with no signal.
    for page in range(1, 30):
        try:
            r = subprocess.run(
                ["gh", "api", f"repos/{repo}/issues?state=open&per_page=100&page={page}"],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            print("adr-accepted-issue-sweep: gh is not installed; no issues read.", file=sys.stderr)
            break
        if r.returncode != 0:
            print(f"adr-accepted-issue-sweep: could not read issues of {repo} (page {page}); "
                  "the counts below cover only what was read. Check 'gh auth status'.",
                  file=sys.stderr)
            break
        try:
            batch = json.loads(r.stdout)
        except json.JSONDecodeError:
            break
        if not batch:
            break
        issues += only_issues(batch)
    return issues


def _classify_reference(
    issue: dict, path: str, n: int, since: str | None
) -> tuple[str, tuple] | None:
    """One (issue, ADR-reference) pair's disposition, or None if out of scope.

    Returns ("risk" | "suppressed" | "unrankable", row), or None when the
    reference does not apply — the ADR is not Accepted, or it is Accepted but
    filtered out (accepted before ``--since``, or the issue was created on or
    after acceptance, so it cannot predate the ADR). Split out of
    :func:`classify` so the per-reference decision reads as one thing readers
    can verify in isolation, mirroring the extraction TruePPM's own version of
    this script made for the same reason (upstream #3980).
    """
    state, date, is_corr, _head = adr_status(path)
    if state != "Accepted":
        return None
    created = issue["created_at"][:10]
    row = (
        issue["number"],
        created,
        n,
        date,
        (issue.get("milestone") or {}).get("title"),
        (issue.get("title") or "")[:62],
    )
    if date is None:
        return ("unrankable", row)
    if since and date < since:
        return None
    if created >= date:
        return None
    return ("suppressed" if is_corr else "risk", row)


def classify(issues: list[dict], adrs: dict[int, str], only: int | None, since: str | None):
    risk, suppressed, unrankable = [], [], []
    buckets = {"risk": risk, "suppressed": suppressed, "unrankable": unrankable}
    for issue in issues:
        blob = (issue.get("title") or "") + " " + (issue.get("body") or "")
        for n in sorted({int(x) for x in ADR_REF.findall(blob)}):
            if only and n != only:
                continue
            path = adrs.get(n)
            if not path:
                continue
            result = _classify_reference(issue, path, n, since)
            if result is not None:
                bucket, row = result
                buckets[bucket].append(row)
    return risk, suppressed, unrankable


def self_test() -> int:
    rc = 0
    tmp = tempfile.mkdtemp()
    adr_dir = os.path.join(tmp, "docs", "adr")
    os.makedirs(adr_dir)

    def write(name: str, body: str) -> None:
        with open(os.path.join(adr_dir, name), "w", encoding="utf-8") as fh:
            fh.write(body)

    def check(label: str, got, want) -> None:
        nonlocal rc
        if got == want:
            print(f"SELF-TEST OK: {label}")
        else:
            print(f"SELF-TEST FAILED: {label} — got {got!r}, want {want!r}", file=sys.stderr)
            rc = 1

    write("0001-field-style.md", "# 1. T\n\n**Date:** 2026-01-01\n**Status:** Accepted (2026-05-05)\n")
    check("field-style Status parsed", adr_status(os.path.join(adr_dir, "0001-field-style.md"))[:2],
          ("Accepted", "2026-05-05"))

    write("0002-section-style.md", "# 2. T\n\n## Status\n\nAccepted (2026-05-05)\n\n## Context\n")
    check("section-style Status parsed", adr_status(os.path.join(adr_dir, "0002-section-style.md"))[:2],
          ("Accepted", "2026-05-05"))

    write("0003-blockquote.md",
          "# 3. T\n\n## Status\n\n> **Implementation status (2026-09-01):** not built.\n\nAccepted (2026-05-05)\n\n## Context\n")
    check("blockquote erratum does not become the status",
          adr_status(os.path.join(adr_dir, "0003-blockquote.md"))[:2], ("Accepted", "2026-05-05"))

    write("0004-proposed.md", "# 4. T\n\n**Status:** Proposed\n")
    check("Proposed is not Accepted", adr_status(os.path.join(adr_dir, "0004-proposed.md"))[0],
          "not-accepted")

    write("0005-corrected.md",
          "# 5. T\n\n**Status:** Accepted — implemented; status corrected 2026-08-02 after ADR audit\n")
    check("bulk-audit correction date is flagged",
          adr_status(os.path.join(adr_dir, "0005-corrected.md"))[2], True)

    write("0006-undated.md", "# 6. T\n\n**Status:** Accepted\n")
    check("Accepted with no date is unrankable",
          adr_status(os.path.join(adr_dir, "0006-undated.md"))[1], None)

    adrs = adr_index(tmp)
    # GitHub REST issue shape: `number`, `body`; the issues endpoint also returns
    # pull requests (carrying a `pull_request` key), which must be dropped.
    raw = [
        {"number": 10, "created_at": "2026-04-01T00:00:00Z", "title": "implements ADR-0001", "body": "", "milestone": None},
        {"number": 11, "created_at": "2026-06-01T00:00:00Z", "title": "implements ADR-0001", "body": None, "milestone": None},
        {"number": 12, "created_at": "2026-04-01T00:00:00Z", "title": "t", "body": "implements ADR-0005", "milestone": {"title": "0.1"}},
        {"number": 13, "created_at": "2026-04-01T00:00:00Z", "title": "implements ADR-0006", "body": "", "milestone": None},
        {"number": 14, "created_at": "2026-04-01T00:00:00Z", "title": "implements ADR-0001", "body": "",
         "milestone": None, "pull_request": {"url": "https://api.github.com/x"}},
    ]
    issues = only_issues(raw)
    check("pull requests from the issues endpoint are dropped", [i["number"] for i in issues], [10, 11, 12, 13])
    risk, suppressed, unrankable = classify(issues, adrs, None, None)
    check("issue written before acceptance is flagged", [r[0] for r in risk], [10])
    check("issue written after acceptance is not flagged", 11 in [r[0] for r in risk], False)
    check("correction-dated ADR is suppressed, not flagged", [r[0] for r in suppressed], [12])
    check("undated Accepted ADR is unrankable", [r[0] for r in unrankable], [13])

    if rc == 0:
        print("adr-accepted-issue-sweep: self-test passed.")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adr", type=int, help="only this ADR number")
    ap.add_argument("--since", default=None, help="only ADRs accepted on/after YYYY-MM-DD")
    ap.add_argument("--show-unrankable", action="store_true",
                    help="also list references to Accepted ADRs carrying no date")
    ap.add_argument("--self-test", action="store_true", help="run the offline self-test and exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip() or "."
    adrs = adr_index(root)
    repo = repo_slug()
    if not repo:
        print("adr-accepted-issue-sweep: no GitHub repository to read issues from "
              "(no $GITHUB_REPOSITORY and no GitHub origin remote) — nothing swept.")
        return 0
    issues = open_issues(repo)

    risk, suppressed, unrankable = classify(issues, adrs, args.adr, args.since)

    print(f"open issues scanned                                                : {len(issues)}")
    print(f"suppressed (Status date is a bulk-audit CORRECTION, not acceptance) : {len(suppressed)}")
    print(f"unrankable (Accepted ADR carries no date)                           : {len(unrankable)}")
    print()
    print(f"REVIEW — open issue written BEFORE its ADR was accepted: {len(risk)}")
    for iid, created, n, date, ms, title in sorted(risk, key=lambda r: -r[0]):
        print(f"   #{iid:<6} created {created} | ADR-{n:04d} accepted {date} | ms={ms or '-':<5} | {title}")
    if not risk:
        print("   (none — a zero here is a real outcome, record it)")

    if args.show_unrankable:
        print()
        print(f"--- unrankable: Accepted ADR with no date in its Status ({len(unrankable)}) ---")
        for iid, created, n, _d, ms, title in sorted(unrankable, key=lambda r: -r[0]):
            print(f"   #{iid:<6} created {created} | ADR-{n:04d} | ms={ms or '-':<5} | {title}")

    print()
    print("Each row is a QUESTION, not a defect. Re-read the issue against the ADR's")
    print("rejected options; if it diverges, rewrite the TITLE as well as the body and")
    print("lead with a dated correction note. Check the branch first — upstream, the")
    print("branch was right and the issue carried the rejected scope.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
