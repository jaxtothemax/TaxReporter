---
title: Git conventions and the changelog
description: Branch naming, commit format, MR workflow, and the fragment-based changelog system.
---

**The big picture:** Every change follows the same shape: a prefixed branch,
conventional commit messages, a merge request, and a one-line changelog fragment.

**Why it matters:** When every change looks the same, both people and agents can read
history at a glance — and release notes write themselves from the fragments instead of
from memory the night before.

**The rules in one breath:**
- Branch: `feat/`, `fix/`, `docs/`, `chore/`, … plus the issue number and a slug.
- Commit: `type(scope): what changed` — e.g. `fix(api): prevent N+1 on project list`.
- Never commit to `main`; every change goes through an MR, even docs and chores.
- Add `changelog.d/<issue>.<type>.md` with one user-facing line.

## Branch naming

All branches use a prefix that maps to conventional commit types:

```
feat/    — new features
fix/     — bug fixes
docs/    — documentation only
chore/   — maintenance, config, CI
test/    — test-only changes
refactor/— restructuring without behavior change
perf/    — performance improvements
ci/      — CI pipeline changes
```

Example: `feat/user-onboarding`, `fix/login-race-condition`

## Commit format

[Conventional commits](https://www.conventionalcommits.org/) with an optional scope:

```
feat(auth): add OAuth2 PKCE flow
fix(api): prevent N+1 on project list endpoint
docs: update deployment guide for Helm 3.14
chore(ci): pin runner image to node:20-alpine
```

## Merge request workflow

Every change goes through a branch and an MR, including docs, chores, and hotfixes:

1. Start from an issue: `scripts/wt new <issue>` creates the branch and a worktree off
   the latest default branch. For a single change on a clean checkout,
   `git checkout main && git pull origin main && git checkout -b <prefix>/<issue>-<slug>`
   works too.
2. Make changes, commit, and push the branch
3. Run `/mr` to open the MR with pre-flight checks
4. Wait for a green pipeline, then merge
5. From the main checkout, run `scripts/wt prune` to remove the merged worktree

`/mr` writes a structured description (summary, changes, test plan, gate results, and
`Closes #N`). It also checks that a changelog fragment exists unless the branch is
exempt.

## Changelog system

The template uses **fragment-based changelogs** instead of direct `CHANGELOG.md` edits.
This eliminates merge conflicts and enforces that every MR documents its changes.

### How it works

1. **During development:** The `changelog` agent creates a file in `changelog.d/`:
   ```
   changelog.d/
   ├── 42.added.md          # "Add user onboarding flow"
   ├── 57.fixed.md          # "Fix login race condition on slow networks"
   └── oauth-pkce.added.md  # "Add OAuth2 PKCE authentication"
   ```

2. **CI enforcement:** The `changelog-check` job fails an MR that changes product files
   without adding a fragment. Add the `no-changelog` label to exempt a specific MR.

3. **At release time:** `scripts/assemble-changelog.sh` collects all fragments, groups
   them by type (Added, Changed, Fixed, Security), inserts them into `CHANGELOG.md`
   under the new version heading, and deletes the consumed fragment files.

### Fragment naming

```
<issue-number-or-slug>.<type>.md
```

- **Types:** `added`, `changed`, `fixed`, `security`
- **Content:** One line describing the change from the user's perspective
- **When CI skips the check:** the branch starts with `chore/`, or every changed file is
  non-product (CI config, `docs/`, `scripts/`, `README*`, `CLAUDE.md`, `Makefile`,
  `.gitignore`, or any `*.md` / `*.sh` file), or the MR has the `no-changelog` label. A
  dependency bump that changes a lockfile is **not** skipped unless it is on a `chore/`
  branch. Add test directories to the job's filter list in `.gitlab-ci.yml` if test-only
  changes should skip too.
