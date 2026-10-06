#!/usr/bin/env python3
"""scripts/check-ws-event-reachability.py — a published real-time event taxonomy
cannot advertise an event no client can subscribe to.

## Why this exists

A real-time (WebSocket / SSE / socket.io) event taxonomy doc is read by
integrators as a subscribable surface: an event listed there is one you can
connect a client to and receive. It is easy for that to go quietly false —
a backend team ships a broadcast call site fanning out on some new grouping
key before the routing layer grows the matching route/consumer that lets a
client join that group. The event is real (the code emits it), it is
documented (someone wrote it up), and it is completely unreachable — an
integrator who builds against it gets a connection close/refusal and no
amount of debugging on their side fixes it, because the bug is not in their
client.

This was built independently, in different languages, by two prior projects
this gate is ported from (a Python version and a bash version) — the
strongest possible signal that the check belongs in a stack-agnostic
template rather than being re-invented a third time.

## The generic model

Rather than assume a specific framework's routing shape (Django Channels'
`routing.py`, socket.io namespaces, an AsyncAPI document), this gate is
built from three configurable, regex-driven inputs:

  1. A **broadcast call pattern** — scanned across every file under
     `--source-dir`. Its first captured group is the "channel-key
     expression" (whatever value the call fans out on), its second captured
     group is the literal event name string.
  2. An **unreachable-class pattern** — tested against the channel-key
     expression text. A broadcast call whose channel-key expression matches
     this pattern belongs to the "restricted" class of events this run is
     checking (e.g. "this call fans out on a program id, not a project id").
  3. A **route-exists pattern** — tested against `--routing-file`'s content.
     If it matches, the restricted class IS currently reachable (a route or
     consumer exists that can add a client to that channel).

Only events whose channel-key expression matches the unreachable-class
pattern are ever required to carry the "not deliverable" marker in the doc —
every other documented event is left alone. This keeps the gate honest about
what it can and cannot see: it does not attempt to model full routing
semantics, only "does this one restricted class of event have a route".

A project wiring this up for real supplies its own two patterns (see
`--unreachable-class-pattern` / `--route-exists-pattern`); the built-in
defaults are inert placeholders that match nothing, so an unconfigured clone
never fires a false positive — the gate degrades to "no restricted class
declared, nothing to check" rather than doing something surprising with
made-up semantics.

## What it checks, both directions

  1. Every event whose broadcast call site's channel-key expression matches
     the unreachable-class pattern, wherever it appears in a taxonomy block
     (a `- ` bullet, with its indented continuation lines, or a `| ... |`
     table row) in `--doc-file`, must carry the literal marker (default:
     "not deliverable") on that block — for as long as the route-exists
     pattern does not match the routing file.
  2. Once the routing file grows the route that makes that class reachable,
     the same markers become the inverted lie and must come off. The check
     fails in exactly the same way a stale "Ships in 0.X" doc callout would.

It deliberately does NOT infer reachability from the event's *name* — only
from the call site's channel-key expression — so an event that starts
fanning out on a restricted channel under any name is still caught.

## Skip vs. fail

If `--source-dir` or `--doc-file` does not exist at all, this is a clone
with no real-time stack (or no published taxonomy) wired up — the gate
prints an INFO line and exits 0, the same "skip cleanly" shape
`scripts/check-docs-internal-links.py` uses for "no docs site". If both
exist but the scan finds zero broadcast call sites, that is a *setup* error
(the pattern does not match this project's helper, or the helper was
renamed) and the gate must not read that as "0 violations" — see
`scripts/CLAUDE.md`, "stage a backlog by rule severity" and its warning
against a scanner that silently matches nothing.

## Usage

    python3 scripts/check-ws-event-reachability.py \\
        --source-dir backend --routing-file backend/routing.py \\
        --doc-file docs/websockets.md \\
        --broadcast-pattern 'broadcast_event\\(\\s*([^,]+?)\\s*,\\s*["\\']([\\w]+)["\\']' \\
        --unreachable-class-pattern 'program' \\
        --route-exists-pattern 'ws/v1/programs/'
    python3 scripts/check-ws-event-reachability.py --self-test

## Exit codes

    0  reachable / correctly marked, or no real-time stack configured (skip)
    1  a documented event is undeliverable and unmarked, or marked and now
       deliverable
    2  invocation / setup error, including "the scanner matched nothing"
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_USAGE = 2

DEFAULT_SOURCE_DIR = "backend"
DEFAULT_ROUTING_FILE = "backend/routing.py"
DEFAULT_DOC_FILE = "docs/websockets.md"
DEFAULT_MARKER = "not deliverable"
# A named-group pattern: `key` is the channel expression the call fans out
# on, `event` is the literal event-name string. The default function name is
# a placeholder — point --broadcast-pattern at your own helper.
#
# `key` admits two levels of balanced parentheses, so a group helper taking
# several arguments — `group_name("program", program.id)` — is one key
# expression. A bare `[^,]+?` stopped at that inner comma and never matched
# the call at all: loud (exit 2) when every call site used the helper, but a
# SILENT drop when only the restricted-class ones did. Found by the
# app-fixture-gates suite. The trailing `|[^,]+?` keeps every shape the old
# pattern matched (deeper comma-free nesting), so this only ever adds matches.
DEFAULT_BROADCAST_PATTERN = (
    r"broadcast_event\(\s*(?P<key>(?:[^,()]|\((?:[^()]|\([^()]*\))*\))+?|[^,]+?)\s*,\s*[\"'](?P<event>\w+)[\"']"
)
# Inert by default (matches nothing real) so an unconfigured clone never
# invents a restricted class on its own — see the module docstring.
DEFAULT_UNREACHABLE_CLASS_PATTERN = r"(?!)"
DEFAULT_ROUTE_EXISTS_PATTERN = r"(?!)"


@dataclass
class CallSite:
    key_expr: str
    event: str


def find_call_sites(source_dir: Path, pattern: re.Pattern[str]) -> tuple[list[CallSite], int]:
    sites: list[CallSite] = []
    scanned = 0
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in {".py", ".ts", ".tsx", ".js", ".mjs", ".go", ".rb"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        for m in pattern.finditer(text):
            sites.append(CallSite(key_expr=m.group("key"), event=m.group("event")))
    return sites, scanned


def parse_taxonomy_blocks(doc_lines: list[str]) -> list[tuple[int, str]]:
    """One block per bullet (with its indented continuation lines) or table row.

    Both are "listings" a reader takes as part of the advertised surface;
    prose in a paragraph is not required to repeat the marker.
    """
    blocks: list[tuple[int, str]] = []
    i = 0
    while i < len(doc_lines):
        line = doc_lines[i]
        stripped = line.lstrip()
        if stripped.startswith("- "):
            start = i
            buf = [line]
            i += 1
            while i < len(doc_lines):
                nxt = doc_lines[i]
                if nxt.strip() == "" or nxt.lstrip().startswith("- ") or not nxt.startswith(" "):
                    break
                buf.append(nxt)
                i += 1
            blocks.append((start + 1, "\n".join(buf)))
            continue
        if stripped.startswith("|"):
            blocks.append((i + 1, line))
        i += 1
    return blocks


def blocks_mentioning(blocks: list[tuple[int, str]], event: str) -> list[tuple[int, str]]:
    needle = f"`{event}`"
    return [(n, t) for n, t in blocks if needle in t]


def run_check(
    source_dir: Path,
    routing_file: Path,
    doc_file: Path,
    broadcast_pattern: re.Pattern[str],
    unreachable_class_pattern: re.Pattern[str],
    route_exists_pattern: re.Pattern[str],
    marker: str,
) -> tuple[int, list[str]]:
    if not source_dir.exists() or not doc_file.exists():
        return EXIT_OK, [
            f"INFO: skipping — {'source dir' if not source_dir.exists() else 'doc file'} not found "
            f"({source_dir if not source_dir.exists() else doc_file}). No real-time stack/taxonomy "
            "configured in this clone."
        ]

    call_sites, scanned = find_call_sites(source_dir, broadcast_pattern)
    if scanned == 0:
        return EXIT_USAGE, [
            f"ERROR: found no files to scan under {source_dir}. The gate has nothing to check — "
            "this is a setup error, not a clean tree."
        ]
    if not call_sites:
        return EXIT_USAGE, [
            f"ERROR: scanned {scanned} file(s) under {source_dir} but matched zero broadcast call "
            "sites. Either this project emits no real-time events at all (in which case remove this "
            "gate's job) or --broadcast-pattern no longer matches the helper's call shape. A gate "
            "that silently matches nothing must not report success."
        ]

    restricted_events = {
        cs.event for cs in call_sites if unreachable_class_pattern.search(cs.key_expr)
    }

    routing_text = routing_file.read_text(encoding="utf-8") if routing_file.exists() else ""
    reachable = bool(route_exists_pattern.search(routing_text))

    doc_lines = doc_file.read_text(encoding="utf-8").split("\n")
    blocks = parse_taxonomy_blocks(doc_lines)

    violations: list[str] = []
    for event in sorted(restricted_events):
        hits = blocks_mentioning(blocks, event)
        if not hits:
            continue
        if not reachable:
            for n, text in hits:
                if marker in text.lower():
                    continue
                violations.append(
                    f"{doc_file}:{n} lists `{event}` with no \"{marker}\" marker, but its broadcast "
                    f"call site's channel-key expression matches the restricted class and "
                    f"{routing_file} has no route that can join it yet. An integrator who "
                    f"subscribes gets refused.\n    {text.strip().splitlines()[0]}"
                )
        else:
            for n, text in hits:
                if marker not in text.lower():
                    continue
                violations.append(
                    f"{doc_file}:{n} still marks `{event}` \"{marker}\", but {routing_file} now "
                    "carries a route that can join it — the marker is the inverted claim now. "
                    f"Remove it.\n    {text.strip().splitlines()[0]}"
                )

    if violations:
        return EXIT_VIOLATION, violations

    return EXIT_OK, [
        f"OK: {len(call_sites)} broadcast call site(s) scanned, {len(restricted_events)} "
        f"restricted-class event(s), route exists: {reachable}. Every documented event is "
        "correctly marked."
    ]


# ─── self-test ────────────────────────────────────────────────────────────


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def _fixture(root: Path, doc_body: str, with_route: bool) -> None:
    _write(
        root / "src" / "events.py",
        (
            'broadcast_event(program_id, "program_closed", {"id": program_id})\n'
            'broadcast_event(project_id, "project_updated", {"id": project_id})\n'
        ),
    )
    routing = (
        "ROUTES = [\n"
        "    'ws/v1/projects/<uuid:pk>/',\n"
        + ("    'ws/v1/programs/<uuid:pk>/',\n" if with_route else "")
        + "]\n"
    )
    _write(root / "src" / "routing.py", routing)
    _write(root / "docs" / "websockets.md", doc_body)


def _run(root: Path) -> tuple[int, list[str]]:
    return run_check(
        source_dir=root / "src",
        routing_file=root / "src" / "routing.py",
        doc_file=root / "docs" / "websockets.md",
        broadcast_pattern=re.compile(DEFAULT_BROADCAST_PATTERN),
        unreachable_class_pattern=re.compile("program"),
        route_exists_pattern=re.compile(r"ws/v1/programs/"),
        marker=DEFAULT_MARKER,
    )


def self_test() -> int:
    import tempfile

    failures: list[str] = []

    def case(name: str, doc_body: str, with_route: bool, expect: int) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _fixture(root, doc_body, with_route)
            code, msgs = _run(root)
            if code == expect:
                print(f"SELF-TEST OK: {name} (exit {code}).")
            else:
                print(f"SELF-TEST FAILED: {name} — expected exit {expect}, got {code}:", file=sys.stderr)
                for m in msgs:
                    print(f"    {m}", file=sys.stderr)
                failures.append(name)

    case(
        "unmarked restricted event, no route",
        "- Programs: `program_closed`\n\n| `program_closed` | WS-only |\n",
        with_route=False,
        expect=EXIT_VIOLATION,
    )
    case(
        "marked restricted event, no route",
        "- Programs — not deliverable: `program_closed`\n\n"
        "| `program_closed` | WS-only — not deliverable |\n",
        with_route=False,
        expect=EXIT_OK,
    )
    case(
        "partially marked (bullet unmarked, row marked)",
        "- Programs: `program_closed`\n\n"
        "| `program_closed` | WS-only — not deliverable |\n",
        with_route=False,
        expect=EXIT_VIOLATION,
    )
    case(
        "stale marker after route ships",
        "- Programs — not deliverable: `program_closed`\n\n"
        "| `program_closed` | WS-only — not deliverable |\n",
        with_route=True,
        expect=EXIT_VIOLATION,
    )
    case(
        "unmarked after route ships (correct)",
        "- Programs: `program_closed`\n\n| `program_closed` | WS-only |\n",
        with_route=True,
        expect=EXIT_OK,
    )
    case(
        "unrestricted event never needs a marker",
        "- Membership: `project_updated`\n\n| `project_updated` | WS-only |\n",
        with_route=False,
        expect=EXIT_OK,
    )

    # Skip-cleanly case: no real-time stack in this clone at all.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        code, msgs = run_check(
            source_dir=root / "nonexistent",
            routing_file=root / "nonexistent" / "routing.py",
            doc_file=root / "nonexistent" / "docs.md",
            broadcast_pattern=re.compile(DEFAULT_BROADCAST_PATTERN),
            unreachable_class_pattern=re.compile(DEFAULT_UNREACHABLE_CLASS_PATTERN),
            route_exists_pattern=re.compile(DEFAULT_ROUTE_EXISTS_PATTERN),
            marker=DEFAULT_MARKER,
        )
        if code == EXIT_OK:
            print("SELF-TEST OK: absent source dir + doc file skips cleanly (exit 0).")
        else:
            print(f"SELF-TEST FAILED: absent stack should skip (exit 0), got {code}: {msgs}", file=sys.stderr)
            failures.append("skip-cleanly-when-stack-absent")

    # Crash-vs-rejection guard: a scanner that matches ZERO call sites despite
    # scanning real files must be a setup error (2), not a silent pass.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write(root / "src" / "unrelated.py", "print('no broadcasts here')\n")
        _write(root / "docs" / "websockets.md", "- nothing to see\n")
        code, msgs = run_check(
            source_dir=root / "src",
            routing_file=root / "src" / "routing.py",
            doc_file=root / "docs" / "websockets.md",
            broadcast_pattern=re.compile(DEFAULT_BROADCAST_PATTERN),
            unreachable_class_pattern=re.compile("program"),
            route_exists_pattern=re.compile(r"ws/v1/programs/"),
            marker=DEFAULT_MARKER,
        )
        if code == EXIT_USAGE:
            print("SELF-TEST OK: zero broadcast call sites in real files is a setup error (exit 2).")
        else:
            print(f"SELF-TEST FAILED: expected exit 2 for zero call sites, got {code}: {msgs}", file=sys.stderr)
            failures.append("zero-call-sites-is-usage-error")

    if failures:
        print(f"\nSELF-TEST: {len(failures)} case(s) failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    print(f"\nSELF-TEST: all {6 + 2} cases passed.")
    return 0


# ─── CLI ──────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--routing-file", default=DEFAULT_ROUTING_FILE)
    parser.add_argument("--doc-file", default=DEFAULT_DOC_FILE)
    parser.add_argument("--broadcast-pattern", default=DEFAULT_BROADCAST_PATTERN)
    parser.add_argument("--unreachable-class-pattern", default=DEFAULT_UNREACHABLE_CLASS_PATTERN)
    parser.add_argument("--route-exists-pattern", default=DEFAULT_ROUTE_EXISTS_PATTERN)
    parser.add_argument("--marker", default=DEFAULT_MARKER)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        broadcast_pattern = re.compile(args.broadcast_pattern)
        unreachable_class_pattern = re.compile(args.unreachable_class_pattern)
        route_exists_pattern = re.compile(args.route_exists_pattern)
    except re.error as exc:
        print(f"ERROR: invalid regex — {exc}", file=sys.stderr)
        return EXIT_USAGE

    code, messages = run_check(
        source_dir=Path(args.source_dir),
        routing_file=Path(args.routing_file),
        doc_file=Path(args.doc_file),
        broadcast_pattern=broadcast_pattern,
        unreachable_class_pattern=unreachable_class_pattern,
        route_exists_pattern=route_exists_pattern,
        marker=args.marker,
    )
    prefix = {EXIT_OK: "", EXIT_VIOLATION: "VIOLATION: ", EXIT_USAGE: ""}[code]
    for m in messages:
        print(f"{prefix}{m}" if prefix and not m.startswith(("INFO", "ERROR", "OK")) else m)
    return code


if __name__ == "__main__":
    sys.exit(main())
