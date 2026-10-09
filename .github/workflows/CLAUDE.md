# CI workflow rules

Same rules as for `scripts/`, since a job here almost always invokes a script
there. See @../../scripts/CLAUDE.md.

## The four harness workflows

| Workflow | Triggers | Jobs |
|---|---|---|
| `governance.yml` | PR, push to `main`, weekly schedule, manual | every repository gate, each with its `--self-test` first in the same job; `changelog-check` and `pr-followups` on PRs only |
| `security.yml` | PR, push to `main`, weekly schedule, manual | `osv-scan`, `gitleaks-scan` |
| `docs.yml` | PR, push to `main`, manual | `docs-internal-links`, `website-build`, `pages` (deploy from `main` only); all skipped when there is no docs site |
| `release.yml` | push of a `v*` tag | `release-pipeline-gate`, then `publish-release` |

The application's own lint/typecheck/test/build jobs live in `ci.yml`. See
"What `ci.yml` must carry" below.

## Rules for every job

- **Call gate scripts directly from `run:`** (`bash scripts/check-x.sh`), never
  through `make` or a local composite action. `scripts/check-gate-selftest-parity.sh`
  and `scripts/check-prepush-parity.sh` find the gates by reading these files; a
  gate hidden behind a make target is invisible to both.
- **Self-test first, same job.** Each gate runs `--self-test` and then the real
  scan in one job. Every job gets a fresh runner VM, so a self-test that ran in
  another job proves nothing about this one.
- **Pin every third-party action to a full 40-character commit SHA** with a
  trailing `# vX.Y.Z` comment. Look the SHA up read-only:
  `gh api repos/<owner>/<action>/git/ref/tags/<tag>`. If `.object.type` is `tag`,
  dereference it with `gh api repos/<owner>/<action>/git/tags/<sha> -q .object.sha`.
  A downloaded binary (shellcheck, osv-scanner, gitleaks) is pinned by version
  and checked against its SHA-256 before it runs.
- **Least privilege.** Each workflow defaults to `permissions: contents: read`.
  A job that needs more lists everything it needs (a job-level `permissions:`
  replaces the default; it does not add to it).
- **Never use `pull_request_target`.** It runs with a write token against
  untrusted PR code.
- **Untrusted input goes through `env:`, never `${{ }}` inside `run:`.** PR
  titles, branch names (`github.head_ref`), labels and bodies are attacker
  controlled. Interpolating them into a script is shell injection.
- **PR metadata comes from the API or `$GITHUB_EVENT_PATH`**
  (`jq -r '.pull_request.body'`, `.pull_request.labels[].name`). Base and head
  SHAs come from `github.event.pull_request.base.sha` / `.head.sha`. When a
  re-run must see edits made after the trigger, read the API: a re-run reuses
  the original event payload. `changelog-check` (labels) and `pr-followups`
  (body) do this.
- **Concurrency:** superseded PR runs are canceled. Runs on `main` are keyed by
  SHA and never canceled, because `release-pipeline-gate` needs a completed run
  for the tagged commit.
- **A skipped job reports success to branch protection.** That is why the
  GitLab `changes:` rules became a scope step inside the job (`app-fixture-gates`,
  `onboarding-customize-e2e`): the job always exists and says why it did nothing.
  Do not make a required check conditional on something a PR author controls.
- **There is no `allow_failure: exit_codes`.** `continue-on-error` swallows every
  failure, so never use it on a gate. To map one exit code to a warning, catch it
  in the step and emit `::warning::` (see the `osv-scan` severity step).
- **No automatic retry.** Re-run a job that hit an infrastructure failure from
  the run page. Never re-run to get past a red gate.

## Adding a workflow or a gate

- A new gate script: add its `--self-test` and real invocation to a job here,
  and wire it into the Makefile's `pre-push-checks` (or record why it cannot
  run before a push in `check-prepush-parity.sh`'s `OPT_OUT`).
- A new workflow that runs on push to `main`: add it to
  `RELEASE_PIPELINE_WORKFLOWS` in `release.yml`. The gate already refuses a tag
  when any `main` run at that commit failed. The list adds "and these must have
  run at all", so a workflow that never started is not taken as a pass.
- A new tag-triggered job: give it `needs: [release-pipeline-gate]`. If it
  uploads an artifact, assert each path in an earlier step with
  `sh scripts/ci-assert-artifacts.sh <path>`. `check-artifact-assertions.sh`
  enforces this.
- Run `actionlint` on the workflows before pushing.

## Gates whose oracle is outside the repo

`scripts/osv-severity-gate.sh` (the `osv-scan` job) is the reference case: its
oracle is the OSV.dev advisory database, not the working tree.
`check-pr-followups.sh`, `check-stale-references.sh` and
`check-release-pipeline.sh` read GitHub.

- **They are not in `pre-push`.** No commit in this repo can fix a lookup
  failure, and a red would block an unrelated push (scripts/CLAUDE.md: "a gate
  whose input is not the repository cannot live in pre-push"). Each is either an
  `OPT_OUT` entry in `scripts/check-prepush-parity.sh` with its reason, or a
  Makefile target deliberately kept out of `pre-push-checks`. Each still proves
  it can fail in its own CI job, self-test first. The opt-out only covers the
  pre-push mirror, never `check-gate-selftest-parity`.
- **A lookup failure is a real FAILURE, never a skip.** Each has one named
  override, visible in the diff that sets it (`ALLOW_UNRESOLVED=1`,
  `PR_FOLLOWUPS_ALLOW_UNRESOLVED=1`).
- **"Nothing to check" and "could not check" are different outcomes on
  purpose.** A tree with no lockfiles is a clean pass. A scan that could not
  reach its database is a failure. Collapsing the two into one branch is the
  easy way to break this class of gate: either it nags every tree that has
  nothing to scan, or it goes quiet the day its oracle stops answering.

## The meta-gates read workflows with PyYAML

`check-gate-selftest-parity.sh`, `check-artifact-assertions.sh` and
`check-tag-only-jobs.sh` parse the workflows with PyYAML. CI pins it with
`actions/setup-python` and `pip install pyyaml==<version>` in the jobs that run
them. Locally they exit 2 (3 for `check-tag-only-jobs.sh`) with an install hint
when PyYAML is missing. That means "could not check", not a pass.
`check-gate-selftest-parity.sh` reads only the `run:` text of steps. A script
named in a step `name:`, an `env:` value, a `paths:` filter or a shell comment is
a mention, not an invocation. That is why the scope steps keep their watched
paths in `env: WATCH`.

Gate scripts are discovered by extension (`.sh`, `.py`, `.mjs`) in both
`check-prepush-parity.sh` and `check-gate-selftest-parity.sh`. A gate written in
a fourth language is invisible to both until both regexes learn its extension.

## What `ci.yml` must carry

The GitLab template shipped `ci/python.yml` and `ci/node.yml` as opt-in stack
includes. They were not ported; `ci.yml` (TypeScript, pnpm) carries their intent,
and any change to it must keep doing so:

- **Lint, typecheck, test with coverage,** on PR and on push to `main`, with
  the same concurrency block as the harness workflows. Add `ci.yml` to
  `RELEASE_PIPELINE_WORKFLOWS` in `release.yml`.
- **A dependency license check on PRs.** Derive the deny list from this
  project's own license. The template denied `GPL-2.0;GPL-3.0;AGPL-3.0`, which
  is wrong for a project that is itself AGPL-3.0.
- **`added-files-covered`** (`scripts/check-added-files-covered.mjs`, #44). A
  brand-new source file with zero tests never appears in a diff-coverage tool's
  report, so it reads as 100% covered instead of 0%. Run it in a job that
  `needs:` the test job(s) and downloads their coverage reports
  (`actions/upload-artifact` / `actions/download-artifact`). Check out with
  `fetch-depth: 0` so it can diff against the base. Run
  `node scripts/check-added-files-covered.mjs --self-test` first, in that job.

## Application-aware gates vs. a real app tree (`app-fixture-gates`, #52)

`added-files-covered` skips cleanly on a tree with no application source and no
coverage reports, which is this repository until the application lands. Its
`--self-test` proves it can say no on a minimal synthetic input. Nothing proves
it reads the shapes real tooling emits. The `app-fixture-gates` job in
`governance.yml` runs `scripts/tests/app-fixture-gates.test.sh`. That test
generates a small Python-and-TypeScript-shaped app into a temp directory
(`scripts/tests/lib/app-fixture.sh`): source files, tests, a `.coveragerc`, a
`vitest.config.ts`, and the coverage.py and vitest Cobertura reports those tools
emit. It points the gate at the app and demands a pass on the fixture, plus an
exit-1 rejection with the named violation on each seeded drift.

When you change that gate, or add another gate whose input is application code,
extend `generate_fixture` in the shape the real tool emits and add a pass case
and a seeded-violation case to the runner.

**Never commit the fixture as files.** A committed toy app under `tests/` would
sit beside the real application with nothing marking it as gate-test
scaffolding. The fixture exists only in `mktemp -d` (outside the working tree)
for the length of a run, so a run leaves nothing for git to see.

Not covered, and why:

- **`check-version-lockstep.py`**: its inputs are repo-root manifests, not
  application code, and its self-test already uses the real file formats.
- **`check-cognitive-complexity.py`**: scoped to `scripts/` entry points by
  design, not application code.

Known gap, tracked upstream in Blueprint: `check-added-files-covered.mjs`
ignores a Cobertura report's `<sources>`, so a coverage.py
`[run] source = <subpackage>` report yields a false violation (Blueprint #65).
The fixture uses `source = .` until that lands, so the suite does not enshrine
the false positive.

## Cognitive complexity: a proxy metric, opt-in, and what it can and cannot tell you (#41)

The `cognitive-complexity` job sits commented out at the end of
`governance.yml`. It is a cognitive-complexity tier for Python script entry
points, ported in spirit (not in mechanism) from TruePPM's use of SonarCloud
rule S3776. Read `scripts/check-cognitive-complexity.py`'s module docstring for
the scoring model. This section states its honest limits, which issue #41 made
an acceptance criterion.

**What a passing score tells you:** no module-level function in the scanned
files has more branchy, nested control flow than the threshold allows, *as this
specific approximation counts it*. That is useful signal for what it measures: a
script whose top-level orchestration has quietly grown past what a reader can
hold in their head at once, one `elif` and one nested `try` at a time.

**What it cannot tell you, and must never be read as saying:**

- **It is not a defect count.** A function under the threshold can still be
  wrong, untested, or badly named. A function over it can still be correct and
  well tested. See `_check_link` and `declared_versions` in this repo's own
  `scripts/`: both were reviewed and suppressed as legitimately linear dispatch,
  not fixed.
- **It is not SonarCloud's own verdict.** No SonarCloud/SonarQube analysis runs
  here. The score is this script's own approximation of a published algorithm.
  Do not paste it into a report as if it came from a Sonar scan.
- **It only looks at Python entry points.** Shell scripts, the majority of this
  repo's own gates, are not scored at all. There is no standard-library shell AST
  to score them against, and a hand-rolled bash parser would be the kind of
  approximate, silently narrowing discovery `scripts/CLAUDE.md` warns against.
- **It only looks at module-level functions.** Class methods, nested functions,
  lambdas, and a script's top-level (non-function) code are never scored. See
  the script's "What this gate does not cover" section for the full list,
  including that a nested `def` hides its complexity from this gate entirely.
- **A clean score is not "this code is simple to read."** It means this
  function's decision points, counted this one way, stayed under a number. Treat
  a finding as a prompt to look at the function, not as the verdict, and treat
  the absence of a finding the same way.

**Why it is opt-in by comment and never `continue-on-error`:** per
`scripts/CLAUDE.md`'s "stage a backlog by rule severity, not by
`allow_failure`", a job that cannot fail the run renders green, and that green
gets believed. Once uncommented, the job is a normal blocking job. "Opt-in" means
the job stays commented out until someone deliberately enables it in a reviewed
diff. A project that enables it should also add `pre-push-checks:
check-complexity` to the Makefile.

**The shipped threshold is this repo's own number, not a constant to trust.**
It was derived by running `python3 scripts/check-cognitive-complexity.py --list`
against this repo's `scripts/*.py` and reading the real distribution. See
`DEFAULT_THRESHOLD`'s comment in the script for the measurement. A project that
enables the gate should re-run `--list` on its own tree and set its own number.
Keeping 15 unexamined reintroduces the "copied number with no provenance" that
#41's acceptance criteria reject.

**Suppression, and why a bare marker is not one:** put
`# cognitive-complexity-ok: <reason>` on the `def` line, the same shape as
`scripts/check-sigpipe-readers.sh`'s `# sigpipe-ok: <reason>`
(`scripts/CLAUDE.md`, "Prefer a marker that means one thing"). The reason is
required and checked. A bare `# cognitive-complexity-ok` with nothing after the
colon does not suppress the finding: it is still reported, with a note that the
reason is missing. A marker that suppresses on sight regardless of content is a
suppression nobody can audit later.
