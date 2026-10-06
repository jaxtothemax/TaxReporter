# Contributing to [PROJECT NAME]

<!-- Replace [PROJECT NAME] with your project name, then delete this comment. -->

---

## Workflow

Every change goes through a branch and merge request — no direct pushes to `main`.

```bash
# 1. Start from a fresh main
git checkout main && git pull origin main

# 2. Create a branch
git checkout -b feat/your-feature   # or fix/, docs/, chore/

# 3. Make changes, commit
git add <files>
git commit -m "feat(scope): short description"

# 4. Open an MR
/mr   # in Claude Code, or: glab mr create --target-branch main
```

The pipeline must be green before merging. Never merge a failing pipeline.

---

## Branch naming

| Prefix | When to use |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `chore/` | Tooling, CI, dependency bumps — no behavior change |
| `refactor/` | Code restructure with no behavior change |
| `perf/` | Performance improvement |

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — explain why, not what]
```

Examples:
```
feat(api): add endpoint for bulk task assignment
fix(auth): clear query cache on login to prevent 401 race
chore(ci): bump node image to 20-alpine
```

---

## Changelog

Every MR that changes user-visible behavior needs a changelog fragment.

```bash
# Create a fragment file:
echo "- **Your change**: what changed and why it matters." \
  > changelog.d/<slug>.<type>.md

# Types: added  changed  fixed  security
# Example:
echo "- **Bulk assignment**: PMs can now assign multiple tasks at once." \
  > changelog.d/bulk-assign.added.md
```

The CI `changelog-check` job fails if the fragment is missing. It skips the check when:

- the branch starts with `chore/`, or
- every changed file is non-product: CI config, anything under `docs/` or `scripts/`,
  `README*`, `CLAUDE.md`, `Makefile`, `.gitignore`, or any `*.md` / `*.sh` file, or
- the MR carries the `no-changelog` label.

A `docs/` or `ci/` branch is **not** skipped by its name. It passes only because of the
files it changes.

---

## Tests

Run tests before pushing:

```bash
make test        # all packages
make test-<pkg>  # scoped (see Makefile for targets)
```

<!-- Add your coverage threshold here, e.g.: -->
<!-- Coverage must stay at or above 80% — CI enforces this. -->

Every new feature and bug fix needs test coverage in the same MR.

---

## Using Claude Code agents

This project ships Claude agents for common review tasks. Run them before opening an MR:

```
changelog   — create a changelog fragment
regression-check — audit for regressions
security-review  — OWASP Top 10 + project-specific checks (on auth/API changes)
```

And before starting any new feature:

```
/voc all <feature description>  — persona feedback
architect                       — technical design review
```

See `CLAUDE.md` for the full agent workflow and when each one applies.

---

## Getting help

<!-- Add your project's support channels here -->
- Open an issue for bugs or feature requests
- [FILL IN: Slack/Discord/email for questions]
