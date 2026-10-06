# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for [PROJECT NAME].

An ADR captures a significant architectural decision: what was decided, why, and
what the consequences are. It is a permanent record — once accepted, ADRs are not
deleted or edited. If a decision is reversed, a new ADR supersedes the old one.

## Naming

```
NNNN-short-title.md
```

- `NNNN` — zero-padded sequence number starting at `0001`
- `short-title` — lowercase, hyphen-separated

Examples:
```
0001-record-architecture-decisions.md
0002-use-postgresql-for-primary-storage.md
0003-adopt-event-sourcing-for-audit-log.md
```

## Creating a new ADR

Use the `/adr` command in Claude Code:

```
/adr Title of the decision
```

Or copy `docs/adr/0001-record-architecture-decisions.md` and increment the number.

## Status values

- **Proposed** — under discussion, not yet decided
- **Accepted** — the decision is in effect
- **Deprecated** — the decision was valid but is no longer relevant
- **Superseded by [NNNN]** — a later ADR reversed or replaced this one

There is deliberately no status for "accepted but not built". `Accepted` is about
the **decision**, never about the code. When the two differ, add an
`Implementation status` **blockquote** directly under the Status line:

```markdown
**Status:** Accepted (2026-08-29)

> **Implementation status (2026-09-04 ADR audit, #123):** the *decision* stands,
> but nothing ships with this ADR yet — verified against `src/`, there is no such
> model, route, or component.
```

A blockquote is invisible to a status parser by construction, which is why it is a
blockquote and not a second `**Field:**` line. Remove it when the ADR ships — a
stale "not built" note is the same misinformation reversed. See
`.claude/skills/adr/SKILL.md`.

## When an ADR moves to Accepted

Re-read every open issue that names it. An issue arguing for an ADR is written
*before* the ADR settles; the delta between the two is the set of **rejected**
options, and nothing else in the pipeline compares them.

```bash
python3 scripts/adr-accepted-issue-sweep.py --adr NNNN
```

Record the count in the ADR's `## On Acceptance` block, including when it is zero.
