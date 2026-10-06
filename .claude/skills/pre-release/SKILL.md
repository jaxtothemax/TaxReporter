---
name: pre-release
description: Cross-cutting audit of the codebase before cutting a release. Runs security, performance, regression, and documentation checks against the full change inventory since the last tag.
argument-hint: "[full | security | performance | docs]"
---

# Pre-Release Audit

Run a cross-cutting audit of the codebase before cutting a release. This catches
issues that day-to-day feature agents miss because they are domain-scoped — the
pre-release audit applies a "what becomes a public commitment?" lens.

Usage:
```
/pre-release full                # run all audits
/pre-release security            # security only
/pre-release performance         # performance only
/pre-release docs                # documentation only
```

---

## Step 1 — Determine scope

Parse `$ARGUMENTS`:
- `full` — run all audit phases
- A specific domain name — run only that phase
- No argument — default to `full`

---

## Step 1.5 — Cost and fan-out (before launching anything)

**State the expected cost before launching.** Tell the user the audit type, the number of
agents it will launch (2 context agents plus one per phase — `full` is 6), and a token
estimate, and give them the chance to narrow the scope to one phase. Until this project has
its own measurements, estimate from the agent count and say that the number is an
estimate. Record the run's actual total in the report so the next estimate has a real
baseline. An estimate that ignores child agents is wrong by the multiplier, which is why
the next rule exists.

**No nested fan-out.** Only this orchestrator launches agents. Every prompt it sends — the
context agents, each phase agent, and any consolidator — must include this line verbatim:

> **Do not spawn subagents; do the audit directly with Read/Grep/Bash.**

The phase agents (`security-review`, `regression-check`, …) carry the `Agent` tool and,
left unconstrained, delegate. Upstream, a targeted two-agent security audit spawned 14 more
(16 in total) because nothing said not to. An agent that runs past ~250k tokens, or about
twice its peers, is signalling a runaway (scope drift, a search loop, repeated re-reads),
not deeper rigor. Investigate it before trusting its findings.

---

## Step 2 — Gather release context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Change inventory:**
> Run `git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~50)..HEAD`
> to list all commits since the last tag (or last 50 if no tags exist).
> Also run `git diff --stat $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~50)..HEAD`
> for the full change summary.
>
> Categorize changes: new features, bug fixes, refactors, CI/config, docs.
> Return the categorized list with file paths.
>
> Do not spawn subagents; do the audit directly with Read/Grep/Bash.

**Sub-agent 2 — Changelog and docs state:**
> Read `CHANGELOG.md` and check:
> - Does `[Unreleased]` have entries for all the changes found?
> - Are there changelog fragments in `changelog.d/` waiting to be assembled?
>
> Also list all files under `docs/` and check for any `[not specified]`, `TODO`,
> or `FIXME` markers in documentation files.
>
> Return: changelog completeness assessment and docs gap list.
>
> Do not spawn subagents; do the audit directly with Read/Grep/Bash.

---

## Step 3 — Run audit phases

For `full`, run all phases. For targeted audits, run only the specified phase.
Run phases that are independent of each other in parallel where possible.

### Phase: Security

Invoke the `security-review` agent with the full change inventory as context.
Focus on:
- New endpoints without authentication or permission checks
- New serializer fields that expose sensitive data
- New file upload handling without validation
- Hardcoded secrets or credentials
- Dependency CVEs (run `npm audit` / `pip-audit` / `govulncheck` as appropriate)

### Phase: Performance

Invoke the `perf-check` agent with the full change inventory as context.
Focus on:
- New queries without eager loading
- New endpoints without pagination
- New bulk operations without transaction boundaries
- Missing database indexes for new filter/sort fields

### Phase: Regression

Invoke the `regression-check` agent with the full change inventory as context.
Focus on:
- Test coverage for all new code paths
- Stale mocks that don't reflect current module APIs
- Permission boundary changes that aren't tested
- Breaking changes to public APIs

### Phase: Documentation

**Scope of this phase: it is not a claims review.** It checks that changelog entries have
matching doc pages, that version callouts are present, that upgrade notes exist for
breaking changes, that API docs track API changes, and whatever the project's docs gates
enforce (internal links, the docs build). It does **not** check that a feature claimed in
the docs exists, that a claim about edition or licensing is true, or that a copy-paste
command runs as written. Report which classes were checked and say that those three were
not. Never summarize the result as "docs reviewed" or "claims verified".

Check every `### Added` and `### Changed` entry in `CHANGELOG.md [Unreleased]`:
- New features must have a corresponding doc page with a version callout
- Changed behavior must be reflected in existing doc pages
- Breaking changes must have migration/upgrade notes
- API changes must be reflected in API docs

---

## Step 4 — Compile report

Output a structured report:

```
# Pre-Release Audit — [full | <domain>]

## 🔴 Blockers (must fix before release)
- <finding with file path and specific issue>

## 🟡 Important (should fix or create milestone issue)
- <finding>

## 🟢 Observations (informational)
- <finding>

## Changelog completeness
- [✓] or [ ] for each change category

## Documentation completeness
- [✓] or [ ] for each new feature
```

---

## Step 5 — Recommend next steps

Based on the findings:

- If 🔴 blockers exist: "Fix these before proceeding to `/release`"
- If only 🟡 findings: "Triage these — fix now or create issues for the next release. Then proceed to `/release`."
- If clean: "No blockers found. Ready for `/release`."

---

## Rules

- **One-time gate, not an iterative loop** — run once at feature freeze, triage,
  fix blockers, then run once more as the final check. Do not re-run after every
  individual fix.
- **Do not fix issues directly** — report them. The user decides what to fix vs defer.
- **Be specific** — every finding must include the file path, line number, and what
  the issue is. Generic findings like "consider adding tests" are not useful.
- **Respect the change inventory** — only audit code that changed since the last tag.
  Do not audit the entire codebase unless there are no prior tags.
