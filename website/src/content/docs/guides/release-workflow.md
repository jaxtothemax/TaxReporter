---
title: Release workflow
description: The pre-release audit, cutting a release, and the two supported branching models.
---

**The big picture:** A release is three moves: audit everything since the last tag
(`/pre-release`), cut a release branch with the changelog assembled and versions bumped
(`/release`), then merge it and tag by hand.

**Why it matters:** Release day is when mistakes become public and permanent. A
whole-release audit catches what per-branch reviews can't see, and a scripted cut runs
the same checks every time.

**How it works:**
1. `/pre-release full` at feature freeze; fix the blockers; run it once more before
   tagging.
2. `/release` opens a `chore/release-X.Y.Z` branch and MR.
3. After it merges and its pipeline is green: `git tag`, push the tag, `glab release
   create`.

## Pre-release audit

Before cutting a release, run a cross-cutting audit of the codebase:

```
/pre-release full           # run all audits (security, perf, regression, docs)
/pre-release security       # security only
/pre-release performance    # performance only
```

This catches issues that day-to-day feature agents miss because they are domain-scoped.
The pre-release audit applies a "what becomes a public commitment?" lens across the
full codebase.

**This is a one-time gate, not an iterative loop.** Run once at feature freeze,
triage findings, fix blockers, then run once more as a final check.

## Cutting the release

```
/release [version]
```

The `/release` command handles the full flow:

1. **Determine version** — reads `CHANGELOG.md [Unreleased]` and suggests semver
   (patch for fixes only, minor for added features, major for breaking changes)
2. **Pre-flight** — parallel checks: clean working tree, changelog entries exist,
   documentation covers all new features, and an inventory of the tag-only CI jobs
   that changed since the last tag (`scripts/check-tag-only-jobs.sh`, wired into
   `tooling-self-tests` — see [Harness gates](/reference/harness-gates/)). Those jobs
   run for the first time at the tag, so each is either probed beforehand or reported
   as unproven.
3. **Run `scripts/release.sh`** — before committing anything it shows the extracted
   release notes and waits for approval (Enter accepts, anything else aborts and
   deletes the release branch). Any other failure before the release commit (changelog
   assembly, a missing `[Unreleased]` section) removes the release branch the same way.
   Empty notes fail closed. `/release` shows you the notes
   in chat first, then passes `--yes` (or `RELEASE_ASSUME_YES=1`) to stand in for the
   prompt; a run with no TTY and no flag fails closed. The script also refuses a
   version whose tag already exists on the remote, or that `RELEASE_PUBLISHED_CHECK` (an optional command you set, such as a
   `curl` against your registry) reports as already published. That command exits 0 for
   "published", 1 for "not published", and anything else for "could not tell". An
   unreachable remote, or a check that could not tell, fails closed unless
   `RELEASE_ALLOW_OFFLINE=1`. The comment above `refuse_if_published` in the script
   has a copy-paste example. It then assembles changelog fragments into `CHANGELOG.md`,
   bumps version in all version-bearing files, creates a `chore/release-{version}`
   branch with a `chore: release vX.Y.Z` commit
4. **MR → merge → tag by hand.** The release goes through a branch and MR like
   every other change. After it merges:

   ```
   glab ci list --ref main --per-page 5   # confirm the merged commit's own pipeline is green
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   glab release create vX.Y.Z --notes-file docs/releases/vX.Y.Z.md
   ```

   **Why by hand:** see [Why tagging is manual](#why-tagging-is-manual) below.

`git tag` requires push access to the repository (or a protected-tag exception),
which any Maintainer running the release already has — no separate credential.

## GitLab Flow

The template supports two branching models. Choose one during setup and document it
in `CLAUDE.md`:

- **Simple (tag on main):** `feature branch → MR → main → tag`. Best for projects
  that deploy continuously or don't have a staging/production split.
- **Full (with production branch):** `feature branch → MR → main (staging) →
  merge to production → tag`. Best for projects with a formal release train. Tag
  on `production` instead of `main` if you use this variant.

## Why tagging is manual

**The short answer:** it's two commands, and the automated version silently never ran.

**Between the lines:**
- An earlier version of this template had CI jobs that tagged and published once a
  `chore: release vX.Y.Z` commit reached `main`. They matched the commit message against
  `/^chore: release v/`.
- GitLab's rule regexes treat `^` as the start of the **whole message**, not of a line.
  A real merge commit starts with `Merge branch '…' into 'main'` and puts the MR title on
  line two — so the rule never matched. On the v0.5.0 cut the job simply didn't run.
- It also needed a masked, protected `RELEASE_TOKEN` variable: one more secret to set up
  and keep valid.
- The jobs were retired in #56. Tagging by hand matches the `release` skill's own Step 5,
  and how the sibling project TruePPM releases.
