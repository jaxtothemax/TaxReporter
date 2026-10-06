#!/usr/bin/env python3
"""Every version-bearing manifest in the tree declares the same version, and
none of them is behind the last released version in the changelog.

Why this exists
---------------
A release script bumps the files someone remembered to list in it. Upstream,
that list covered every manifest except the Helm chart's ``Chart.yaml``, so a
``0.4.0-beta.1`` release published a chart stamped ``0.4.0`` whose
``appVersion`` — which is also the chart's DEFAULT IMAGE TAG — named an image
that had never been built. A stock install hit ``ImagePullBackOff``, every beta
overwrote the previous chart at the same registry tag, and nothing in the
pipeline had an opinion, because the only check on the bump list was the person
writing it.

The fix is not "remember the file next time". It is a gate that fails on an MR
the moment a manifest disagrees with the others, so the drift is found while
someone is still editing, rather than after an artifact is public and
immutable.

Two rules, and the second one exists because the first is vacuous in a
single-manifest repository:

1. **Lockstep.** Every discovered manifest declares the same version string.
2. **Not behind the changelog.** That shared version is not OLDER than the most
   recent released section in ``CHANGELOG.md``. Ahead is fine and deliberate:
   a project may bump its manifests in a prep commit before the tag is cut.
   Behind means a release happened and a manifest did not move with it.

A manifest that DERIVES a default from a version — ``appVersion`` becoming an
image tag is the canonical case — carries a second version, not a copy of the
first. Both have to move, so both are checked.

Usage
-----
    python3 scripts/check-version-lockstep.py [--self-test]

Exit codes
----------
    0  every manifest agrees, or there is nothing to compare yet
    1  a manifest disagrees with the others, or is behind the changelog
    2  invocation error (not a git repository)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ─── Waivers ─────────────────────────────────────────────────────────────────
#
# A manifest that is versioned INDEPENDENTLY on purpose — a vendored chart, a
# package with its own release cadence — belongs here WITH ITS REASON. An
# unexplained entry is how a bump list rots in the first place, one file at a
# time, each with a good reason nobody wrote down.
#
# Keys are repository-relative paths; values are the reason.
WAIVERS: dict[str, str] = {
    "website/package.json": (
        "The docs site is tooling, not a release artifact — it has no version of "
        "its own to keep in lockstep. Pinned at 0.0.0 and private:true, same as "
        "every other internal-only Node package.json in this pattern."
    ),
}

# Filenames worth reading, and how to pull a version out of each. Add a project
# stack's manifest here rather than to a list inside a release script — this is
# the file that gets consulted when a release goes wrong.
VERSION_PATTERNS = {
    "pyproject.toml": [("version", r'^\s*version\s*=\s*["\']([^"\']+)["\']')],
    "Cargo.toml": [("version", r'^\s*version\s*=\s*["\']([^"\']+)["\']')],
    "Chart.yaml": [
        ("version", r"^\s*version\s*:\s*[\"']?([^\"'\s]+)"),
        # appVersion is the chart's default image tag. A stale one publishes a
        # chart that points at an image tag which was never built.
        ("appVersion", r"^\s*appVersion\s*:\s*[\"']?([^\"'\s]+)"),
    ],
    "VERSION": [("version", r"^\s*v?([0-9][^\s]*)\s*$")],
    "version.txt": [("version", r"^\s*v?([0-9][^\s]*)\s*$")],
}

RELEASED_HEADING = re.compile(r"^##\s*\[(?!Unreleased)([^\]]+)\]")


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True,
        text=True,
        check=False,
    )
    if out.returncode != 0:
        print("ERROR: not a git repository.", file=sys.stderr)
        sys.exit(2)
    return out.stdout.splitlines()


def declared_versions(root: Path) -> list[tuple[str, str, str]]:  # cognitive-complexity-ok: linear per-manifest-type dispatch (package.json vs regex-pattern manifests), reviewed #41
    """Return (path, field, version) for every version a manifest declares."""
    found: list[tuple[str, str, str]] = []
    for rel in tracked_files(root):
        name = Path(rel).name
        if rel in WAIVERS:
            continue
        path = root / rel
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        if name == "package.json":
            try:
                version = json.loads(text).get("version")
            except json.JSONDecodeError:
                continue
            if isinstance(version, str) and version:
                found.append((rel, "version", version))
            continue

        for field, pattern in VERSION_PATTERNS.get(name, []):
            match = re.search(pattern, text, re.MULTILINE)
            if match:
                found.append((rel, field, match.group(1)))
    return found


def latest_released(root: Path) -> str | None:
    changelog = root / "CHANGELOG.md"
    if not changelog.is_file():
        return None
    for line in changelog.read_text(encoding="utf-8").splitlines():
        match = RELEASED_HEADING.match(line)
        if match:
            return match.group(1).strip().lstrip("v")
    return None


def sort_key(version: str) -> tuple:
    """Order two semver-ish strings. A pre-release sorts BELOW its own base
    version (1.0.0-rc.1 < 1.0.0), which is the rule that decides whether a
    manifest is behind a release or deliberately ahead of one."""
    base, _, pre = version.partition("-")
    numbers = tuple(int(part) if part.isdigit() else 0 for part in base.split(".")[:3])
    numbers += (0,) * (3 - len(numbers))
    if not pre:
        return (numbers, 1, ())
    parts = tuple(
        (0, int(part)) if part.isdigit() else (1, part) for part in re.split(r"[.+]", pre)
    )
    return (numbers, 0, parts)


def check(root: Path) -> int:
    declared = declared_versions(root)
    released = latest_released(root)

    if not declared:
        print("OK: no version-bearing manifest found yet — nothing to compare.")
        return 0

    distinct = sorted({version for _, _, version in declared})
    if len(distinct) > 1:
        print("VERSION LOCKSTEP GAP\n")
        print("These manifests do not declare the same version:\n")
        for path, field, version in sorted(declared):
            print(f"  {version:<16} {path} ({field})")
        print("\nA release bumps the files its bump list names. A manifest missing")
        print("from that list ships stamped with a version nothing else agrees with —")
        print("and an artifact that derives a default from it (a Helm appVersion")
        print("becoming an image tag) points that default at something never built.")
        print("\nFix one of two ways:")
        print("  1. Add the file to the release script's bump list and bump it now.")
        print("  2. If it really is versioned independently, add it to WAIVERS in")
        print(f"     {Path(__file__).name} WITH THE REASON.")
        return 1

    current = distinct[0]

    if released and sort_key(current) < sort_key(released):
        print("VERSION LOCKSTEP GAP\n")
        print(f"Every manifest declares {current}, but CHANGELOG.md's most recent")
        print(f"released section is [{released}]. The manifests are BEHIND the last")
        print("release, which means a release was cut without bumping them.\n")
        for path, field, _ in sorted(declared):
            print(f"  {path} ({field})")
        print("\nBump them to the released version, and add whichever one was missed")
        print("to the release script's bump list so the next release carries it.")
        return 1

    where = "; ".join(f"{path} ({field})" for path, field, _ in sorted(declared))
    suffix = f", not behind CHANGELOG's [{released}]" if released else ""
    print(f"OK: every manifest declares {current}{suffix} — {where}.")
    return 0


# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# Each case builds a throwaway repository, because the discovery half — "which
# files even are manifests" — is the half that fails open, and a fixture that
# hands the checker a file list would never exercise it.


def self_test() -> int:
    failures = 0

    def case(description: str, files: dict[str, str], expect: int, expect_text: str = "") -> None:
        nonlocal failures
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, body in files.items():
                target = root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(body, encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "init", "-q"], check=True)
            subprocess.run(["git", "-C", tmp, "add", "-A"], check=True)

            from contextlib import redirect_stdout
            from io import StringIO

            buffer = StringIO()
            with redirect_stdout(buffer):
                actual = check(root)
            output = buffer.getvalue()

        if actual != expect:
            print(f"SELF-TEST FAILED: {description} (expected exit {expect}, got {actual})",
                  file=sys.stderr)
            failures += 1
        elif expect_text and expect_text not in output:
            print(f"SELF-TEST FAILED: {description} (output did not mention {expect_text!r})",
                  file=sys.stderr)
            print(f"  got: {output.strip()}", file=sys.stderr)
            failures += 1
        else:
            print(f"SELF-TEST OK: {description}.")

    changelog = "# Changelog\n\n## [Unreleased]\n\n---\n\n## [1.2.0] — 2026-09-01\n"

    case("a manifest left behind by a release is rejected",
         {"CHANGELOG.md": changelog,
          "package.json": '{"version": "1.2.0"}\n',
          "helm/Chart.yaml": "version: 1.1.0\nappVersion: 1.1.0\n"},
         1, "do not declare the same version")

    case("a stale appVersion beside a bumped version is rejected",
         {"CHANGELOG.md": changelog,
          "helm/Chart.yaml": "version: 1.2.0\nappVersion: 1.1.0\n"},
         1, "do not declare the same version")

    # The single-manifest case rule 1 cannot see: nothing to disagree with.
    case("a lone manifest behind the changelog is rejected",
         {"CHANGELOG.md": changelog, "pyproject.toml": 'version = "1.1.0"\n'},
         1, "BEHIND the last")

    case("manifests bumped ahead of the tag by a prep commit are accepted",
         {"CHANGELOG.md": changelog,
          "package.json": '{"version": "1.3.0"}\n',
          "pyproject.toml": 'version = "1.3.0"\n'},
         0, "1.3.0")

    case("a pre-release of the NEXT version is ahead, not behind",
         {"CHANGELOG.md": changelog, "VERSION": "1.3.0-rc.1\n"},
         0, "1.3.0-rc.1")

    # The other half of the same rule: a pre-release of the version that has
    # ALREADY shipped is stale, however new its string looks.
    case("a pre-release of the SHIPPED version is behind it",
         {"CHANGELOG.md": changelog, "VERSION": "1.2.0-rc.1\n"},
         1, "BEHIND the last")

    # The state a freshly cloned template is in. It must not red on day one.
    case("a repository with no manifests and no releases passes",
         {"CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n"},
         0, "nothing to compare")

    if failures:
        print(f"SELF-TEST: {failures} case(s) failed.", file=sys.stderr)
        return 1
    print("SELF-TEST: all cases passed.")
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        return self_test()
    root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=False,
        ).stdout.strip()
        or "."
    )
    return check(root)


if __name__ == "__main__":
    sys.exit(main())
