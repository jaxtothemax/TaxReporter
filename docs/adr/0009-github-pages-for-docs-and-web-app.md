# 9. Publish the docs and the web app on one GitHub Pages site

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.

## Context

The project is GitHub-native and has no backend (ADR 0002). A static web app and the Starlight
documentation site (`website/`) both need hosting. GitHub Pages serves one site per
repository, at `https://<owner>.github.io/<repo>/` for project sites.

## Decision

- **One site.** The documentation site is served at the Pages root and the web app under
  `/app/`. `.github/workflows/docs.yml` builds both into a single Pages artifact and deploys
  it from `main` only.
- **Base paths come from the build.** They come from `actions/configure-pages` at build time,
  never from a hardcoded repository name.
- **The CLI comes later.** It will be published to npm once v0.1 is usable. Until then it runs
  from a clone.

## Consequences

- **Free hosting** with no new infrastructure. Every deploy is tied to a reviewed commit on
  `main`.
- **Docs and app release together.** An app hotfix also ships whatever docs are on `main`.
  That is acceptable while both live in one repository.
- **Repository renames are free.** The app's base path is configurable, so renaming the
  repository or adding a custom domain changes no code.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
