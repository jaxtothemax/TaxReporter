#!/usr/bin/env python3
"""Internal documentation link gate (#32).

Ported from TruePPM's `scripts/check-docs-internal-links.py` (upstream #2869,
591 lines as of the port). Nothing in a docs-build pipeline checks that a
site-internal link, anchor, or relative asset actually resolves — a build can
exit 0 while a page links to a route that moved, or an anchor that got
renamed, and the reader hits a 404 or a dead jump. This gate reads the
Markdown source (not the build output) and checks every internal link,
same-page and cross-page anchor, relative asset, and cross-repository
"source of record" link it finds.

Why it reads Markdown source, not the built HTML: some docs frameworks
snapshot/version their content at a release cut by copying the live tree and
rewriting that copy's internal links to a versioned prefix, in the same
build. Resolving every link against the URL each *source file* itself
publishes at makes the check version-aware without knowing a version exists
— a snapshotted page linking to `/0.4/features/x/` resolves against the
`0.4/features/x.md` file the same cut wrote. A link a versioning plugin did
NOT rewrite resolves against the live tree, which is correct if that URL is
real on the published site.

## What this gate is a PORT of, and what changed

This is a generalization, not a drop-in copy — Blueprint is a stack-agnostic
template and the upstream script is Astro/Starlight-coupled in several ways.
Four assumptions were identified; two became configuration, two stayed
hard-coded because generalizing them honestly would have meant supporting a
second docs-framework's link/anchor semantics, which is out of scope for one
port. Both hard-coded ones are named here so the next person doesn't have to
re-derive them from the regex.

Made configurable (flags, all optional — auto-detected/skipped if omitted):
  --docs-root     Content root, repo-relative. Frameworks disagree on this
                   (Astro Starlight: `<site>/src/content/docs`; Docusaurus:
                   `docs/`; MkDocs: `docs/`; Sphinx: varies).
  --config        The framework config file read for two things: a `site:`
                   field (site's own base URL, so an absolute link to it can
                   be treated as internal) and an Astro-shaped `redirects:
                   { "/old/": "/new/" }` object literal. Redirects parsing
                   is Astro-specific by construction; a project on another
                   framework simply gets an empty redirect map, which is
                   safe (it makes the gate slightly stricter, never looser).
  --site          Override the auto-detected site URL.
  --repo-source   URL prefix (`https://gitlab.com/org/repo` or a GitHub
                   equivalent) for cross-repository blob/tree "source of
                   record" links. Auto-detected from `git remote get-url
                   origin` when omitted. Supports GitLab's `/-/blob|tree/`
                   convention and GitHub's `/blob|tree/` convention.

Left Astro/remark-shaped, documented, not configurable:
  - Route generation (file path -> URL): `index.md` -> `/`, `foo/index.md`
    -> `/foo/`, `foo.md` -> `/foo/`. This is the file-based-routing
    convention Astro Starlight, Docusaurus, VitePress, and MkDocs all share,
    but it is not universal (Sphinx and Jekyll's `permalink:` front matter
    can both remap it), so a project on one of those would need to fork
    `page_url()`.
  - Anchor-slug generation: github-slugger's algorithm (lowercase, strip
    everything but letters/marks/numbers/spaces/hyphens/underscores, spaces
    to hyphens, `-1`/`-2` suffixes for repeats). This is what Astro's
    `rehype-heading-ids` uses, and it matches most of the remark/rehype
    ecosystem (GitHub itself, `markdown-it-anchor`'s default), but MkDocs'
    `toc` extension slugifies differently (it keeps underscores differently
    and has its own Unicode handling). A project on a non-remark toolchain
    would need to swap `slugify()`.

## Scanning discipline

Enumerates via `git ls-files` (falling back to a filesystem walk only when
`root` is not inside a git work tree, which is what lets `--self-test`'s
fixtures — plain tempdirs — keep working without a repo). This is what keeps
the gate seeing the *repository*, not the working directory: an ignored
local file (a stray editor export, a partially-downloaded fixture) under the
docs root is invisible to it, the same way it is invisible to CI's clean
clone. See `scripts/CLAUDE.md`, "Scan the repository, not the working
directory."

## What it checks, over every page under `--docs-root`

  1. A site-internal link (`/path/`, a relative page link, or an absolute
     URL under `--site`) resolves to a page that exists, or to a redirect
     declared in `--config`.
  2. A `#anchor` on that link — or a bare same-page `#anchor` — names a
     heading id or an explicit `id="…"` on the target page.
  3. A relative asset link (an image, a JSON/YAML/CSV file, …) points at a
     file that is tracked in the repository.
  4. A cross-repository link to the source of record — a `--repo-source`
     blob/tree URL — names a file or directory tracked in this repository.

What it cannot see: links built at runtime by a component, and anchors a
component injects that are not written as `id="…"` in the page source.
External links (any other domain) are not followed. It refuses to pass when
it matched no pages, no links, or no anchors — a checker that silently
matches nothing is the failure it exists to prevent.

Exit codes:
  0  every internal link resolves
  1  a link names a missing page, anchor, asset, or source file
  2  invocation / setup error, including "the scanner matched nothing" and
     "the configured docs root does not exist" — the latter is a REAL error
     when this script is invoked directly; a project with no docs site at
     all should never invoke it in the first place (see ci/docs.yml's
     `rules: exists:` gate and the `check-docs-links` Makefile target, both
     of which skip rather than call this script when the docs root is
     absent).

Modes:
  python3 scripts/check-docs-internal-links.py
  python3 scripts/check-docs-internal-links.py --docs-root docs --config docs/.vuepress/config.js
  python3 scripts/check-docs-internal-links.py --self-test
"""

from __future__ import annotations

import argparse
import html
import posixpath
import re
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

DEFAULT_DOCS_REL = "website/src/content/docs"
DEFAULT_CONFIG_REL = "website/astro.config.mjs"

FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
# Trailing optional-hashes stripped separately (_strip_trailing_hash_marker
# below, plain str.rstrip logic — not a regex) rather than via
# `(.+?)(?:[ \t]+#+)?[ \t]*$` — the lazy `.+?` overlaps `[ \t]` with the
# following `[ \t]+#+` / `[ \t]*$`, so the backtracker retries every split
# point on a line with no closing marker. HEADING itself only matches the
# bounded `#{1,6}[ \t]` marker — an in-regex `(.+)$` tail after `[ \t]+` is
# the same adjacent-quantifier-over-overlapping-chars shape, since `.` also
# matches space/tab; callers slice `line[m.end():]` for the remainder
# instead. The fixed-width `(?=[ \t].)` lookahead (not a second quantifier)
# preserves the original's "at least one separator char AND at least one
# more char" floor — without it, "### " (hash run + a single trailing
# space, no text) would newly match where it should be rejected.
HEADING = re.compile(r"^\s{0,3}(#{1,6})(?=[ \t].)[ \t]")


def _strip_trailing_hash_marker(text: str) -> str:
    """Strip a Markdown ATX heading's optional closing '#' run (e.g. 'Heading ###' ->
    'Heading'). Plain str logic instead of a regex — a `[ \t]+#+[ \t]*$` pattern
    chains three adjacent quantified groups, which trips backtracking heuristics
    even though the character classes are disjoint."""
    no_trailing_ws = text.rstrip(" \t")
    no_hashes = no_trailing_ws.rstrip("#")
    if no_hashes == no_trailing_ws:
        return text  # no trailing hash run
    if not no_hashes or no_hashes[-1] not in " \t":
        return text  # hash run wasn't preceded by whitespace — not a closing marker
    return no_hashes.rstrip(" \t")


MD_LINK = re.compile(
    r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)"
)
# Alternation instead of `<?(\S+?)>?(?:\s+.*)?$` — `>` is itself a `\S`
# character, so the lazy `\S+?` and the optional `>?` overlap on where the
# URL ends. The two shapes (angle-bracketed vs. bare) don't overlap with
# each other, so matching them as distinct alternatives removes the
# ambiguity; callers read `ref.group(1) or ref.group(2)`.
REF_DEF = re.compile(r"^\s{0,3}\[(?!\^)[^\]]+\]:\s*(?:<([^<>]*)>|(\S+))(?=\s|$)")
HREF = re.compile(r"""\bhref=["']([^"'{}]+)["']""")
ID_ATTR = re.compile(r"""\bid=["']([^"'{}]+)["']""")
FOOTNOTE = re.compile(r"^\s{0,3}\[\^([^\]]+)\]:")
# `(`+)` deliberately bounded to `{1,4}`: the backreference check inside the
# content loop costs O(delimiter length) per position, so an unbounded `+`
# made a single match attempt O(n^2) against an adversarial run of
# backticks. Real inline code spans are never more than a few backticks
# (anything longer is a ``` block fence, handled separately above).
INLINE_CODE = re.compile(r"(`{1,4})(?:(?!\1).)+?\1")
ASSET_EXT = re.compile(
    r"\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|json|ya?ml|txt|csv|zip|mp4|webm)$", re.I
)
SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
SITE_FIELD = re.compile(r"""\bsite:\s*["']([^"']+)["']""")
# `[^}]*` instead of `(.*?)\n\s*\}` with re.S — DOTALL `.` and `\s` both
# match newlines, so the lazy `.*?` and the trailing `\n\s*` overlap. The
# redirects block never nests braces (values are quoted strings), so
# "everything up to the next `}`" is equivalent and unambiguous.
REDIRECTS_BLOCK = re.compile(r"redirects:\s*\{([^}]*)\}")
REDIRECT_ENTRY = re.compile(r"""["'](/[^"']*)["']\s*:\s*["'](/[^"']*)["']""")


def slugify(text: str) -> str:
    """github-slugger 2.x: lowercase, drop everything but letters, marks, numbers,
    spaces, hyphens and underscores, then spaces to hyphens. Documented
    hard-coded assumption — see the module docstring."""
    kept = []
    for ch in text.lower():
        # U+24B6..U+24E9 (circled letters, e.g. the "ⓘ" in a field-help heading) are
        # category So but carry the Alphabetic property, which github-slugger keeps.
        if (
            ch in " -_"
            or unicodedata.category(ch)[0] in "LMN"
            or "Ⓐ" <= ch <= "ⓩ"
        ):
            kept.append(ch)
    return "".join(kept).replace(" ", "-")


def heading_text(raw: str) -> str:
    """Approximate the text a heading-id plugin collects from a heading."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", raw)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("`", "")
    t = re.sub(r"\*\*|~~|\*", "", t)
    t = re.sub(r"(?<!\w)_(\S(?:.*?\S)?)_(?!\w)", r"\1", t)
    t = re.sub(r"\\(.)", r"\1", t)
    return html.unescape(t).strip()


@dataclass
class Page:
    file: Path
    url: str
    anchors: set[str] = field(default_factory=set)
    links: list[tuple[int, str]] = field(default_factory=list)


def page_url(docs: Path, file: Path) -> str:
    """File path -> route. Astro/Starlight-shaped (see module docstring): a
    convention shared by most file-based-routing static site generators, not
    universal."""
    rel = file.relative_to(docs).with_suffix("").as_posix()
    if rel == "index":
        return "/"
    if rel.endswith("/index"):
        rel = rel[: -len("/index")]
    return f"/{rel}/"


def _frontmatter_end(lines: list[str]) -> int:
    """Line index where a leading ``---`` frontmatter block ends, or 0 if there is none."""
    if not lines or lines[0].strip() != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return i + 1
    return 0


def _unique_slug(base: str, seen: dict[str, int]) -> str:
    """github-slugger's ``-1``, ``-2`` suffixing for a heading slug seen again."""
    slug = base
    while slug in seen:
        seen[base] += 1
        slug = f"{base}-{seen[base]}"
    seen[slug] = 0
    return slug


def _update_fence(fence: str | None, line: str) -> tuple[str | None, bool]:
    """Track a ``` / ~~~ code-fence's open/close state for one line.

    Returns the fence token now open (``None`` if closed/not open) and whether
    ``line`` is itself a fence-marker line (which the caller must not otherwise
    parse as content).
    """
    marker = FENCE.match(line)
    if not marker:
        return fence, False
    token = marker.group(1)
    if fence is None:
        return token, True
    if token[0] == fence[0] and len(token) >= len(fence):
        return None, True
    return fence, True


def _heading_anchor(line: str, seen: dict[str, int]) -> str | None:
    heading = HEADING.match(line)
    if not heading:
        return None
    raw_text = _strip_trailing_hash_marker(line[heading.end() :])
    base = slugify(heading_text(raw_text))
    return _unique_slug(base, seen)


def _line_links(lineno: int, line: str) -> list[tuple[int, str]]:
    text = INLINE_CODE.sub("", line)
    links = [(lineno, target) for rx in (MD_LINK, HREF) for target in rx.findall(text)]
    ref = REF_DEF.match(text)
    if ref:
        links.append((lineno, ref.group(1) or ref.group(2)))
    return links


def parse_page(docs: Path, file: Path) -> Page:
    page = Page(file=file, url=page_url(docs, file), anchors={"_top"})
    seen: dict[str, int] = {}
    lines = file.read_text(encoding="utf-8").splitlines()
    start = _frontmatter_end(lines)
    fence: str | None = None
    for lineno, line in enumerate(lines[start:], start=start + 1):
        fence, is_marker = _update_fence(fence, line)
        if is_marker or fence is not None:
            continue
        anchor = _heading_anchor(line, seen)
        if anchor is not None:
            page.anchors.add(anchor)
        page.anchors.update(ID_ATTR.findall(line))
        footnote = FOOTNOTE.match(line)
        if footnote:
            # GFM footnotes render a labelled Footnotes section and per-note targets.
            page.anchors.update(
                {"footnote-label", f"user-content-fn-{footnote.group(1)}"}
            )
        page.links.extend(_line_links(lineno, line))
    return page


def _norm_url(url: str) -> str:
    url = posixpath.normpath(url) if url not in ("", "/") else "/"
    return url if url.endswith("/") else url + "/"


def load_redirects(config_text: str | None) -> dict[str, str]:
    """Astro-shaped: a `redirects: { "/old/": "/new/" }` object literal in the
    framework config. A project on another framework simply gets no redirects,
    which only makes the gate stricter, never looser."""
    if not config_text:
        return {}
    block = REDIRECTS_BLOCK.search(config_text)
    if not block:
        return {}
    return {
        _norm_url(src): _norm_url(dst)
        for src, dst in REDIRECT_ENTRY.findall(block.group(1))
    }


def detect_site(config_text: str | None) -> str | None:
    """Auto-detect the docs site's own base URL from a `site: "https://…"` field."""
    if not config_text:
        return None
    m = SITE_FIELD.search(config_text)
    return m.group(1).rstrip("/") if m else None


def normalize_remote(url: str) -> str | None:
    """`git remote get-url origin` output -> an `https://host/path` prefix, or
    None if it does not look like a forge URL. Handles both the SSH
    (`git@host:path.git`) and HTTPS (`https://host/path.git`) shapes."""
    url = url.strip()
    m = re.match(r"^git@([^:]+):(.+?)(?:\.git)?/?$", url)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    m = re.match(r"^https?://(?:[^@/]+@)?([^/]+)/(.+?)(?:\.git)?/?$", url)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    return None


def detect_repo_source(root: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return normalize_remote(result.stdout)


def repo_source_pattern(prefix: str) -> re.Pattern[str]:
    """Match a cross-repository blob/tree URL and capture the file/directory path.
    Supports GitLab's `/-/blob|tree/<ref>/` convention and GitHub's plain
    `/blob|tree/<ref>/` convention (no `/-`)."""
    prefix = prefix.rstrip("/")
    infix = "/-" if "gitlab" in prefix.lower() else ""
    return re.compile(rf"^{re.escape(prefix)}{infix}/(?:blob|tree)/[^/]+/([^#?]+)")


# --------------------------------------------------------------- repo scanning


def tracked_files(root: Path) -> set[str] | None:
    """Git-tracked repo-relative paths, or None when ``root`` is not inside a
    git work tree (this is what lets --self-test's plain-tempdir fixtures keep
    working). Enumerating via `git ls-files` instead of a filesystem walk is
    what keeps this gate scanning the REPOSITORY: an ignored local file (a
    stray export, a partially-downloaded fixture) is invisible to it, exactly
    as it is invisible to CI's clean clone. See scripts/CLAUDE.md, "Scan the
    repository, not the working directory."."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return set(result.stdout.splitlines())


def discover_pages(root: Path, docs: Path, tracked: set[str] | None) -> list[Path]:
    if tracked is not None:
        docs_rel = docs.relative_to(root).as_posix()
        prefix = f"{docs_rel}/"
        return sorted(
            root / p
            for p in tracked
            if p.startswith(prefix) and Path(p).suffix in (".md", ".mdx")
        )
    return sorted(f for f in docs.rglob("*.md*") if f.suffix in (".md", ".mdx"))


def path_exists(root: Path, tracked: set[str] | None, path: Path) -> bool:
    """Existence check for an asset or cross-repo source path. Tracked-set aware
    for the same reason discover_pages is: a link to a file that exists only
    because it is gitignored locally (or not yet committed) must not read as
    resolved — CI's clean clone would 404 it."""
    if tracked is None:
        return path.exists()
    # Callers pass unresolved `../`-laden paths (a relative asset link walks up
    # from the page's own directory) — normalize the STRING first. Path.relative_to
    # does not collapse ".." segments, so comparing an unnormalized path against
    # the tracked set would silently never match and every relative asset link
    # would read as broken.
    normalized = Path(posixpath.normpath(path.as_posix()))
    try:
        rel = normalized.relative_to(root).as_posix().rstrip("/")
    except ValueError:
        return path.exists()
    if rel in tracked:
        return True
    prefix = f"{rel}/"
    return any(t.startswith(prefix) for t in tracked)  # a tracked file under this dir


# ------------------------------------------------------------------ checking


@dataclass
class _LinkCheckResult:
    links_checked: int = 0
    anchors_checked: int = 0
    violation: str | None = None


def _check_link(  # cognitive-complexity-ok: linear one-branch-per-link-kind resolver (repo-source, external, asset, anchor); each `if` returns independently, reviewed #41
    page: Page,
    lineno: int,
    raw: str,
    rel: str,
    pages: dict[str, Page],
    redirects: dict[str, str],
    root: Path,
    tracked: set[str] | None,
    site: str | None,
    repo_pattern: re.Pattern[str] | None,
) -> _LinkCheckResult:
    """One link's contribution to :func:`run_check`'s counters and violation list."""
    target = raw.strip()
    where = f"{rel}:{lineno}"

    if repo_pattern:
        source = repo_pattern.match(target)
        if source:
            if path_exists(root, tracked, root / unquote(source.group(1)).rstrip("/")):
                return _LinkCheckResult(links_checked=1)
            return _LinkCheckResult(
                links_checked=1,
                violation=f"{where} links to {raw} — no such file in this repository",
            )

    if site and target.startswith(site):
        target = target[len(site) :] or "/"

    if target.startswith("//") or SCHEME.match(target):
        return _LinkCheckResult()

    path, _, anchor = target.partition("#")
    path = path.split("?", 1)[0]
    if path and not path.startswith("/") and ASSET_EXT.search(path):
        if path_exists(root, tracked, page.file.parent / unquote(path)):
            return _LinkCheckResult(links_checked=1)
        return _LinkCheckResult(
            links_checked=1,
            violation=f"{where} links to {raw} — no such file relative to the page",
        )

    if path == "":
        resolved: Page | None = page
        links_delta = 0
    else:
        url = _norm_url(
            path if path.startswith("/") else posixpath.join(page.url, path)
        )
        resolved = pages.get(url) or (
            pages.get(redirects[url]) if url in redirects else None
        )
        links_delta = 1
        if resolved is None:
            return _LinkCheckResult(
                links_checked=1,
                violation=f"{where} links to {raw} — no page publishes at {url}",
            )

    if not anchor:
        return _LinkCheckResult(links_checked=links_delta)
    if unquote(anchor) not in resolved.anchors:
        return _LinkCheckResult(
            links_checked=links_delta,
            anchors_checked=1,
            violation=f"{where} links to {raw} — {resolved.url} exists, the anchor '#{anchor}' does not",
        )
    return _LinkCheckResult(links_checked=links_delta, anchors_checked=1)


def _print_scope_notes(
    pages: dict[str, Page],
    docs_rel: str,
    config_rel: str,
    config_text: str | None,
    redirects: dict[str, str],
    site: str | None,
    repo_source: str | None,
) -> None:
    """The "what this gate did not cover" block for :func:`run_check`.

    Split out so `run_check`'s own orchestration — discover, check, report —
    reads as one thing a reader can follow without wading through the scope
    disclaimer in the middle of it. Mirrors the extraction TruePPM's own
    version of this script made to `run_check` for the same reason
    (upstream #3980). Printed unconditionally, not only when something was
    dropped (scripts/CLAUDE.md, "Say what the gate did not cover").
    """
    print(f"SCOPE: docs root = {docs_rel} ({len(pages)} page(s) discovered)")
    if config_text is None:
        print(
            f"SCOPE: config not found at {config_rel} — redirects and site-URL"
            " auto-detection are skipped (this only makes the gate stricter)"
        )
    elif not redirects:
        print(f"SCOPE: config found at {config_rel}, no `redirects:` block declared")
    else:
        print(f"SCOPE: {len(redirects)} redirect(s) loaded from {config_rel}")
    print(
        f"SCOPE: site URL = {site}"
        if site
        else "SCOPE: no site URL configured or detected — an absolute link to this"
        " site's own domain is treated as external and NOT checked"
    )
    print(
        f"SCOPE: repo-source = {repo_source}"
        if repo_source
        else "SCOPE: no --repo-source configured or detected — cross-repository"
        " source-of-record (blob/tree) links are NOT checked"
    )
    print(
        "SCOPE: external links, redirects declared outside the config's `redirects`"
        " object, and links/anchors a component renders at runtime are never checked"
    )


def _print_verdict(
    pages: dict[str, Page], links_checked: int, anchors_checked: int, violations: list[str]
) -> int:
    """The pass/fail report for :func:`run_check`. See `_print_scope_notes`."""
    print(f"COUNT: pages={len(pages)} links={links_checked} anchors={anchors_checked}")

    if not pages or links_checked == 0 or anchors_checked == 0:
        print(
            "STATUS: ERROR — scanner matched nothing; refusing to pass a check that"
            " saw nothing",
            file=sys.stderr,
        )
        return 2

    for v in violations:
        print(f"VIOLATION: {v}")
    if violations:
        print(
            f"STATUS: FAIL — {len(violations)} broken internal documentation"
            " link(s)/anchor(s)/asset(s). A link that reads as authoritative and"
            " 404s is worse than no link.",
            file=sys.stderr,
        )
        return 1
    print(
        f"STATUS: PASS — {links_checked} internal link(s) and {anchors_checked}"
        f" anchor(s) across {len(pages)} page(s) resolve."
    )
    return 0


def run_check(
    root: Path,
    docs_rel: str,
    config_rel: str,
    site: str | None,
    repo_source: str | None,
) -> int:
    docs = root / docs_rel
    if not docs.is_dir():
        print(f"STATUS: ERROR — docs tree not found: {docs}", file=sys.stderr)
        return 2

    tracked = tracked_files(root)
    config_path = root / config_rel
    config_text = config_path.read_text(encoding="utf-8") if config_path.is_file() else None

    if site is None:
        site = detect_site(config_text)
    if repo_source is None:
        repo_source = detect_repo_source(root)

    redirects = load_redirects(config_text)
    repo_pattern = repo_source_pattern(repo_source) if repo_source else None

    pages = {
        p.url: p for p in (parse_page(docs, f) for f in discover_pages(root, docs, tracked))
    }

    violations: list[str] = []
    links_checked = anchors_checked = 0
    for page in pages.values():
        rel = page.file.relative_to(root).as_posix()
        for lineno, raw in page.links:
            result = _check_link(
                page, lineno, raw, rel, pages, redirects, root, tracked, site, repo_pattern
            )
            links_checked += result.links_checked
            anchors_checked += result.anchors_checked
            if result.violation:
                violations.append(result.violation)

    _print_scope_notes(pages, docs_rel, config_rel, config_text, redirects, site, repo_source)
    return _print_verdict(pages, links_checked, anchors_checked, violations)


# --------------------------------------------------------------------- self-test

TEST_DOCS_REL = "website/src/content/docs"
TEST_CONFIG_REL = "website/astro.config.mjs"
TEST_SITE = "https://docs.example.test"
TEST_REPO_SOURCE = "https://gitlab.example.test/group/project"
# Needs at least one anchor AND one cross-page link, or run_check's "matched
# nothing" refusal (exit 2) fires and masks whatever the case is testing.
GOOD_BODY = (
    "---\ntitle: Reference\n---\n\n## Same page\n\n"
    "[a](/features/csv-import-export/#import) [b](#same-page)\n"
)


def _write(root: Path, rel: str, body: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def _fixture(root: Path, reference_body: str, redirects: str = "") -> None:
    _write(
        root,
        TEST_CONFIG_REL,
        f'export default defineConfig({{\n  site: "{TEST_SITE}",\n  redirects: {{\n'
        + redirects
        + "\n  },\n});\n",
    )
    _write(
        root,
        f"{TEST_DOCS_REL}/index.mdx",
        "---\ntitle: Home\n---\n\n[Reference](/api/reference/)\n",
    )
    _write(
        root,
        f"{TEST_DOCS_REL}/features/csv-import-export.md",
        "---\ntitle: CSV\n---\n\n## Import\n\n## Import\n\n## Export — CSV & `Excel`\n\n"
        '<div id="custom-anchor"></div>\n\n![shot](../../../assets/shot.webp)\n',
    )
    _write(root, "website/src/assets/shot.webp", "x")
    _write(root, "docs/adr/0001-example.md", "# ADR\n")
    _write(root, f"{TEST_DOCS_REL}/api/reference.md", reference_body)


def _run(root: Path) -> tuple[int, str, str]:
    import contextlib
    import io

    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        status = run_check(root, TEST_DOCS_REL, TEST_CONFIG_REL, None, TEST_REPO_SOURCE)
    return status, out.getvalue(), err.getvalue()


def _expect(label: str, root: Path, expected: int) -> bool:
    status, out, err = _run(root)
    ok = True
    # Demand the EXACT rejection code, not merely non-zero — 1 is "found a
    # violation", 2 is "the gate itself could not run the check". A probe that
    # reads any non-zero as "correctly rejected" cannot tell those apart.
    if status != expected:
        print(
            f"SELF-TEST FAIL: {label} — exit {status}, expected {expected}",
            file=sys.stderr,
        )
        ok = False
    # A count line must precede every verdict — its absence is what proves the
    # script crashed before reaching a decision rather than making one.
    if "COUNT: pages=" not in out:
        print(f"SELF-TEST FAIL: {label} — no COUNT line emitted", file=sys.stderr)
        ok = False
    verdict = {0: "STATUS: PASS", 1: "STATUS: FAIL", 2: "STATUS: ERROR"}[expected]
    if verdict not in out and verdict not in err:
        print(
            f"SELF-TEST FAIL: {label} — expected the verdict line {verdict!r}"
            " but it was not printed",
            file=sys.stderr,
        )
        ok = False
    return ok


def _git(args: list[str], cwd: Path) -> bool:
    return (
        subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, check=False
        ).returncode
        == 0
    )


def _case_scan_is_repo_scoped() -> bool:
    """scripts/CLAUDE.md, "Scan the repository, not the working directory":
    plant a gitignored page with a broken link and assert the gate stays
    green. Enumerating via `git ls-files` is what makes this true — an
    untracked/ignored file never reaches the scan, the same way it never
    reaches CI's clean clone."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if not (
            _git(["init", "-q"], root)
            and _git(["config", "user.email", "test@example.test"], root)
            and _git(["config", "user.name", "Test"], root)
        ):
            print(
                "SELF-TEST SKIP: git unavailable — repo-scoped-scan case not exercised",
                file=sys.stderr,
            )
            return True
        _fixture(root, GOOD_BODY)
        _git(["add", "-A"], root)
        _git(["commit", "-q", "-m", "init"], root)

        _write(root, ".gitignore", "ignored/\n")
        _write(root, f"{TEST_DOCS_REL}/ignored/broken.md", "[x](/nowhere/)\n")

        status, out, _ = _run(root)
        if status != 0:
            print(
                "SELF-TEST FAIL: a gitignored page with a broken link failed the"
                f" gate (exit {status}) — the scan is reading the working directory,"
                " not the repository",
                file=sys.stderr,
            )
            return False
        if "STATUS: PASS" not in out:
            print(
                "SELF-TEST FAIL: repo-scoped-scan case did not reach a PASS verdict",
                file=sys.stderr,
            )
            return False
        print("SELF-TEST OK: a gitignored page with a broken link does not fail the gate.")
        return True


def _case_helpers() -> bool:
    ok = True
    if detect_site(f'  site: "{TEST_SITE}/",\n') != TEST_SITE:
        print("SELF-TEST FAIL: detect_site did not parse a quoted site field", file=sys.stderr)
        ok = False
    if detect_site(None) is not None:
        print("SELF-TEST FAIL: detect_site(None) should be None", file=sys.stderr)
        ok = False
    cases = [
        ("git@gitlab.com:group/project.git", "https://gitlab.com/group/project"),
        ("https://gitlab.com/group/project.git", "https://gitlab.com/group/project"),
        ("https://github.com/org/repo", "https://github.com/org/repo"),
        ("not a url", None),
    ]
    for remote, expected in cases:
        got = normalize_remote(remote)
        if got != expected:
            print(
                f"SELF-TEST FAIL: normalize_remote({remote!r}) = {got!r}, expected {expected!r}",
                file=sys.stderr,
            )
            ok = False
    if ok:
        print("SELF-TEST OK: detect_site / normalize_remote helpers.")
    return ok


def self_test() -> int:
    good = (
        "---\ntitle: Reference\n---\n\n## Same page\n\n"
        "[a](/features/csv-import-export/#import) [b](/features/csv-import-export/#import-1)"
        " [c](/features/csv-import-export/#export--csv--excel) [d](#same-page)"
        f" [e]({TEST_SITE}/features/csv-import-export/#custom-anchor)"
        " [f](../../features/csv-import-export/)"
        f" [g]({TEST_REPO_SOURCE}/-/blob/main/docs/adr/0001-example.md)\n\n"
        "```md\n[fenced, never checked](/nowhere/)\n```\n\n`[inline code, never checked](/nowhere/)`\n"
    )
    cases: list[tuple[str, str, str, int]] = [
        ("valid paths, anchors, duplicate headings, relative, cross-tree, fenced", good, "", 0),
        ("the upstream #2846 defect — a path that no page publishes at", good + "\n[x](/features/csv-import/)\n", "", 1),
        (
            "the same path, once a redirect declares it",
            good + "\n[x](/features/csv-import/#import)\n",
            '    "/features/csv-import/": "/features/csv-import-export/",',
            0,
        ),
        ("a missing anchor on an existing page", good + "\n[x](/features/csv-import-export/#nope)\n", "", 1),
        ("a missing same-page anchor", good + "\n[x](#not-a-heading)\n", "", 1),
        (
            "a cross-tree link to a missing source file",
            good + f"\n[x]({TEST_REPO_SOURCE}/-/blob/main/docs/adr/9999-missing.md)\n",
            "",
            1,
        ),
        ("a relative asset that does not exist", good + "\n![x](./missing.png)\n", "", 1),
    ]
    ok = True
    for label, body, redirects, expected in cases:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _fixture(root, body, redirects)
            ok &= _expect(label, root, expected)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / TEST_DOCS_REL).mkdir(parents=True)
        ok &= _expect("an empty docs tree must refuse to pass", root, 2)
        _write(root, f"{TEST_DOCS_REL}/plain.md", "No links here.\n")
        ok &= _expect("a tree with pages but no links must refuse to pass", root, 2)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        status, out, err = None, "", ""
        import contextlib
        import io

        buf_out, buf_err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
            status = run_check(root, "nonexistent/docs/root", TEST_CONFIG_REL, None, None)
        out, err = buf_out.getvalue(), buf_err.getvalue()
        # This is the "crash vs. rejection" case scripts/CLAUDE.md asks for: a
        # missing docs root is a SETUP error (2), never conflated with "found a
        # violation" (1).
        if status != 2 or "STATUS: ERROR" not in (out + err):
            print(
                f"SELF-TEST FAIL: a missing docs root must exit 2 with a STATUS: ERROR"
                f" line, got exit={status}",
                file=sys.stderr,
            )
            ok = False
        else:
            print("SELF-TEST OK: a missing docs root is a setup error (exit 2), not a violation (1).")

    ok &= _case_scan_is_repo_scoped()
    ok &= _case_helpers()

    if not ok:
        return 1
    print(
        f"SELF-TEST OK: {len(cases) + 5} cases — valid links accepted (duplicate headings,"
        " redirects, cross-tree, config helpers); broken paths, anchors, assets,"
        " cross-tree files, vacuous trees and a missing docs root all correctly"
        " rejected; a gitignored violation does not fail the gate."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="run the offline self-test and exit")
    parser.add_argument(
        "--docs-root",
        default=None,
        help=f"content root, repo-relative (default: {DEFAULT_DOCS_REL})",
    )
    parser.add_argument(
        "--config",
        default=None,
        help=f"docs framework config, repo-relative, read for redirects + site URL (default: {DEFAULT_CONFIG_REL})",
    )
    parser.add_argument(
        "--site",
        default=None,
        help="the docs site's own base URL (auto-detected from --config's `site:` field if omitted)",
    )
    parser.add_argument(
        "--repo-source",
        default=None,
        help="URL prefix for cross-repository blob/tree links (auto-detected from `git remote get-url origin` if omitted)",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False
    )
    root = (
        Path(result.stdout.strip())
        if result.returncode == 0 and result.stdout.strip()
        else Path(__file__).resolve().parent.parent
    )
    return run_check(
        root,
        args.docs_root or DEFAULT_DOCS_REL,
        args.config or DEFAULT_CONFIG_REL,
        args.site,
        args.repo_source,
    )


if __name__ == "__main__":
    sys.exit(main())
