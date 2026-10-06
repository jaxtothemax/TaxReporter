# CI gate rules

Same rules as for `scripts/`, since a job here almost always invokes a script
there. See @../scripts/CLAUDE.md.

## `ci/helm.yml` — the reference case for "oracle outside the repo"

`ci/helm.yml` (registry-shadow drift + install/upgrade drills, #43) is the
first template file with real jobs, and the first to set precedent in the
two previously-empty `OPT_OUT` lists:

- **`scripts/check-chart-registry.sh` is an `OPT_OUT` entry in
  `scripts/check-prepush-parity.sh`, not a Makefile target.** Its oracle is
  the published OCI chart registry — state outside the working tree. A
  lookup failure there is a real FAILURE (exit 2), never a skip; the one
  named override is `ALLOW_UNRESOLVED=1`. Because no commit in this repo can
  fix a registry drifting, and a red would block an unrelated push, it
  cannot live in `pre-push` at all (scripts/CLAUDE.md: "a gate whose input is
  not the repository cannot live in pre-push"). It still proves it can fail
  in its own CI job (`helm-registry-drift`, self-test-first) — the opt-out is
  only about the *pre-push* mirror, never about `check-gate-selftest-parity`.
- **"Not configured" and "configured but unreachable" are different exit
  codes on purpose** (0 vs 2). `CHART_REPO` empty — the template default,
  since most clones never publish a chart — is a legitimate skip. `CHART_REPO`
  set and the registry not answering is the gate's actual job. Collapsing
  these into one branch is the easy way to break this class of gate: either
  it nags every unconfigured clone forever, or it goes quiet the day a
  configured registry stops answering.
- **`scripts/helm-install-drill.sh` DOES get a Makefile target
  (`helm-drill`)**, despite also being unsuitable for `pre-push` (it boots a
  real kind cluster — minutes, not seconds). The distinction:
  `check-prepush-parity.sh` only requires a script be *reachable* from the
  Makefile, not that it run automatically before every push — same posture
  as `check-stale-refs`. A drill a developer CAN run by hand, given the
  prerequisites, gets a named target; a gate whose oracle no local run can
  ever legitimately reach gets recorded as `OPT_OUT` instead.
- **Every job is additionally gated on `exists: [$HELM_CHART_DIR/Chart.yaml]`**
  — stronger than relying on the include line staying commented out in
  `.gitlab-ci.yml`. A clone that uncomments `ci/helm.yml` before it has a
  chart still gets a no-op, not a failure.

## Docker gates (`ci/docker.yml`)

Stack-conditional gates that only run for a project that has uncommented
`- local: ci/docker.yml`. They live here rather than in a root `scripts/`
gate specifically so a project with no Docker stack never runs them — see the
"skip-when-absent" note on `check-shellcheck` in `scripts/CLAUDE.md` for the
same shape applied to a tool instead of a whole file class.

- **`compose-project-names`** (`scripts/check-compose-project-names.sh`) —
  every standalone Docker Compose file pins its own top-level `name:`, so an
  unpinned project name (which falls back to the checkout directory) cannot
  collide across dev/prod stacks or two worktrees of the same repo. Passes
  with nothing scanned when a project includes this file but ships no
  compose files at all (image-only, Dockerfile + kaniko/buildx) — that is a
  legitimate configuration, not a gap.

Add the next Docker-specific gate here, next to this one.

## `ci/sonar-complexity.yml` — a proxy metric, opt-in, and what it can and cannot tell you (#41)

Cognitive-complexity tier for Python script entry points. Ported in spirit —
not in mechanism — from TruePPM's use of SonarCloud rule S3776. Read
`scripts/check-cognitive-complexity.py`'s module docstring for the scoring
model; this section is the honest-limits statement issue #41 makes an
acceptance criterion, not a nicety.

**What a passing score tells you:** no module-level function in the scanned
files has more branchy, nested control flow than the threshold allows,
*as this specific approximation counts it*. That is useful signal for the
thing it measures: a script whose top-level orchestration has quietly grown
past what a reader can hold in their head at once, one `elif` and one nested
`try` at a time.

**What it cannot tell you, and must never be read as saying:**

- **It is not a defect count.** A function scoring under threshold can still
  be wrong, untested, or badly named. A function scoring over threshold can
  still be correct and well-tested — see `_check_link` and
  `declared_versions` in this repo's own `scripts/`, both reviewed and
  suppressed as legitimately linear dispatch, not fixed.
- **It is not SonarCloud's own verdict.** No SonarCloud/SonarQube analysis
  runs here. The score is this script's own approximation of a published
  algorithm, not a number comparable to an actual Sonar scan — do not paste
  it into a report as if it were one.
- **It only ever looks at Python entry points.** Shell scripts — the
  majority of this repo's own gates — are not scored at all; there is no
  standard-library shell AST to score them against, and a hand-rolled bash
  parser would be exactly the kind of approximate, silently-narrowing
  discovery `scripts/CLAUDE.md` warns against. If a project's real
  complexity lives in its shell entry points, this gate is blind to it.
- **It only looks at module-level functions.** Class methods, nested
  functions, lambdas, and a script's own top-level (non-function) code are
  never scored — see the script's "What this gate does not cover" section
  for the full list, including that a nested `def` hides its complexity
  from this gate entirely.
- **A clean score is not "this code is simple to read."** It is "this
  function's decision points, counted this one way, stayed under a number."
  Treat a finding as a prompt to look at the function, not as the verdict
  itself — and treat the absence of a finding the same way.

**Why it is OFF BY DEFAULT and not `allow_failure`:** per
`scripts/CLAUDE.md`'s "stage a backlog by rule severity, not by
`allow_failure`" — a failing `allow_failure` job renders as a *green*
pipeline, which is worse than not having the gate at all, because the green
is believed. The job in `ci/sonar-complexity.yml` is a normal blocking job;
"opt-in" is expressed by the include line staying commented out in
`.gitlab-ci.yml`, the same mechanism `ci/python.yml`/`ci/node.yml`/
`ci/docker.yml`/`ci/go.yml`/`ci/helm.yml` use — never by softening the job
that runs once it is enabled.

**The threshold in the shipped template is this repo's own number, not a
constant to trust.** It was derived by running
`python3 scripts/check-cognitive-complexity.py --list` against this repo's
`scripts/*.py` and reading the real distribution — see `DEFAULT_THRESHOLD`'s
comment in the script for the measurement. A project enabling this gate
against its own scripts should re-run `--list` on its own tree and set its
own number; keeping 15 unexamined reintroduces the "copied number with no
provenance" #41's acceptance criteria reject.

**Suppression, and why a bare marker is not one:** `# cognitive-complexity-ok:
<reason>` on the `def` line, same shape as `scripts/check-sigpipe-readers.sh`'s
`# sigpipe-ok: <reason>` (`scripts/CLAUDE.md`, "Prefer a marker that means one
thing"). The reason is required and checked — a bare
`# cognitive-complexity-ok` with nothing after the colon does not suppress
the finding; it is still reported as an offender, with a note that the
reason is missing. This is deliberate: `scripts/CLAUDE.md` warns that "most
[bare markers] are explanatory history", and a marker that suppresses on
sight regardless of content is a suppression nobody can audit later.

## Python gates (`ci/python.yml`) — contract & collision drift (#44)

Three gates ported from two prior application repos (Visiban and TruePPM),
generalized so the template carries no project-specific paths (a fourth,
`added-files-covered`, is Node-based and lives in `ci/node.yml` — see the
"Node gates" section below):

- **`migration-numbering`** (`scripts/check-migration-numbering.sh`) — two
  branches cut from the same point on `main` can each generate a migration
  claiming the same next number; each is green in isolation and the
  collision exists only on the tree that results from both merging. Gated
  on `exists: **/migrations/[0-9]*.py` — framework-agnostic (matches
  Django's `<app>/migrations/NNNN_*.py` and anything following the same
  numbered-file convention), so a clone with no migrations directory
  anywhere gets no job at all. Runs on every MR pipeline, not only at
  merge, which is what makes it fire on a rebase that just picked up a
  sibling branch's migration.

- **`serializer-ts-parity`** (`scripts/check-serializer-ts-parity.py`) —
  hand-maintained shared frontend types drift from what the backend API
  actually returns, with no error anywhere: a field added to a serializer
  but not to TypeScript is data the frontend cannot see, and a field's
  type drifting is worse, because both sides keep type-checking cleanly
  against their own private idea of the contract. Compares an OpenAPI
  document (not serializer source directly, so it works with any backend
  framework that emits one) against `export interface` declarations in a
  TypeScript file — types, nullability, and enum membership, not just
  field names. The (schema component, TS interface) mapping defaults to
  "same name on both sides" and is overridable via `--component-map`.
  Gated on the schema (`TS_PARITY_SCHEMA`) existing.
- **`ws-event-reachability`** (`scripts/check-ws-event-reachability.py`) — a
  published real-time event taxonomy can advertise an event no client can
  actually subscribe to (the route/consumer that would let a client join its
  channel doesn't exist yet). Built independently, in different languages,
  by two prior upstream projects — the strongest signal it belongs here
  rather than being reinvented a third time. Configured via two regexes
  (which channel-key expressions count as "restricted", and what marks a
  route as existing); both default to `(?!)` (matches nothing) so an
  unconfigured clone never invents a restricted class on its own. Gated on
  the taxonomy doc (`WS_DOC_FILE`) existing.

Add the next Python-specific gate here, next to this one.

## Node gates (`ci/node.yml`) — contract & collision drift (#44)

- **`added-files-covered`** (`scripts/check-added-files-covered.mjs`) — a
  brand-new source file with zero tests never appears in a diff-coverage
  tool's report at all, so it reads as 100% covered instead of 0%: the
  failure mode is exactly backwards. Generalized into a list of
  configurable "layers" (a directory prefix + extensions + which coverage
  report and omit-config to read); the built-in defaults cover a
  `backend/` Python layer and a `frontend/src/` TypeScript layer, both
  inert no-ops in a clone that has neither directory. Runs in the
  `security` stage with `needs: [python-test, node-test]` (both
  `optional: true`) so it reads the SAME-PIPELINE coverage artifacts those
  jobs just produced, in whichever of the two (or both) this clone
  actually has.

  **This is the first non-shell/Python gate script in this template.**
  `scripts/check-prepush-parity.sh` and `scripts/check-gate-selftest-parity.sh`
  both discover CI-invoked gate scripts by extension (`.sh` / `.py`); both
  were extended to also match `.mjs` when this gate was added. Porting a
  gate written in a third language means checking those two regexes first
  — a gate script whose extension neither meta-gate recognizes is invisible
  to both, and would silently satisfy neither "has a pre-push mirror" nor
  "proves it can fail in its own CI job".

## Application-aware gates vs. a real app tree (`app-fixture-gates`, #52)

The four gates above skip cleanly on Blueprint's own tree — it has no
`backend/` or `frontend/` — and `ci/python.yml` / `ci/node.yml` are not
included in this repo's own pipeline. Their `--self-test`s prove each can say
no on a minimal synthetic input; nothing proved they read the shapes real
tooling emits. The `app-fixture-gates` job in `.gitlab-ci.yml` runs
`scripts/tests/app-fixture-gates.test.sh`, which generates a small
Django/DRF-and-React-shaped app into a temp directory
(`scripts/tests/lib/app-fixture.sh`) — a drf-spectacular OpenAPI 3.0 document,
coverage.py and vitest Cobertura reports, Django migrations, and a Channels
routing file — points all four gates at it, and demands a pass
on the fixture plus an exit-1 rejection, with the named violation, on each
seeded drift. Its first run found three bugs the self-tests could not:
drf-spectacular's `NullEnum` crashed the parity gate with exit 1 (read as
"drift found") on a clean tree; `interface X extends Y` dropped Y's fields;
and a `squashmigrations` output was reported as a numbering collision.

When you change one of those four gates, or add an application-aware gate,
extend `generate_fixture` in the shape the real tool emits and add a pass case
and a seeded-violation case to the runner.

**Never commit the fixture as files.** Blueprint is stack-agnostic and every
project starts as a clone of this tree; a committed concrete app under
`tests/` would land in every downstream repository with nothing marking it as
gate-test scaffolding. The fixture exists only in `mktemp -d` (outside the
working tree) for the length of a run, so a run leaves nothing for git to see.

Not covered yet, and why:

- **`check-version-lockstep.py`, `check-compose-project-names.sh`** — their
  inputs are repo-root manifests and compose files, not application code, and
  their self-tests already use the real file formats.
- **`schemathesis` schema fuzz and the nightly load test (`ci/python.yml`)** —
  need a booted API, which a static fixture cannot provide; that belongs with
  the `make customize` end-to-end work (#53).
- **`check-cognitive-complexity.py`** — scoped to `scripts/` entry points by
  design, not application code.

Known gap, tracked: `check-added-files-covered.mjs` ignores a Cobertura
report's `<sources>`, so a coverage.py `[run] source = <subpackage>` report
yields a false violation (#65). The fixture uses `source = .` until that
lands, so the suite does not enshrine the false positive.
