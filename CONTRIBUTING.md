# Contributing to TaxReporter

Thank you for helping Slovenian investors file correct returns without handing their
statements to anyone. You do not need to be a tax expert: most contributions are broker
adapters, fixtures, docs and bug reports. Read `docs/research/README.md` before changing
anything that affects a computed figure.

---

## Workflow

This project follows GitHub Flow: every change goes through a short-lived branch and a
pull request (PR) into `main`. There are no direct pushes to `main` — it is protected, and
a PR merges only once its required status checks are green.

```bash
# 0. Once per machine: authenticate the GitHub CLI and install the git hooks
gh auth login
make setup

# 1. Start from a fresh main
git checkout main && git pull origin main

# 2. Create a branch (put the issue number first when there is one)
git checkout -b feat/123-your-feature   # or fix/, docs/, chore/

# 3. Make changes, commit
git add <files>
git commit -m "feat(scope): short description"

# 4. Push and open a PR
git push -u origin "$(git branch --show-current)"
/mr   # in Claude Code, or: gh pr create --base main --fill
```

The `pre-push` hook runs `make pre-push-checks`, which mirrors every locally runnable
CI gate, so a red result shows up before the push rather than on the PR.

Checks must be green before merging (`gh pr checks`). Never merge a PR with a failing
check, and never bypass one: fix the root cause.

Working on several issues at once? Use `scripts/wt new <issue>` for an isolated git
worktree. It also checks the issue out (the `status:wip` label) so that a parallel
session does not pick up the same issue.

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
feat(import): read the dividends section of a broker activity statement
fix(xml): round withholding tax to two decimals before summing
chore(ci): bump actions/checkout to the latest patch release
```

---

## Changelog

Every PR that changes user-visible behavior needs a changelog fragment. Do not edit
`CHANGELOG.md` directly. Fragments are assembled into it at release time.

```bash
# Create a fragment file:
echo "- **Your change**: what changed and why it matters." \
  > changelog.d/<slug>.<type>.md

# Types: added  changed  fixed  security
# Example:
echo "- **Dividend import**: dividends from the activity statement now fill the dividend form." \
  > changelog.d/dividend-import.added.md
```

The CI `changelog-check` job fails if the fragment is missing. It skips the check when:

- the branch starts with `chore/`, or
- every changed file is non-product: CI config (`.github/`), anything under `docs/` or
  `scripts/`, `README*`, `CLAUDE.md`, `Makefile`, `.gitignore`, or any `*.md` / `*.sh`
  file, or
- the PR carries the `no-changelog` label.

A `docs/` or `ci/` branch is **not** skipped because of its name. It passes only because
of the files it changes.

---

## Tests

Run tests before pushing:

```bash
make test                          # every package, with coverage
pnpm vitest run packages/brokers   # one package or file while iterating
```

Every new feature and bug fix needs test coverage in the same PR. The
`check-added-files-covered` gate fails a PR that adds a source file no test executes.
Anything FURS ingests is covered by a golden XML file that is also validated against the
vendored XSD (`packages/furs/schemas/`).

---

## Reporting a broker export change

Brokers change their export formats without notice. If a file stops importing:

1. Open a **Bug** issue naming the broker, the export type (for example "Trading 212 →
   History → Export CSV"), and the date you exported it.
2. Paste **only the header row** and, if needed, one or two rows with every number,
   identifier and name replaced by made-up values.
3. Never attach the real file. Real exports belong in the gitignored `private/` folder of
   your own clone.

---

## Adding a broker adapter

An adapter turns one broker's export into the normalized ledger events in
`packages/core`; FX conversion, FIFO lot matching and XML generation are shared, so an
adapter never touches them. A new adapter PR needs:

- detection by header or structure (never by file name), with one fixture per known
  header revision under `packages/brokers/test/fixtures/<broker>/`;
- every input row accounted for: an event, an explicit "ignored (reason)" record, or a
  blocking diagnostic — nothing is dropped silently;
- the import contract of `docs/adr/0011-import-contract-for-broker-files.md`:
  - `read` takes a `ReadContext`, the file's ID and account group, and never sees a file
    name;
  - every event carries its account, the broker's own clock (`at`) and a key from core's
    `keyBuilder()`;
  - dates come from core's `taxDate`, never from a rule of the adapter's own;
  - text copied from the file reaches a finding only through `untrusted()`;
- synthetic or anonymized fixtures only, plus a short `docs/research/` note on where the
  format is documented and which fields are trusted;
- the `security-review` and `regression-check` agents run on the branch (see the
  fast-paths table in `CLAUDE.md`).

---

## Issues

Open issues from the forms on the **New issue** page (bug, feature, task, feedback).
Blank issues are disabled. **Never attach a real broker export or a generated tax file,
and never paste personal or tax identifiers.** Issues are public.

Report security vulnerabilities privately through **Security → Report a vulnerability**
(GitHub private vulnerability reporting). Do not open a public issue for them.

---

## Using Claude Code agents

This project ships Claude agents for common review tasks. Run them before opening a PR:

```
changelog        — create a changelog fragment
regression-check — audit for regressions
security-review  — OWASP Top 10 + project-specific checks (parsers, importers, generated XML)
```

And before starting any new feature:

```
/voc all <feature description>  — persona feedback
architect                       — technical design review
```

The `/mr`, `/fix-mr` and `/mass-merge` skills keep their upstream Blueprint names. In
this repository, an MR is a GitHub pull request.

See `CLAUDE.md` for the full agent workflow and when each one applies.

---

## Getting help

- Open an issue for bugs or feature requests (use the **Feedback** form for questions and
  ideas)
- For a security problem, use private vulnerability reporting (see `SECURITY.md`)
- TaxReporter is not tax advice. For questions about your own return, ask FURS or a tax
  adviser
