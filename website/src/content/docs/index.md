---
title: Blueprint
description: A ready-made delivery system for a new software project, for teams that build with GitLab and Claude Code.
---

**The big picture:** Blueprint is a repository you clone as the first commit of a new
project. It holds no application code and picks no language. It gives you the *process*
around the code — branches, reviews, tests, releases — already wired for Claude Code.

**Why it matters:** AI coding agents are fast, but speed without structure makes messes
faster. Most projects only add review and release discipline months in, after the
incidents that prove they need it. Blueprint gives you that discipline on day one.

**The bottom line:** You describe what you want. The workflow supplies project context,
runs the reviews that change actually needs, and lands the result as a reviewed merge
request with tests and a changelog entry already in place.

## The harness behind Visiban and TruePPM

**The big picture:** Blueprint is **the harness that runs Visiban and TruePPM**, plus
the lessons learned building both projects, collected here. Blueprint was extracted from Visiban and is kept current by TruePPM's parallel harness, and fixes flow back into both.

| Project | What it is | Repo | Docs |
|---|---|---|---|
| Visiban | Open-source Kanban board where every row is an entity and every move is on the record | [gitlab.com/visiban/visiban](https://gitlab.com/visiban/visiban) | [docs.visiban.com](https://docs.visiban.com) |
| TruePPM | Open-core project, program, and portfolio management for waterfall, agile, and hybrid | [gitlab.com/trueppm/trueppm](https://gitlab.com/trueppm/trueppm) | [docs.trueppm.com](https://docs.trueppm.com) |

**Go deeper:** [Credits](/about/why-blueprint/#credits) explains how the three projects
relate and the scale they have run at.

## How these docs work

Every page opens with the essentials: **The big picture** (what it is), **Why it
matters** (what it buys you), then short bullets. Skim those and move on, or keep reading
— the **Go deeper** sections below them hold the full detail and the reasoning.

New to agents, skills, hooks, or worktrees? Keep the **[Glossary](/reference/glossary/)**
open in another tab.

## Without Blueprint vs. with it

- **Without:** you ask for a change. The agent writes code, maybe writes tests, maybe
  touches something you didn't ask about, and you reconstruct what happened from the diff.
- **With:** the change starts from a tracked issue, gets its own branch, goes through the
  reviews sized to it, and arrives as an MR that records which checks ran and what they
  found.

Blueprint treats Claude Code as a contributor working inside a defined process — the same
branch, review, and test discipline a human contributor follows, written down once
instead of re-explained every session.

## What you get

- **A merge-request-only workflow.** Branch, commit, and MR conventions are written down
  and enforced by Git hooks and CI.
- **17 specialist [agents](/reference/agents/).** Reviewers for security, permissions,
  performance, regressions, database changes, UX, accessibility, and more — each run only
  when a change needs it.
- **20 [skills](/reference/commands/).** One-command workflows for setup (`/kickoff`),
  planning (`/dotplanning`), shipping (`/mr`), and releasing (`/release`).
- **A CI pipeline** with governance checks that work out of the box, plus add-ins for
  Python, Node.js, Go, Docker, and Helm.
- **[Gates that prove they still work](/reference/harness-gates/).** Every check script
  can demonstrate it still fails on a bad input, so a green result means something.
- **Safe parallel work.** [`scripts/wt`](/guides/parallel-work/) gives each issue its own
  folder and branch, so several Claude sessions can run at once without colliding.
- **A fragment-based changelog** and a release script that assembles it.

You supply only what nobody else knows — the project's name, its users, its stack, and
what version one must do. `/kickoff` asks for those and writes them in.

## Is this for you?

| You are… | Fit |
|---|---|
| Curious about AI coding but haven't built anything yet | Probably too early — see [the maturity ladder](#you-dont-need-blueprint-to-start) |
| Have built a small app with Claude Code | Good next step |
| Moderately technical and comfortable with Git | Good fit |
| Building a serious personal project you'll maintain | Very good fit |
| A professional developer using AI agents | Strong fit |
| A team using Claude Code and GitLab together | Strong fit |
| Looking for a no-code tool | Not the right tool |
| Wanting a quick one-off prototype | Probably overkill |

**Between the lines:** Blueprint is built for the move from *"Claude helped me make
this"* to *"I have a repeatable way to build and maintain this."*

## You don't need Blueprint to start

It's a later rung, not a starting requirement:

1. **Explore.** Claude Code and Git. Just build things.
2. **Build reliably.** Add a `CLAUDE.md` with your project's rules, tests, and a Git
   workflow. You're building something you expect to keep.
3. **Scale the workflow.** Blueprint: specialist agents, review gates sized to each
   change, CI, release automation. You're running a larger AI-assisted project, alone or
   with a team.

## What you need to know

**Required:** basic command line; basic Git (clone, branch, commit, pull, merge); basic
GitLab; access to Claude Code; a project you want to apply this to.

**Helpful, not required:** some programming; what a test suite does; basic CI; reading
Markdown and YAML; experience directing an AI coding agent.

**Not needed:** professional development experience, building AI agents, CI/CD
expertise, GitLab administration, or prompt engineering. Blueprint teaches what applies
as you go.

## What Blueprint is not

- **Not a model or a Claude Code replacement.** It configures Claude Code; it doesn't
  replace it.
- **Not an app generator or scaffold.** No `src/`, no framework, no Dockerfile. Add those
  the way you normally would.
- **Not a guarantee.** It makes AI-written code *reviewed*, not automatically correct, and
  it doesn't replace understanding what you're building.
- **Not a dependency.** Once cloned, the files are yours. Nothing pulls updates from
  Blueprint.
- **Not GitHub-first.** CI, issue templates, and MR templates target GitLab. The scripts
  also work with `gh`; see [Removing what you don't need](/reference/whats-included/#removing-what-you-dont-need).

## Where to go next

- **See it work first:** the [15-minute quickstart](/getting-started/quickstart/) on a
  throwaway copy.
- **Set up a real project:** [Start a project](/getting-started/start-a-project/).
- **Understand why it's built this way:** [Why Blueprint](/about/why-blueprint/).
- **Look something up:** [Skills](/reference/commands/), [Agents](/reference/agents/),
  [Glossary](/reference/glossary/).
