---
name: release
description: Create a release following GitHub Flow. Determines version from changelog, runs pre-flight checks with parallel sub-agents, executes release script, and guides through the release PR, the tag, and the GitHub Release that release.yml publishes.
disable-model-invocation: true
argument-hint: "[version]"
---

# Release

You are creating a release following GitHub Flow (the simple variant: feature branch →
pull request → `main`, then a `vX.Y.Z` tag on `main`). In this repository an MR is a
GitHub pull request (PR). Follow these steps exactly.

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
> - [ ] No open PRs targeting main that are marked as release-blocking (`gh pr list --base main --state open --label release-blocker 2>/dev/null`)
> - [ ] `CHANGELOG.md [Unreleased]` has entries (`grep -A 30 '\[Unreleased\]' CHANGELOG.md`)
> - [ ] `scripts/release.sh` exists and is executable
> - [ ] Every version-bearing manifest agrees (`python3 scripts/check-version-lockstep.py`)
> - [ ] Every credential the publish jobs need already exists (`gh secret list` and
>       `gh variable list`, plus `gh secret list --env <name>` for any `environment:`
>       a tag-triggered job names — a secret's value never prints, its existence does).
>       `release.yml` needs only the built-in `GITHUB_TOKEN` until a publish job is
>       added that needs more. A missing one fails **after** the tag is pushed, which is
>       the one moment in the release when nothing can be un-done cheaply.
> - [ ] **Inventory every tag-only job that changed since the last tag.** A tag push
>       runs the workflow files as they stood at the tagged commit, and these jobs run
>       nowhere else, so a job edited since the previous `v*` tag has never run in its
>       current form. Upstream, every cut across two minor lines found at least one such
>       defect by burning a version. Run `bash scripts/check-tag-only-jobs.sh` — it
>       inventories every tag-only job (in this repository, the jobs of
>       `.github/workflows/release.yml`, which triggers on `push: tags: ['v*']`) and
>       reports any that is new or changed since the last `v*` tag; exit 1 means at
>       least one. For each one it lists, either run a probe that exercises it without
>       a tag (a `workflow_dispatch` dry run, or a step gated so it also runs on a PR)
>       or report it as **unproven until the tag** — the script inventories, it does not
>       judge whether a flagged job was actually probed. A changed `environment:`,
>       `permissions:` (`id-token: write` for OIDC) or secret name also changes what the
>       registry sees: confirm the binding on the registry side, not only in the YAML.
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

1. Create a PR from the release branch → `main`, in the `/mr` skill's format:
   `gh pr create --base main --head chore/release-{version} --title "chore: release v{version}" --body "$(cat <<'EOF' … EOF)"`
2. Wait for its checks to pass (`gh pr checks <N>`)
3. Hand the PR URL to the user to merge. Agents never merge: `gh pr merge` is under
   `deny` in `.claude/settings.json`, and the user merges every PR by hand. Wait for
   them to confirm the merge before Step 5.

**If you poll the checks with a loop rather than a single check, write it as
`while true; do …; if [ "$s" = success ] || [ "$s" = failed ]; then break; fi; sleep N; done`,
never `until …; case $s in …esac; do sleep N; done`.** A `case` statement is the last command
of the loop body and returns 0 whether or not a branch matched, so an `until` gated on it exits
after the very first iteration — the loop "completes" immediately regardless of the checks'
real state, and a background watcher's "finished" notification then carries no information.
Read the checks' actual status after the loop returns; don't trust that it returned. Bound
the loop and run it in the background — foreground `sleep` is blocked in the agent harness.

## Step 4 — Promote to production (full variant only)

This repository uses the simple variant: `main` is the release branch and there is no
`production` branch, so skip this step.

If the project later adopts a protected `production` branch (see *When to adopt each
variant* in `CLAUDE.md`), promote by PR, never by a direct push: `gh pr create --base
production --head main`. The user merges it as a plain merge, never a rebase or squash.
Then tag on `production` in Step 5.

## Step 5 — Tag and release

**First: the commit's own checks on `main` must be green.** A tag push is not the branch
run happening again — workflows trigger per event, so the tag starts only the workflows
whose `on:` matches a tag (`release.yml`). `governance.yml`, `security.yml` and every
other `pull_request` / `push: branches: [main]` workflow *does not run* for it. Nothing
links the two, so a tag will publish from a commit whose `main` run failed, and the first
sign of it is a public artifact. Upstream shipped a broken release this way twice.

```bash
git checkout main && git pull
gh run list --branch main --event push --commit "$(git rev-parse HEAD)" \
  --json workflowName,status,conclusion
```

Confirm every run at **this exact commit** completed with `success` — not the newest run
on the branch, and not just one of the workflows. In CI this is enforced by the
`release-pipeline-gate` job of `release.yml` (`scripts/check-release-pipeline.sh`),
which every tag-triggered publish job must `needs:`. A job without that `needs:` starts
in parallel with the gate, so it publishes whether or not the gate passes.

Then tag the commit on `main` (on `production` instead, if the full variant is in
use):

```bash
git tag v{version}
git push origin v{version}
```

`scripts/release.sh` has already refused a version whose tag exists on the remote, or one
that `RELEASE_PUBLISHED_CHECK` reports as already published. Registries refuse to
overwrite a version, so that failure otherwise arrives only after the tag is pushed.
Every tag-triggered job that uploads files runs `sh scripts/ci-assert-artifacts.sh
<paths>` before the upload (the `artifact-assertions` CI job enforces the wiring),
because `actions/upload-artifact` defaults to `if-no-files-found: warn` and marks the
step successful when it uploaded nothing.

**The tag push publishes the release.** `release.yml` runs `release-pipeline-gate`, and
when it passes, creates the GitHub Release from `docs/releases/v{version}.md`, the notes
`scripts/release.sh` generated. Watch that run and then confirm the release exists:

```bash
gh run list --workflow release.yml --commit "$(git rev-parse HEAD)" \
  --json databaseId,status,conclusion
gh release view v{version}
```

If the gate passed and the publish job then failed for an infrastructure reason, re-run
just that job first (`gh run rerun <run-id> --failed`). Create the release by hand only
when that does not fix it, or when `release.yml` is not on the tagged commit at all:

```bash
gh release create v{version} --verify-tag --notes-file docs/releases/v{version}.md
```

`--verify-tag` makes `gh` refuse when the tag does not exist on the remote. Without it,
`gh release create` makes a new tag at the default branch's tip, which may not be the
commit you gated on. Add `--prerelease` for a `-rc.N` / `-beta.N` version. **Never
hand-create the release after `release-pipeline-gate` failed.** That bypasses the one
check that ties the tag to a green commit. If the tagged commit's checks were only slow,
re-run the workflow once they are green (`gh run rerun <run-id>`). If they failed, the
fix is a new commit, and so a new version.

Never hand-write the notes into the GitHub UI. Notes that are typed rather than derived
describe what someone remembered, and they drift from the tag they claim to describe.

## Step 6 — Post-release verification

- [ ] Tag exists on the correct commit (`git ls-remote --tags origin v{version}`)
- [ ] Release notes are accurate (`gh release view v{version}`)
- [ ] Anything deployed from `main` is serving the new version
- [ ] Documentation is deployed (if applicable): the `docs.yml` run for this commit on
      `main` succeeded and GitHub Pages shows the new version
- [ ] **A default install resolves to this release** — not merely "the publish job
      succeeded"

That last one is a different question from the one CI answers, and the
difference is where a release goes wrong quietly. Registries rank by semver, and a plain
`X.Y.Z` outranks every `X.Y.Z-rc.N` and `X.Y.Z-beta.N` **forever** — so one bad stable
artifact keeps winning against every pre-release published after it. Package managers
each have this shape in their own dialect (`latest` on npm, an unpinned `pip install`,
GitHub's "Latest release" badge).

So check what an unpinned consumer actually gets — `npm view <pkg> version`, an
unpinned `pip index versions <pkg>`, the release a fresh visitor downloads
(`gh api 'repos/{owner}/{repo}/releases/latest' --jq .tag_name`, which skips drafts and
pre-releases) — and check
that what it resolves to works: for a downloadable build, that every asset it links to
**exists** and runs. If the answer is a broken artifact, republishing under a new version does
not fix it; the bad version has to be deleted, which usually needs a permission no
CI job has. Say so in the release notes rather than leaving a consumer to discover it.
