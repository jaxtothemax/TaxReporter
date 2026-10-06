---
title: Glossary
description: Plain-language definitions of every term these docs use — written for someone who has used an AI coding tool but is new to running one inside a disciplined workflow.
---

**The big picture:** Blueprint borrows words from three worlds — AI agents, Git, and CI —
and uses them precisely. This page defines each one in a sentence or two.

**Why it matters:** Most confusion in these docs comes from one undefined word. If a page
loses you, the term is probably here.

## AI and Claude Code

**Claude Code** — Anthropic's command-line coding assistant. You run `claude` in a
project folder, describe what you want, and it reads files, runs commands, and edits
code. Blueprint is a set of instructions and tools that shape how it works.

**Session** — one running Claude Code conversation. It remembers what it read and did
until you `/clear` it or close it.

**Context** — everything a session currently "has in mind": your messages, the files it
read, command output. Context costs money every turn and degrades when it gets very
long, which is why the docs keep telling you to keep it small.

**`CLAUDE.md`** — a Markdown file Claude Code reads automatically at the start of every
session. It is how you tell the assistant your project's rules once, instead of
repeating them in every prompt. Blueprint ships three kinds:
- the root `CLAUDE.md` — this project's conventions;
- nested ones such as `scripts/CLAUDE.md` — loaded only when Claude works on files in
  that folder;
- `global-claude-md.example` — rules you copy to `~/.claude/CLAUDE.md` so they apply to
  every project on your machine.

**Agent (subagent)** — a separate Claude instance that the main session starts to do one
focused job, such as "review this diff for security problems." It gets a fresh, empty
context, does the job, and reports back. Blueprint's agents live in `.claude/agents/`, one
Markdown file each. See [Agents](/reference/agents/).

**Skill (slash command)** — a packaged, multi-step workflow you start by typing
`/name`, such as `/mr` to open a merge request. Skills live in `.claude/skills/`. See
[Skills](/reference/commands/).

**User-invoked only** — a skill marked `disable-model-invocation: true`. Claude can't start
it on its own; only you can, by typing it. Blueprint uses this for anything that touches
the outside world or spends real money (`/mr`, `/release`, `/batch`). The docs mark these
with ⛔.

**Hook** — a small script Claude Code runs automatically at a set moment, such as just
before it edits a file. Hooks are deterministic: they run every time, whether or not the
model remembers to. Blueprint's live in `.claude/hooks/`.

**Model tiers (Opus, Sonnet)** — Claude comes in sizes. **Opus** is the stronger,
pricier reasoner; **Sonnet** is faster and cheaper. Blueprint gives judgment-heavy work
(architecture, security, design) to Opus and checklist work (scans, test scaffolds) to
Sonnet. Each agent's file names its tier in its `model:` line.

**Fan-out** — one agent starting several more. Useful for parallel scanning, expensive
when it runs away. Blueprint caps it — see [Fan-out ceiling](/reference/agent-architecture/#fan-out-ceiling).

**Persona** — a written profile of one kind of user (their goal, their frustration). The
`/voc` skill role-plays your personas to stress-test a feature idea. It's a design aid,
**not** user research.

**Memory** — notes Claude Code saves between sessions in `~/.claude/projects/…/memory/`.
Useful for lessons learned; `/memory-audit` keeps it tidy.

## Git and GitLab

**Repository (repo)** — the project folder and its full change history.

**Branch** — a named line of work. Every change in Blueprint happens on its own branch,
never directly on `main`.

**Commit** — one saved snapshot of changes, with a message. Blueprint uses
[conventional commits](/guides/git-and-changelog/#commit-format) (`feat:`, `fix:`, …).

**Merge request (MR)** — GitLab's request to merge a branch into `main`, with a
description, a review, and a pipeline. GitHub calls this a pull request (PR).

**Issue** — a tracked unit of work in GitLab. In Blueprint every change starts from one.
See [Issues are the unit of work](/guides/issues-and-the-tracker/).

**Milestone** — a group of issues with a target date, usually one release.

**Worktree** — a second (or third…) checkout of the same repo in its own folder, on its
own branch. Blueprint's `scripts/wt` makes one per issue so parallel sessions never trip
over each other. See [Parallel work](/guides/parallel-work/).

**`glab` / `gh`** — the GitLab and GitHub command-line tools. Blueprint's scripts use
whichever matches your `origin` remote.

## CI and checks

**CI pipeline** — the set of automated jobs GitLab runs on every MR (and on `main` and on
tags). A **green** pipeline means every blocking job passed.

**Gate** — any check that can say *no*: a CI job, a pre-push script, or a review agent.
Blueprint's rule is that a gate's green must be evidence, so every gate script can prove
it still fails when it should. See [Harness gates](/reference/harness-gates/).

**Self-test** — a gate's `--self-test` mode: it builds a deliberately broken example and
confirms the gate rejects it.

**Git hook** — a script Git runs on your machine at `git commit` (pre-commit) or
`git push` (pre-push). Not the same thing as a Claude Code hook.

**Pre-MR gate batch** — the four review agents (`regression-check`, `security-review`,
`rbac-check`, `perf-check`) that read the same diff, run together in parallel before an
MR opens.

**Gate ledger** — the `## Gates` section of every MR description: one line per gate,
saying how many findings it produced. It's how you learn which gates earn their keep.

**Fast path** — the row of the *Fast paths by change class* table in `CLAUDE.md` that
matches a change, which lists exactly which gates it needs. A typo fix doesn't get an
architecture review.

**Changelog fragment** — a one-line file in `changelog.d/` describing one change. Release
time stitches them into `CHANGELOG.md`.

**Fail closed** — when a check can't get an answer (network down, service unreachable),
it reports failure rather than quietly passing.
