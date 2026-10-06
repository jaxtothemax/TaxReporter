---
title: Agents
description: Every review and helper agent Blueprint ships — what it checks, why that check is worth an agent, when it runs, and which model it uses.
---

**The big picture:** An agent is a focused helper Claude starts for one job — "review
this diff for permission bugs," "write the changelog entry." Blueprint ships 17 of them in
`.claude/agents/`. Most are **gates**: they read a change and say what's wrong with it
before it merges.

**Why it matters:** One general-purpose session reviewing its own work misses the same
things every time. A specialist with a fresh context and one checklist doesn't get tired,
doesn't skip steps, and doesn't share the author's blind spots.

**How they get used:**
- Claude starts them on its own when a change matches their description (each agent's
  `description:` line says when). With [`global-claude-md.example`](/getting-started/start-a-project/#7-turn-on-the-agent-workflow)
  installed, the *Fast paths by change class* table in `CLAUDE.md` makes that mandatory
  rather than optional.
- You can always ask for one by name: *"run the security-review agent on this branch."*
- Not every agent runs on every change. A typo fix runs almost none; a new full-stack
  feature runs most. See [Development workflow](/guides/development-workflow/).

**Reading the entries:** **Opus** is the stronger, pricier model, used for judgment;
**Sonnet** is faster and cheaper, used for checklists. "Can delegate" means the agent may
start a few Sonnet sub-agents for parallel scanning. "Read-only" means it can't edit files.

## At a glance

| When | Agents |
|---|---|
| [Before design](#before-design) | `voc` · `threat-model` |
| [Design](#design) | `architect` · `ux-design` |
| [Review the change](#review-the-change) | `regression-check` · `security-review` · `rbac-check` · `perf-check` · `schema-check` · `generated-artifact-check` · `ux-review` · `accessibility` |
| [Finish the change](#finish-the-change) | `test-scaffold` · `completeness-check` · `changelog` · `docs` |
| [On demand](#on-demand) | `dependency` |

---

## Before design

### `voc`

**What it checks:** How your personas would react to a proposed feature — adoption
blockers, usability worries, priority mismatches — grounded first in whatever real
evidence exists.

**Why it matters:** The most expensive bug is a well-built feature nobody needed. This is
the cheapest point to hear "who is this for?"

**Yes, but:** it's a simulation of your personas, not user research.

**When:** before `architect`, on any new user-facing feature. Also runs as the `/voc`
skill.
**Model:** Opus · can delegate.

### `threat-model`

**What it checks:** Where data crosses a trust boundary in a *planned* feature — login,
permissions, sessions or sync, tenancy, file uploads, payments, third-party input — and
what an attacker could do at each crossing (the STRIDE method).

**Why it matters:** `security-review` finds holes in code that exists. This finds them in
the design, before any code is written, when moving a boundary costs a whiteboard instead
of a rewrite.

**When:** before `architect`, for any new subsystem that crosses a trust boundary.
**Model:** Opus · can delegate.

---

## Design

### `architect`

**What it checks:** The technical approach, before implementation — technical debt,
coupling, naming, migration risk, API changes, and whether the change can be undone. It
raises blocking questions and recommends an approach.

**Why it matters:** Changing a plan costs minutes; changing merged code costs days. **Do
not start implementing until its blocking questions are answered.**

**When:** any new feature, new endpoint, model change, or change to existing behavior.
Not for a bug fix with a known cause.
**Model:** Opus · can delegate.

### `ux-design`

**What it checks:** Proposes the layout, components, interaction flow, and every state
(loading, empty, error) for a UI feature — specific enough that whoever builds it makes no
design decisions.

**Why it matters:** When design is left to the implementer, every screen invents its own
patterns. One proposal up front keeps the product consistent.

**When:** after `architect`, before implementing any UI.
**Model:** Opus · can delegate.

---

## Review the change

The first four below are the **pre-MR gate batch**: independent reads of the same diff,
run together in parallel. Running them one after another was the biggest avoidable source
of review delay.

### `regression-check`

**What it checks:** Whether the change breaks something that used to work. It maps
changed files to risk areas, finds stale test mocks and fixtures, runs the affected test
suites, and checks every other consumer of any shared rule the change moved.

**Why it matters:** New code is reviewed carefully; the old code it quietly broke usually
isn't. This is the gate that looks backward.

**When:** before every MR on a branch that changes source code.
**Model:** Opus (default; `/batch` runs it on Sonnet) · can delegate.

### `security-review`

**What it checks:** The OWASP Top 10, authorization gaps, input handling, secrets, plus
project-specific risks — for example, a field the API hides from some users but a
real-time channel still broadcasts to them.

**Why it matters:** Security bugs are the ones that cost trust, not just time, and they're
easy to miss in a diff that "just adds an endpoint."

**When:** any change to an endpoint, login logic, file upload, invite flow, or
user-controlled input.
**Model:** Opus (default; `/batch` runs it on Sonnet) · can delegate.

### `rbac-check`

**What it checks:** Access control on every endpoint: login required, each object scoped
to users who may see it, roles enforced per action, no field or query leaking data across
users, and real-time connections closed when access is revoked.

**Why it matters:** A missing permission check is a **security vulnerability**, not a
style issue — and it's the single most common way one user sees another's data.

**When:** any new or changed endpoint, view, route, serializer, or permission rule.
**Model:** Sonnet · read-only.

### `perf-check`

**What it checks:** N+1 queries, missing eager loading, unbounded result sets, missing
transaction boundaries — and that every way an endpoint can grow (more rows, more
columns, more members) has its own test.

**Why it matters:** These bugs are invisible with ten test rows and take production down
with ten thousand.

**When:** any new or changed endpoint, query, or data-access path.
**Model:** Sonnet · read-only.

### `schema-check`

**What it checks:** Database changes: a migration exists and matches the models;
destructive and table-locking operations are called out (and listed in upgrade notes);
a new constraint can't crash-loop a deploy on existing data; the change can be reversed.

**Why it matters:** A bad migration is the one deploy you can't simply roll back. It runs
on startup against real data.

**When:** whenever a model, schema file, or migration changes — **before you push**,
not before the MR.
**Model:** Sonnet.

### `generated-artifact-check`

**What it checks:** Files generated from (or hand-copied from) your code — OpenAPI
schemas, shared client types, SDKs, GraphQL or protobuf schemas, schema dumps, fixture
snapshots — were regenerated from the fully merged code, and their shape matches what the
code really returns.

**Why it matters:** A stale schema passes every check that compares it with itself. The
bug shows up in a client, weeks later.

**When:** any change to an API surface, exported type, or public schema.
**Model:** Sonnet.

### `ux-review`

**What it checks:** UI code against your design system — color tokens, component reuse,
type sizes, spacing, interactive states, and loading, empty, and error states.

**Why it matters:** Small inconsistencies add up to a product that feels unfinished. Some
token mistakes look right in light mode and break in dark mode, so it sweeps the whole
repo, not just the changed files.

**When:** after any UI change. Pairs with `accessibility`. Reads `frontend/CLAUDE.md`
(see `/import-design`).
**Model:** Sonnet · read-only.

### `accessibility`

**What it checks:** WCAG 2.1 AA: keyboard operation, screen-reader names, focus
management (including focus that stays inside an open dialog), contrast, and touch
targets.

**Why it matters:** An inaccessible screen locks people out. And unlike visual polish,
it's nearly invisible to a sighted mouse user reviewing the diff.

**When:** after any UI change.
**Model:** Sonnet · read-only.

---

## Finish the change

### `test-scaffold`

**What it checks:** Generates tests in your project's existing style for code that has
none — and requires watching each new test **fail** on the unfixed code before trusting
it.

**Why it matters:** A test that has never failed might not test anything. Watching it go
red first is the cheapest proof it does.

**When:** a new feature or bug fix with no existing coverage.
**Model:** Sonnet · can delegate · can edit files.

### `completeness-check`

**What it checks:** The whole branch against its issue, by an agent that **did not write
it**:
- every acceptance criterion and test-plan line in the issue *and its comments*;
- the whole class of bug, not just the reported instance;
- other code that relied on any shared rule the change moved;
- whether the tests can actually fail, and whether the docs are true;
- collisions with what has landed on `main` since the branch started.

It tags each finding with its cause, and returns the **Requirements** table the MR
carries.

**Why it matters:** An audit of 20 merged MRs in a sibling project found gaps in 16 —
mostly breaking rules that were already written down. What was missing was anyone but the
author checking before the push. The author's context is the worst place to look for what
the author didn't think of.

**When:** every source or docs branch, **before push**, after the gate batch. Fixes go in
a new commit; then at most one more pass:
- a narrow **fix-diff re-check** when a fix changed executable code;
- or a full **round 2** (fresh Opus, not shown round 1's findings) when round 1 found a
  structural problem or four or more gaps.

Never a loop.
**Model:** Sonnet; Opus for complex branches · makes no changes (its rules forbid edits, commits, and pushes).

### `changelog`

**What it checks:** Writes the one-line changelog fragment in `changelog.d/` with the
right type (`added`, `changed`, `fixed`, `security`).

**Why it matters:** The CI `changelog-check` job blocks an MR without one, and the
release notes are assembled from these lines — so they're written while the change is
fresh, not the night before release.

**When:** any branch that touches source.
**Model:** Sonnet · can edit files.

### `docs`

**What it checks:** Writes and updates user-facing documentation — structure, navigation,
version notes, a build check — and sweeps for old claims that the change made false, on
other pages, in `README.md`, and in `changelog.d/`.

**Why it matters:** Docs that describe last month's behavior are worse than none: readers
trust them.

**When:** any user-facing doc change, especially a new page.
**Model:** Sonnet · can delegate · can edit files.

---

## On demand

### `dependency`

**What it checks:** A package before you add it: its license (blocks GPL-2.0/3.0), known
vulnerabilities, whether your stack already does the job, and how much else it pulls in.

**Why it matters:** Every dependency is code you didn't review and must keep patching. A
license mistake can be a legal problem, not just a technical one.

**When:** before adding any new package.
**Model:** Sonnet · can delegate · can search the web.

---

## Go deeper

- **The model split, the delegation pattern, and writing your own agent:**
  [Agent architecture](/reference/agent-architecture/).
- **The record each gate leaves in the MR, and how `/kaizen` uses it:**
  [The gate ledger](/reference/harness-gates/#the-gate-ledger).
- **The source of truth:** each agent's own file in `.claude/agents/`. Its front matter
  (`model:`, `tools:`, `description:`) is exactly what Claude Code reads.
