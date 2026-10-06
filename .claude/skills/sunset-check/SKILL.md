---
name: sunset-check
description: >
  Decide whether to remove, fix, narrow, or demote an existing surface. Inverts
  the Voice-of-Customer question — instead of "would you adopt this?", it asks
  each persona "this is gone next release, what breaks for you?" — and scores
  removal cost rather than adoption likelihood. Verifies what the surface
  actually does against what the docs and ADRs claim it does before scoring
  anything, because a panel handed an ADR scores a feature that may not exist.
  Use when considering deleting a feature, when a shipped surface is half-built
  or oversold, when maintenance cost is outrunning use, or when asked whether
  something should just be taken out.
argument-hint: "<feature, page, endpoint, or flow>"
---

# Sunset Check

Answer the question "should this still exist?" about a surface that already ships.

---

## What this skill produces — read this before using its output

Like `/voc`, this produces **simulated feedback from modeled personas** plus a
reading of the codebase. It is not user research. Nobody is asked anything.

The provenance rules from `/voc` apply here unchanged and are not optional: every
output carries the Step 5 banner, real signal supersedes the panel, and nothing
this skill emits may be quoted outside a sunset-check context as though it were
customer feedback.

One rule is specific to this skill, and it is the most important line in the file:

> **A simulated panel never authorizes a removal.** Deleting a shipped capability
> is a promise broken to whoever was using it. The panel routes attention and
> prices the maintenance burden; a human decides. A low removal-cost score is an
> argument to *investigate* a removal, never a mandate to merge one.

## Why this is not `/voc` with a different prompt

`/voc` scores **predicted adoption of a proposed addition**. Pointed at a removal
question its number is ambiguous in a way no amount of prompting fixes: a 3/10
cannot be read as "removing this would be bad" or as "this thing is bad" — those
are opposite recommendations and the rubric produces the same digit for both. Its
next-step vocabulary has no removal verb in it either.

`/voc-audit` reviews shipped surfaces, but always *toward improvement*: its output
matrix is file-new / boost-priority / already-tracked. It has no cell for "this
should not exist."

This skill fills the gap. Use it when the question is the surface's continued
existence.

---

## Step 0 — Establish what the surface actually does

**Do not skip this, and do not substitute the design document for it.** A panel
handed an ADR scores a feature *as designed*; the decision in front of you is
about the feature *as shipped*, and on a half-built surface those are different
products.

1. **Find the implementation.** Name the files, the endpoints, the events, and
   the UI entry points. If you cannot find an entry path a user could actually
   reach, that is the single most important finding in the run — say so in the
   first line of the report.
2. **Read what the project claims about it** — the docs tree, the relevant ADR,
   `README.md`, and the changelog entry that introduced it.
3. **Diff claim against code** and classify the surface into exactly one of:

   | State | Meaning |
   |---|---|
   | **Delivered** | Code does what the docs say |
   | **Oversold** | Docs and/or an ADR promise materially more than the code does |
   | **Vestigial** | Code exists, but there is no reachable entry point — or no reader for what it writes |
   | **Undocumented** | Code does something real that nobody was ever told about |

4. **Check reversibility before anything else.** Removal is not symmetric with
   addition: a feature can be re-added, destroyed data cannot, and a broken
   client stays broken. Answer three questions, and put the answers in the report:
   - Does removing it **destroy or orphan user data**? Then the recommendation is
     a deprecation path with a migration, never a delete, whatever the panel says.
   - Is it part of a **published contract** — an API schema, a frozen event list,
     a public library surface? Then removal is a breaking change and carries that
     process regardless of removal-cost score.
   - Is it an **extension point** something else registers against? Their shape is
     a contract with whoever registered.

5. **Price the cost of keeping it.** Nobody on the panel represents this, so
   measure it here and hand it to them as fact: source lines, test files, docs
   pages, ADRs, open issues, and CI jobs that exist *only* to serve this surface.
   An oversold surface also carries a **trust cost** — someone who finds the docs
   overstate one feature reasonably discounts every other claim in them.

> **The Oversold case has no status-quo option.** When Step 0 classifies a
> surface as Oversold, "leave it alone" is not on the menu, because the current
> state actively misleads users. The four verbs collapse to three: fix the code,
> narrow the claim, or remove both. Say this explicitly in the report rather than
> letting inaction win by default — it is exactly how an oversold surface
> survives review after review.

## Step 1 — Establish what evidence already exists

Run **Step 0 of `/voc` verbatim** — the three sources (the tracker, external
practitioner discourse, the calibration ledger), the E0–E3 evidence tier, and the
rule that external category evidence may never be called corroboration. Do not
restate that section here; read it there, so the two skills cannot drift apart.

Two additions specific to a removal decision:

- **Absence of complaint is not evidence of value, and it is not evidence of
  worthlessness either.** On a young product you have neither. Record E0 honestly
  and do not let silence be read as either signal — that inference is how a
  surface both survives and dies for no reason.
- **A competitor's deprecation notice is unusually strong evidence here**, and it
  is public. If comparable tools shipped and then removed this class of
  functionality, their changelog usually says why and their users usually
  replied. Spend a search on it.

## Step 2 — Convene the panel with the question inverted

One review per relevant persona, run in parallel. The question is **not** "would
you use this?" It is:

> "This surface is gone in the next release. What breaks for you?"

Every persona whose workflow could plausibly touch the surface participates, plus
any persona who carries the **trust cost** of an oversold claim — they feel a
removal as an upgrade surprise, and they are the one who notices that the docs
were wrong.

Each returns exactly this shape:

```
## <PERSONA>: removal cost N/10 [BLOCKER | CONCERN | WIN]
"<one sentence in this persona's voice, reacting to the surface being gone>"

What breaks: <concretely, what this persona can no longer do — or "nothing">

Cheapest replacement: <the smallest thing that would make this removal painless
for this persona: an export, a doc line, a different existing feature. "None
needed" if the removal costs them nothing.>

Falsification: <for each BLOCKER and CONCERN, one line naming the real-world
observation that would confirm or refute it after a removal — "nobody reports its
absence within one release", "someone asks where it went in the first week". A
line naming a code check is NOT a falsification line. If you cannot name one for
a BLOCKER, downgrade it to CONCERN and say why.>

Blind spot: <one line — what could a real person in this role tell us that you,
reasoning only from the persona definition, structurally cannot?>
```

Note the inverted severity: a **WIN** means the feature going away is *good* for
that persona.

## Step 3 — Weigh the panel against the cost of keeping

Do not delegate this. The synthesis is the skill.

The panel prices what is lost; Step 0.5 priced what is paid. Neither number
decides alone, and **a removal-cost average is not an inverted adoption average**
— do not carry either across from a `/voc` run on the same surface, and do not
compare them.

| Removal cost | Cost of keeping | Reading |
|---|---|---|
| Low | High | Strongest case to **remove** |
| Low | Low | **Demote to experimental** — cheap to keep, nobody needs it, stop advertising it |
| High | High | **Keep-and-fix** — load-bearing and underbuilt. The expensive answer, and usually the right one |
| High | Low | **Keep.** There is no decision here; do not manufacture one |

A single BLOCKER outweighs a low average in either direction. Do not average away
a hard NO, and do not let a chorus of WINs retire one.

## Step 4 — Pick a verb

The recommendation is exactly one of four, with the condition that selects it:

- **Remove** — no BLOCKER, removal cost low across the panel, cost of keeping
  real, no data destroyed, no published contract broken. Ships with: the
  deletion, the docs removal, the changelog fragment, and an issue recording
  what was removed and why, so it is not silently re-proposed in six months.
- **Keep-and-fix** — a BLOCKER exists, or the surface is Oversold and the promise
  is worth keeping. Ships with: one issue per gap between claim and code, and a
  named owner.
- **Keep-but-narrow-the-claim** — the code is fine, the documentation is not. The
  most common right answer for an Oversold surface, and the cheapest. Ships with:
  the docs diff that makes the claim true.
- **Demote to experimental** — keep the code, remove the advertising. Ships with:
  docs moved behind an explicit experimental label, and removal from any
  getting-started or evaluation path.

**"Leave it exactly as it is" is not one of the four.** If that is genuinely
right, the run should have concluded at Step 0 that there was no question here.

## Step 5 — Report

```
> **Simulated panel — not user research.** Every persona verdict below is a
> language model reasoning from the composite personas in `.claude/personas.md`.
> No user was interviewed, surveyed, or observed. Scores are predicted removal
> cost against documented criteria, not measured sentiment.
> **A simulated panel does not authorize a removal.** This is a recommendation to
> a human.
> **Evidence tier:** <E0 | E1 | E2 | E3> — <what each Step 1 source returned.
> External evidence is cited as evidence about the category, never as reports
> from this product's users.>

### Surface reviewed
<files, entry points, and the Step 0 classification: Delivered / Oversold /
Vestigial / Undocumented>

### Reversibility
<data destroyed? published contract? extension point? — and what each constrains>

### Cost of keeping
<source lines, tests, docs pages, ADRs, open issues, CI jobs. Plus trust cost if
Oversold.>

### Panel verdict — removal cost
| Persona | Cost | Tag | What breaks | Cheapest replacement |

### Recommendation: <remove | keep-and-fix | keep-but-narrow-the-claim | demote to experimental>
<the condition from Step 4 that selects it, and what ships with it>

### Falsification lines
<carried out of the panel verbatim — these are what a later cycle checks against>

### What this panel could not see
<the Blind spot lines, consolidated>
```

## Step 6 — Carry the falsification lines out

The falsification lines are the only part of this run that a future cycle can
score. Put them in the issue that records the decision, not only in the report —
a prediction nobody wrote down cannot be wrong, which is the same as not having
made one.

## What this skill does NOT do

- It does not remove anything. It recommends; a human merges.
- It does not answer "should we build this?" — that is `/voc`.
- It does not audit a shipped surface toward improvement — that is `/voc-audit`.
- It does not produce a number anyone may quote outside a sunset-check context.
- It does not treat a design document as evidence about the code.
