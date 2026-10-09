---
name: kaizen
description: Audit the development harness (CI, agent gates, pre-push, PR flow, the CLAUDE.md rules) for friction and propose a small, ranked list of speed wins. Distinct from /pre-release, which audits the codebase — kaizen audits the *process*. Reports and optionally files tooling issues; it never changes the harness itself.
argument-hint: "[--silent | --no-file]"
---

# Kaizen — Continuous Harness Improvement

Audit the *development process itself* — the CI workflows (GitHub Actions), the agent
gate chain, the pre-push hook, the pull request (PR) flow, and the `CLAUDE.md` rules that
govern how change ships — for friction, and propose a small, ranked list of speed wins.

The tracker and CI are GitHub. Every `gh` command below resolves the repository from the
origin remote; with no origin (or no GitHub repo yet) they fail with a "no git remotes"
error. Then 1a, 1b and 1g have no data: record each as "n/a — no GitHub repo" in the
report and audit what is local (1c's commit scan, 1d, 1e, 1f). Never point them at a
guessed repository.

**Scope discipline.** `/pre-release` audits the **code**. `/kaizen` audits the
**harness**. It proposes; it does not apply. Any change it recommends lands through a
normal branch + PR, reviewed like any other.

---

## When to run

- On demand, when the workflow feels slower than it should.
- As a periodic checkup (e.g. once per milestone), or as the pre-flight step of a
  `/pre-release full` audit.
- After a burst of process pain (repeated CI failures, a gate that keeps firing on
  changes it never finds anything in).

---

## Arguments

- `--silent` — report only; do not offer to file issues.
- `--no-file` — same as `--silent` for the filing step.

---

## Step 1 — Gather signals (run in parallel)

Launch these as parallel sub-agents (`model: "sonnet"`) and wait for all. Each returns
a compact finding list, not raw logs.

### 1a. PR cycle-time signals
> From the tracker, pull the last ~30 merged PRs and compute time from opening to
> merge. Flag PRs that sat > 48h and cluster the reasons (CI failures, review
> latency, rework).
> `gh pr list --state merged --limit 30 --json number,title,createdAt,mergedAt,commits,statusCheckRollup`
> (`commits` gives the first push; `statusCheckRollup` shows the checks that failed along
> the way). Return the slow outliers and the dominant cause.

### 1b. CI job duration leaders
> From the last ~5 workflow runs per workflow on the default branch
> (`gh run list --branch main --limit 20 --json databaseId,workflowName,conclusion`),
> list the slowest jobs by wall-clock (`gh run view <id> --json jobs` — each job carries
> `startedAt` / `completedAt`). Flag any single job over 5 minutes and any workflow that
> dominates total CI time. Return the top time sinks with durations.

### 1c. Override and skip signals
> Scan the last ~50 commits and recent PR descriptions for gate escapes: `--no-verify`,
> "skip the review", "skip security gate", `[skip ci]`, disabled checks, `# type: ignore`
> / `eslint-disable` clusters. A gate that is skipped > 20% of the time is either
> misplaced or ceremonial. Return each skip pattern with its frequency.

### 1d. Pre-push / local-gate runtime
> Measure or estimate how long the project's pre-push gate takes (the `make pre-push`
> equivalent, or the pre-push hook). A local gate over ~60s trains people to bypass it.
> Return the runtime and the slowest step.

### 1e. Mandate vs reality
> Compare the gates `CLAUDE.md` says are mandatory against what actually runs in
> practice (from 1a–1c). Flag mandates that are silently skipped — either the mandate is
> wrong (needs a fast-path carve-out) or the enforcement is missing (needs a hook/CI
> check). Return the mismatches.

### 1f. Documentation drift
> Spot rules in `CLAUDE.md` / `.claude/` that no longer match how the repo actually
> works (a referenced script/agent that was renamed or removed, a path that moved, a
> gate that no longer exists). Return each stale rule.

### 1g. Gate yield — find-rate, not just skip-rate

1c measures how often a gate is *escaped*. This measures whether it ever finds
anything when it does run — the signal that decides whether a gate keeps its slot.

The `/mr` skill emits a machine-readable `## Gates` section (one
`gate: <name> — <outcome>` line per gate). Parse it across recent PRs:

> Pull the descriptions of the last ~40 merged PRs and extract every line matching
> `gate: <name> — <outcome>`. For each gate name, count: runs with `<N> findings`
> where N > 0, runs with `0 findings`, runs marked `n/a`, and runs marked `skipped`.
> Report a table of gate · ran · found>0 · yield% · n/a · skipped, sorted by yield.

```bash
gh pr list --state merged --limit 40 --json number,body | python3 -c '
import json, re, sys, collections

HDR = "%-28s%5s%7s%8s%6s%6s"
ROW = "%-28s%5d%7d%8s%6d%6d"
tally = collections.defaultdict(collections.Counter)

for pr in json.load(sys.stdin):
    body = pr.get("body") or ""
    for name, outcome in re.findall(r"^\s*[-*]\s*gate:\s*([a-z][a-z/-]*)\s+[\u2014-]\s*(.+)$", body, re.M):
        if name == "completeness-check" and "round 2" in outcome:
            name = "completeness-check:r2"
        t = tally[name]
        if outcome.startswith("n/a"):
            t["na"] += 1
        elif outcome.startswith("skipped"):
            t["skipped"] += 1
        else:
            t["ran"] += 1
            m = re.match(r"(\d+)", outcome)
            if m and int(m.group(1)) > 0:
                t["found"] += 1

print(HDR % ("gate", "ran", "found", "yield", "n/a", "skip"))
for name, t in sorted(tally.items(), key=lambda kv: -(kv[1]["found"] / (kv[1]["ran"] or 1))):
    pct = ("%d%%" % (100 * t["found"] / t["ran"])) if t["ran"] else "-"
    print(ROW % (name, t["ran"], t["found"], pct, t["na"], t["skipped"]))
'
```

How to read it:

- **0% yield over ≥ 10 runs** → strong fast-path candidate. The gate has never
  changed an outcome; propose a carve-out row that skips it for that change class.
- **< 10% yield** → candidate for demotion to opt-in, or for folding into a
  neighboring gate that already reads the same diff.
- **> 50% yield** → the opposite finding, and worth stating explicitly in the
  report: this gate is load-bearing and must not be batched away.
- **High yield with rule-shaped findings** → the findings are mechanical enough to
  become a CI check. Migrating them frees the agent slot entirely.

Two honesty constraints, or the table lies:

- **Yield is only meaningful inside a gate's applicable scope.** A gate correctly
  marked `n/a` on most PRs is not low-yield; those runs are excluded above by design.
- **A 0%-yield gate may be working as a deterrent** — the code was written
  correctly *because* the author knew the gate would run. Weigh that before
  proposing removal, and prefer demotion to deletion when in doubt.

Gate names may carry a `/<mode>` suffix (`completeness-check/fix-diff`); the parser
tallies each mode as its own gate. A label with a space or parenthesis does not match and
is silently dropped — that is a ledger defect to report, not a zero. Three
`completeness-check` readings go beyond yield (see `.claude/agents/completeness-check.md`
§ Recording it):

- **`completeness-check/fix-diff`** is the narrow re-check of the fix commits. Near-0%
  yield over ≥ 10 runs → its executable-behavior trigger is too broad; tighten it.
- **`completeness-check:r2`** is the conditional round-2 full audit. Its `found` counts
  only what round 1 missed, so its yield is the direct measure of whether the second
  agent earns its cost. Also read the `overlap k/N` notes — consistently high overlap
  means the two audits converge and round 2 adds little.
- **The `causes:` tally**, summed across rounds, answers whether up-front requirement
  clarification would pay. If `requirement-unclear` is a real share of findings, propose
  an acceptance-criteria check in `/batch` Step 2; if it stays near zero, the findings
  come from reading the code, and no up-front question would have prevented them.

If the table is empty or sparse, the finding is about the **ledger**, not the
gates: PRs are not recording outcomes, and no yield question can be answered until
they do. Fix that first.

---

## Step 2 — Filter against declined findings

`.claude/kaizen-declined.json` is the ledger of findings a human has already seen and
explicitly declined to act on. **Read it before ranking or reporting anything.** Without
this step, every kaizen run re-proposes what was already rejected, and the user pays the
full cost of re-arguing a finding they already settled — every single run.

The file is a JSON object: `{"$comment": ..., "schema": {...}, "declined": [...]}`. Each
entry in `declined` has:

```json
{ "id": "gate-yield:migration-check:fast-path-candidate", "declined_on": "2026-09-15", "reason": "...", "subject": "..." }
```

`id` is `<category>:<subject>:<claim>`:
- `category` — the signal step that produced the finding: `mr-cycle-time` (1a — the id
  keeps the upstream `mr-` spelling so it matches the ledger's schema and upstream
  ledgers; it means PR cycle time here),
  `ci-duration` (1b), `gate-skip` (1c), `prepush-runtime` (1d), `mandate-reality` (1e),
  `doc-drift` (1f), or `gate-yield` (1g).
- `subject` — the concrete thing the finding is about: a gate name, a CI job name, a
  `CLAUDE.md` rule/section, a file path.
- `claim` — the specific shape of the finding about that subject (`fast-path-candidate`,
  `slow-outlier`, `frequently-skipped`, `stale-rule`, `mismatch`, `load-bearing`, …).

Compute this same id for every candidate finding from Step 1 and drop any finding whose
id exactly matches an entry already in the ledger — do not surface it, do not silently
reword it to dodge the match. Keep a short list of what you suppressed and why (you need
it for the report's "Declined (not re-raised)" section in Step 4).

**Composing the id from subject+claim, not from free text, is what makes a decline
durable across runs and self-expiring when its premise changes.** If a gate's yield
verdict moves from `fast-path-candidate` to `load-bearing`, that is a different `claim`
and therefore a different id — the old decline stops matching automatically, with no
edit to the ledger required, and the (now different) finding is free to surface again.
This is not the only way to revisit a decline — see Step 6 for the explicit un-decline
path, which works even when the claim hasn't changed and a human just wants to revisit it.

---

## Step 3 — Rank by cycle-time impact

Rank findings by **estimated minutes saved per PR**, not by severity. A 30-second win
that hits every PR beats a 10-minute win that hits one PR a month. **Cap the report at
the top 5** — kaizen is about the highest-leverage handful, not an exhaustive list.

For each: state the friction, the estimated time saved, and the concrete change
(a fast-paths carve-out row, a parallelized gate batch, a CI cache, a hook, a deleted
ceremonial check).

---

## Step 4 — Consolidated report

```
# Kaizen — Harness Audit (<date>)

## Top speed wins (ranked by minutes saved per PR)
1. <finding> — saves ~<N> min/PR — fix: <concrete change>
   ...

## Signals reviewed
- PR cycle time: <summary>
- CI duration leaders: <summary>
- Gate skips/overrides: <summary>
- Pre-push runtime: <summary>
- Mandate vs reality: <summary>
- Doc drift: <summary>

## Declined (not re-raised)
<one line per finding Step 2 suppressed: id, declined_on, reason — or "none" if the
ledger suppressed nothing this run>
```

A common, high-value outcome: a gate keeps firing on a change class and finding nothing
→ propose a **carve-out row** for the *Fast paths by change class* table in `CLAUDE.md`,
so that class stops paying for a gate it doesn't need.

**Always include the "Declined (not re-raised)" section, even when empty.** A silent
omission is indistinguishable from "the ledger has nothing relevant" — say which one it
is. If the user wants to revisit anything listed there, point them at Step 6.

---

## Step 5 — File issues (skip if `--silent` or `--no-file`)

Offer to file the top findings as tooling/chore issues — **with confirmation, one at a
time**:

```bash
gh issue create --title "chore(harness): <win>" \
  --body "$(cat <<'EOF'
## Friction
<what's slow and the evidence>

## Proposed change
<the concrete harness change>

## Estimated impact
~<N> min saved per PR
EOF
)" --label "task"
```

`--label` must name a label the repository already has (`/kickoff` creates `task`) —
GitHub does not create one on first use, and an unknown label fails the create. Search
open and closed issues for the same win first (`gh issue list --state all --search
"chore(harness) <key terms>"`). Filing into a dated milestone means asking the user which
`release:*` label applies, per `CLAUDE.md`'s milestone-commitment rule.

Never file without showing the list first.

---

## Step 6 — Decline / un-decline a finding

**Declining is a recorded action, not a silent drop.** If, in this session, the user
says to drop a specific finding from the report (or from future reports) — "skip that
one", "we're not doing that", "decline #2" — do not just omit it going forward. Ask for
(or confirm) a one-line reason if the user hasn't given one, then append an entry to
`.claude/kaizen-declined.json`'s `declined` array with that finding's computed `id`
(Step 2), today's date, the reason, and a short `subject` restating what was declined.
Write the file, show the user the diff, and say plainly that the finding won't resurface
under that id until it's un-declined or its claim shape changes. **Never seed an entry
the user hasn't explicitly declined in the live session** — a finding you merely didn't
raise this run is not a decline.

**Un-declining.** Two ways, both legitimate, both worth telling the user about the first
time this comes up:

1. **Ask /kaizen directly** — "un-decline `<id>`" (or "bring back the migration-check
   finding"). Look up the id (or the closest match by subject) in the ledger, remove that
   object from `declined`, write the file, and confirm what was removed and why it will
   now be eligible to reappear on the next run.
2. **Edit the JSON by hand** — it's a plain, git-tracked file; delete the object and
   commit. This is the same operation as (1) done outside a kaizen session, and is
   useful when nobody wants to spin up a kaizen run just to revert one decline.

A decline also expires **on its own**, without either of the above, the moment its
underlying claim stops matching (Step 2's id-composition note) — e.g. a gate declined as
`fast-path-candidate` that later earns a `load-bearing` verdict is a new id and is never
suppressed by the old entry. Say this once, the first time a user asks how to reverse a
decline, so they don't assume the ledger is append-only.

---

## What kaizen does **not** do

- It does not change the harness — no edits to CI, hooks, or `CLAUDE.md`. It proposes;
  the user lands changes through a normal PR.
- It does not audit product code — that is `/pre-release` and the review gates.
- It does not loop. One pass, top 5, done.
- It does not write to `.claude/kaizen-declined.json` on its own initiative — every
  entry traces to an explicit user decision made in a live session (Step 6).

---

## Anti-patterns to refuse

- A 20-item report. If everything is a priority, nothing is — cap at 5.
- Ranking by severity instead of time-saved-per-PR.
- Proposing a *new* gate as a speed win. Kaizen removes friction; new gates are the
  architect's / security's call, not a cycle-time optimization.
- Weakening a gate purely to make a number go down — never trade correctness for speed.
- Re-proposing a finding whose id is already in `.claude/kaizen-declined.json` as if it
  were new. Suppress it and list it under "Declined (not re-raised)" instead.
- Recording a decline the user did not actually make this session, or declining on their
  behalf to shrink the report. A decline with no real reason behind it is a blind spot
  wearing the shape of a decision.
