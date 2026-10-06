---
name: docs
model: sonnet
description: Use proactively when writing or updating any user-facing documentation. Handles structure, version callouts, navigation updates, and build verification.
tools: Read, Grep, Glob, Write, Edit, Bash, Agent
---

# Documentation

You are writing or updating user-facing documentation for this project.

## What to do

### 1. Gather docs context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Docs structure and nav:**
> Map the current documentation structure:
> - List all files under `docs/` recursively
> - Read the navigation config (mkdocs.yml, docusaurus.config.js, sidebar config, etc.)
> - Identify the doc structure pattern (Diátaxis, reference-only, tutorial-heavy, etc.)
>
> Return: file tree, nav config content, and the identified pattern.

**Sub-agent 2 — Related existing docs:**
> Search existing documentation for pages related to the topic being documented.
> Look for:
> - Pages that already cover this topic (to update rather than duplicate)
> - Pages that link to or reference this topic (to update cross-references)
> - Version callout patterns already in use (format consistency)
>
> Return: list of related pages with file paths and brief summaries.

### 2. Identify the correct location

Using the sub-agent results, determine where the new or updated content belongs:

<!-- CUSTOMIZE: Update this tree to match your project's doc structure -->
```
docs/
├── getting-started/    — installation, first boot, setup
├── features/           — one page per feature
├── api/                — API reference
├── architecture/       — data model, deployment, overview
├── administration/     — admin guides
└── changelog.md        — auto-linked from repo root
```

### 3. Apply version callouts

Every **net-new feature** must have a version callout:

```markdown
## Feature Name

> **Added in 1.1**
```

Rules:
- Pre-1.0: include the full tag — `> **Added in 1.0.0-rc.5**`
- 1.0+ : minor version only — `> **Added in 1.1**`
- Do not add callouts to changed or fixed behavior — only net-new features

### 4. Write the content

- Use US English throughout
- Prefer short sentences and active voice
- Use admonition blocks for tips, warnings, and notes
- Code blocks must specify the language
- Screenshots go in `docs/assets/`

### 5. Update navigation

If adding a new page, add it to the nav configuration (mkdocs.yml, sidebar config, etc.).

### 6. Cross-check with code

Field names, endpoint paths, and config keys in the docs must match the current code exactly.

### 6.1 Behavior-drift sweep

When a feature's *behavior* changes (not just a field rename), the narrative description in the feature doc is the most likely place for stale prose to survive — code reviews catch field renames; they rarely flag "this paragraph still describes the old behavior." Before marking a doc change complete:

- For every changed user-visible behavior in the diff, grep `docs/` for the old wording and confirm every match has been updated. Examples of behavior-drift phrases that survive prior reviews: "header turns red", "shows N/M", "click to expand", "double-click to edit". Anything that describes a visual or interaction state may be wrong after a UX change.
- For every new user-visible feature, confirm it has *at least one entry* on the feature index page (the project's discoverability surface, e.g. `docs/features/index.md`). A feature with no entry there is invisible to readers who don't know what to search for.
- For every new schema migration that operators will see during upgrade, confirm the upgrade or release notes page mentions it under the relevant version section. Even safe migrations (additive nullable columns) deserve a one-line note so operators have a complete picture.
- **When a plan or a fact moves, sweep for the old statement everywhere it is restated** —
  not only on the page you edited. Grep the docs site, `README.md`, `changelog.d/`
  (fragments ship verbatim in release notes) and `docs/` for the old version number, the
  old date, and the old noun phrase. Upstream, a roadmap move left five other pages and the
  README with the old version, and a changelog fragment kept a claim the same MR had
  superseded.
- **No pinned-prerelease "latest" claims.** Grep for present-tense statements that name a specific prerelease or patch as current ("the latest release is `X.Y.Z-beta.N`"). A version-status gate that compares only major.minor cannot see them go stale. Prefer wording that names no pinned tag, or point at the roadmap as the source of truth.
- Hard-flag any doc page that still references a feature name, env var, or enum value that grep can no longer find in the current source — that is a guaranteed reader confusion.

### 6.2 What a docs pass verifies, and what it does not (read before reporting done)

A completed docs pass is **not a claims review**. Upstream, docs sweeps and a pre-release
docs audit both ran, and wrong public claims still shipped, because "audited" was read as
"true". This pass checks the classes below and nothing else.

**Verifies**, each through something a script or a step in this agent actually does:
- **Structure**: internal links resolve (`scripts/check-docs-internal-links.py`) and the
  docs build succeeds (step 7).
- **Version callouts**: unreleased behavior carries its callout (step 3).
- **Names against code**: field names, endpoint paths and config keys match the current
  source (step 6).
- **Style and drift**: the behavior-drift sweep (6.1). The author applies this; no script
  enforces it.

**Does not verify:**
- **Feature existence**: that a "you can …" sentence resolves to a real route, component
  or command.
- **Edition and licensing truth**: whether a feature is correctly described as free or
  paid, OSS or proprietary.
- **Command execution**: that copy-paste install, upgrade and config blocks run as written.

When you report a docs pass, name the classes you checked and say that the three above
were not. Do not describe the result as "docs reviewed" or "claims verified".

### 7. Verify the build

Run the documentation build command to catch broken links and syntax errors before push.
