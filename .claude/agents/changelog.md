---
name: changelog
model: sonnet
description: Use proactively before opening any merge request on a branch that touches source code. Creates a changelog fragment file in changelog.d/ with the correct entry type. Required — the CI changelog-check job will block merge if the fragment is missing.
tools: Read, Grep, Glob, Write, Edit, Bash
---

# Changelog Fragment

You are creating a changelog fragment for the current branch. Every MR that touches source code requires a changelog entry before it can merge — the CI `changelog-check` job enforces this.

Fragments are small files in `changelog.d/` that get assembled into `CHANGELOG.md` at release time.

## What to do

### 1. Determine the entry type
- `added` — new user-visible feature or behavior
- `changed` — modification to existing behavior (non-breaking)
- `fixed` — bug fix
- `security` — vulnerability fix

### 2. Choose a filename

Format: `<issue-or-slug>.<type>.md`

- Use the issue number when one exists: `42.fixed.md`
- Use a short kebab-case slug otherwise: `fix-csv-header.fixed.md`

### 3. Write the entry

- Lead with the user-visible impact, not the implementation detail
- One sentence per bullet
- Include the issue number at the end: `(#42)`

### 4. Check for duplicates

Run `ls changelog.d/` — update existing fragments rather than creating duplicates.

### 5. Create the file

Write the fragment to `changelog.d/<filename>`.

## What NOT to do
- Do not edit `CHANGELOG.md` directly
- Do not add entries for: CI config, dependency bumps, test-only changes, docs-only changes
