---
name: release
description: Create a release following GitLab Flow. Determines version from changelog, runs pre-flight checks with parallel sub-agents, executes release script, and guides through MR/tag/deploy.
disable-model-invocation: true
argument-hint: "[version]"
---

# Release

You are creating a release following GitLab Flow. Follow these steps exactly.

## Step 0 — Get the version string

If not provided in `$ARGUMENTS`, determine it:

1. Read `CHANGELOG.md [Unreleased]` and the git log since the last tag
2. Apply these rules:
   - **PATCH** — only `### Fixed` entries → e.g. `0.1.1`
   - **MINOR** — any `### Added` entries → e.g. `0.2.0`
   - **MAJOR** — any breaking change → e.g. `1.0.0`
   - **Pre-release** — keep the same base version, increment suffix → e.g. `0.2.0-rc.1`
3. Present the suggestion and ask the user to confirm

### Manifests already bumped by a prep commit

Check this **before** computing anything:

```bash
python3 scripts/check-version-lockstep.py
git log --oneline -15
```

Version manifests are sometimes bumped ahead of the tag by a deliberate prep commit
("bump version to X.Y.Z", explicitly noting that no tag is cut there). If the manifests
already read the version you intend to tag, **do not derive a bump from them** — a bump
computed off the current version bumps again (`beta` against an already-`1.0.0-beta.1`
tree yields `beta.2`), silently skipping the tag that was actually wanted. Pass the
explicit version instead. Bumping a manifest that already matches is a safe no-op, so
the release still performs the changelog assembly, commit, and tag around it.

## Step 1 — Pre-flight checks (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Release readiness:**
> Check the following and report pass/fail for each:
> - [ ] Working tree is clean (`git status --porcelain`)
> - [ ] On `main` branch with latest pulled (`git branch --show-current`, `git fetch origin`, `git diff main..origin/main`)
> - [ ] No open MRs targeting main that are marked as release-blocking (`glab mr list --target-branch main --label release-blocker 2>/dev/null`)
> - [ ] `CHANGELOG.md [Unreleased]` has entries (`grep -A 30 '\[Unreleased\]' CHANGELOG.md`)
> - [ ] `scripts/release.sh` exists and is executable
> - [ ] Every version-bearing manifest agrees (`python3 scripts/check-version-lockstep.py`)
> - [ ] Every credential the publish jobs need already exists (`glab variable list`, or the
>       forge's secrets page — a masked value will not print, its existence will). A
>       missing one fails **after** the tag is pushed, which is the one moment in the
>       release when nothing can be un-done cheaply.
> - [ ] **Inventory every tag-only job that changed since the last tag.** A tag pipeline
>       runs the CI config as it stood at the tag commit, and these jobs run nowhere else,
>       so a job edited since the previous `v*` tag has never run in its current form.
>       Upstream, every cut across two minor lines found at least one such defect by
>       burning a version. Run `bash scripts/check-tag-only-jobs.sh` — it inventories
>       every job whose rules match `$CI_COMMIT_TAG` (or `only: tags`) and reports any
>       whose block text is new or changed since the last `v*` tag; exit 1 means at
>       least one. For each one it lists, either run a probe that exercises it without
>       a tag (a manual job, or a variable-gated dry run in an MR pipeline) or report it
>       as **unproven until the tag** — the script inventories, it does not judge
>       whether a flagged job was actually probed. A changed `environment:`, `id_tokens:`
>       or credential name also changes what the registry sees: confirm the binding on
>       the registry side, not only in the YAML.
> - [ ] **Days and commits since the last `v*` tag.** If about four weeks, or several
>       hundred non-merge commits, have passed without a tag, say so. A cut that large
>       carries untested publish changes *and* a large change surface at once.
>       Informational: it does not block the cut, it sets expectations.

**Sub-agent 2 — Documentation audit:**
> For every entry in `CHANGELOG.md [Unreleased]`, verify documentation is in sync:
> - New features (### Added) have corresponding doc pages with version callouts
> - Changed behavior (### Changed) is reflected in existing doc pages
> - Breaking changes have migration/upgrade notes
>
> Return a list of any documentation gaps found.

If any pre-flight check fails, **stop and report** what needs to be fixed. Name the
unproven tag-only jobs from the inventory in the summary, whether or not anything failed.
In Step 5, watch those jobs first and warn the user that a re-cut is possible.

## Step 2 — Confirm the release notes, then run the release script

**First, show the user the notes and wait for explicit approval.** The notes are
assembled mechanically, so a stale bullet, a fragment under the wrong heading, or an
empty `[Unreleased]` would otherwise ship unreviewed. Render them without touching
anything: print the fragments in `changelog.d/` (they become the `[Unreleased]` body),
or read `CHANGELOG.md [Unreleased]`, and paste that text into the chat. If there are no
entries, stop — the script fails closed on empty notes. Ask the user to approve, and do
not run the script until they say so.

Then run it with `--yes`:

```bash
./scripts/release.sh --yes {version}
```

You have no TTY for the script's own Enter-to-accept prompt, so `--yes` (or
`RELEASE_ASSUME_YES=1`) stands in for it. It is valid only because the user approved the
text in chat just now; never pass it to skip the review. Without it, a non-TTY run fails
closed. If the user rejects the notes, fix the fragments first. When a human runs the
script directly, it shows the notes itself and aborts, deleting the release branch,
on anything but Enter. Any other failure before the release commit (changelog assembly,
a missing `[Unreleased]` section) removes the release branch the same way.

The script creates a `chore/release-{version}` branch, assembles changelog fragments, rotates
`[Unreleased]`, **generates `docs/releases/v{version}.md`**, and pushes the branch.

### What the release notes contain, and why both halves

`scripts/release-notes.sh` emits two sections, and neither is sufficient alone:

- **What is included** — the version's own CHANGELOG section, verbatim. The curated,
  human-authored part: what the fragments said.
- **Changes since `v{previous}`** — every non-merge commit in the range, mechanically.
  This is what catches anything that shipped **without** a fragment, which is precisely
  what a curated list cannot tell you about itself.

A commit in the second list with no counterpart in the first is a missing changelog
fragment. That is the signal — do not delete the line, add the fragment and regenerate.

Only `vMAJOR.MINOR.PATCH` tags count as previous releases. A tag that is not semver was
not produced by this process, so it is **reported but not treated as a predecessor** —
"there is no previous release" and "there is an older tag that was never a release" are
different facts, and the second one is the one a reader needs.

## Step 3 — Merge to main

1. Create an MR from the release branch → `main`
2. Wait for the pipeline to pass
3. Merge the MR

**If you poll the pipeline with a loop rather than a single check, write it as
`while true; do …; if [ "$s" = success ] || [ "$s" = failed ]; then break; fi; sleep N; done`,
never `until …; case $s in …esac; do sleep N; done`.** A `case` statement is the last command
of the loop body and returns 0 whether or not a branch matched, so an `until` gated on it exits
after the very first iteration — the loop "completes" immediately regardless of the pipeline's
real state, and a background watcher's "finished" notification then carries no information.
Read the pipeline's actual status after the loop returns; don't trust that it returned.

## Step 4 — Promote to production (GitLab Flow)

If the project uses a `production` branch:

```bash
git checkout production
git pull origin production
git merge main
git push origin production
```

If the project uses a single-branch model (no `production` branch), skip this step.

## Step 5 — Tag and release

**First: the commit's own branch pipeline must be green.** A tag pipeline is not the
branch pipeline running again — pipelines are triggered per ref, so the tag starts an
independent pipeline in which every job whose rule matches a branch or a merge request
*does not exist*. Nothing links the two, so a tag will publish from a commit whose branch
pipeline failed, and the first sign of it is a public artifact. Upstream shipped a broken
release this way twice.

```bash
glab ci list --ref main --per-page 5      # or --ref production, per the variant in use
```

Confirm the pipeline at **this exact commit** succeeded — not the newest one on the
branch. In CI this is enforced by `release-pipeline-gate`
(`scripts/check-release-pipeline.sh`), which every tag-triggered publish or deploy job
must `needs:`; a job with no `needs:` waits only for earlier stages, which is a weaker
promise than it looks.

Then tag the commit on the deployment branch (`production` if it exists, otherwise
`main`):

```bash
git tag v{version}
git push origin v{version}
```

`scripts/release.sh` has already refused a version whose tag exists on the remote, or one
that `RELEASE_PUBLISHED_CHECK` reports as already published. Registries refuse to
overwrite a version, so that failure otherwise arrives only after the tag is pushed.
Every tag-triggered job that declares `artifacts:paths` ends with
`sh scripts/ci-assert-artifacts.sh <paths>` (the `artifact-assertions` CI job enforces
the wiring), because GitLab marks a job successful when its upload found nothing.

Create the release from the tag, using the generated notes:

```bash
glab release create v{version} --notes-file docs/releases/v{version}.md
```

Never hand-write the notes into the forge UI. Notes that are typed rather than derived
describe what someone remembered, and they drift from the tag they claim to describe.

## Step 6 — Post-release verification

- [ ] Tag exists on the correct commit
- [ ] Release notes are accurate
- [ ] Staging and production are running the new version
- [ ] Documentation is deployed (if applicable)
- [ ] **A default install resolves to this release** — not merely "the publish job
      succeeded"

That last one is a different question from the one the pipeline answers, and the
difference is where a release goes wrong quietly. Registries rank by semver, and a plain
`X.Y.Z` outranks every `X.Y.Z-rc.N` and `X.Y.Z-beta.N` **forever** — so one bad stable
artifact keeps winning against every pre-release published after it, and on Helm even
`--devel` will not reach past it. Package managers have the same shape in their own
dialect (`latest` on npm, an unpinned `pip install`, a mutable container tag).

So check what an unpinned consumer actually gets — `helm show chart oci://…` with no
`--version`, `npm view <pkg> version`, `docker pull <image>` with no tag — and check that
what it resolves to works: for a chart, that the image tag it defaults to **exists** in
the registry. If the answer is a broken artifact, republishing under a new version does
not fix it; the bad version has to be deleted, which usually needs a permission no
pipeline has. Say so in the release notes rather than leaving a consumer to discover it.
