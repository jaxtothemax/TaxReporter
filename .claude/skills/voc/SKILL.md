---
name: voc
description: >
  Voice of the Customer panel. Grounds itself in real evidence before convening —
  the project's own tracker first, then external practitioner discourse about the
  functional category — records the evidence tier it reached, then runs each
  persona through a structured review of a proposed feature to surface adoption
  blockers, usability concerns, and priority mismatches before design begins. For
  a removal question use /sunset-check instead: this skill scores predicted
  adoption of an addition and cannot answer whether to delete something.
argument-hint: "[all | persona-name] <feature description>"
---

# Voice of the Customer

You are running a structured feedback panel against user personas for a proposed feature. This provides early signal on whether a feature will actually help users before investing in architecture and implementation.

## What to do

Given the feature description in `$ARGUMENTS`:

### 0. Establish what evidence already exists — before convening anyone

**Modeled opinion is the fallback, not the default.** Three sources, in ascending
order of cost. Record which produced anything: the answer is the run's **evidence
tier**, and it goes in the provenance banner.

**(i) The project's own tracker** — has anyone real already spoken on this?

```bash
glab issue list --search "<feature keywords>" -P 20
glab issue list --label "user-report" -P 20
```

**(ii) External practitioner discourse** — what do people who do this job for a
living say about this *class* of functionality?

This is the step that keeps the skill honest before a product has users. A young
tracker is *structurally* empty, so (i) alone returns nothing on every run and
the panel proceeds on pure simulation while the banner reports "no real signal"
as though the world had been searched. Public discourse about the category is
real human speech and costs two or three web searches.

Search the **functional category, never the product name** — nobody outside the
repo has heard of it, so a product-name search returns zero and that zero reads
as "no evidence":

- ✅ "do teams actually use <category>", "<category> tool complaints", "why teams
  stopped using <category>"
- ❌ "<product name> reviews"

Record where you looked and what blocked you, so the next run does not rediscover
it one wasted search at a time. Competitor changelogs and deprecation notices are
usually public and are unusually strong evidence — a competitor removing the same
capability is a real decision made with real usage data.

**(iii) The calibration ledger** — `.claude/persona-calibration.md`, if the
project keeps one. If a prior cycle recorded that a persona mispredicted this
class of question, weight that persona's verdict down and **say so in the
verdict**. A persona with a bad track record on a topic does not keep its full
voice on it.

#### Record the evidence tier

The old binary — "real signal found" / "none found" — collapsed *"we looked in
the one place that is structurally empty"* into *"there is no evidence
anywhere."* Record a tier instead:

| Tier | Meaning | Effect on the run |
|---|---|---|
| **E0** | Nothing in (i) or (ii) | Full panel. State the tier plainly — for a young product this is the honest position, not a failure |
| **E1** | External category evidence only — practitioners discussing this class of thing, nobody speaking about this product | Panel runs; E1 findings enter as **established facts** the panel may not reason against |
| **E2** | The tracker carries a real report bearing on this question | Real signal supersedes the panel — scope the panel to the residue only |
| **E3** | A named real user, or a measured behavior, answers the question | **Do not convene.** Report the evidence and stop |

> **The guardrail that makes E1 safe.** External evidence is about the
> *category*, not a report from a user of this product. It may not raise a
> persona's grounding, it may not be called corroboration, and it is cited as
> "practitioners on `<source>` describe X" — **never** "our users say X".

### 1. Load the personas

Check two locations for persona definitions (in priority order):
1. The **Personas** section in `CLAUDE.md` (inline with project instructions)
2. `.claude/personas.md` (standalone file with extended persona details)

Use whichever has more detail. If neither has personas defined (only placeholder `[Name]` entries), inform the user they need to define them — see README.md for instructions.

### 2. Evaluate from each persona's perspective

For each persona, produce a structured review:

```
### <Persona Name> — <Role/Archetype>

**Would use this feature:** Yes / Maybe / No
**Excitement (1–5):** X
**Concerns:**
- <specific concern from this persona's perspective>

**What they'd actually want instead (if different):**
- <alternative or modification>

**Quote** (in character):
> "<one sentence reaction in the persona's voice>"
```

### 3. Synthesize

After all personas have reviewed:

#### Panel summary
- **Average excitement:** X.X / 5
- **Consensus:** <one sentence on where personas agree>
- **Key tension:** <one sentence on where personas disagree>

#### Blockers (feed these to the architect agent)
- 🔴 **Blocking** — a concern raised by 2+ personas that would prevent adoption
- 🟡 **Important** — a concern that should shape the design but doesn't block it
- 🟢 **Nice to have** — a suggestion from one persona that could be deferred

Give each 🔴 a **falsification line**: the one observation that would show the
blocker is not real. A blocker nobody can disprove is an opinion with a colour.

### 4. Banner every output with its provenance

**What this produces is simulated feedback from modeled personas — not user
research.** Nobody was asked anything. Head every panel output with the tier:

```
> Simulated persona panel — evidence tier E0. No real user was consulted.
```

The rules this banner exists to enforce:

- **Never present panel output as customer feedback** in an issue, MR, ADR,
  roadmap entry, commit message, or anything else user-facing. If a persona
  finding is worth filing, file it on its own merits and say a simulated panel
  surfaced it.
- **The panel average never authorizes a decision** and never leaves this
  context. Hand the architect the key blockers with their falsification lines,
  plus the "what this panel could not see" open questions — not the score.
- **Two simulated panels agreeing is not corroboration.** Only a real user report
  corroborates a modeled finding.

## Persona scope

If `$ARGUMENTS` starts with a persona name (e.g. `maya: <feature>`), run only that persona's review. If it starts with `all`, run all personas.

## What NOT to do

- Do not invent personas — use only those defined in `.claude/personas.md`
- Do not give generic feedback — each persona must react from their specific context
- Do not average away disagreements — surface the tension explicitly
- Do not run a panel to argue a real report away. At E2/E3 the real signal
  decides; scope the panel to the remainder, or skip it
- Do not answer a **removal** question here. This rubric scores predicted
  adoption of an addition, so a low score cannot separate "removing this would be
  bad" from "this thing is bad", and none of its next-step verbs is a removal.
  Use `/sunset-check`
