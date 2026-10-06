---
name: incident-postmortem
description: Run a structured postmortem after a harness or process incident — a red default branch, a milestone that overran unnoticed, a gate that stayed green through something it was scoped to catch, work lost to a tooling collision. Reconstructs the timeline from the mechanical trail, separates root cause from contributing factors, checks whether an existing gate should have fired, and writes the lesson into the durable memory store instead of leaving it in a transcript. Reactive and incident-scoped — distinct from /kaizen, which is periodic and pattern-scoped.
argument-hint: "[incident description or issue/MR reference]"
---

# Incident Postmortem

You are running a postmortem on a **specific, already-resolved** harness or process
incident. The incident is the starting point; the job is to work backward to a cause and
forward to a durable record, so the same *shape* of failure is not rediscovered the hard
way next time.

**The deliverable is the memory entry, not the report.** A postmortem that produces a
good write-up in the conversation and nothing on disk has changed nothing — the next
session starts exactly as blind as this one did. Step 5 is not optional.

---

## Scope discipline

In scope — harness and process incidents:

- The default branch red for an extended window, or red from a cause with no code fix (a
  label edit, a stale merge base, an exhausted job quota)
- A gate, cap, or milestone that silently stopped describing practice until someone
  noticed the gap
- A gate that ran, reported clean, and something it was scoped to catch shipped anyway
- Work lost or overwritten by a tooling collision (a shared stash, a worktree pruned
  under someone, a force-push)
- A release that shipped something it should not have, where the cause is a process gap
  rather than one person's slip

Out of scope:

- A product bug with no process angle. Fix it, and if the lesson is durable write the
  memory entry directly — that is normal practice, not a postmortem.
- General friction with no triggering incident — that is `/kaizen`.
- The fix itself. This runs **after** the incident is resolved, not instead of resolving
  it.

**Relationship to `/kaizen`.** Kaizen starts from steady-state signals (cycle time, gate
yield, skip rate) and looks *forward* for friction that has not caused visible damage
yet. A postmortem starts from a known bad outcome and works *backward*. A kaizen finding
can trigger one ("gate X has never found anything, and something it covers just broke the
default branch") — when it does, hand this skill kaizen's signal work rather than
re-deriving it.

---

## When to run

- After the incident is fixed and the affected surface is confirmed green. A postmortem
  written mid-incident conflates the fix with the record of the fix, and Step 2's timeline
  will be incomplete.
- When a release retrospective surfaces a process failure with no memory entry.
- On demand, whenever the user asks for a postmortem on a named incident.

## Arguments

- `[incident description or issue/MR reference]` — required. An issue or MR number if one
  exists, or free text if the incident was never tracked (common for label-edit and
  tooling-collision incidents, which rarely get their own issue).

---

## Step 1 — Establish the incident record

Pull the mechanical facts rather than working from recollection.

```bash
glab issue view <N> 2>&1      # or: gh issue view <N>
glab mr view <N> 2>&1         # or: gh pr view <N>
```

If only a description was given, ask the user for the minimum needed to anchor Step 2:
roughly when it started, how it was noticed (a person, a CI failure, a user report), and
current status.

Record what broke, when it started, how long it was broken, how it was noticed, and the
blast radius — everyone's pipeline, one branch, a shipped release, lost work.

## Step 2 — Reconstruct the timeline

Build it from the trail, not from what anyone remembers.

```bash
git log --since="<window start>" --until="<window end>" --oneline --all

glab api "projects/:id/pipelines?ref=$(git symbolic-ref --short HEAD)&per_page=50" \
  | python3 -c "import json,sys; [print(p['id'], p['status'], p['created_at']) for p in json.load(sys.stdin)]"
```

Produce four timestamps: **introduced** (the action that created the bad state),
**noticed** (when a human or system first flagged it), **understood** (when the cause was
identified), **resolved** (when the fix landed).

The gap between *introduced* and *noticed* is frequently the real finding. A fast fix for
a slow-to-notice problem leaves the detection gap exactly where it was.

## Step 3 — Root cause vs contributing factors

Do not stop at the triggering commit. Three questions, in order:

1. **What was the single mechanical trigger?** The commit, the label edit, the merge
   order, the stash pop.
2. **What let that trigger cause this much damage?** Why did nothing catch or contain it
   sooner? This is almost always the more useful finding and the one most often skipped.
   State the **class** of trigger, not the instance — a record that names only the
   triggering commit prevents that one commit and nothing else.
3. **Was this foreseeable?** Check whether a memory entry, an ADR, or a `CLAUDE.md` rule
   already existed that should have caught this shape — and if so, why it was not
   consulted, or was not specific enough to help. Grep the memory index and `docs/adr/`
   before concluding nothing existed.

Report root cause and contributing factors as **separate lines**. Collapsing them into one
narrative is how the second question gets lost.

## Step 4 — Did a gate exist, and did it fire

Check the fast-path table in `CLAUDE.md` and the gate list in `scripts/CLAUDE.md` for
whichever gate should have covered the change. Three outcomes, three different fixes:

- **No gate covered this class of change** → candidate for a new gate or a new fast-path
  row. Hand it to `/kaizen`, or file it directly (Step 6) when it is clear-cut.
- **A gate covered it, ran, and reported clean** → the gate has a blind spot. Name the
  exact check that should have caught this and did not. "It ran" is not "it checked for
  this."
- **A gate covered it and was skipped, or marked `n/a` wrongly** → a compliance gap, not a
  coverage gap. Name where the skip happened — an MR's `## Gates` section, a conversation
  turn — rather than proposing a new check for a check that already exists.

## Step 5 — Write the durable memory entry

This is the step that closes the loop. Apply the memory-discipline rules in `CLAUDE.md`
verbatim; this skill does not redefine them.

- **Lead with the rule, not the narrative.** "The default branch was red for six hours" is
  the incident; "a label edit on an open issue reds the boundary gate, and the red lands on
  whoever pushes next" is the memory. The test: would a session that never reads this file
  still make the right call?
- **One fact per file**, with a `description:` carrying the retrieval hook. Without one the
  file is invisible to recall no matter how good it is.
- **`Why:` and `How to apply:` are mandatory**, not decorative — they are what let a future
  session judge the edge cases this incident did not cover.
- **Check for an existing memory covering the same lesson first.** If Steps 3 and 4 landed
  on something an existing file half-covers, update that file — with a dated
  **Superseded** note if it contradicts the old belief — rather than writing a sibling.
  Duplicates are how an index grows without the store getting smarter.
- Add the one-line pointer to the loaded index, or to the archive when the entry is a
  closeout record with no reusable rule. `make memory-check` verifies the index afterward.

## Step 6 — Propose a process fix (optional)

Only if Step 4 found a real, actionable gap — not for a gate that was correctly scoped and
simply had not yet met a rare case. Route it like a kaizen finding, against the next open
milestone rather than the one currently shipping: the incident just fixed is already in
motion, and a process change landing late in it adds risk without benefit.

```bash
glab issue create --title "<slug>" --label "chore,tooling" --description "$(cat <<'EOF'
<finding body>
EOF
)"
```

If the project uses dated milestones, **ask which `release::` value applies** rather than
inferring one — `CLAUDE.md`'s milestone-commitment rule applies to an issue this skill
files exactly as it does to any other.

Cross-reference the incident issue or MR, and any related `/kaizen` finding, so the two are
not investigated twice.

## Step 7 — Report

```
## Postmortem — <incident> — <date>

### Timeline
introduced: <ts>  noticed: <ts>  understood: <ts>  resolved: <ts>
detection gap: <noticed − introduced>

### Root cause
<the mechanical trigger>

### Contributing factors
<what let it cause this much damage — usually the more important line>

### Gate coverage
<no gate covered this | gate ran clean, blind spot: X | gate skipped at: Y>

### Memory entry
<file path> — <one-line hook>  (new | updated <prior file>)

### Process fix filed
<issue # | "none — the existing gate is correctly scoped">
```

---

## What this does not do

- Fix the incident — it is resolved before this runs
- Replace `/kaizen`'s periodic, pattern-scoped audit
- Audit product code for bugs
- Edit `CLAUDE.md`, CI config, or labels directly. It proposes; the user lands any change
  through a normal branch and MR.

## Anti-patterns to refuse

- Running while the incident is still unresolved
- A memory entry that narrates what happened with no `Why:` / `How to apply:`
- Filing a process-fix issue against a gate that worked correctly and simply had not met
  this case yet — that is noise, not a finding
- Writing a sibling memory file when an existing one already owns the lesson
- Treating one incident as a recurring loop. One incident, one pass.
