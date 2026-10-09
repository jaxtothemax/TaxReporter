# Changelog Fragments

Each MR that requires a changelog entry drops a small file here instead of
editing `CHANGELOG.md` directly. This eliminates merge conflicts between
concurrent branches.

## File naming

```
<issue-or-slug>.<type>.md
```

- **issue-or-slug** — issue number (e.g. `42`) or a short kebab-case slug
  when there is no issue (e.g. `fix-csv-header`)
- **type** — one of: `added`, `changed`, `fixed`, `security`

Examples:

```
42.fixed.md
add-dark-mode.added.md
fix-csv-header.fixed.md
```

## File contents

One bullet point per file. Lead with user-visible impact, not implementation
detail.

Three shapes are accepted, and all three assemble correctly — a new bullet starts
only at the top of the file or after a blank line, and everything else continues
the bullet above it:

- `- bullet` with two-space-indented continuation lines
- `- bullet` with unindented continuation lines (they get indented for you)
- a wrapped paragraph with no bullet marker at all (it becomes one bullet)

A file with no trailing newline keeps its last line. `scripts/assemble-changelog.sh
--self-test` covers all of this; it exists because the third shape used to become
**one bullet per line**, silently, and the damage was visible only in the published
release notes.

Example:

```
Board export now includes all card metadata — previously export dropped
custom fields silently (#42)
```

## What happens at release time

`scripts/assemble-changelog.sh` collects all fragments, groups them by type,
appends them to `CHANGELOG.md` under `[Unreleased]`, and deletes the fragment
files. The release script calls this automatically.

## When to skip

The CI `changelog-check` job auto-skips for branches that only touch CI config,
docs, tests, or tooling. You can also add the `no-changelog` pull request label to skip
manually.
