---
name: memory-audit
disable-model-invocation: true
description: >
  Sweep the Claude Code memory store for this project and repair what makes it
  unrecallable: files with no description, files holding several facts, index
  lines that are bare pointers, wiki-links with no target, and grounding claims
  that name files or flags which no longer exist. Reports a ranked repair list
  and applies the safe fixes on confirmation. Run at each release close, or when
  recall starts returning the wrong things.
argument-hint: "[--report-only]"
---

# Memory Audit

The memory store is **append-mostly by default, and that is the failure mode.**
Nothing in the write path pushes back, so growth is unbounded and quality decays
in ways that are individually invisible. Upstream, one store reached 801 files /
2.5 MB with 130 files carrying no `description:` — invisible to recall no matter
how good their contents — and 266 indexed by nothing at all.

The policy that governs the store lives in `global-claude-md.example`
("Memory discipline"). **This skill is its enforcement.** A policy with no sweep
is the exact shape this harness exists to eliminate: a rule that lives only in
prose.

---

## Step 0 — Locate the store

`~/.claude/projects/<project>/memory/`, plus `MEMORY.md` (loaded every turn) and
`MEMORY-archive.md` (loaded never). Report file count, total size, and the count
written in the last 30 days. A high recent-write rate with no eviction is itself
the finding.

Then run **`make memory-check`** and report its result. `MEMORY.md` is truncated past
roughly 24.4 KB — silently, with nothing failing — so an over-budget index means some
indexed memories are already not arriving, and that outranks every check below. The
script also catches index links to files that do not exist. If it fails on size, the
fix is the demotions from 1c, not a raised budget.

---

## Step 1 — Five checks, in parallel

### 1a. Missing or useless `description:`

`description:` is what recall **ranks on**. A file without one is unreachable
regardless of its contents; it is the only retrieval handle, not optional
metadata. Flag every file missing it, and every one whose description restates
the filename ("notes on the build", "issue 123") rather than stating the finding.

### 1b. Files holding more than one fact

If a file needs sub-headings for separate findings, it is several memories and
will never be recalled as a unit. A 2 KB file is normal; flag anything past ~6 KB
or carrying more than one `##` finding heading, and propose the split.

### 1c. `MEMORY.md` lines that are bare pointers

`MEMORY.md` costs context on **every turn**; `MEMORY-archive.md` costs nothing.
The test for staying in the index is not "is this true" or "was this hard work" —
it is:

> **Would a session that never opens the file still make the right call?**

An index hook like `#2373-75 → #2378`, `blueprint`, or `marketing sites` fails
it: nobody can act on a pointer. Flag those for demotion to the archive.

**Judge by the hook text, not the filename.** A file named `..._batch_2026`
whose hook states a reusable trap is durable and stays. A filename heuristic gets
this backwards.

### 1d. Broken `[[wiki-links]]`

Links resolve by **filename**, not by the `name:` field — and `name:` fields
drift, so a large fraction of them no longer match their own file. Flag links
with no target file. A link to a memory that does not exist *yet* is fine and
deliberate: it marks something worth writing. Distinguish the two by whether the
target names a plausible future memory or a renamed existing one.

### 1e. Grounding claims that have decayed

A memory naming a file, function, flag, skill, or persona records what was true
**when it was written**, and nothing re-validates it. For every such reference,
check the referent still exists. Upstream, four "mandatory" gates survived in
prose for months after deletion, and a personas file was rewritten wholesale
while memories still asserted its previous roster.

Flag each decayed claim with what it names and whether that thing exists.

---

## Step 2 — Rank the repairs

Order by **recall damage**, not by count:

1. **Missing `description:`** — the file is invisible. Highest value per fix.
2. **Decayed grounding** — the file is worse than invisible; it is confidently wrong.
3. **Multi-fact files** — recalled as a unit, useful as none of its parts.
4. **Bare-pointer index lines** — pure per-turn context cost, zero actionability.
5. **Broken links** — lowest damage; often just a not-yet-written memory.

---

## Step 3 — Apply (on confirmation; skip entirely with `--report-only`)

Safe to apply directly:

- **Write a missing `description:`** from the file's own body.
- **Demote a bare-pointer index line** to `MEMORY-archive.md` under a dated
  `## Archived <date>` heading, verbatim.
- **Split a multi-fact file**, linking the parts to each other.

Requires the user's decision:

- **A decayed grounding claim.** Prefer a dated **Superseded** note naming the
  change over a silent rewrite: the old belief is often *why* a later decision
  looks strange. Never quietly rewrite history.
- **Any deletion.**

### Never delete a memory to shrink the store

Deleting for size destroys findings that cost real debugging to produce. The fix
for an unreachable memory is a `description:`; the fix for a noisy index is the
archive. **Delete only what is *wrong*** and not worth recording as superseded —
and say which of the two it was.

---

## Step 4 — Report

```
# Memory Audit — <date>

Store: <N> files · <size> · <M> written in the last 30 days
Index: <N> lines in MEMORY.md · <N> in MEMORY-archive.md

## Applied
- <fix> × N

## Needs your decision
| file | issue | proposed |

## Healthy
<what passed, so the report is not only bad news>
```

---

## Rules

- **Report before repairing.** The user sees the list first.
- **Never delete to shrink.** Size is not a defect; unreachability is.
- **Never silently rewrite a memory that turned out wrong** — supersede it, dated,
  naming the change that invalidated it.
- **Do not bulk-fix `name:` fields** to match filenames. Links resolve by
  filename, so the drift is cosmetic, and a bulk rewrite churns the whole store
  for no recall benefit.
- Run at each release close, alongside changelog assembly.
