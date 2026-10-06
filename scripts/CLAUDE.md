# Gate rules

Loaded automatically whenever Claude reads or edits a file under `scripts/` — this
is where check scripts and CI gates live. The same lessons apply to `ci/**` and
`.gitlab-ci.yml` / `.github/workflows/**`; see `ci/CLAUDE.md`.

A gate is a script that says yes or no about the tree. Its whole value is that a
green result is *evidence*. Everything below exists because a gate reported OK
on a tree that violated it — which is worse than having no gate, because the
green was believed.

## A gate must be able to fail

Ship every check script with a `--self-test` that synthesizes a violating
fixture, runs the real decision path against it, and asserts the gate says no.

**Run it in the gate's own CI job, first, before the real scan — not in a
shared self-test job.** The half that rots is environment-dependent, so a
self-test that ran in a different job ran on a different image and is evidence
about that image, not about the gate. Upstream, the two gates that had gone
blind *both already had passing test suites*; the suites ran in a job with GNU
grep and the gates ran in a job with BusyBox grep. Same job is the only way to
say "same image" in a CI config.

`scripts/check-gate-selftest-parity.sh` enforces this. Without it the rule is
prose, and the property it asserts is invisible by construction: a gate that has
gone blind reports **OK**, so nothing else in the run will ever mention it. The
gate's only opt-out category is `EXTERNAL` — the input is not the repository, so
no fixture can represent a violation. There is deliberately no "verified by hand
once" category: upstream parked twelve gates in one, and when each was later
neutered on purpose, every one still passed on the real tree, because a
compliant tree never executes the detection path at all.

The half that rots is **discovery**, not judgment. The judgment half either
answers or errors loudly; a scan that stops matching fails open and silently.
Give the discovery half its own offline mode (`--list`) and test that a tree
carrying a violation is seen at all.

Concrete instances of a gate going blind:

- **BusyBox `grep` rejects `--include` / `--exclude-dir`.** On an Alpine job
  image, a scan wrapped in `|| true` swallows the usage error and reports "no
  matches found" — forever, on every tree. One real boundary violation passed
  this way. Detect an unsupported flag and **exit non-zero**; never let a
  fallback quietly narrow the scan.
- **`|| true` on the scan itself.** It is there because `grep` exits 1 on no
  matches, which is a clean pass. It also swallows exit 2, which is the gate
  being broken. Distinguish the two, or check the flag support up front.
- **Any early-exiting reader on a pipe, under `set -o pipefail`.** `| head -n 1`,
  `| grep -q`, `| grep -m1`, and a `| while read …; do … return; done` lookup
  helper are one class under four names: each stops reading at its first answer.
  A writer still flushing takes SIGPIPE, `pipefail` promotes **141** to the
  pipeline's status, and the gate reports a satisfied assertion as a failure —
  often with an empty log, because `set -e` aborts before anything prints.
  Upstream met it four times, and each sweep for "more of these" searched for the
  previous name and missed the next one.

  It fails in **both** directions. `printf "$x" | grep -q 'header'` reds an
  unchanged tree, a different header each run, and clears on retry.
  `printf "$body" | grep -q 'try_files' || continue` on a body past the pipe
  buffer skips the whole block — a **false green**. The race is **payload- and
  scheduling-sized**: upstream measured 1 run in 300 under CPU contention in the
  job's own image, and 0 in 400 on macOS, which is why the shape survives local
  runs indefinitely and passes before a rebase and fails after, with no diff to
  blame.

  Feed the reader a **here-string** (`grep -q X <<< "$x"`, `done <<< "$VAR"`): no
  second process, so an early exit has nothing to signal. Read a file directly
  (`grep -m1 X file`) rather than `grep X file | head -1`. `awk … | grep -q` is the
  same bug — awk is a writer too — so nest here-strings. Give the self-test a case
  whose input is padded **past the pipe buffer**, where the race stops being a
  race and the failure is deterministic, and add a static scan that fails if
  `| grep -q` or `| head` returns to the gate script. A static guard needs its own
  negative control: one that only ever sees a clean tree proves nothing.

  **Make the static scan a walk, not a list.** The scan that catches this class
  must enumerate every shell file under its roots — `.sh` extension or a sh/bash
  shebang — not a hand-maintained set of paths. A list is correct the day it is
  written and covers exactly the files that have already been bitten; upstream it
  is how `release.sh` stayed outside the guard through two prior sweeps, and how
  Blueprint shipped the same line in its own duplicate-tag guard. The gate is
  `scripts/check-sigpipe-readers.sh` (`make check-sigpipe`). A site whose input is
  provably tiny and bounded takes an inline `# sigpipe-ok: <reason>` marker — the
  reason is required, so a bare marker is still an offender and the exception is
  read by the next person rather than being a silent switch.

## A self-test proves the gate can say no — not that it reads real input

A `--self-test` synthesizes the smallest input that reaches the decision path.
That is the right proof that a gate *can fail*, and the wrong proof that it
reads what real tooling *emits*: the author writes both the parser and the
fixture, so they agree by construction. Blueprint's application-aware gates
had passing self-tests and still crashed on a drf-spectacular `NullEnum`,
ignored `interface X extends Y`, and flagged every `squashmigrations` output —
each visible the first time the gate met a realistic tree.

For a gate whose input is application code, add a case to
`scripts/tests/app-fixture-gates.test.sh` against the fixture that
`scripts/tests/lib/app-fixture.sh` generates at run time (never committed —
every downstream project is a clone of this tree), written
in the shape the real generator produces (copy real output, do not paraphrase
it). See `ci/CLAUDE.md`, "Application-aware gates vs. a real app tree".

## A self-test must tell a crash from a rejection

A probe that reads **any** non-zero exit as "correctly rejected" cannot tell a gate that
said no from a gate that never ran. Upstream, a check shelled out to `python3`, which the
job's Alpine image did not carry. Under `set -euo pipefail` it died at 127 before printing
anything, and its self-test printed three `SELF-TEST OK` lines for a gate that had not
executed a single check. The log read as though the pattern were over-matching.

- **Demand the exact rejection code** — `exit 1`, not merely non-zero — and keep other
  codes for "the gate itself is broken" (`2`, `127`).
- **Demand the gate's own verdict line, in both directions.** Print a count line after
  every count and before every verdict; its absence proves the script never reached one.
- **Read the signature.** Failures on exactly the expect-*pass* fixtures are a crash, not
  an over-matching pattern.
- **Write to the job image's toolset** instead of adding interpreters to it — POSIX /
  BusyBox awk has no `gensub`, `ENDFILE`, `\s`, or `\b` — and verify in that image
  (`docker run --rm -v "$PWD":/w -w /w <image> sh -c '… --self-test'`), not a local proxy.

## Stage a backlog by rule severity, not by `allow_failure`

A new detector opens with a backlog. Shipping its job `allow_failure: true` looks
cautious and is worse: a failing `allow_failure` job renders as a **green** pipeline, so
the reviewer who needs the signal never sees it, and a permanently yellow job is one
everybody learns to scroll past. Make the job **blocking** from day one and stage the
backlog *inside* the tool — rules with a clean tree at `error`, rules with a backlog at
`warn` (every finding printed, none reaching the exit code), each promoted to `error` in
its own change as it reaches zero. Red then means exactly one thing: a class declared
clean has regressed.

Before trusting the detector, plant the violation it exists to find. Upstream, a
dead-export scanner reported clean for a freshly created file exporting a symbol nobody
imported: a framework plugin read `import.meta.glob` patterns but ignored their `?raw`
option, so a handful of source-text scans made the whole tree look imported.

## A gate that cannot reach its oracle must go RED

If a check resolves state outside the repo (issue status, published artifacts,
an advisory database), a lookup failure is a **failure**, not a skip. Fail
closed, and provide one explicit, named opt-out (`ALLOW_UNRESOLVED=1`) that a
reviewer can see in the diff.

Corollary: a gate whose input is *not the repository* cannot live in `pre-push`.
No commit can fix it, and a red would block an unrelated push. Record it as an
opt-out in `scripts/check-prepush-parity.sh` with the reason.

## Scan the repository, not the working directory

`find` and `grep -r` see ignored artifacts — local reports, scratch dirs,
downloaded fixtures — that CI's clean clone never has. The result is a false RED
**locally only**, naming a real file with a real violation, on a file CI cannot
see. The identical gate passing in CI is the *only* tell, and nothing in the
output points at it.

Source `scripts/lib/git-ignored.sh` and guard the loop with `is_ignored`, or
pipe `grep -rn` output through `drop_ignored_lines`. Test it by planting an
ignored probe file that contains a violation and asserting the gate stays green.

## Keep the pre-push set complete by derivation, not by hand

`make pre-push` must mirror the CI gates, or its green is worthless. A
hand-maintained mirror list is a historical accretion: it is correct on the day
it is written and silently incomplete forever after — and two Make targets one
character apart will hide the hole from anyone reading either.

`scripts/check-prepush-parity.sh` derives the CI set from the CI configuration
and fails when a gate script has neither a Makefile mirror nor a recorded reason.
Add new gates to the Makefile, not to a list inside the parity check.

## Prefer a marker that means one thing

When a gate hunts for annotations in source, make the marker **opt-in and
unambiguous** (`SUPPRESSED-UNTIL(#N)`, `TODO(#N)`). Do not infer intent from a
bare issue reference near a suppression: most such references are explanatory
history, and flagging them on the day they become most accurate produces a gate
whose findings are mostly noise. A noisy gate gets deleted, and the real signal
goes with it.

## A guard wired in by one call site needs its own gate

Some guards protect everything and are protected by nothing. The shape recurs: a
validator, a schema check, a safety hook, an ignore filter — installed by **one
line** at the top of a shared helper, or one entry in a config file. Delete that
line and every test still passes. The guard stops guarding, silently, forever.

Upstream the instance was `installSchemaGuard(page)`, a single call at the top of
a shared Playwright setup helper, which is what made ~290 e2e specs validate
their mock payloads against the OpenAPI schema. All 290 pass without it. The gate
that watched that one line existed for no other purpose, and that is the correct
amount of machinery for the problem.

The generic form is `scripts/check-load-bearing.sh` and the stanzas in
`load-bearing.declarations`. Declare a line when all three hold: it *wires in* a
guard rather than doing the work, there is exactly one of it, and deleting it
leaves the suite green. That last one is a test, not an argument — delete the
line and run the suite before declaring it. If something already fails, that
something is the gate and a declaration adds only ceremony.

**Why a manifest and not a marker at the call site.** The obvious alternative is
to annotate the line itself — `# load-bearing: <reason>` — and grep for the
marker. It cannot work, structurally rather than as a matter of taste:
**deleting the call deletes the marker**. The gate then finds zero markers, which
is indistinguishable from a repo that declared nothing, and reports OK. A marker
detects its own *presence*; the event here is an *absence*, so the declaration
has to outlive the line it describes, which means it has to live somewhere else.

That is also the manifest's cost — a declaration away from the code can rot in
the other direction — so both rot directions a text scan can see are errors: a
declared file that no longer exists, and a declared call that no longer appears
in it. What it still cannot see is **reachability**: a declared call inside a
module nobody imports any more passes, and the verdict line says so on every run.

"Prefer a marker that means one thing", just above, still applies — to the
manifest's own format: `call:` is opt-in and unambiguous, and `why:` is
**required**, so a declaration with no stated reason is an offender rather than a
silent switch.

A declaration list also cannot accumulate a backlog — nothing is declared until
someone declares it — so every rule ships at `error` and the `warn` staging in
"Stage a backlog by rule severity" has nothing to stage.

## Do not exclude a tree to stop a gate flagging its own docs

A gate that hunts for a literal marker will match the prose describing it. The reflex —
excluding `*.md` and config from the scan — blinds the gate to real debt in exactly the
files nobody re-reads. Write the prose so it is not a marker instead: use a digit-free
placeholder for issue numbers, and drop the trailing colon when naming a colon-suffixed
marker. Self-exclude the gate's own file, and nothing else.

## An exclusion is a deferral when the excluded content gets copied

Excluding a directory does not remove a violation from the tree — it removes the
gate's ability to *see* it. If the excluded content is later **copied into a scanned
location**, the violation materializes then, at whatever moment that copy happens.

This gate red its own release exactly that way. `changelog.d/` was excluded, so a
fragment carrying a literal marker sat there for weeks, invisible. At release time
the assembler merged it into `CHANGELOG.md` and the notes generator copied it into
`docs/releases/` — both scanned. The gate fired correctly, on the release MR, on
content written long before and never editable in that context again.

So: before excluding a directory, ask **where its contents end up**. Templates,
changelog fragments, snippet libraries, fixture sources, and anything a generator
reads are all copied into scanned files by design. Exclude build output and vendored
third-party code — things that are *produced* or *imported*, never *authored*.

## Say what the gate did not cover

If a check bounds its own coverage — top-N, no retry, sampling, a scanner that
cannot see a bundled binary — **log what was dropped**. Silent truncation reads
as "covered everything". `0 findings` from a scanner that could not see the
artifact is a statement about *scope*, not about safety.

## Diagnose a red gate against its base before opening the file it names

A gate that accuses your diff is often reporting a **stale base**: the default
branch already deleted that marker, already shipped the cap the new spec asserts,
already renamed the symbol. Fetch and diff against the current base first. A
spec failing because its subject has not merged yet is the gate *working*.
