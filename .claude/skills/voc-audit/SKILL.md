---
name: voc-audit
disable-model-invocation: true
description: >
  Run a Voice-of-Customer panel against a surface that has already SHIPPED — a
  merged feature, page, or flow — verify every finding against the code, then
  cross-reference the survivors with the issue tracker. Produces a ranked
  "file new / boost priority / already tracked" matrix. Distinct from /voc,
  which evaluates a spec before it is built; distinct from /ux-review, which
  checks design-system compliance; and distinct from /sunset-check, which
  decides whether a surface should exist at all. voc-audit reasons about
  persona-level friction in what actually exists.
argument-hint: "<merged PR, page, or feature name> [--calibrate]"
---

# VoC Audit — Persona Review of Shipped Surfaces

## What this produces, and what it is not

**Simulated feedback from modeled personas. Nobody is asked anything.** A model
reasons from composite personas in `.claude/personas.md`. That is a legitimate
post-launch proxy and an illegitimate substitute for a user report. Three rules
follow, and they are not stylistic:

- **Never present panel output as customer feedback** — not in an issue, PR, ADR,
  roadmap entry, or commit message. If a finding is worth filing, file it on its
  merits and say a simulated panel surfaced it.
- **Two panels agreeing is not corroboration.** It is the same model agreeing
  with itself. Only a real user report corroborates a modeled finding.
- **Check for real signal first.** If a real report already covers the question,
  it decides. Scope the panel to the remainder, or skip it. Never run a panel to
  argue a real report away.

---

## Step 0 — Resolve the target surface

From the argument, resolve exactly what shipped: the merged pull request(s) (PRs —
`gh pr view <N> --json title,body,files,mergedAt,mergeCommit`), the files, the
routes or endpoints, and the release it landed in. If the target is ambiguous,
ask — auditing the wrong surface wastes the whole run.

## Step 1 — Inventory what shipped

Read the code. Produce a factual brief of the surface **as it exists**: what a
user can do, what they cannot, what states exist (empty, error, loading,
permission-denied), and what is stubbed.

This brief is the panel's only ground truth, so its errors propagate to every
finding. Record what you actually read, file by file.

## Step 2 — Choose the personas that can reach this surface

**Seat personas by reachability, not by role plausibility.** The failure mode:
seating four personas because the surface is "PM-facing", when three of them do
their top-three daily tasks somewhere else entirely. Those three then mark their
own criteria N/A *and* drag the average down with floored scores — the panel
reports a low number that means "wrong audience", not "bad surface".

Seat a persona only if this surface is on the path of one of their top-three
tasks. Name the ones you excluded and why.

## Step 3 — Run the panel

Spawn one sub-agent per seated persona, in parallel. Each returns:

```
## <PERSONA>: N/10  [🔴 blocker | 🟡 friction | 🟢 fine]

### Material improvements (ranked by daily-task impact)
- <finding> — falsification line: <a real-world observation that would prove this wrong>

### Already-acceptable aspects
### What this persona could NOT see
```

The **falsification line is mandatory and must predict an observation about the
world**, not a code condition. "There is no export button" is a code check, and
Step 4 spends it. "Users will abandon this flow rather than paginate" is a claim
a later real report can confirm or refute. Only the second kind can ever be
scored.

---

## Step 4 — Verify every finding against the code, BEFORE touching the tracker

**This is the step that makes the run worth doing.** The panel is a hypothesis
generator; this is the only step that touches ground truth. Searching the tracker
first means filing model output as fact.

Deduplicate first — personas surface overlapping concerns. Merge identical
substance into one entry and credit each persona that raised it.

Then execute each finding's falsification line against the tree. Read the
component, grep the symbol, check the schema, read the issue the finding assumes
is open. Assign one of three outcomes:

- **survived** — the check ran and the finding stands. Carry it to Step 5, and
  record what you checked, so the report rests on a `file:line` rather than on a
  persona.
- **falsified** — the condition was met; the finding is wrong. **Drop it and say
  so in the report.** A falsified finding is a result, not an embarrassment — it
  is the run demonstrating it can tell its hypotheses from reality, and it is
  what keeps wrong issues out of the tracker.
- **surfaced-during-verification** — the check falsified the finding as stated but
  exposed a real defect one layer away. These are frequently the strongest
  findings in a run. **Attribute them to the check, never to a persona** —
  crediting a persona with a finding it did not make corrupts calibration.

Two rules that matter more than they look:

- **A finding that rests on an absence must be verified as absent.** "There is no
  X" is the most common false finding, because the Step 1 brief can be wrong and
  the personas take it as given. Grep before you believe it.
- **Re-check the brief itself.** If verification shows Step 1 misstated the
  shipped behavior, every finding downstream is suspect — say so, rather than
  quietly correcting one row.

**Code verification is not falsification.** "Verified against the default branch
at `<sha>`" proves the defect exists; it does not predict what a user would say,
which is the only thing calibration can score. A finding whose falsification line
merely restates a code check is **unscoreable** — it counts against the panel,
not for it. Write the real-world line before filing, or file it explicitly marked
unscoreable so the ledger is not misled about what the panel staked.

Record the counts: survived / falsified / surfaced-during-verification. Panel
yield and verification yield must be tellable apart over time.

---

## Step 5 — Cross-reference survivors against the tracker

Only **survived** findings reach this step. For each, search the tracker in
**all** states (open and closed) with 2–3 keywords; run one search per facet of a
multi-faceted finding:

```bash
gh issue list --state all --search "<keywords>" --limit 30 \
  --json number,title,state,stateReason,closedAt,labels,milestone
```

(`stateReason` is GitHub's close reason — `COMPLETED` or `NOT_PLANNED`; read the closing
comment too, since it is where the *why* lives.) Assign a state:

- **`tracked in #N (priority: P)`** — an open issue exists; P is its current priority
  as the tracker records it (its `release:*` label and milestone, or a priority label if
  the project uses one). If the panel raises urgency above it, mark it a **boost
  candidate**.
- **`closed #N (<date>, <close reason>)`** — read the close reason. Do **not**
  silently re-file. Classify with the user as: regression / new instance of the
  same class / already-decided.
- **`untracked`** — eligible for a new issue.

As you go, separate **real** reports from modeled ones. An issue filed from a
user's words is evidence of a different kind from one filed off a panel —
including this one. A finding a real user also raised is **corroborated**; a
finding matching only other panel-filed issues is **not**. Write "raised again by
the panel", never "confirmed by users".

---

## Step 6 — Report

```
# VoC Audit — <surface> — <date>

## Surface reviewed        <files, routes, release>
## Personas seated         <and who was excluded, and why>
## Panel verdict           <per-persona scores — context only, never a decision>
## Verification yield      <survived / falsified / surfaced-during-verification>

## File new                <untracked survivors, ranked by impact × frequency × personas>
## Boost priority          <tracked, with current and proposed priority>
## Already tracked         <no action>
## Already decided         <closed and not a regression>
## Falsified               <reported, not filed — with what falsified each>
## What the panel could not see
```

**The panel average never authorizes a decision.** It is context. What leaves
this skill is the verified findings and their falsification lines.

---

## Step 7 — File (only with user confirmation)

Confirm the "file new" list with the user before creating anything. Each issue
carries, in separate fields: the verification (`file:line`, the grep, the query)
and the falsification line. Label them so they are distinguishable from real user
reports forever after.

---

## `--calibrate`

Once the surface has real users, score what the panel predicted against what
users actually reported, and append the result to a calibration ledger
(`.claude/persona-calibration.md`). A release that shipped to users with no
calibration entry is a finding for `/kaizen`, not an oversight to catch up on
later.

Calibration is the only thing that tells a useful persona from a plausible one.
Without it, the panel is unfalsifiable by construction.

---

## When the answer is "this should not exist"

This skill's matrix — file new / boost priority / already tracked — has no cell
for that, and forcing one produces an improvement issue against a surface nobody
should be improving. **Hand the question to `/sunset-check`** and say so in the
report. The tells: the panel keeps returning the same friction release after
release; the surface's docs promise materially more than its code does; or a
persona's honest answer to "what would you do instead" names a different feature
that already exists.
