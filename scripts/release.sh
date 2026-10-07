#!/usr/bin/env bash
# Usage: ./scripts/release.sh [-y|--yes] <version>
# Example: ./scripts/release.sh 1.0.0
#
# The extracted release notes are shown and a human must approve them (Enter
# accepts, anything else aborts and removes the release branch) before the commit
# is made. Any other failure between creating the release branch and committing
# removes the branch too (an EXIT trap), so a failed run never leaves one behind.
# -y / --yes / RELEASE_ASSUME_YES=1 stand in for the prompt when the caller has
# already reviewed the notes (the /release skill does so in chat). A run with no
# TTY and no such flag fails closed rather than shipping unreviewed.
#
# The version-bearing manifests it bumps are derived, not listed: see
# release_manifests below.
set -euo pipefail

# ─── CHANGELOG rotation ──────────────────────────────────────────────────────
#
# rotate_changelog <file> <version> <date>  — writes the rotated file to stdout.
#
# ONE pass, not a `sed` rename followed by an `awk` prepend. The two-step version
# renamed the `## [Unreleased]` heading in place and then wrote a fresh
# `## [Unreleased]` + `---` above it — but the `---` divider that had been sitting
# UNDER the old Unreleased heading did not move, so it landed between the newly
# released heading and its first entry. The fresh Unreleased block carries the
# same divider, so the artifact reproduces itself at EVERY subsequent release.
# It is invisible in review because the result is still valid markdown.
rotate_changelog() {
  awk -v version="$2" -v date="$3" '
    # Rename the Unreleased heading to this version and emit a fresh Unreleased
    # block above it, then swallow the separator that belonged to the OLD
    # Unreleased block: blank lines and at most one `---` immediately after the
    # heading we just renamed.
    /^## \[Unreleased\]/ && !seen {
      print "## [Unreleased]"
      print ""
      print "---"
      print ""
      print "## [" version "] — " date
      seen = 1
      eating = 1
      next
    }
    eating && /^[[:space:]]*$/     { next }
    eating && /^---[[:space:]]*$/  { eating = 0; next }
    eating                         { eating = 0; print "" }
    { print }
  ' "$1"
}

# ─── Release-notes confirmation gate ─────────────────────────────────────────
#
# confirm_release_notes <notes> <assume_yes>  — returns 0 to proceed, 1 to abort.
#
# Rotation and notes generation are mechanical, so a stale bullet, a fragment filed
# under the wrong heading, or an empty [Unreleased] all reach docs/releases/ and the
# release commit with no human having read them. This is the read.
#   - empty notes            → fail closed, even with --yes (nothing to approve)
#   - assume_yes = 1         → proceed (caller reviewed the text out of band)
#   - no TTY and no flag     → fail closed (an unattended run is not a review)
#   - otherwise              → show the notes; Enter accepts, anything else aborts
confirm_release_notes() {
  local notes="$1" assume_yes="${2:-0}" reply=""
  if [[ -z "${notes//[[:space:]]/}" ]]; then
    echo "Error: the release notes are empty or could not be read (see any error above); an empty [Unreleased] needs changelog fragments first." >&2
    return 1
  fi
  if [[ "$assume_yes" == "1" ]]; then
    echo "Release notes approved non-interactively (--yes / RELEASE_ASSUME_YES=1)." >&2
    return 0
  fi
  # _RELEASE_FORCE_TTY is test-only: it lets --self-test drive the prompt from a pipe.
  if [[ ! -t 0 && "${_RELEASE_FORCE_TTY:-}" != "1" ]]; then
    echo "Error: no TTY to confirm the release notes; review them, then re-run with --yes (or RELEASE_ASSUME_YES=1)" >&2
    return 1
  fi
  {
    echo ""
    echo "──────── Release notes (becomes docs/releases) ────────"
    printf '%s\n' "$notes"
    echo "───────────────────────────────────────────────────────"
  } >&2
  # EOF (Ctrl-D) is not an Enter: it aborts.
  read -r -p "Press Enter to accept these release notes, anything else to abort: " reply || return 1
  [[ -z "$reply" ]]
}

# ─── Version-bearing manifests ───────────────────────────────────────────────
#
# release_manifests — every package.json that carries the release version, one
# per line: the root package.json plus each pnpm workspace package, matching
# the `packages:` globs in pnpm-workspace.yaml. Derived from git, not listed by
# name, so a workspace package added later is bumped without anyone editing
# this script. `:(glob)` makes `*` stop at a slash, so a package.json nested
# deeper (a test fixture) is never stamped with the release. website/package.json
# is deliberately not matched: the docs site is tooling, waived in
# scripts/check-version-lockstep.py, which is the backstop for all of this.
release_manifests() {
  git ls-files -- package.json ':(glob)packages/*/package.json' ':(glob)apps/*/package.json'
}

# bump_manifests <version> — set the top-level "version" of every manifest
# release_manifests names, and nothing else. JSON-aware (node), not sed: a sed
# over `"version": ...` also rewrites any nested "version" key, and the 2-space
# JSON.stringify layout is the one Prettier keeps package.json in. Fails when
# there is no manifest at all, or one without a top-level version string — a
# release that bumps nothing must not look like one that bumped everything.
bump_manifests() {
  local version="$1" f
  local -a files=()
  # Here-string, not a pipe into `while read` (scripts/check-sigpipe-readers.sh).
  while IFS= read -r f; do
    [[ -n "$f" ]] && files+=("$f")
  done <<< "$(release_manifests)"
  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "Error: no version-bearing package.json is tracked (root, packages/*, apps/*)" >&2
    return 1
  fi
  node -e '
    const fs = require("node:fs");
    const [version, ...files] = process.argv.slice(1);
    for (const file of files) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof manifest.version !== "string") {
        console.error("Error: " + file + " has no top-level \"version\" string");
        process.exit(1);
      }
      manifest.version = version;
      fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    }
    console.log("Bumped " + files.length + " package.json manifest(s) to " + version + ": " + files.join(", "));
  ' "$version" "${files[@]}"
}

# abort_release_branch <branch> <default-branch> [<notes-file>] — leave no half-edited tree behind.
abort_release_branch() {
  git reset -q --hard HEAD
  # reset leaves untracked files; release-notes.sh may have written the notes file.
  # Remove only that one file: the clean-tree guard ignores untracked files, so
  # anything else under docs/releases/ may be the user's own draft.
  if [[ -n "${3:-}" ]]; then rm -f -- "$3"; fi
  git checkout -q "$2"
  git branch -q -D "$1"
}

# ─── Already-published guard ─────────────────────────────────────────────────
#
# refuse_if_published <remote> <tag> <version>  — returns 1 (with a message) when
# the tag already exists on <remote>, or when RELEASE_PUBLISHED_CHECK says the
# version is already in a registry.
#
# The local `git tag` check below only sees tags this clone has fetched. A tag
# another machine pushed, or a version a registry already holds (PyPI, npm and
# OCI registries refuse to overwrite), is found only when the publish job fails
# AFTER the tag is pushed. That burns the version, and the fix is a re-cut. Checking
# here costs one round trip.
#
# RELEASE_PUBLISHED_CHECK is an optional shell command that runs with VERSION set.
# Its exit status is a three-way answer, because "not published" and "could not
# reach the registry" must not look alike:
#   0  the version IS already published   → refuse
#   1  the version is NOT published       → proceed
#   *  could not tell (network, DNS, 5xx) → refuse
# A bare `curl -sf` cannot tell those apart, since it fails the same way on a 404 and
# on a dropped connection. Map the HTTP status explicitly instead:
#   c=$(curl -s -o /dev/null -w '%{http_code}' "https://pypi.org/pypi/<pkg>/${VERSION}/json");
#   case "$c" in 200) exit 0 ;; 404) exit 1 ;; *) exit 2 ;; esac
# An unreachable git remote, or a registry check that cannot tell, fails closed;
# RELEASE_ALLOW_OFFLINE=1 is the escape hatch for both.
refuse_if_published() {
  local remote="$1" tag="$2" version="$3" listing
  if ! listing="$(git ls-remote --tags "$remote" "refs/tags/${tag}" 2>/dev/null)"; then
    if [[ "${RELEASE_ALLOW_OFFLINE:-}" == "1" ]]; then
      echo "Warning: could not reach ${remote}; RELEASE_ALLOW_OFFLINE=1, not checking remote tags" >&2
    else
      echo "Error: could not list tags on ${remote} (set RELEASE_ALLOW_OFFLINE=1 to skip)" >&2
      return 1
    fi
  elif [[ -n "$listing" ]]; then
    echo "Error: tag ${tag} already exists on ${remote}" >&2
    return 1
  fi
  if [[ -n "${RELEASE_PUBLISHED_CHECK:-}" ]]; then
    local check_rc=0
    VERSION="$version" bash -c "$RELEASE_PUBLISHED_CHECK" >/dev/null 2>&1 || check_rc=$?
    case "$check_rc" in
      0)
        echo "Error: version ${version} is already published (RELEASE_PUBLISHED_CHECK)" >&2
        return 1
        ;;
      1) ;;
      *)
        if [[ "${RELEASE_ALLOW_OFFLINE:-}" == "1" ]]; then
          echo "Warning: RELEASE_PUBLISHED_CHECK could not tell (exit ${check_rc}); RELEASE_ALLOW_OFFLINE=1, proceeding" >&2
        else
          echo "Error: RELEASE_PUBLISHED_CHECK could not tell whether ${version} is published (exit ${check_rc}); set RELEASE_ALLOW_OFFLINE=1 to proceed anyway" >&2
          return 1
        fi
        ;;
    esac
  fi
}

if [[ "${1:-}" == "--self-test" ]]; then
  _RELEASE_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  rc=0; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  _rot_case() { # <label> <input> <expected>
    printf '%s\n' "$2" > "$tmp/in.md"
    local got; got="$(rotate_changelog "$tmp/in.md" 0.3.0 2026-09-05)"
    if [[ "$got" == "$3" ]]; then
      echo "SELF-TEST OK: $1"
    else
      echo "SELF-TEST FAILED: $1" >&2
      echo "--- got ---"    >&2; printf '%s\n' "$got" >&2
      echo "--- wanted ---" >&2; printf '%s\n' "$3"   >&2
      rc=1
    fi
  }

  # The regression: the divider under Unreleased must NOT follow the heading into
  # the released section.
  _rot_case "a divider under Unreleased stays with Unreleased" \
'## [Unreleased]

---

### Added
- new thing

## [0.2.0] — 2026-08-29' \
'## [Unreleased]

---

## [0.3.0] — 2026-09-05

### Added
- new thing

## [0.2.0] — 2026-08-29'

  _rot_case "no divider under Unreleased still rotates cleanly" \
'## [Unreleased]

### Added
- new thing

## [0.2.0] — 2026-08-29' \
'## [Unreleased]

---

## [0.3.0] — 2026-09-05

### Added
- new thing

## [0.2.0] — 2026-08-29'

  # Only the FIRST Unreleased heading is rotated; a later literal one is content.
  _rot_case "only the first Unreleased heading is rotated" \
'## [Unreleased]

- a

## [Unreleased]

- b' \
'## [Unreleased]

---

## [0.3.0] — 2026-09-05

- a

## [Unreleased]

- b'

  # refuse_if_published: a tag on the remote, a registry hit, and an unreachable
  # remote all refuse; a clean remote passes.
  git init -q --bare "$tmp/origin.git"
  git -C "$tmp" init -q work && git -C "$tmp/work" -c user.email=t@t -c user.name=t commit -q --allow-empty -m x
  git -C "$tmp/work" tag v9.9.9 && git -C "$tmp/work" push -q "$tmp/origin.git" v9.9.9
  _pub_case() { # <label> <want-rc> <remote> <tag> [check]
    local got=0
    RELEASE_PUBLISHED_CHECK="${5:-}" refuse_if_published "$3" "$4" x 2>/dev/null || got=1
    if [[ "$got" == "$2" ]]; then echo "SELF-TEST OK: $1"; else echo "SELF-TEST FAILED: $1" >&2; rc=1; fi
  }
  _pub_case "tag already on the remote refuses" 1 "$tmp/origin.git" v9.9.9
  _pub_case "new tag on a clean remote passes" 0 "$tmp/origin.git" v1.0.0
  _pub_case "registry check reporting published refuses" 1 "$tmp/origin.git" v1.0.0 true
  _pub_case "registry check reporting absent passes" 0 "$tmp/origin.git" v1.0.0 "exit 1"
  _pub_case "registry check that could not tell refuses" 1 "$tmp/origin.git" v1.0.0 "exit 2"
  _pub_case "registry check dying on a network error refuses" 1 "$tmp/origin.git" v1.0.0 "curl -sf --max-time 1 http://127.0.0.1:1/nope"
  _pub_case "unreachable remote fails closed" 1 "$tmp/nope.git" v1.0.0

  # confirm_release_notes: empty fails even with the flag; the flag accepts; no TTY
  # and no flag fails closed (stdin is /dev/null here, so there is no TTY).
  _conf_case() { # <label> <want-rc> <notes> <assume_yes>
    local got=0
    confirm_release_notes "$3" "$4" </dev/null 2>/dev/null || got=1
    if [[ "$got" == "$2" ]]; then echo "SELF-TEST OK: $1"; else echo "SELF-TEST FAILED: $1" >&2; rc=1; fi
  }
  _conf_case "approval via the non-interactive flag proceeds" 0 "- a thing" 1
  _conf_case "no TTY and no flag fails closed" 1 "- a thing" 0
  _conf_case "empty notes fail closed even with the flag" 1 "  " 1
  _conf_case "empty notes fail closed without the flag" 1 "" 0

  # The interactive prompt, driven from a pipe via the test-only TTY override.
  _prompt_case() { # <label> <want-rc> <stdin-text or EOF>
    local got=0
    if [[ "$3" == "EOF" ]]; then
      _RELEASE_FORCE_TTY=1 confirm_release_notes "- a thing" 0 </dev/null 2>/dev/null || got=1
    else
      printf '%s\n' "$3" | _RELEASE_FORCE_TTY=1 confirm_release_notes "- a thing" 0 2>/dev/null || got=1
    fi
    if [[ "$got" == "$2" ]]; then echo "SELF-TEST OK: $1"; else echo "SELF-TEST FAILED: $1" >&2; rc=1; fi
  }
  _prompt_case "an empty reply (Enter) accepts" 0 ""
  _prompt_case "a non-empty reply aborts" 1 "n"
  _prompt_case "EOF at the prompt aborts" 1 EOF

  # bump_manifests: the root and every workspace package.json move to the
  # release version together; a nested "version" key, a package.json nested
  # deeper than the workspace globs (a fixture) and website/ stay as they were.
  bumpdir="$tmp/bumpcase"
  mkdir -p "$bumpdir/packages/a/test/fixture" "$bumpdir/apps/b" "$bumpdir/website"
  printf '{\n  "name": "root",\n  "version": "0.1.0",\n  "private": true\n}\n' > "$bumpdir/package.json"
  printf '{\n  "name": "@x/a",\n  "version": "0.1.0",\n  "nested": { "version": "9.9.9" }\n}\n' > "$bumpdir/packages/a/package.json"
  printf '{\n  "name": "@x/b",\n  "version": "0.1.0"\n}\n' > "$bumpdir/apps/b/package.json"
  printf '{\n  "name": "fixture",\n  "version": "0.0.1"\n}\n' > "$bumpdir/packages/a/test/fixture/package.json"
  printf '{\n  "name": "docs",\n  "version": "0.0.0"\n}\n' > "$bumpdir/website/package.json"
  git -C "$bumpdir" init -q && git -C "$bumpdir" add -A
  bump_rc=0
  (cd "$bumpdir" && bump_manifests 1.2.3 >/dev/null) || bump_rc=$?
  # One node call reads every field the case asserts, in a fixed order.
  got="$(cd "$bumpdir" && node -p '[
    "package.json", "packages/a/package.json", "apps/b/package.json",
    "packages/a/test/fixture/package.json", "website/package.json",
  ].map((f) => require("./" + f).version).join(" ") + " " + require("./packages/a/package.json").nested.version')"
  # $(tail -c 1) is empty exactly when the file still ends in a newline.
  if [[ "$bump_rc" -eq 0 && "$got" == "1.2.3 1.2.3 1.2.3 0.0.1 0.0.0 9.9.9" ]] \
     && [[ -z "$(tail -c 1 "$bumpdir/package.json")" ]]; then
    echo "SELF-TEST OK: the root and workspace manifests are bumped together, and nothing else is"
  else
    echo "SELF-TEST FAILED: bump_manifests (rc=$bump_rc) left versions '$got' (wanted '1.2.3 1.2.3 1.2.3 0.0.1 0.0.0 9.9.9')" >&2; rc=1
  fi
  emptydir="$tmp/bump-empty"; mkdir -p "$emptydir"; git -C "$emptydir" init -q
  if (cd "$emptydir" && bump_manifests 1.2.3 >/dev/null 2>&1); then
    echo "SELF-TEST FAILED: bump_manifests passed with no manifest to bump" >&2; rc=1
  else
    echo "SELF-TEST OK: a release with no manifest to bump fails instead of bumping nothing"
  fi

  # abort_release_branch: reset, return to the default branch, delete the branch.
  git -C "$tmp/work" -c user.email=t@t -c user.name=t checkout -q -b main 2>/dev/null || git -C "$tmp/work" checkout -q main 2>/dev/null || true
  base="$(git -C "$tmp/work" rev-parse --abbrev-ref HEAD)"
  git -C "$tmp/work" checkout -q -b chore/release-0.0.1
  echo dirty > "$tmp/work/f.txt"; git -C "$tmp/work" add f.txt; echo more >> "$tmp/work/f.txt"
  (cd "$tmp/work" && abort_release_branch chore/release-0.0.1 "$base")
  if [[ "$(git -C "$tmp/work" rev-parse --abbrev-ref HEAD)" == "$base" ]] \
     && ! git -C "$tmp/work" rev-parse -q --verify chore/release-0.0.1 >/dev/null \
     && [[ -z "$(git -C "$tmp/work" status --porcelain)" ]]; then
    echo "SELF-TEST OK: abort resets the tree, returns to $base, and deletes the release branch"
  else
    echo "SELF-TEST FAILED: abort left a release branch or a dirty tree" >&2; rc=1
  fi

  # The real EXIT-trap path: drive this script end to end in a scratch repo whose
  # CHANGELOG has no [Unreleased] section. It must fail AFTER `git checkout -b`
  # and leave a clean tree on the default branch with no release branch behind.
  trapdir="$tmp/trapcase"; mkdir -p "$trapdir"
  git init -q --bare "$trapdir/origin.git"
  git clone -q "$trapdir/origin.git" "$trapdir/repo" 2>/dev/null
  (
    cd "$trapdir/repo"
    git checkout -q -b main
    printf '# Changelog\n\n## [0.1.0] — 2026-01-01\n' > CHANGELOG.md
    git add CHANGELOG.md
    git -c user.email=t@t -c user.name=t commit -q -m init
    git push -q origin main 2>/dev/null
  )
  # An untracked file a release run could have written before failing.
  # Plus an unrelated untracked draft, which the abort must leave alone.
  mkdir -p "$trapdir/repo/docs/releases"; echo stale > "$trapdir/repo/docs/releases/v9.9.9.md"
  echo draft > "$trapdir/repo/docs/releases/draft-notes.md"
  trap_rc=0
  trap_out="$(cd "$trapdir/repo" && bash "$_RELEASE_SELF" --yes 9.9.9 2>&1)" || trap_rc=$?
  # The "Aborted" line pins the failure to after `git checkout -b`, so this cannot
  # pass by failing earlier (bad semver, dirty tree, tag check).
  if [[ "$trap_rc" -ne 0 ]] \
     && grep -qF "Aborted: release branch chore/release-9.9.9 removed" <<<"$trap_out" \
     && [[ ! -e "$trapdir/repo/docs/releases/v9.9.9.md" ]] \
     && [[ "$(git -C "$trapdir/repo" rev-parse --abbrev-ref HEAD)" == "main" ]] \
     && ! git -C "$trapdir/repo" rev-parse -q --verify chore/release-9.9.9 >/dev/null \
     && [[ -f "$trapdir/repo/docs/releases/draft-notes.md" ]] \
     && [[ "$(git -C "$trapdir/repo" status --porcelain)" == "?? docs/" ]]; then
    echo "SELF-TEST OK: a failure before the notes gate removes the release branch and leaves a clean default branch"
  else
    echo "SELF-TEST FAILED: failure before the gate (rc=$trap_rc) left a release branch or a dirty tree" >&2; rc=1
  fi

  [[ $rc -eq 0 ]] && echo "release: self-test passed."
  exit $rc
fi

ASSUME_YES="${RELEASE_ASSUME_YES:-0}"
VERSION=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -*) echo "Error: unknown option '$arg'" >&2; exit 1 ;;
    *) if [[ -n "$VERSION" ]]; then echo "Error: more than one version given" >&2; exit 1; fi
       VERSION="$arg" ;;
  esac
done
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 [-y|--yes] <version>  (e.g. 1.0.0 or 1.0.0-rc.1)" >&2
  exit 1
fi

TAG="v${VERSION}"
TODAY=$(date +%Y-%m-%d)

# Validate semver
if ! grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$' <<<"$VERSION"; then
  echo "Error: '$VERSION' is not valid semver (e.g. 1.2.3 or 1.2.3-rc.1)" >&2
  exit 1
fi

# Clean working tree required
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean" >&2
  exit 1
fi

# Check tag doesn't already exist.
#
# A here-string, not `git tag | grep -q`: under `set -o pipefail` grep -q exits
# at its first match and SIGPIPEs git, the pipeline reports 141, and an EXISTING
# tag reads as absent — so the release proceeds against a tag it must refuse.
# It is a race on how much git flushed, so it passes every small local run and
# fails once, on a repo with enough tags. See scripts/check-sigpipe-readers.sh.
if grep -qxF "$TAG" <<<"$(git tag)"; then
  echo "Error: tag $TAG already exists" >&2
  exit 1
fi
refuse_if_published "${RELEASE_REMOTE:-origin}" "$TAG" "$VERSION" || exit 1

# ─── Version-bearing files ───────────────────────────────────────────────────
#
# The root package.json and every pnpm workspace package's package.json: found
# by release_manifests and bumped by bump_manifests (both defined above), right
# after the CHANGELOG rotation below.
#
# A HAND-KEPT LIST IS THE THING THAT ROTS. It covers the files someone
# remembered; a manifest added later, by someone who was not thinking about
# releases, is stamped with whatever version it was born with and nothing says
# otherwise. Upstream that was a Helm `Chart.yaml`, and because its `appVersion`
# doubles as the chart's default image tag, the published chart pointed at an
# image that had never been built. That is why the manifests are derived from
# the workspace globs rather than listed, and `scripts/check-version-lockstep.py`
# is the backstop: it fails a PR the moment one manifest disagrees with the
# others, so drift surfaces while someone is still editing rather than after an
# artifact is public.
#
# A file that DERIVES something from its version (an image tag, a docs banner)
# carries a second version, not a copy — bump it next to bump_manifests below,
# and teach the lockstep gate to read it.
# ─────────────────────────────────────────────────────────────────────────────

# Create release branch from latest main
BASE_BRANCH=main
git checkout "$BASE_BRANCH"
git pull origin "$BASE_BRANCH"
RELEASE_BRANCH="chore/release-${VERSION}"
git checkout -b "$RELEASE_BRANCH"

# From here until the release commit, ANY nonzero exit (an explicit `exit 1`, a
# `set -e` failure, Ctrl-C at the notes prompt) removes the release branch and its
# half-edited tree, instead of leaving them behind. A trap rather than a call at
# each exit point, so a failure added later is covered without anyone remembering.
# It is disarmed once the commit exists: a push/PR failure after that must not
# destroy a committed release branch.
_cleanup_release_branch() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    abort_release_branch "$RELEASE_BRANCH" "$BASE_BRANCH" "docs/releases/${TAG}.md" \
      && echo "Aborted: release branch $RELEASE_BRANCH removed, back on $BASE_BRANCH." >&2
  fi
  exit "$status"
}
trap _cleanup_release_branch EXIT

# Assemble changelog fragments
if [ -d changelog.d ]; then
  scripts/assemble-changelog.sh || { echo "Error: changelog assembly failed" >&2; exit 1; }
fi

# Rotate CHANGELOG: rename [Unreleased] -> [vVERSION] and prepend fresh [Unreleased]
if ! grep -q "## \[Unreleased\]" CHANGELOG.md; then
  echo "Error: CHANGELOG.md has no [Unreleased] section" >&2
  exit 1
fi

TMP=$(mktemp)
rotate_changelog CHANGELOG.md "$VERSION" "$TODAY" > "$TMP" && mv "$TMP" CHANGELOG.md

if ! grep -q "^## \[${VERSION}\] — ${TODAY}$" CHANGELOG.md; then
  echo "Error: CHANGELOG rotation did not produce a [${VERSION}] section" >&2
  exit 1
fi

echo "Updated CHANGELOG.md"

# Every version-bearing manifest, in lockstep (release_manifests, above). After
# the rotation so a CHANGELOG with no [Unreleased] section fails first; inside
# the EXIT trap, so an abort from here on resets these edits with the branch.
bump_manifests "$VERSION"

# Human confirmation of the notes, before anything is committed or pushed. Placed
# as soon as the rotated text exists so an abort has nothing to undo but this
# branch's working tree. Previewed via --stdout: docs/releases/ is not touched yet.
# release-notes.sh exits non-zero on an empty section; that is also a fail-closed.
# Its stderr is left visible so a real failure (missing CHANGELOG, no section) is not
# mistaken for "empty".
if ! PREVIEW="$(scripts/release-notes.sh "$VERSION" --stdout)"; then
  PREVIEW=""
fi
if ! confirm_release_notes "$PREVIEW" "$ASSUME_YES"; then
  exit 1  # the EXIT trap removes the release branch
fi

# Release notes, derived from the rotated CHANGELOG plus the commit range since
# the previous release tag. This step replaces a RELEASE_NOTES variable that was
# computed here and then never used — so every release shipped with whatever
# someone pasted into the release UI by hand, or with nothing.
scripts/release-notes.sh "$VERSION" >/dev/null
echo "Wrote docs/releases/${TAG}.md"

# Commit and push branch
git add -A
git commit -m "chore: release ${TAG}"
trap - EXIT  # committed: a push failure must not delete the release branch
git push -u origin "$RELEASE_BRANCH"

echo "Pushed branch $RELEASE_BRANCH"
echo ""
echo "Next steps (GitHub Flow — main is protected, so the release lands through a PR):"
echo "  1. Open a PR from $RELEASE_BRANCH -> main, wait for green checks, and merge it:"
echo "       gh pr create --base main --head $RELEASE_BRANCH --title \"chore: release ${TAG}\" --fill"
echo "       gh pr checks --watch"
echo "  2. Confirm the merged commit's own workflow runs on main are green:"
echo "       gh run list --branch main --limit 5"
echo "  3. Tag the merged commit on main and push the tag:"
echo "       git checkout main && git pull"
echo "       git tag $TAG && git push origin $TAG"
echo "  4. The tag push runs .github/workflows/release.yml: it refuses unless main's checks"
echo "     passed for the tagged commit, then publishes the GitHub Release from"
echo "     docs/releases/${TAG}.md. Watch it with:  gh run list --workflow release.yml --limit 1"
echo "     Without that workflow, publish by hand:"
echo "       gh release create $TAG --verify-tag --title $TAG --notes-file docs/releases/${TAG}.md"
