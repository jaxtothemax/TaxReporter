# 1. Record architecture decisions

**Date:** [YYYY-MM-DD]
**Status:** Accepted

## Context

Significant architectural decisions accumulate silently over time. Without a
record, the reasoning behind a choice is lost — leaving future contributors to
guess, re-litigate, or unknowingly work against constraints that were established
for good reasons.

## Decision

We will record architecture decisions using lightweight Architecture Decision
Records (ADRs) stored in `docs/adr/`. Each ADR captures what was decided, why,
and what the consequences are.

ADRs are append-only: accepted decisions are never edited. If a decision changes,
a new ADR is created that supersedes the old one.

## Consequences

- Architectural context is preserved and searchable in the codebase
- New contributors can understand why the project is structured the way it is
- Decision reversals are explicit and traceable
- Small overhead per decision — ADRs are intentionally short
