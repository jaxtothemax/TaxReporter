---
title: Harness gates
description: What each gate script catches, the four properties they all share, and how the test layers catch each other's blind spots.
---

**The big picture:** A gate is any check that can say *no* to a change — a CI job, a
pre-push script, a review agent. Blueprint's rule is simple: **a green result has to be
evidence**, so every gate script can prove, on demand, that it still fails when it should.

**Why it matters:** A check that silently stopped working is worse than no check, because
people keep trusting its green. Almost every rule on this page exists because a check
somewhere reported "all clear" on a tree that broke the rule.

**How it works:**
- Every gate script has a `--self-test` that builds a broken example and confirms it's
  rejected — run in the same CI job as the real check.
- A gate that can't reach what it needs (the network, the tracker) **fails** instead of
  passing quietly.
- Every CI gate can also run on your machine before you push (`make pre-push-checks`).
- Review agents leave a one-line result in each MR (the [gate ledger](#the-gate-ledger)),
  so you can tell which gates actually find problems.

## The gate scripts

| Gate | Runs | Catches |
|---|---|---|
| `check-issue-collision.sh` | pre-push | A second MR for an issue that already has one |
| `check-prepush-parity.sh` | pre-push + CI | A CI gate you can't run before pushing |
| `check-gate-selftest-parity.sh` | pre-push + CI | A gate with no `--self-test`, or one that self-tests in a different job |
| `check-stale-references.sh` | CI (MRs, `main`, schedules) | `STUB`/`WIP` markers; `TODO(#N)` and `SUPPRESSED-UNTIL(#N)` pointing at closed issues |
| `check-mr-followups.sh` | CI (MRs) | An MR description naming a follow-up without an open issue |
| `check-version-lockstep.py` | pre-push + CI | A version-bearing file the release script forgot to bump |
| `check-sigpipe-readers.sh` | pre-push + CI | An early-exit reader behind a pipe, which under `pipefail` reports a real match as missing |
| `check-shellcheck.sh` | pre-push + CI | Shell scripts failing `shellcheck` |
| `check-nul-bytes.sh` | pre-push + CI | A stray NUL byte in a text file — Git and `grep` then treat the whole file as binary, so every tree-walking check silently skips it |
| `check-load-bearing.sh` | pre-push + CI | Deleting a [declared one-line guard](#declaring-a-load-bearing-call-site) |
| `check-artifact-assertions.sh` | pre-push + CI | A tag-time publish job that doesn't verify its artifact is non-empty |
| `check-tag-only-jobs.sh` | `/release` pre-flight + CI self-test | A tag-only CI job changed since the last tag — it has never run in its current form |
| `check-release-pipeline.sh` | CI (tags) | Publishing a tag from a commit whose own branch pipeline failed |
| `check-docs-internal-links.py` | pre-push + CI (`ci/docs.yml`), only with a docs site | A broken internal link, anchor, asset, or source link in the docs |
| `check-compose-project-names.sh` | pre-push + CI (`ci/docker.yml`) | A compose file without its own pinned project name — two stacks can then share volumes (and data) or recreate each other's containers |
| `check-migration-numbering.sh` | pre-push + CI (`ci/python.yml`) | Two branches picking the same migration number — invisible until both merge |
| `check-serializer-ts-parity.py` | pre-push + CI (`ci/python.yml`) | Backend schema and TypeScript types disagreeing on a field's type |
| `check-ws-event-reachability.py` | pre-push + CI (`ci/python.yml`) | A published real-time event no client can actually subscribe to |
| `check-added-files-covered.mjs` | pre-push + CI (`ci/node.yml`) | A brand-new source file with no tests, which coverage tools silently omit |
| `check-chart-registry.sh` | CI (`ci/helm.yml`) | A published Helm chart that doesn't install the way the docs say |
| `check-cognitive-complexity.py` | CI (`ci/sonar-complexity.yml`, off by default) | A script entry point above its cognitive-complexity tier — a rough proxy, read its header before trusting it |
| `nightly_load_test.py` | CI (`python-nightly-load-test`, scheduled) | An endpoint whose p95 latency exceeds its committed budget |
| `osv-severity-gate.sh` | CI only (`osv-scan`) | A dependency vulnerability at or above the threshold; fails closed if the scan didn't finish |
| `gitleaks-precommit.sh` | pre-commit + CI self-test | A secret in staged changes, before it's ever committed |

The app-aware gates (migration numbering, schema-to-types parity, event reachability,
added-file coverage) skip cleanly when your project has nothing for them to check. CI's
`app-fixture-gates` job proves them against a generated sample app, since Blueprint's own
tree has no app.

**Go deeper:** the rest of this page explains how the gates are built and why.

## The four properties every gate shares

Copy these into any gate you add.

**1. It can fail on demand, in its own job.** Every script takes `--self-test`: it
synthesizes a violating fixture, runs the real decision path, and asserts a rejection.
The half that rots is *discovery*, not judgment — judgment either answers or errors
loudly, while a scan that stops matching fails open and silently. One real instance: a
CI image shipped BusyBox `grep`, which rejects `--exclude-dir`; the `|| true` on the
scan swallowed the usage error and the gate reported "no matches found" on every tree,
forever, while a real violation sat in two tracked files.

The **in its own job** half is not a detail. Both gates that had gone blind upstream
already carried passing test suites — the suites ran in a job with GNU `grep` and the
gates ran in a job with BusyBox `grep`, so they were evidence about that image and
nothing else. Same job is the only way to say "same image" in a CI config, so each gate
runs `--self-test` first, in the job that runs the real scan, and
`check-gate-selftest-parity.sh` asserts that every gate does. Its only opt-out category
is `EXTERNAL` — the gate's input is not the repository, so no fixture can represent a
violation. There is deliberately no "verified by hand once" category: upstream parked
twelve gates in one, and when each was later neutered on purpose, every one still passed
on the real tree, because a compliant tree never executes the detection path at all.
`make gate-self-tests` remains a local convenience; it is not what proves the property.

**2. It fails closed.** A check whose oracle is outside the repo (issue state, an
advisory feed, a published artifact) treats an unreachable oracle as a **failure**, with
one named, reviewable opt-out (`ALLOW_UNRESOLVED=1`). A gate that silently skips when it
cannot answer is a gate that reports success for the wrong reason. `osv-severity-gate.sh`
is the concrete instance: a missing or unparseable results file means OSV-Scanner's own
scan did not complete (verified against a blocked network path — no partial file, no
output at all), so the gate blocks rather than passing silently, distinct from a genuinely
empty scan (no lockfiles in the tree), which is a clean pass. Its oracle being outside the
repo is also why it is the one gate here that cannot run in `pre-push` at all — see its
entry in `scripts/check-prepush-parity.sh`'s `OPT_OUT`.

:::note
`scripts/osv-severity-gate.sh` and `scripts/gitleaks-precommit.sh` don't end in `-check.sh`
or start with `check-`, which is the naming pattern `check-gate-selftest-parity.sh` uses to
recognize a gate — so neither registers with it, even though both self-test in the same CI
job as their real scan, by the same rule every other gate here follows. Naming them to
match the pattern would trade a name both upstream ports already use, and this issue's own
acceptance criteria assume, for a mechanically-enforced checkbox neither needs to be
useful.
:::

**3. It scans the repository, not the directory.** `scripts/lib/git-ignored.sh` provides
`is_ignored` and `drop_ignored_lines`. Without them a gate reads ignored artifacts — local
reports, scratch dirs, downloaded fixtures — that CI's clean clone never sees, producing a
false RED **locally only**, naming a real file with a real violation. The identical gate
passing in CI is the only tell, and nothing in the output points at it.

**4. The mirror list is derived, not hand-kept.** `make pre-push` is only worth its green
if it covers what CI covers. A hand-maintained list is correct the day it is written and
silently incomplete after — and two Make targets one character apart will hide the hole
from anyone reading either. `check-prepush-parity.sh` reads the CI configuration and
fails when a gate script has neither a Makefile mirror nor a recorded reason it cannot
have one. Add new gates to the `Makefile`, not to a list inside the parity check.

## Declaring a load-bearing call site

Most of the gates above hunt for something that should not be in the tree. `check-load-bearing.sh`
is the inverse: it asserts something *is* there. It exists for one failure class — a guard
wired in by a single line, where deleting that line leaves the whole suite green and the
guard simply stops guarding.

The shape recurs: a validator installed at the top of a shared test-setup helper, a hook
entry in a config file, an ignore filter inside a tree walk. Upstream, one
`installSchemaGuard(page)` call was what made ~290 Playwright specs validate their mock
payloads against the OpenAPI schema; all 290 pass without it.

Declare a line in `load-bearing.declarations` when **all three** hold:

1. It *wires in* a guard, hook, filter or validator — the line causes the work to happen
   rather than doing it.
2. There is exactly one of it. Losing one of ten is visible; losing the only one is not.
3. Deleting it leaves the suite green. **This one is a test, not an argument** — delete
   the line and run the suite before declaring it. If something already fails, that
   something is the gate, and a declaration adds only ceremony.

```
path: hooks/pre-push
call: if ! make pre-push-checks 2>&1; then
why:  The only local invocation of every pre-push gate. Delete it and the hook
      still installs, still runs, and checks nothing.
```

`call:` is matched as a fixed string anywhere on a line, so indentation is not part of it
and regex metacharacters are literal. `why:` is **required**: a declaration with no stated
reason fails the gate rather than standing as a silent switch. When the gate fires you
restore the call, move the declaration to the guard's new home, or delete the stanza and
say in the MR what covers this now — all three are reviewable one-line diffs. The gate
cannot stop a removal; it makes one visible.

**Why a manifest and not a comment on the line.** The obvious alternative — annotate the
call site itself and grep for the marker — cannot work, structurally: deleting the call
deletes the marker, the gate finds zero markers, and zero markers is exactly what a repo
that declared nothing looks like. It reports OK. A marker can only prove its own
*presence*, and the event this gate exists to catch is an *absence*, so the declaration
has to outlive the line it describes. That is also the manifest's cost — a declaration
living away from the code can rot in the other direction — so both rot directions a text
scan can see are errors: a declared file that no longer exists, and a declared call that
no longer appears in it. A declared path that git *ignores* is an error too, because it
would resolve on a developer's machine and vanish in CI's clean clone.

What it cannot see is **reachability**: a declared call inside a module nobody imports any
more still passes, and the verdict line says so on every run. And a repo that has declared
nothing passes trivially — a state indistinguishable from a broken gate, which is why the
`--self-test` rather than the green is what proves the machinery works.

## The gate ledger

Agent gates (`architect`, `security-review`, `rbac-check`, …) leave their outcome in the
MR's `## Gates` section, one machine-readable line each. It is the only record of gate
*yield*: without it, a gate that runs on every MR and never finds anything is
indistinguishable from one that catches real defects — both look like compliance.
`/kaizen` parses those lines across recent MRs and reports find-rate per gate, which is
what earns a gate a fast-path exemption or costs it its slot.

`0 findings` is a real outcome and must never be omitted; `n/a` (out of scope) and
`skipped` (the user declined it) are different states; and "applied but not actually
run" has no token — so run it. A gate marked `n/a` with a confident one-line
justification is, in practice, usually an unrun gate whose justification was guessed.

## How the tests test themselves

Every layer here answers a question the layer below it cannot. The point of the stack is
not more coverage — it is that **each layer's green means something specific**, and each
one has a known way of lying that the next layer catches.

:::note
**What ships and what doesn't.** The unit/integration-test rules and a `--self-test` on
every gate are in the template today. `ci/python.yml` also ships two concrete,
stack-conditional jobs — `python-schema-fuzz` (contract fuzzing against a live API,
blocking) and `python-nightly-load-test` (a scheduled, budgeted latency check) — inert
(they do not appear in the pipeline at all) until a clone wires up the API-boot hook
script each one names; see [CI pipeline](/guides/ci-pipeline/#python-schema-fuzzing-and-a-nightly-load-test).
Blueprint still ships **no** E2E suite or static-analysis job, because those depend
entirely on your stack. The fuzzing and static-analysis sections below describe the
general pattern — including for a non-Python stack, or a second fuzz target beyond
`python-schema-fuzz` — so results can be trusted, and what went wrong in projects that
added them without these safeguards.
:::

| Layer | Answers | Lies by |
|---|---|---|
| Unit + integration tests | Does this code do what I meant? | Passing on the unfixed build |
| E2E | Does the assembled product work? | Asserting on a stale bundle, or racing a refetch |
| Gate self-tests | Can the checks still detect anything? | — *this is the layer that catches the others* |
| Fuzzing | What did nobody think to write a test for? | Reporting clean for operations it never reached |
| Static analysis (Sonar / CodeQL) | What decays slowly across the whole tree? | Suppressions whose globs stopped matching |

### 1. Watch the test fail

The base of the whole stack, and the cheapest. **Revert the fix, run the new test,
require red, reapply.** A test that has never been seen failing is an assertion about
the author's intent. `tests/CLAUDE.md.example` catalogues the four vacuous shapes that
pass review *and* pass on the broken build — absence assertions that sample before the
action fires, key sequences that cancel themselves, name matchers that bind to a
neighboring node, parameterized guards whose parameter is ignored.

### 2. The gates test themselves

Every `scripts/check-*.sh` ships a `--self-test` that synthesizes a violating fixture and
asserts a rejection, and CI runs it **in the gate's own job**, before the real scan.
This exists because a gate's silent failure mode is reporting OK forever — upstream, a
CI image whose BusyBox `grep` rejects `--exclude-dir` turned a `|| true` scan into a
permanent clean report while a real violation sat in two tracked files. A self-test in a
*different* job would not have caught it: the suites existed and passed, on the other
image. `scripts/check-gate-selftest-parity.sh` is what keeps the rule from being prose.

### 3. Fuzzing — and a gate on the fuzzer

Contract fuzzing drives every documented API operation with generated input and asserts
the responses match the schema. It finds the 500 nobody wrote a test for, because nobody
imagined the input.

Two design decisions matter more than the fuzzer itself:

- **It is scheduled and non-gating.** A fuzz finding is a triage signal, not a merge
  blocker — an unbounded generator on every MR trains people to ignore it. It runs
  nightly with `allow_failure: true`.
- **A coverage gate sits on top of the fuzzer's own output.** Nothing else distinguishes
  *"581 operations fuzzed, all clean"* from *"580 fuzzed, 1 never ran"*. An operation
  that **errors** gets zero checks and the run still ends green — so a separate script
  reads the fuzzer's JUnit report against the API schema and fails when an operation was
  never actually exercised. That script has its own `--self-test`, run in the same job.

:::caution
**The honest caveat, and you must internalize it:** `allow_failure: true` means the
**pipeline reads `success` while the job inside it failed**. Upstream, the API fuzz job
failed 14 of 21 consecutive nightlies, every pipeline green. Never conclude anything
about fuzzing from a pipeline status — query the *jobs*, and read the artifact. An
`<error>` result (never ran) and a `<failure>` result (found something) are completely
different answers.
:::

:::note
**Why `python-schema-fuzz` (`ci/python.yml`) does the opposite of bullet one.** This
section describes the *general* pattern for a fuzzer you stand up yourself: scheduled,
`allow_failure: true`, findings triaged before anything blocks. The shipped Python job
is deliberately **blocking, on relevant MRs** instead — it ports a real precedent where a
schema-fuzz job spent one release non-blocking specifically to build up a baseline, then
flipped to blocking once every backlog finding had a scoped, justified entry in
`schemathesis-baseline.json` (schemathesis's own "accepted known failures" mechanism,
matched by operation + check + failure class, not by the random value generated). The
baseline file does the same staging job `allow_failure: true` does elsewhere in this
section, just scoped to individual findings instead of the whole job. It also has no
operation-coverage gate on top of it (bullet two above) — that is a real gap relative to
this general pattern, not a design choice, and a good candidate to add if you rely on
this job heavily.
:::

### 4. Static analysis, and a gate on the suppressions

Sonar and CodeQL catch the slow decay a diff review cannot see. Both have the same
structural weakness: **the suppression list rots silently**.

- A Sonar exclusion is a *reviewed false positive* — but nothing checks its glob still
  points at anything. Upstream, a rename moved `useProjectChangelog.ts` → `.tsx`, an
  `activity/*.ts` pattern stopped matching, four suppressed findings resurfaced, and the
  reliability rating fell **A → D with no job going red**. The fix is a pure path-matching
  gate (no network, no token, under a second) that runs **on every MR** — deliberately
  *not* tied to the scan itself, which is scheduled-only and non-gating.
- **Inline `// codeql[rule-id]` comments suppress nothing.** They are greppable human
  notes; the findings they annotate stay open. Under default setup there is no
  query-filter lever either — the only mechanism that clears a false positive is
  dismissing it in the UI.
- **A scheduled-only scan is invisible to every pre-merge gate**, and its findings still
  read as open at pre-fix line numbers after the fix merges. Check when the last analysis
  actually ran before believing any number from it.

### 5. What none of it covers

Say the scope out loud, or a `0 findings` gets read as safety. A dependency scanner reads
the lockfile — so a browser binary a test framework downloads at install time is outside
it entirely, and reports clean because it was never looked at. `scripts/CLAUDE.md`
makes this a rule: **if a check bounds its own coverage, log what it dropped.**
