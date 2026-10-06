#!/usr/bin/env python3
"""Cognitive-complexity gate for Python script entry points (issue #41).

Ported in spirit — not in mechanism — from TruePPM's use of SonarCloud rule
S3776 (`refactor(scripts): reduce cognitive complexity in dev/CI script
entry points`, upstream #3980). That port ran against an actual SonarCloud
project (a paid, hosted service reached over the network, configured with an
org/token). Blueprint ships no SonarCloud integration at all, and adding one
just to get this one metric would introduce exactly the kind of "gate whose
oracle is outside the repository" that `scripts/CLAUDE.md` warns cannot live
in `pre-push` and should not be added lightly. So this is a **local,
offline, stdlib-only approximation of the same metric** — SonarSource's
Cognitive Complexity, whose scoring rules are public — scoped to Python
script entry points, the domain `scripts/CLAUDE.md` already governs.

## What "entry point" means here

A module-level (`ast.Module.body`-level) function or async function
definition — `def foo(): ...` at column 0, not nested inside another
function, a class, or a lambda. That is deliberately narrower than "every
function in the file": a script's small, already-extracted helpers are not
the target, and scoring them too would make the exact refactor this gate
exists to encourage (extract a branchy block into a named helper) look like
it accomplished nothing, since the helper's own score would just get flagged
next. Scoring only the orchestrating function is what makes extraction the
correct response to a finding.

## Scoring (a documented approximation, not SonarQube's own scanner)

Three increments, applied while walking ONLY the function's own body (never
descending into a nested `def`/`async def`/`lambda` — see "What this gate
does not cover" below):

  1. A nesting-eligible control structure — `if`/`elif`, `for`, `while`,
     `except`, a ternary (`x if y else z`), a `match`/`case` — adds
     `1 + current_nesting_depth`, then nests one level deeper for its own
     body. A plain trailing `else` (not `elif`) adds a flat `1` at the
     enclosing `if`'s depth, matching Sonar's treatment of an `if`/`elif`
     chain as one structure rather than one nesting level per link.
  2. A run of the same boolean operator (`and`/`or`) within one expression
     adds a flat `1` per run, regardless of nesting depth; switching
     operator mid-expression (`a and b or c`) starts a new run and adds
     again.
  3. Direct recursion — the function calling itself by name anywhere in its
     body — adds a flat `1`, once, no matter how many call sites.

This is intentionally a subset of the full S3776 specification (it does not
score `goto`-equivalents, which Python has none of, or lambda bodies
in-line). It is close enough to be useful and is not claimed to be exact —
see the acceptance criteria in issue #41: "a cognitive-complexity number is a
proxy". Do not read a passing score as SonarCloud's own verdict; SonarCloud
was never run.

## Suppressing a finding

Verified false positives — legitimately branchy dispatch code a reviewer has
looked at and decided reads fine as-is — are suppressed with a trailing
comment on the `def` line, following the same shape as `# sigpipe-ok:
<reason>` in `scripts/check-sigpipe-readers.sh` (`scripts/CLAUDE.md`,
"Prefer a marker that means one thing"):

    def dispatch_command(argv):  # cognitive-complexity-ok: table-driven CLI dispatch, reviewed #41
        ...

The marker is opt-in (nothing is suppressed by default), unambiguous (one
literal string, not inferred from a nearby comment or issue reference), and
REQUIRES a reason after the colon. A bare `# cognitive-complexity-ok` with no
reason text is not a valid suppression — it still counts as an offender, with
a message telling the author to add the reason. This mirrors
`scripts/check-sigpipe-readers.sh`'s own marker and exists for the same
reason stated in `scripts/CLAUDE.md`: "most such references are explanatory
history", so an unreasoned marker is at least as likely to be a copy-pasted
habit as a reviewed decision, and a gate that accepts either is a gate whose
suppressions nobody can audit later.

## What this gate does not cover (scripts/CLAUDE.md: "say what the gate did
## not cover")

  - Only files matching `--pattern` (default `scripts/*.py`) are scanned.
    Shell entry points (the majority of this repo's own gates) are NOT
    scored — cognitive complexity is a well-defined metric over a language
    with a real AST; Python ships one in the standard library, POSIX/bash
    control flow does not, and a hand-rolled bash parser would be exactly
    the kind of gate `scripts/CLAUDE.md` warns against (approximate
    discovery that silently narrows). If this project's scripts are
    predominantly shell, this gate covers a minority of its entry points.
  - Only module-level function definitions are scored — not class methods,
    not nested functions, not lambdas, not the module's own top-level
    (non-function) code. A branchy module-level `if __name__ == "__main__":`
    block is not scored either.
  - A nested `def`/`async def`/`lambda` inside a scored function is not
    walked at all — its own complexity, if any, is invisible here. If a
    script hides its real branching inside a closure to dodge this gate,
    this gate will not see it.
  - This is an approximation of SonarSource's Cognitive Complexity (rule
    S3776), not that rule's own reference implementation. No SonarCloud or
    SonarQube analysis is run, and a score from this script is not
    comparable to one from an actual Sonar scan.

Usage
-----
    python3 scripts/check-cognitive-complexity.py [--self-test]
    python3 scripts/check-cognitive-complexity.py --list
    python3 scripts/check-cognitive-complexity.py --threshold 15
    python3 scripts/check-cognitive-complexity.py --pattern 'tools/*.py'

Exit codes
----------
    0  every scored entry point is at or under the threshold (or suppressed)
    1  at least one entry point exceeds the threshold without a valid,
       reasoned suppression
    2  a scanned file could not be parsed (a real syntax error, not a
       complexity finding)
"""

from __future__ import annotations

import argparse
import ast
import glob
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Derived, not copied — measured against this repo's own scripts/*.py
# module-level functions on 2026-09-22 with `--list`. The tree splits
# cleanly in two: ordinary orchestration functions top out at 14 (the
# highest, `classify` in adr-accepted-issue-sweep.py, was itself refactored
# down from 28 in the same change that added this gate — see #41's MR), and
# two functions sit apart from that cluster at 18 and 20 — both reviewed and
# found to be linear, one-branch-per-case dispatch/resolvers rather than
# genuinely tangled control flow, and suppressed with a reasoned marker
# rather than forced into an artificial extraction.
#
# 15 sits just above the ordinary cluster's ceiling (14) and below both
# reviewed exceptions (18, 20): it catches anything that grows past what
# this repo's own entry points look like today without relitigating the two
# findings already reviewed. It flags nothing UNSUPPRESSED as of this
# writing — run `--list` after cloning to re-derive this number for your own
# tree rather than keeping this comment's; a different codebase's
# orchestration functions will cluster differently.
DEFAULT_THRESHOLD = 15

DEFAULT_PATTERNS = ["scripts/*.py"]

# Opt-in, unambiguous, reason required — see the module docstring's
# "Suppressing a finding" section and scripts/CLAUDE.md's "Prefer a marker
# that means one thing".
_SUPPRESS_RE = re.compile(r"#\s*cognitive-complexity-ok\s*:\s*(\S.*)\s*$")
_SUPPRESS_BARE_RE = re.compile(r"#\s*cognitive-complexity-ok\b")


@dataclass
class Finding:
    path: str
    lineno: int
    name: str
    score: int
    suppressed: bool = False
    suppress_reason: str | None = None
    bare_marker: bool = False


class _ComplexityVisitor(ast.NodeVisitor):
    """Scores a single module-level function's body.

    See the module docstring's "Scoring" section for the three increments
    this implements. Never descends into a nested def/async def/lambda —
    `generic_visit` is never reached for those node types because they are
    overridden as no-ops below.
    """

    def __init__(self, func_name: str) -> None:
        self.func_name = func_name
        self.score = 0
        self.nesting = 0
        self.calls_self = False

    # -- nesting-eligible structures --------------------------------------

    def visit_If(self, node: ast.If) -> None:
        self.score += 1 + self.nesting
        self.nesting += 1
        for stmt in node.body:
            self.visit(stmt)
        self.nesting -= 1

        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            # `elif` — ast nests it as a single If in orelse. Sonar treats
            # this as a continuation of the SAME if/elif chain, not one
            # nesting level deeper, so visit it at the current depth.
            self.visit(node.orelse[0])
        elif node.orelse:
            # A plain trailing `else` (not elif): flat +1, no deeper nesting.
            self.score += 1
            for stmt in node.orelse:
                self.visit(stmt)

    def visit_For(self, node: ast.For) -> None:
        self._visit_loop(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self._visit_loop(node)

    def visit_While(self, node: ast.While) -> None:
        self._visit_loop(node)

    def _visit_loop(self, node: ast.For | ast.AsyncFor | ast.While) -> None:
        self.score += 1 + self.nesting
        self.nesting += 1
        for stmt in node.body:
            self.visit(stmt)
        self.nesting -= 1
        for stmt in node.orelse:
            self.visit(stmt)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        self.score += 1 + self.nesting
        self.nesting += 1
        for stmt in node.body:
            self.visit(stmt)
        self.nesting -= 1

    def visit_IfExp(self, node: ast.IfExp) -> None:  # ternary
        self.score += 1 + self.nesting
        self.nesting += 1
        self.visit(node.test)
        self.visit(node.body)
        self.visit(node.orelse)
        self.nesting -= 1

    def visit_Match(self, node: ast.Match) -> None:  # py3.10+
        self.visit(node.subject)
        self.nesting += 1
        for i, case in enumerate(node.cases):
            # The match itself is not a decision point; each case is.
            self.score += 1 + (self.nesting - 1)
            for stmt in case.body:
                self.visit(stmt)
        self.nesting -= 1

    # -- boolean operator runs (flat, not nesting-scaled) -----------------

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        self._score_boolop(node, None)

    def _score_boolop(self, node: ast.BoolOp, parent_op: type | None) -> None:
        if parent_op is not type(node.op):
            self.score += 1
        for value in node.values:
            if isinstance(value, ast.BoolOp):
                self._score_boolop(value, type(node.op))
            else:
                self.visit(value)

    # -- recursion (flat, once) -------------------------------------------

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id == self.func_name:
            self.calls_self = True
        self.generic_visit(node)

    # -- never descend into a nested scope ---------------------------------

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: D102
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: D102
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:  # noqa: D102
        return

    def finalize(self) -> int:
        return self.score + (1 if self.calls_self else 0)


def score_function(func: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    visitor = _ComplexityVisitor(func.name)
    for stmt in func.body:
        visitor.visit(stmt)
    return visitor.finalize()


def _suppression(line: str) -> tuple[bool, str | None, bool]:
    """Returns (suppressed, reason, bare_marker_present)."""
    m = _SUPPRESS_RE.search(line)
    if m:
        return True, m.group(1).strip(), True
    if _SUPPRESS_BARE_RE.search(line):
        return False, None, True
    return False, None, False


def scan_file(path: Path, root: Path) -> list[Finding]:
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        raise SyntaxError(f"{path}: {exc}") from exc

    try:
        rel = str(path.relative_to(root))
    except ValueError:
        rel = str(path)
    findings: list[Finding] = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        score = score_function(node)
        def_line = lines[node.lineno - 1] if 0 < node.lineno <= len(lines) else ""
        suppressed, reason, bare = _suppression(def_line)
        findings.append(
            Finding(
                path=rel,
                lineno=node.lineno,
                name=node.name,
                score=score,
                suppressed=suppressed,
                suppress_reason=reason,
                bare_marker=bare and not suppressed,
            )
        )
    return findings


def discover_files(patterns: list[str], root: Path) -> list[Path]:
    seen: dict[str, Path] = {}
    for pattern in patterns:
        for match in glob.glob(str(root / pattern)):
            p = Path(match)
            if p.suffix == ".py" and p.is_file():
                seen[str(p)] = p
    return sorted(seen.values())


def _no_files_message(patterns: list[str], root: Path) -> str:
    return (
        f"OK: no files matched {patterns!r} under {root} — nothing to score. "
        "(Coverage note: this gate only ever looks at Python entry points; "
        "see the module docstring's 'What this gate does not cover'.)"
    )


def _list_tag(finding: Finding) -> str:
    if finding.suppressed:
        return f"  [suppressed: {finding.suppress_reason}]"
    if finding.bare_marker:
        return "  [bare suppression marker, no reason — NOT honored]"
    return ""


def _print_list_report(findings: list[Finding], files: list[Path], threshold: int) -> None:
    for finding in sorted(findings, key=lambda f: (-f.score, f.path, f.lineno)):
        print(f"{finding.score:3d}  {finding.path}:{finding.lineno}  {finding.name}{_list_tag(finding)}")
    print(f"\n{len(files)} file(s) scanned, {len(findings)} module-level function(s) scored. Threshold: {threshold}.")


def _print_scan_header(files: list[Path], patterns: list[str], findings: list[Finding], threshold: int) -> None:
    print(
        f"check-cognitive-complexity: scanned {len(files)} file(s) matching "
        f"{patterns!r}, scored {len(findings)} module-level function(s), "
        f"threshold {threshold}."
    )
    print(
        "Coverage note: only module-level functions in files matching the "
        "pattern above are scored — not shell scripts, not class methods, not "
        "nested defs/lambdas. See the module docstring for the full list."
    )


def _print_offenders(offenders: list[Finding]) -> None:
    print("\ncheck-cognitive-complexity: FAIL — entry point(s) over threshold:\n")
    for finding in sorted(offenders, key=lambda f: (-f.score, f.path)):
        reason = " (bare suppression marker present but missing a reason — add one)" if finding.bare_marker else ""
        print(f"  {finding.path}:{finding.lineno}  {finding.name}  score={finding.score}{reason}")
    print(
        "\nEither extract the branchy sub-block into a named helper, or — if this is "
        "a verified false positive (e.g. table-driven dispatch) — suppress it with a "
        "reasoned marker on the def line:\n"
        "  def foo():  # cognitive-complexity-ok: <why this reading is fine>\n"
    )


def _collect_findings(files: list[Path], root: Path) -> list[Finding] | int:
    """Returns the findings, or an int exit code if a file failed to parse."""
    all_findings: list[Finding] = []
    for f in files:
        try:
            all_findings.extend(scan_file(f, root))
        except SyntaxError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
    return all_findings


def run(patterns: list[str], threshold: int, root: Path, list_mode: bool) -> int:
    files = discover_files(patterns, root)
    if not files:
        print(_no_files_message(patterns, root))
        return 0

    findings = _collect_findings(files, root)
    if isinstance(findings, int):
        return findings

    if list_mode:
        _print_list_report(findings, files, threshold)
        return 0

    _print_scan_header(files, patterns, findings, threshold)
    offenders = [f for f in findings if f.score > threshold and not f.suppressed]
    if offenders:
        _print_offenders(offenders)
        return 1

    print(f"OK: all {len(findings)} scored entry point(s) at or under {threshold}.")
    return 0


# ─── Self-test ────────────────────────────────────────────────────────────


def _write(tmp: Path, name: str, body: str) -> Path:
    p = tmp / name
    p.write_text(body, encoding="utf-8")
    return p


def self_test() -> int:
    import tempfile

    rc = 0

    def _case(label: str, ok: bool) -> None:
        nonlocal rc
        if ok:
            print(f"SELF-TEST OK: {label}")
        else:
            print(f"SELF-TEST FAILED: {label}", file=sys.stderr)
            rc = 1

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        # 1. A synthesized violating fixture: a table-driven-looking but
        #    deeply nested dispatcher, well over any sane threshold, with NO
        #    suppression. The real gate, run against it, must exit EXACTLY 1
        #    (scripts/CLAUDE.md rule: "assert exit exactly 1, not merely
        #    non-zero").
        violator = _write(
            tmp,
            "violator.py",
            "def dispatch(a, b, c, d, e):\n"
            "    if a:\n"
            "        if b:\n"
            "            if c:\n"
            "                if d:\n"
            "                    if e:\n"
            "                        return 1\n"
            "                    elif e == 2:\n"
            "                        return 2\n"
            "                    else:\n"
            "                        return 3\n"
            "                elif d == 2:\n"
            "                    for x in range(a):\n"
            "                        while x and b or c and not d:\n"
            "                            try:\n"
            "                                x -= 1\n"
            "                            except ValueError:\n"
            "                                pass\n"
            "                            except TypeError:\n"
            "                                pass\n"
            "    return 0\n",
        )
        rc_real = run([violator.name], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case(
            "a synthesized violating fixture is rejected with exit exactly 1",
            rc_real == 1,
        )

        # 2. A clean fixture — a flat, simple function — must pass.
        clean = _write(
            tmp,
            "clean.py",
            "def add(a, b):\n"
            "    return a + b\n",
        )
        rc_clean = run([clean.name], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case("a clean fixture passes with exit 0", rc_clean == 0)

        # 3. A reasoned suppression on an otherwise-violating function must
        #    be honored.
        suppressed = _write(
            tmp,
            "suppressed.py",
            "def dispatch(a, b, c, d, e):  # cognitive-complexity-ok: reviewed table dispatch, #41\n"
            "    if a:\n"
            "        if b:\n"
            "            if c:\n"
            "                if d:\n"
            "                    if e:\n"
            "                        return 1\n"
            "                    elif e == 2:\n"
            "                        return 2\n"
            "                    else:\n"
            "                        return 3\n"
            "                elif d == 2:\n"
            "                    for x in range(a):\n"
            "                        while x and b or c and not d:\n"
            "                            try:\n"
            "                                x -= 1\n"
            "                            except ValueError:\n"
            "                                pass\n"
            "                            except TypeError:\n"
            "                                pass\n"
            "    return 0\n",
        )
        rc_suppressed = run([suppressed.name], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case("a reasoned suppression marker is honored", rc_suppressed == 0)

        # 4. A BARE suppression marker (no reason after the colon) must NOT
        #    be honored — it still counts as an offender, per the issue's own
        #    acceptance criterion.
        bare = _write(
            tmp,
            "bare.py",
            "def dispatch(a, b, c, d, e):  # cognitive-complexity-ok\n"
            "    if a:\n"
            "        if b:\n"
            "            if c:\n"
            "                if d:\n"
            "                    if e:\n"
            "                        return 1\n"
            "                    elif e == 2:\n"
            "                        return 2\n"
            "                    else:\n"
            "                        return 3\n"
            "                elif d == 2:\n"
            "                    for x in range(a):\n"
            "                        while x and b or c and not d:\n"
            "                            try:\n"
            "                                x -= 1\n"
            "                            except ValueError:\n"
            "                                pass\n"
            "                            except TypeError:\n"
            "                                pass\n"
            "    return 0\n",
        )
        rc_bare = run([bare.name], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case("a bare suppression marker with no reason is STILL an offender", rc_bare == 1)

        # 5. elif does not double-count as a deeper nesting level than a
        #    plain if/else at the same position would — a chain of N elifs
        #    scores linearly, not exponentially. (Regression guard on the
        #    scoring model itself, not the gate's pass/fail contract.)
        chain = _write(
            tmp,
            "chain.py",
            "def classify(x):\n"
            "    if x == 1:\n"
            "        return 'a'\n"
            "    elif x == 2:\n"
            "        return 'b'\n"
            "    elif x == 3:\n"
            "        return 'c'\n"
            "    elif x == 4:\n"
            "        return 'd'\n"
            "    else:\n"
            "        return 'e'\n",
        )
        tree = ast.parse(chain.read_text())
        func = tree.body[0]
        assert isinstance(func, ast.FunctionDef)
        chain_score = score_function(func)
        # if(1) + elif(1) + elif(1) + elif(1) + else(1) = 5, not 1+2+3+4+5=15.
        _case(f"a 4-way elif/else chain scores linearly (got {chain_score}, want 5)", chain_score == 5)

        # 6. Nested defs/lambdas are not descended into — a function whose
        #    ONLY complexity lives inside a closure scores 0.
        closure = _write(
            tmp,
            "closure.py",
            "def outer():\n"
            "    def inner(x):\n"
            "        if x:\n"
            "            if x > 1:\n"
            "                return 1\n"
            "        return 0\n"
            "    return inner\n",
        )
        tree2 = ast.parse(closure.read_text())
        outer_func = tree2.body[0]
        assert isinstance(outer_func, ast.FunctionDef)
        outer_score = score_function(outer_func)
        _case(f"a nested def's complexity is invisible to its outer scope (got {outer_score}, want 0)", outer_score == 0)

        # 7. Recursion adds exactly 1, regardless of call-site count.
        recursive = _write(
            tmp,
            "recursive.py",
            "def fact(n):\n"
            "    if n <= 1:\n"
            "        return 1\n"
            "    return n * fact(n - 1) + fact(n - 2)\n",
        )
        tree3 = ast.parse(recursive.read_text())
        rec_func = tree3.body[0]
        assert isinstance(rec_func, ast.FunctionDef)
        rec_score = score_function(rec_func)
        # if(0) = 1, recursion flat = 1 -> total 2, regardless of 2 call sites.
        _case(f"recursion adds exactly 1 regardless of call-site count (got {rec_score}, want 2)", rec_score == 2)

        # 8. --list mode (the discovery half) reports EVERY function, even
        #    ones under threshold, and never fails the process on its own —
        #    scripts/CLAUDE.md: "give the discovery half its own offline
        #    mode and test that a tree carrying a violation is seen at all".
        rc_list = run([violator.name, "clean.py"], DEFAULT_THRESHOLD, tmp, list_mode=True)
        _case("--list mode always exits 0 (it reports, it does not judge)", rc_list == 0)

        # 9. A syntax error is a real parse failure (exit 2), never conflated
        #    with a complexity finding (exit 1) — scripts/CLAUDE.md: "a self-
        #    test must tell a crash from a rejection".
        broken = _write(tmp, "broken.py", "def f(:\n    pass\n")
        rc_broken = run([broken.name], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case(f"a syntax error exits 2, not 1 (got {rc_broken})", rc_broken == 2)

        # 10. No files matched is a clean pass, not a failure — a clone that
        #     never wrote scripts/*.py must not be broken by opting in.
        rc_empty = run(["no-such-*.py"], DEFAULT_THRESHOLD, tmp, list_mode=False)
        _case(f"no matching files is a clean pass (got {rc_empty})", rc_empty == 0)

    if rc == 0:
        print("check-cognitive-complexity: self-test passed.")
    return rc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--self-test", action="store_true", help="run the built-in self-test and exit")
    parser.add_argument("--list", action="store_true", help="report every scored entry point (discovery mode; never fails)")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD, help=f"max score before an entry point is flagged (default: {DEFAULT_THRESHOLD})")
    parser.add_argument("--pattern", action="append", default=None, help="glob (repeatable) relative to the repo root; default: scripts/*.py")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    patterns = args.pattern or DEFAULT_PATTERNS
    return run(patterns, args.threshold, REPO_ROOT, list_mode=args.list)


if __name__ == "__main__":
    sys.exit(main())
