---
title: Your docs site — Astro Starlight on GitLab Pages
description: The docs site a clone inherits, how its CI proves every page rendered, and the failure modes to guard against.
---

**The big picture:** Blueprint's own docs (this site) are an Astro Starlight site built
in CI and published to GitLab Pages — and a clone keeps that setup. Use it as the starting
point for your project's docs, or delete it.

**Why it matters:** A green docs build doesn't prove the docs rendered. This page covers
the checks that make it trustworthy.

**What you get when you clone:**
- `website/` — the site source. Replace the content under `website/src/content/docs/`
  with your own.
- `website:build` — builds the site **and verifies every page actually rendered**.
- `pages` — publishes the already-built site on `main`.
- `ci/docs.yml` — checks every internal link, anchor, and image.

Don't want a docs site? Delete `website/` and the `website:build` and `pages` jobs in
`.gitlab-ci.yml`.

## Go deeper: why the build is two jobs

Build the site as an [Astro Starlight](https://starlight.astro.build/) content collection
in CI and publish it to GitLab Pages. Use two jobs, deliberately split:

- **`website:build`** runs `astro build` and then **verifies the output**, publishing
  `dist/` as an artifact.
- **`pages`** publishes that artifact. GitLab requires the job be named `pages` with
  output in `public/`. It does **not** rebuild — the site is already built once per
  pipeline, and a second build paid for a full re-render plus a multi-gigabyte image pull
  to reproduce bytes that already existed.

## `astro build` exits 0 with a page's entire body missing

This is the single most important thing to know about the docs pipeline. **A green build
is not proof the docs rendered.** Starlight's content loader catches a per-page render
error, logs it, drops that page's **whole body**, emits the `index.html` anyway, and the
build still succeeds. Upstream (TruePPM, a sibling project using this same pattern),
three pages shipped as bare navigation chrome — 99 characters of body where eleven
sections should have been — for 19 days of green pipelines.

So `website:build` should run a **post-build check** that asserts the rendered output
actually contains what it should and that the build log carries no error lines. That
check, not the exit code, is the verification.

If your site renders diagrams or other content through a headless browser at build time,
two consequences are worth copying:

- **Pin the browser version in every place it appears, exactly — no carets — and add a
  gate that asserts the pins agree.** A package only ever looks in the path matching its
  own revision, so a mismatch is a hard "executable doesn't exist", not a soft degrade.
- **A local build does not reproduce it.** A stale `node_modules` still holds the working
  version; only CI's clean install honors the drifted lockfile. Astro's content cache
  means even a deliberate repro needs the cache cleared first.

## Internal links, anchors, and assets — checked for you already

Unlike `website:build` / `pages` above, you don't need to add this one: `ci/docs.yml` is
included by default and `scripts/check-docs-internal-links.py` runs against
`website/src/content/docs` (and `make check-docs-links` runs the same check before a
push) the moment `website/astro.config.mjs` exists — which is to say, the moment you've
added a docs site in this recommended shape. Nothing to wire up.

It reads the Markdown source (not the built HTML, for the same reason the build-output
check above exists — a broken route or a renamed heading id has nothing to do with
whether `astro build` exits 0) and fails the job on a link to a page that doesn't
publish, a `#anchor` that doesn't match a heading, a relative image that isn't tracked in
the repository, or a `-/blob/main/…` link into a file this repository doesn't have. See
the script's own module docstring for what it checks, what it cannot see (anything a
component renders at runtime), and which of its assumptions are configurable via
`--docs-root` / `--config` / `--site` / `--repo-source` if your docs site doesn't use
this recommended shape.

## Saying which version a page describes

A docs page can describe an entirely unreleased feature in plain present tense, never
mention a version, and read to someone on the current release as a description of their
install. Tense rules cannot catch that — nothing can check "did the author choose the
right tense".

The workable answer is to make the author **declare** it: a front-matter key naming the
version the page documents, paired with a visible callout, both checked against the
roadmap. The check runs **in both directions** — a missing callout fails, and so does a
"ships in 0.X" banner on a page whose version has since shipped. That reverse direction
is the one a release actually produces.

Pages that declare nothing are covered by a **content hash baseline**: editing one breaks
its hash and fails the gate until you either declare a version or re-baseline. Be honest
about what that buys — re-baselining is one command and a rubber stamp gets today's
outcome. What it removes is the **silence**: before it, adding four paragraphs of
unreleased behavior produced no signal anywhere in the pipeline.

This particular gate is worth the ceremony for a versioned product with a roadmap of
shipped/underway/planned features. Blueprint's own docs site doesn't need it — a template
repository doesn't have "features that haven't shipped yet" in the same sense — so it
isn't wired in here. Add it if your project does have that shape.
