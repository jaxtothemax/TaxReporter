---
title: Why start a project from Blueprint
description: The failure modes a starting structure front-loads, how the three layers fit together, and how this maps to Claude Code's documented best practices.
---

**The big picture:** A project's first weeks set habits that are expensive to change
later. Blueprint front-loads the answers to the problems nearly every repository runs
into, before they can form.

**Why it matters:** With an AI agent writing code, those problems arrive faster — and an
agent repeats whatever habits the repo teaches it. A structure from the first commit
means it learns good ones.

**Two ideas run through all of it:**
- **Effort in proportion to the change.** Nothing runs "just in case"; a typo fix never
  gets an architecture review.
- **A passing check has to mean something.** Every gate can prove it still fails when it
  should.

## The problems it heads off

| Without a starting structure | With Blueprint from the first commit |
|---|---|
| Conventions get decided one argument at a time | Branch, commit, MR, and changelog rules are written down in `CONTRIBUTING.md` and `CLAUDE.md`, and enforced by hooks and CI |
| Work starts from a sentence in chat, and nobody can say later what was agreed | Every change starts from a tracked issue. `/import-spec` turns your spec into issues, and `/dotplanning` turns a milestone into an ordered plan that lists what is still missing |
| Review depth depends on who reviews and how busy they are | Each kind of change gets a fixed set of reviews: a bug fix with a known cause gets a regression check, tests if it has none, and a completeness audit; a full-stack feature gets the full design and security chain |
| An AI assistant works fast, but nothing checks its output the same way twice | Claude Code agents run the same checklist on every diff and record the result in the MR |
| CI arrives after the first broken `main`, and nobody checks that its checks still work | Every gate script ships with a self-test that proves it can still fail, run in the same CI job as the real check |
| The changelog gets written the night before a release | Every MR adds a one-line fragment file, and `/release` assembles them |
| Parallel work collides: two sessions take one issue, or one checkout switches branches under another | `scripts/wt` gives each issue its own worktree, and a pre-push gate blocks a second MR for an issue that already has one |

Each reference page names the failure that led to its rule — see
[Harness gates](/reference/harness-gates/).

## How it fits together

Blueprint has three layers, and lower layers never depend on higher ones. Leave out Claude
Code and the repository and tracker layers still work. Leave out the tracker too, and the
hooks, CI, changelog, and release tooling still work.

| Layer | What is in it | Needs |
|---|---|---|
| **1. Repository** | `Makefile`, `hooks/`, `.gitlab-ci.yml` and `ci/`, `changelog.d/`, `scripts/` (release, `wt`, gates), issue and MR templates | `git`, `make`, `python3` |
| **2. Tracker** | Issue-driven work: branches named after issues, the duplicate-MR gate, `Closes #N`, milestones for planning | A GitLab project and `glab` (or GitHub and `gh`) |
| **3. Claude Code** | `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/personas.md`, nested `CLAUDE.md`/`CLAUDE.md.example` files (`scripts/`, `backend/`, `frontend/`, `tests/`), `global-claude-md.example` | `claude` |

A project moves through five phases. Setup happens once; the other four repeat for every
milestone:

| Phase | You run | You get |
|---|---|---|
| **Set up** (once) | `/kickoff`, `make customize`, `make setup` | A named project with personas, stack, hooks, and a checklist of what is left |
| **Fill the backlog** | `/import-spec` | Tracker issues, plus a milestone per phase if your spec has phases |
| **Plan a milestone** | `/dotplanning <version>` | An HTML plan mapping features to screens, endpoints, and docs, with gaps, open questions, and ordered workstreams |
| **Build** | `scripts/wt new <issue>`, the review chain, `/mr` | One worktree and one MR per issue, each recording which reviews ran and what they found |
| **Release** | `/pre-release full`, then `/release` | An audited release branch with an assembled changelog and bumped versions |

## Built on Claude Code best practices

Blueprint is a concrete implementation of Anthropic's recommended Claude Code patterns —
each mechanism here maps to a documented best practice:

| Best practice | How Blueprint applies it |
|---|---|
| **A checked-in `CLAUDE.md`** | Root `CLAUDE.md` holds durable, everyone-facing conventions; `/init` can regenerate a starter from your code. Kept concise with `@path` imports and nested `CLAUDE.md` files. |
| **Path-scoped context** | A `CLAUDE.md` placed inside the directory it governs (`scripts/CLAUDE.md`, `frontend/CLAUDE.md`) loads automatically only when you open a file under there, so the root file stays short. Directories Blueprint doesn't ship code for yet keep a `CLAUDE.md.example` to move into place once one exists. |
| **Subagents with least-privilege tools** | Each `.claude/agents/*.md` sets `model:` to the right reasoning tier and restricts `tools:` to what it needs (e.g. `ux-review` and `accessibility` are read-only). |
| **Skills for repeatable workflows** | `.claude/skills/*/SKILL.md` package multi-step flows; side-effecting ones (`/mr`, `/release`, `/dotplanning`) set `disable-model-invocation: true` so they never auto-fire. |
| **Hooks for deterministic guardrails** | `PreToolUse` blocks lock-file/migration edits and gates a `glab mr create` Bash call on the security review; `PostToolUse` reminds; `Stop` ships as a documented, opt-in example (not wired by default). |
| **Explicit permissions** | `settings.json` allows read-only tracker/git queries and denies force-push, auto-merge, and reading secrets (`.env`, `*.pem`). |
| **Plan before code** | The design gates (`/voc` → `threat-model` → `architect` → `ux-design`) front-load thinking; use Plan mode for the hard calls — see [Plan mode](/guides/tips-and-tricks/#plan-mode) in Tips & tricks. |
| **Auto memory** | Project learnings accumulate in `~/.claude/projects/…/memory/`; durable rules get promoted into `CLAUDE.md`. Review with `/memory`. |
| **Proportional effort** | The *Fast paths by change class* table runs only the gates a change needs, and the pre-MR cluster runs as one parallel batch — not every gate on every change. |
| **Cost discipline** | Brief subagents like a colleague (paths + line numbers), prefer `ToolSearch` over speculative schema loads, don't idle a session past the prompt-cache TTL, and cap fan-out — default 5 concurrent delegated agents per task, no re-delegation beyond one Phase-1 level, cheaper model by default (see [Fan-out ceiling](/reference/agent-architecture/#fan-out-ceiling)). |

The result: Claude does the right amount of work for each change, with guardrails that
fail safe and a workflow that stays out of the way until it's needed.

## Credits

Extracted from the [Visiban](https://gitlab.com/visiban/visiban) project governance and
kept current with the parallel harness built for [TruePPM](https://gitlab.com/trueppm/trueppm)
— gate and workflow improvements flow in both directions between the three projects.
Together, Visiban and TruePPM have refined these patterns through 13,000+ CI pipeline
runs and 3,600+ merge requests.
