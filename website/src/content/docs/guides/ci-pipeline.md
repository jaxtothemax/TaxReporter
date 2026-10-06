---
title: CI pipeline
description: What runs on every MR, on the default branch, and on tags — why each job is there, and what to do when one fails.
---

**The big picture:** GitLab runs a pipeline on every MR, on `main`, on a `production`
branch if you use one, and on tags. Out of the box it runs **governance jobs** that check
the process itself. You switch on **stack jobs** (lint, test, license) for your language.

**Why it matters:** CI is the one reviewer that never skips a step. A required green
pipeline means "this passed the same checks every other change passed," not "the author
says it's fine."

**How it works:**
- **Governance jobs** need no setup: changelog present, no stale markers, every check
  script still able to fail, secret and dependency scans.
- **Stack jobs** come from `ci/*.yml`. Uncomment the line for your stack in
  `.gitlab-ci.yml`.
- **Almost everything CI checks, you can check before pushing**, with
  `make pre-push-checks`. The Git pre-push hook runs it for you.

## When the pipeline fails

1. **Read the log first.** `/ci-debug <pipeline or MR>` fetches the failed logs,
   finds the root cause, and prescribes a fix without changing anything.
2. **Then fix it.** `/fix-mr <MR>` fixes, commits, pushes, and re-checks — up to three
   rounds. It also resolves conflicts with `main`.
3. **Never just retry** without a code change, unless the failure is clearly
   infrastructure (a runner died, a registry timed out).

**Why:** a retry that "fixes" a failure hides a flaky test or a real bug until it bites
harder.

## What runs out of the box

| Stage | Jobs |
|---|---|
| **lint** | `changelog-check`, `mr-followups`, `stale-references`, `gate-selftest-parity`, `prepush-parity`, `tooling-self-tests`, `sigpipe-readers`, `shellcheck`, `nul-bytes`, `load-bearing`, `version-lockstep`, `artifact-assertions`, `onboarding-customize-e2e`; on tags, `release-pipeline-gate` |
| **test** | `app-fixture-gates`, `docs-internal-links` (from `ci/docs.yml`), `website:build` |
| **security** | GitLab SAST and secret-detection components, `osv-scan`, `gitleaks-scan` |
| **deploy** | `pages` (publishes the docs site); `deploy-staging` / `deploy-production` templates, commented out |

### What each governance job is for

| Job | Catches | Why it's worth a job |
|---|---|---|
| `changelog-check` (MRs) | A product change with no `changelog.d/` fragment | Release notes can't be reconstructed later |
| `mr-followups` (MRs) | An MR description that mentions a follow-up or deferral without naming an open issue | "We'll do it later" with no issue means never |
| `stale-references` (MRs, `main`, schedules) | `STUB`/`WIP` markers; `TODO(#N)` pointing at a closed issue | A TODO whose issue closed is a promise nobody is tracking |
| `gate-selftest-parity` | A check script with no `--self-test`, or one that self-tests in a different job | A check that can't prove it still fails might be silently broken |
| `prepush-parity` | A CI check you can't also run before pushing | Finding out in CI costs a pipeline; finding out locally costs seconds |
| `tooling-self-tests` | Broken release, worktree, and setup tooling | These scripts run rarely, so they break silently |
| `sigpipe-readers`, `shellcheck`, `nul-bytes` | Shell-script bugs that make a check report the wrong answer | A check that lies is worse than no check |
| `load-bearing` | Deletion of a one-line call that wires in a guard | Deleting it leaves every test green and the guard off |
| `version-lockstep` | A file holding the version that disagrees with the others | Ships a release stamped with the wrong version |
| `artifact-assertions` | A tag-time publish job that would upload nothing | Tag-time jobs never run on MRs, so they fail at the worst moment |
| `onboarding-customize-e2e` (when setup files change) | `make customize` / `make doctor` breaking for a fresh clone | The first experience of a new project shouldn't be a crash |
| `release-pipeline-gate` (tags) | Publishing a tag from a commit whose own branch pipeline failed | Stops a broken commit from becoming a release |
| `app-fixture-gates` | The app-aware checks (schema-to-types parity, real-time event reachability, migration numbering, coverage of added files) failing on a realistic app | Blueprint's own tree has no app, so these are proven against a generated fixture instead |

## Go deeper

### Dependency and secret scanning

The GitLab SAST and secret-detection components **report**; on their own they don't fail
the pipeline. Two jobs close that gap:

| Job | What it does | Configure with |
|---|---|---|
| `osv-scan` | Scans every lockfile in the tree against the OSV.dev advisory database. **Fails** at or above `OSV_SEVERITY_THRESHOLD` (default `HIGH`); a finding below it is a non-blocking warning. | The `OSV_SEVERITY_THRESHOLD` CI/CD variable (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). Accept a risk with a documented, expiring `IgnoredVulns` entry in an `osv-scanner.toml` next to the lockfile. |
| `gitleaks-scan` | Scans the whole working tree for secrets — not just the diff. The same tool runs as a pre-commit hook (installed by `make setup`), so a secret is stopped before it's even committed. | `.gitleaks.toml` at the repo root; add a documented allowlist entry for a genuine false positive. |

**Fail closed:** if the advisory scan can't complete (network down, database
unreachable), `osv-scan` fails instead of quietly passing. The only override is
`ALLOW_UNRESOLVED=1`, for a runner that genuinely can't reach the internet — set it as an
explicit, reviewable CI/CD variable.

### Stack templates

Uncomment the include in `.gitlab-ci.yml`. Each file has its settings (source folder,
coverage threshold, image version) at the top.

| File | For | Jobs |
|---|---|---|
| `ci/python.yml` | Python | `python-lint` (ruff), `python-test` (pytest + coverage), `python-license-check`, `migration-numbering`, `ws-event-reachability`, `serializer-ts-parity`, and two opt-in jobs below |
| `ci/node.yml` | Node.js | `node-lint` (eslint), `node-test` (vitest + coverage), `node-license-check`, `added-files-covered` |
| `ci/go.yml` | Go | `go-lint` (golangci-lint), `go-test`, `go-vuln-check` (govulncheck) |
| `ci/docker.yml` | Docker | `docker-build` (kaniko, no privileged mode), `compose-project-names` |
| `ci/helm.yml` | Helm charts | `helm-registry-drift`, `helm-install`, `helm-upgrade` — see [Deployment options](/guides/deployment-options/) |
| `ci/docs.yml` | A docs site | `docs-internal-links` — **included by default**; it does nothing until a docs site exists |
| `ci/sonar-complexity.yml` | Python scripts | `cognitive-complexity` — **off by default**; read its header first, because it false-positives on legitimately branchy code (a local approximation; for a real Sonar scan see [External validation](/guides/external-validation/)) |

### Python: schema fuzzing and a nightly load test

`ci/python.yml` ships two jobs that need a **running** API, not just source files. Each
stays out of the pipeline entirely until you provide the startup script it names.

| Job | What it does | Turn it on with |
|---|---|---|
| `python-schema-fuzz` | Uses [schemathesis](https://schemathesis.readthedocs.io/) to hit your live API with generated input and fails when a real response doesn't match your OpenAPI schema. **Blocking** on relevant MRs. Record accepted, triaged findings in `schemathesis-baseline.json`. | `SCHEMA_FUZZ_API_BOOT_SCRIPT` — your script that migrates, seeds a small fixture, starts the API, and waits until it's serving |
| `python-nightly-load-test` | Measures p50/p95/p99 latency for chosen read endpoints and fails when one exceeds its p95 budget. **Scheduled**, not per-MR. | `LOAD_TEST_API_BOOT_SCRIPT` (seeds a **large** fixture) plus at least one target in `nightly-load-test-budgets.json` |

**Why they matter:** the fuzzer is the one check that asks whether your schema describes
what the server *actually* returns — not whether the schema agrees with itself. The load
test catches a slowdown that keeps the query count the same (a missing index, data
growth), which no code review can see.

For why fuzzing matters when an AI writes the tests, and what mutation testing adds,
see [Testing AI-written code](/guides/testing-ai-written-code/).

**Yes, but:** the load test's default budget (500 ms) is a placeholder, not a
measurement. Derive real budgets with `python3 scripts/nightly_load_test.py --measure-only`.

### Running the checks yourself

```bash
make pre-push-checks   # what the pre-push hook runs: collision, parity, and the gate suite
make gate-self-tests   # prove every check script can still fail
make help              # list every target
```
