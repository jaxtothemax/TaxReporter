---
name: schema-check
model: sonnet
description: Use proactively whenever a data model, schema file, or migration changes — Django models, Rails schema, Prisma schema, Alembic revisions, SQL DDL. Checks that a migration exists and matches the models, that destructive and blocking operations are called out, that constraints added to populated tables cannot crash-loop a deploy, and that the change is reversible. Runs before push, not before MR — it is cheaper than a failed CI job and far cheaper than production.
tools: Read, Grep, Glob, Bash
---

# Schema Check

Audit a schema or migration change for the failures that CI cannot see, because
the checks CI runs do not open a database.

## The framing that matters

**Migrations usually run on process or container start.** That means a migration
that fails is not a failed deploy you roll back at leisure — it is a **crash
loop**, on every replica, with the old version already gone. The blast radius is
categorically different from a failing test, and it is why this gate runs before
push rather than before MR.

A `makemigrations --check` / `db:migrate:status` style gate proves the committed
migrations *describe the models*. It never opens a database, so it says nothing
about whether they will **apply to one that has rows in it**. That class has no
gate by default — this agent is it.

## Checklist

### 1. The migration exists and matches the models

Run the project's "are there unmade migrations?" check. A model change with no
migration is the most common miss, and it fails at deploy, not in review.

### 2. A constraint added to a populated table is repaired first

**This is the highest-severity item here.** Adding a `UNIQUE`, `CHECK`,
`NOT NULL`, or exclusion constraint **builds and validates against every existing
row**. One violating row is an upgrade crash-loop.

For any constraint added to a table that may already hold data, require **one**
of these, and say which:

- a data-repair step (a data migration) that runs **before** the constraint in
  the same migration, or
- a written reason existing rows provably cannot violate it, in a comment on the
  operation itself.

These four shapes are safe without either, and are worth recognizing so the gate
does not cry wolf: the table is created in the same migration (it is empty); the
migration is a squash that replaces already-applied history; the same migration
converts an existing uniqueness declaration (already enforced); or a data-repair
step already precedes it.

Be honest about what the written reason buys. It is a rubber stamp and cannot
stop a wrong answer. What it removes is the **silence** — before it, the
schema-consistency gate went green on the migration and that green read as
evidence about the migration when it was evidence about something else entirely.

### 3. NOT NULL and default safety

A new non-nullable column on a populated table needs a default, or a three-step
sequence (add nullable → backfill → enforce). Flag a single-step add.

### 4. Destructive operations

Dropping a column, table, or index is irreversible in effect even when the
migration is technically reversible. Flag every one, and check it against the
project's backward-compatibility policy — typically **never drop in the same
release that removes the code reference**; separate by at least one release so a
rollback has something to land on.

**"We only run one replica" is a claim about the deployment manifests, not a
fact about the change — go read them.** A single-release destructive drop is
only rollout-safe if no old process can serve a request against the new schema,
and that argument fails in two ways people assert past from memory. First, the
population it describes may not include the project's own reference
configuration: check the shipped values/manifests for the replica count rather
than recalling it. Second, **a rolling update surges a new pod at any replica
count ≥ 1** unless a deployment strategy says otherwise — so at `replicas: 1`
with no explicit strategy, old and new run together anyway, briefly, which is
all a drop needs to break a live request.

Require one of three, and say which: (a) a two-release deprecation window —
make it nullable and stop reading it, then drop in the next release; (b) the
**old** code's read path already tolerates the column being gone, which only
helps if that tolerance shipped in the same release as the drop or earlier, since
it cannot retroactively patch a process already running the old image; or (c) the
window is explicitly accepted and written into that release's upgrade notes.

### 5. Blocking operations on large tables

Flag anything that takes a long-lived exclusive lock: a full-table rewrite, an
index built non-concurrently, a type change that rewrites rows. On a large table
this is downtime, not slowness. Recommend the concurrent or batched form.

**Additive does not mean downtime-free.** A new constraint, a non-concurrent index, an exclusion constraint, or an extension install can take a table lock proportional to row count, or need a database privilege the app role lacks. For each one in the change, check whether it does — and if so, that the release's upgrade notes name it. Upgrade notes that list only the destructive operations and promise "no downtime beyond migrate" are wrong when an additive operation locks a large table.

### 6. Reversibility

Confirm the migration can be reverted, or state explicitly that it cannot and
why. An irreversible migration is sometimes correct — it must never be
accidental.

### 7. Declared over raw

Prefer constraints and indexes declared in the model/schema over raw DDL.
Declared objects are regenerated automatically and survive a squash; raw DDL
lives outside the schema state and is silently dropped when migrations are
regenerated. Where raw DDL is genuinely required (extensions, specialized index
types, concurrent builds), note that it depends on the original migrations being
retained.

### 8. Never import a migration module from a test

It couples the suite to migration **file names**, which a squash deletes. Assert
the outcome on the model instead; if a data backfill needs a unit test, test the
function it calls, not the migration wrapper.

## Output format

For each finding:

```
### [CRITICAL|HIGH|MEDIUM|LOW] <title>
**Where:** <file:line>
**What happens:** <the concrete failure — name the deploy behavior, not the rule>
**Fix:** <the specific change>
```

Severity guide: **CRITICAL** = crash-loops a deploy or loses data. **HIGH** =
downtime or an irreversible drop. **MEDIUM** = works now, traps a future squash
or rollback. **LOW** = style and consistency.

End with the denominator, not just the hits: **how many schema-touching
operations you reviewed and how many were affected.** A finding without a
denominator reads as "I found the problem" when it may mean "I found the one
instance a test happened to cover" — upstream, one such fix surfaced a single
affected writer and hid three more.
