---
name: mass-merge
model: sonnet
disable-model-invocation: true
description: >
  Safely land a batch of already-green MRs onto the default branch, one at a
  time, without breaking the post-merge pipeline. Emulates a merge train
  client-side: stacks the MRs on a local integration branch, re-runs the
  repo-wide aggregate/ratchet gates after each add, then merges only the safe
  prefix serially — bringing every MR up to the latest default branch first.
  Use when landing several related MRs in one sitting.
argument-hint: "[<mr-iid> ...] | --all-ready"
---

# Mass Merge

Land a batch of green MRs without reddening the default branch.

---

## Who invokes this — user only

`disable-model-invocation: true`. This skill force-pushes branches and merges
MRs; it must never run as part of unattended agent work. If an agent needs the
analysis without the landing, run **Phase A only** and stop.

---

## Why this skill exists

Under parallel work, the default branch goes red **after** merge even though
every MR's own pipeline was green. Two causes, neither of which is a code-quality
problem:

1. **Aggregate / ratchet gates do not compose.** Any gate that counts something
   across the *whole tree* against a baseline — hardcoded literals against a
   design-token ratchet, ADR or migration numbers, a coverage floor, a bundle-size
   budget, a lint-debt ceiling — sees only its own MR's tree. MR A adds 2 (under
   ceiling on A's tree), MR B adds 3 (under ceiling on B's tree). Both pipelines
   pass. The combined tree is over ceiling, and that appears only on the
   post-merge pipeline.
2. **Stale merge base.** Without merged-results pipelines, each MR is gated
   against the default branch it *branched from*, not the current one. Auto-merges
   on shared files — a generated schema, a route registry, changelog fragments, a
   shared spec — apply cleanly as **text** and break **semantically**.

This skill fixes both *before* merge: **(A)** stack the MRs on a local
integration branch and re-run every aggregate gate after each add, then **(B)**
land only the safe prefix serially, bringing each up to the latest default
branch and waiting for green before the next.

> **The durable fix is server-side merge trains.** This is a client-side
> emulation. Once merged-results pipelines / merge trains are enabled in the
> project settings, the server does Phase A+B for you and this skill becomes a
> convenience. Say so to the user if they run it on large batches repeatedly.

---

## Configure this per project

Before first use, fill in the two project-specific lists. Everything else is
generic.

**Aggregate gates** — the CI jobs that read the *whole tree* rather than the
diff. These are the ones Phase A must re-run after each add; a diff-scoped gate
composes fine and is a waste of Phase A minutes.

```
AGGREGATE_GATES = <e.g. make lint, make typecheck, the ratchet/baseline checks,
                   the numbering-collision checks, coverage floor, bundle budget>
```

**Shared-file hotspots** — paths that several MRs in a typical batch touch, where
a clean textual auto-merge is most likely to be semantically wrong.

```
HOTSPOTS = <e.g. generated API schema, route registry, changelog.d/,
            shared test fixtures, i18n catalogs, lockfiles>
```

**Merge method** — read it from the project's own settings, do not assume.

```
MERGE_METHOD = <merge | rebase-merge | ff-only>
```

This one line decides how Phase B brings each branch up to date, and getting it
wrong is the most expensive mistake in the skill:

| `MERGE_METHOD` | Phase B updates each branch with | Push |
|---|---|---|
| `merge` (merge commit) | `git merge --no-edit origin/<default>` | plain, fast-forward |
| `rebase-merge` / `ff-only` (linear history) | `git rebase origin/<default>` | `--force-with-lease`, **bare form** |

**Match the forge.** Phase B's job is to produce the tree the forge is about to
produce; any other operation is a simulation of something that will never happen.
On a `merge` project the rebase is strictly worse: it replays each commit against
a base that has moved, so it conflicts once per commit where a merge resolves
once — upstream, a run whose Phase A predicted one conflict produced three more
— and it conflicts *spuriously* on any branch already carrying a merge from the
default branch (2 of 13 branches in one run). It also forces a force-push where a
merge needs none.

---

## Step 0 — Pre-flight

1. **Resolve the batch.** With explicit IIDs, use them in the given order. With
   `--all-ready`, list open MRs targeting the default branch whose pipeline is
   green, that have no conflicts and no unresolved discussions.
2. **Validate each MR**: state is `opened`, target is the default branch, head
   pipeline is `success`, and the MR is not draft. Report and drop any that fail.
3. **Check the session may merge — before Phase A, not after it.** Landing needs
   `glab mr merge`, and the template's `.claude/settings.json` ships it under `deny`
   (agents must not merge on their own initiative). If the session cannot run it, the
   merge is refused after the whole simulation has already run, and the skill only
   reports conflicts without landing anything. Say so up front and offer **Phase A
   only**. The permission is the user's personal call. A `deny` rule overrides an `allow`,
   so they must remove the `Bash(glab mr merge:*)` entry from `deny` where it is defined
   and allow `Bash(glab mr merge:*)` for their own sessions. Neither change belongs in a
   commit: never commit the removed `deny` entry or the `allow` rule to the checked-in
   settings, and never work around a refusal.
4. **Record the user's current branch** so it can be restored at the end.
5. **Require a clean tree and no parallel in-flight work.** This skill flips
   checkouts and force-pushes. If other sessions are live, run it from a
   dedicated worktree.
6. **Warn if the batch is large.** Landing many MRs quickly is what exhausts CI
   capacity — see the zero-job rule below. Suggest splitting past ~5.

### A competing session can land the batch out from under you

Step 0's validation is a **snapshot, not a lock**. Read
`.claude/skills/mass-merge/failure-modes.md` for what to do if another session
or a human merges part of the batch mid-run — this has happened before and
voids the simulation.

**Re-read each MR's state immediately before updating it, and again immediately
before merging it.** If it is no longer `opened`, skip it and re-plan.

---

## Step 1 — Detect shared-file hotspots

For each MR, list its changed files. Report every file touched by **two or more**
MRs in the batch, and flag any that appear in `HOTSPOTS`.

This is an **ordering hint, not a verdict**. Two MRs touching the same generated
schema will very likely conflict on rebase; ordering the smaller one first
usually costs less. One rule beats intuition here:

> **When the conflict is a registry line that one MR *deletes*, land that MR
> first.** It dissolves the conflict class instead of forcing you to resolve the
> same collision once per branch.

### Screen each branch's update strategy now, not in Phase B

Phase B brings each branch up to the latest default branch. Decide *how* per
branch here, while there is time to think, rather than under time pressure with
a half-landed batch:

```bash
for iid in <order>; do
  BR=$(<forge CLI> mr view "$iid" --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["source_branch"])')
  git fetch origin "$BR" --quiet
  if git merge-base --is-ancestor origin/<default> "origin/$BR"; then
    echo "!$iid $BR  -> UP-TO-DATE (no update, no push, reuse its green pipeline)"
  elif [ "$(git log --merges --oneline "origin/<default>..origin/$BR" | wc -l)" -gt 0 ]; then
    echo "!$iid $BR  -> MERGE ONLY (carries a merge commit; a rebase conflicts spuriously)"
  else
    echo "!$iid $BR  -> MERGE_METHOD default"
  fi
done
```

The **UP-TO-DATE** row is not a nicety. Updating a branch that already contains
the default branch pushes nothing, the forge creates no pipeline, and the Step 3
poll then burns its entire timeout waiting on a sha whose pipeline never existed.

---

## Step 2 — Phase A: simulate the merge train (always runs)

Run this in a **dedicated worktree**, never the shared main checkout — another
session's `git checkout` silently yanks the integration branch, and the gates
then pass against the wrong tree. Symlink the project's heavy dependency
directories into it; a bare `git worktree add` does not, and the toolchain dies
without them (`scripts/wt` does this for you).

```
create integration branch from latest origin/<default>
for each MR in order:
    rebase the MR's commits onto the current simulation tip
    land them onto the simulation branch with `merge --no-ff`  # mirror how the forge lands it
    run every gate in AGGREGATE_GATES against the combined tree
    record: 🟢 clean | 🔴 <which gate, what it said>
    on 🔴: stop adding. Everything BEFORE this MR is the safe prefix.
```

Report the table: MR · title · files · result · first failing gate.

**A conflict during the Phase A rebase is a finding, not an error to work
around.** Never resolve one by guessing — record it and stop.

### Phase A being clean does not predict Phase B

**Phase A answers "does this combined tree pass the gates". It never answers
"will Phase B update cleanly".** Treat Phase A as a gate-composition check, not
a conflict oracle — read `.claude/skills/mass-merge/failure-modes.md` for why a
batch that stacks cleanly here can still hit conflicts in Phase B, and how
`MERGE_METHOD` narrows (but does not close) the gap.

---

## Step 3 — Phase B: land the safe prefix serially

Only the **contiguous safe prefix** lands. A 🔴 stops the run; do not reorder to
land later MRs.

For each MR in the safe prefix:

1. **Re-verify the MR is still `opened`** (see Step 0).
2. **Fetch, then bring the branch up to the current default branch** using the
   strategy Step 1 recorded for it. Drive worktree-held branches with
   `git -C "$WT"` — a forge CLI's `checkout` fails on a branch already checked
   out in a worktree and can silently leave you on the wrong branch.

   ```bash
   git -C "$WT" fetch origin
   if git -C "$WT" merge-base --is-ancestor origin/<default> "$BR"; then
     # Already contains the default branch. Pushing creates NO pipeline and the
     # poll below would wait out its whole timeout on one that never exists.
     echo "!$iid already up to date — no update, no push"
     SHA=$(git -C "$WT" rev-parse HEAD)   # its existing green pipeline IS the gate
   else
     git -C "$WT" merge --no-edit origin/<default>    # MERGE_METHOD = merge
     SHA=$(git -C "$WT" rev-parse HEAD)   # the EXACT sha about to be pushed
     git -C "$WT" push --no-verify origin "$BR"       # fast-forward; no force
   fi
   ```

   `--no-verify` skips the local pre-push hook: Phase A already ran the full gate
   suite on the combined tree, so re-running it per push is pure latency, and the
   hook is what stalls on a credential prompt.

   **On a linear-history project** (`MERGE_METHOD` = `rebase-merge` / `ff-only`,
   and Step 1 did not mark the branch MERGE ONLY) substitute a rebase — and note
   that the push then needs a lease, in the **bare form only**:

   ```bash
   git -C "$WT" rev-parse "origin/$BR"    # assert BY HAND this is the sha you expect
   git -C "$WT" rebase origin/<default>
   git -C "$WT" push --no-verify --force-with-lease origin "$BR"
   ```

   > **Never write `--force-with-lease="$BR:<sha>"`.** Verify the sha by hand
   > with `rev-parse`, then push bare — read
   > `.claude/skills/mass-merge/failure-modes.md` for why the explicit ref form
   > is dangerous (it silently drops the lease on git 2.50.1).

3. **Assert the update actually succeeded.** `git rebase … | tail` (or `merge`)
   prints what looks like success on a conflict, because the pipe swallows the
   exit status. Check `git diff --name-only --diff-filter=U` is empty. On
   conflict: abort, stop, report — it needs a manual resolution.
4. **Never `--force`; always `--force-with-lease`** on any push that rewrites
   history. A merge push rewrites nothing and needs neither.
5. **Capture the pushed full sha into a variable. Never retype a short sha as a
   long one** — a fabricated 40-char sha fails in two ways that each mimic a
   *different* known failure (a stale-info force-push rejection, and a status
   poll stuck on "none").
6. **Poll the pipeline for that exact sha on the MR ref** to `success`. Do not
   filter by short sha (returns empty and loops forever) and do not read
   `head_pipeline` (stale after a force-push). Cap the wait so a CI hang cannot
   loop forever. See *Polling*, below.
7. **Merge.** Then poll the **default-branch** pipeline for the new tip.
8. Repeat.

### Polling

**Run every poll under `Monitor` / `run_in_background`, never as foreground
Bash, and shape it as a bounded `for` loop.** The agent harness blocks foreground
`sleep`, so the `while :; …; sleep 30; done` shape this skill used to prescribe
errors out immediately — it was handing out code that cannot run — and chaining
shorter sleeps is blocked too.

```bash
for i in $(seq 1 120); do    # bounded: 120 x 30s = 60 min, then stop and report
  ...                        # query the API; exit 0 on success, exit 1 on failure
  sleep 30
done
```

**On the default-branch poll, match `source == 'push'` as well as the sha.** A
scheduled nightly can run on the identical sha; a poller that takes the first
result can read *its* status and red the whole batch over a job the merge had
nothing to do with. **Do not carry that filter to the MR-ref poll** — an MR
pipeline's source is `merge_request_event`, so the same filter matches nothing
there and the poll reports `none` until it times out.

When the two gates overlap (the default-branch pipeline for merge N and the
pushed MR N+1), prefer **one combined poller** over two. Long-lived pollers do
get killed mid-flight; on recovery, re-query the API live rather than trusting a
dead poller's last line.

**A poll is silent while it waits.** Echo only at a terminal state — `success`,
`failed`/`canceled`, or the final timeout — and let the waiting branch be a bare
`sleep 30`. Upstream, landing four MRs produced **150+ near-duplicate
`status=running` notifications**, one per conversation turn, because the agent
instantiating the template added an unconditional `echo "poll $i: $ST"` before the
status check. If mid-wait visibility is genuinely useful on a long pipeline, gate a
heartbeat behind a modulus — `[ $((i % 10)) -eq 0 ] && echo "…"`, about once every
five minutes — never every tick.

**Make no tool calls while a poll is pending.** A placeholder call issued once per
turn "to do something" between notifications (a bare `true`, a re-read of state the
poll already watches) buys a new conversation turn carrying zero information, and is
what multiplied those 150 notifications into far more wasted turns. Once a poll is
running, wait for it to report.

### Non-negotiables in Phase B

The full list — what to do when a pipeline fails, a merge command errors, an
advisory drops mid-batch, or a conflict shows up — is a lookup table in
`.claude/skills/mass-merge/failure-modes.md`. Read it before running Phase B, and
consult it again the moment any of those happens. The two rules that shape the
control flow itself, not just failure recovery:

- **Gate on the default-branch pipeline after every merge — at most one merge
  lands on a red default branch.** The first red is a hard stop for the whole run.
- **Merges are serial; the next update+push may overlap.** Merge N+1 once
  **both** MR(N+1)'s pipeline and the default-branch pipeline for merge N are
  green.

---

## Step 3b — Clean up each landed worktree

A batch MR's source branch is very often a `scripts/wt` worktree. Once the MR merges,
the forge deletes the remote branch and the local worktree is left on a dead ref — pure
debris that still counts against the WIP cap. Across repeated batches these pile up
silently; upstream, a single run left four behind, and a batch that never cleans up after
itself is the surest way to hit the cap mid-sprint.

**Remove each MR's worktree immediately after it merges, not in a final sweep.** A run
that stops partway (a later 🔴, a red default branch) then still cleans up everything it
actually landed, instead of leaving the whole batch for a last step that never runs:

```bash
scripts/wt remove <issue-number>
```

It refuses a worktree with uncommitted or untracked work, which cannot be true of a
branch that was just merged from a pushed, clean state. `no worktree matches` means the
branch was never a worktree — not an error for this step. When the run ends, a
`scripts/wt prune` from the main checkout catches anything the per-merge removals missed,
including tips that landed rebased or squashed.

**Never remove the worktree of an MR that did not merge.** A 🔴-blocked or still-open
MR's worktree holds live work; leave it for its owner.

---

## Step 4 — Report

```
# Mass Merge — <date>

## Landed
| MR | title | default-branch pipeline | worktree |

## Not landed (and why)
| MR | title | blocked by |

## Phase A simulation
| MR | result | first failing gate |

## Follow-ups
- <conflicts needing manual rebase, gates needing a ratchet re-baseline>
```

Restore the user's original branch (Step 0) when the run ends — on success or
failure.

---

## Rules

- **User-invoked only.** Never run Phase B unattended.
- **Only the contiguous safe prefix lands.** A 🔴 stops the run.
- **Bring every MR up to the latest default branch immediately before pushing —
  by the operation `MERGE_METHOD` says the forge will use**, not by habit.
- **Skip the update entirely when the branch already contains the default
  branch.** Pushing creates no pipeline, and the poll then hangs to its timeout.
- **Run Phase A in a dedicated worktree**, never the shared main checkout.
- **Re-verify MR state before every act** — Step 0 is a snapshot, not a lock.
- **Never `--force`; always `--force-with-lease`, and only in its bare form.**
  The `ref:sha` form silently drops the lease.
- **Every poll is a bounded `for` loop run in the background** — foreground
  `sleep` is blocked in the agent harness.
- **A poll echoes only at terminal states, and nothing else runs while it waits.**
  No per-tick echo (gate a heartbeat behind `i % 10` if you need one), and no filler
  tool calls between its notifications.
- **Remove each MR's worktree right after it merges** (Step 3b), never one whose MR
  did not merge.
- **Never guess at a conflict resolution.**
- If merge trains get enabled in the project, tell the user this skill is now
  mostly redundant with the server doing it.
