---
title: Testing AI-written code
description: Why coverage isn't proof when an AI writes both the code and the tests, what fuzzing and mutation testing add, and how TruePPM runs them.
---

**The big picture:** when an AI writes the code *and* the tests, a green suite with high
coverage proves less than it seems. Two techniques check the tests themselves:
**fuzz (property-based) testing** attacks the code with inputs nobody thought of, and
**mutation testing** breaks the code on purpose to see whether the tests notice.

**Why it matters:** coverage says a line *ran* during a test, not that anything checked
its result. An AI that misreads a requirement tends to write a test that agrees with its
own misreading, so code and test are wrong together and stay green. You need a check
that doesn't share the author's assumptions.

**How it works:**
- **Fuzzing** generates hundreds of inputs per run, including the odd ones, and checks
  that stated *properties* always hold ("the result is never negative", "the API never
  returns a 500").
- **Mutation testing** changes the code (flips a `<` to `<=`, deletes a line), reruns
  the suite, and counts how many changes the tests caught.
- Both run **nightly** or on a narrow scope, not on every push. They are slow.

## Fuzz and property-based testing

| Tool | Fuzzes | What it finds |
|---|---|---|
| [Hypothesis](https://hypothesis.readthedocs.io/) (Python) | Functions and classes | Inputs that break a property you declared; shrinks to the smallest failing case |
| [Schemathesis](https://schemathesis.readthedocs.io/) | A running API, from its OpenAPI schema | 500s, and responses that don't match the schema |

An example test checks one input you chose. A property test checks a rule over many
inputs you didn't. The AI can't have tuned the code to inputs it never saw.

**Run it in two tiers:**
1. **A deterministic profile on every MR.** Fixed seed, small budget, so a red result is
   always a real, reproducible finding.
2. **A deep stochastic profile on a nightly schedule.** Big budget, saved corpus of past
   failures, and it never blocks an MR. A red nightly is a triage signal: turn the
   failing case into a plain deterministic test, then fix.

## Mutation testing

A *surviving mutant* is a code change the suite did not catch. It names a specific line
whose behavior no test pins down.

- **Score = caught mutants ÷ total.** Read the survivor list, not just the number.
- **Equivalent mutants** change the code without changing its behavior, so no test can
  catch them. Remove them from the code or accept them; don't chase 100%.
- **Pin the tool version.** A new mutation tool version can change what gets mutated and
  move the score with no change on your side.
- **Report first, gate later.** Run report-only until you have several nights of data,
  then set the floor *from that data*. Lower the floor only with a recorded reason.
  Raising it to quiet a red run deletes the finding.
- **Scope it.** Start with the few modules where a wrong answer is costly.

## How TruePPM uses them

TruePPM (the [project management app](https://gitlab.com/trueppm/trueppm) built on this
harness) runs all of it in its own `.gitlab-ci.yml`:

| Job | Technique | Posture |
|---|---|---|
| `scheduler:fuzz-deep` | Hypothesis, `deep` profile, split across four shards | Nightly only, never blocks an MR |
| `api:fuzz` | Schemathesis against the live API | Nightly, non-blocking (`allow_failure`) |
| `scheduler:mutation` | mutmut over the scheduler's `models`, `derive`, and `cli` modules | Nightly **fails below a floor**; MRs that change the measured code run it as informational; MRs that change the mutation setup itself gate |
| `api:mutation` | mutmut on a high-risk API module | Report-only until a baseline exists |

The same Hypothesis properties also run on every MR in the deterministic profile.
TruePPM added the API mutation job after computations in that layer shipped wrong on a
green suite twice.

## What Blueprint ships today

- **Schema fuzzing:** `python-schema-fuzz` in `ci/python.yml`. See
  [CI pipeline](/guides/ci-pipeline/#python-schema-fuzzing-and-a-nightly-load-test).
- **Property tests and mutation testing:** not shipped. Add Hypothesis to your own test
  suite, and a scheduled mutation job modeled on the table above.

**Bottom line:** treat coverage as a floor, not a verdict. When an AI writes both sides,
let a fuzzer and a mutation run decide whether the tests are any good.
