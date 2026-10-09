---
name: adr
description: Create an Architecture Decision Record in docs/adr/ with sequential numbering and the Nygard template (Context, Decision, Consequences).
argument-hint: "<decision title>"
---

# Create Architecture Decision Record

Create a new ADR in `docs/adr/` for the decision described in `$ARGUMENTS`.

## What to do

### 1. Determine the next sequence number

```bash
ls docs/adr/*.md | grep -E '[0-9]{4}-' | sort | tail -1
```

Extract the number, increment by 1, zero-pad to 4 digits.

### 2. Derive the filename slug

Convert `$ARGUMENTS` to lowercase, replace spaces with hyphens, strip special
characters.

Example: "Use PostgreSQL for primary storage" → `0002-use-postgresql-for-primary-storage.md`

### 3. Create the ADR file

Write to `docs/adr/<NNNN>-<slug>.md` using this template:

```markdown
# <N>. <Title>

**Date:** <today's date YYYY-MM-DD>
**Status:** Proposed

<!-- Optional, and REQUIRED whenever Accepted stops meaning shipped. A
     blockquote, directly under the Status line — never a second field line.
     See "Accepted does not mean shipped" below. -->

## Context

<What is the situation that forces this decision? What constraints, requirements,
or forces are in play? 2–4 sentences.>

## Decision

<What was decided? State it clearly and directly. "We will…" or "We will not…">

## Consequences

<What are the results of this decision — both positive and negative?
What becomes easier? What becomes harder? What new constraints does this create?>

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr <NNNN>`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
```

### 4. Report

Output the file path and remind the user to:
- Fill in Context, Decision, and Consequences
- Change status from `Proposed` to `Accepted` once the decision is confirmed
- Commit with: `docs(adr): add ADR-<NNNN> <title>`

---

## Accepted does not mean shipped

`Accepted` records that the **decision** is settled. It says nothing about
whether the code exists — and a reader of `docs/adr/` cannot tell a shipped ADR
from a design-only one without opening it and inferring from prose. Some ADRs
are deliberately design-only: they close a question so the next implementer
meets the record instead of re-deriving it, and nothing ships with them.

**When `Accepted` does not mean shipped, say so in an `Implementation status`
blockquote placed directly under the Status line.** Do not invent a fifth status
value for it.

```markdown
**Status:** Accepted (2026-08-29)

> **Implementation status (2026-09-04 ADR audit, #123):** the *decision* stands,
> but no endpoint, model, or page ships with this ADR — verified 2026-09-04,
> there is no such model, route, or component anywhere under `src/`.
```

Three rules, each load-bearing:

1. **A blockquote, not a second field line.** `**Implementation:** not built`
   *becomes* the parsed status for anything reading the Status line — so a
   genuinely `Proposed` ADR could sail past a status check. A `>` line is
   invisible to a status parser by construction. That is not decoration; it is
   the entire reason for the shape. Any status parser you write must skip `>`
   lines, and must be self-tested for a blockquote placed *above* the status text
   as well as below it.
2. **Verified, not asserted.** State what is and is not on the default branch and
   name the files you checked. An unverified blockquote is a second thing that
   can be wrong.
3. **Remove it when it ships.** A stale "not built" note is the same
   misinformation reversed, and it is the failure mode shipping actually produces.

---

## When an ADR moves to Accepted

An issue that says *"implements ADR-NNNN"* is almost always written **before**
the ADR is accepted — that is its job, to argue for it. The ADR then gets
negotiated and options are **rejected**, and the issue is never re-read. The
delta between the issue that proposed it and the ADR that settled it is exactly
**the set of rejected options** — the most expensive thing to accidentally
implement.

Nothing in CI can catch this: every gate reads the diff, and **no gate
has ever read an issue body against an ADR**. Building one would be a poor trade
— it cannot distinguish a divergence from an issue that legitimately implements
one section — so this is a checklist step at a moment that already exists.

Acceptance is the trigger. Do these four, in order:

1. **Sweep.** `python3 scripts/adr-accepted-issue-sweep.py --adr NNNN` lists
   every open issue naming this ADR that was written before it was accepted.
2. **Check the branch before assuming the issue is right.** Upstream, the
   worktree already followed the accepted ADR and the *issue* carried the
   rejected scope; diagnosing it the other way round would have "corrected"
   working code. Branch-right/issue-wrong is the dangerous direction: an
   implementer reading the issue builds the rejected design, a reviewer approves
   against it, and `Closes #NNN` then closes the issue as though the rejected
   scope had shipped.
3. **Rewrite the title, not only the body.** A stale title is what survives a
   triage sweep.
4. **Lead with a dated correction note** rather than editing silently. The old
   scope is often why an in-flight branch looks strange later.

Record the count in the ADR's `## On Acceptance` block **including when it is
zero** — a zero is the evidence that the class is rare, and it is what tells a
future reader whether this step is still earning its slot.

> **Trap, if you ever automate this.** An ADR's Status date is *not* reliably an
> acceptance date. A bulk audit that restates statuses as *"Accepted —
> implemented; status corrected `<date>` after ADR audit"* stamps ADRs that were
> accepted, and usually implemented, long before the date they now carry.
> Ranking issues against a correction date turns a handful of real candidates
> into dozens. The sweep script detects and suppresses those, and reports
> undated Accepted ADRs separately as **unrankable** — the honest ceiling on
> what this check can ever see. A hand-rolled `grep` will do neither.

---

## Rules

- Never set status to `Accepted` without the user confirming
- Use the date from the system clock
- Do not invent content — create the skeleton and let the user fill it in
- Run the acceptance sweep when the status changes, and record its count
- If `docs/adr/` does not exist, create it with a `README.md` first (copy the
  format from `docs/adr/README.md` in the template repo)
