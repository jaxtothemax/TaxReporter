---
title: Skills (slash commands)
description: Every slash command Blueprint ships — what it does, why it's worth running, and when to reach for it.
---

**The big picture:** A skill is a packaged workflow you start by typing `/name` in Claude
Code. Blueprint ships 20 of them, covering a project's whole life: setup, planning,
building, releasing, and keeping the process itself healthy.

**Why it matters:** Each skill turns a multi-step chore you'd otherwise explain from
scratch every time ("check the branch, write a description, link the issue, open the
MR…") into one command that does it the same way every time.

**How to read this page:**
- ⛔ means **you** have to type it — Claude can't start it on its own, because it touches
  GitLab, git history, or your budget.
- Each entry has **What it does**, **Why it matters**, and **Use it when**. The full
  instructions live in `.claude/skills/<name>/SKILL.md`.
- New to the terms? See the [Glossary](/reference/glossary/).

## At a glance

| Stage | Skills |
|---|---|
| [Set up](#set-up-a-project) | `/kickoff` ⛔ · `/import-spec` ⛔ · `/import-design` |
| [Plan](#plan-the-work) | `/dotplanning` ⛔ · `/voc` · `/adr` · `/sunset-check` |
| [Build and ship a change](#build-and-ship-a-change) | `/review` · `/mr` ⛔ · `/ci-debug` · `/fix-mr` ⛔ · `/batch` ⛔ |
| [Release](#release) | `/pre-release` · `/mass-merge` ⛔ · `/release` ⛔ |
| [Keep the process healthy](#keep-the-process-healthy) | `/kaizen` · `/voc-audit` ⛔ · `/incident-postmortem` · `/tracker-hygiene` · `/memory-audit` ⛔ |

---

## Set up a project

### `/kickoff` ⛔

**What it does:** Asks you five questions — what you're building, who uses it, your
stack, what version one must do, and your GitLab project path — then writes the answers
into `CLAUDE.md` and `.claude/personas.md`, and (if you gave a project path) creates one
issue per capability.

**Why it matters:** Everything downstream reads these answers. The review agents check
against your stack, `/voc` role-plays your personas, and the first issues give you a
backlog on day one. Ten minutes here saves re-explaining the project in every session.

**Use it when:** once, right after cloning. See [Start a project, step 4](/getting-started/start-a-project/#4-describe-the-project-with-kickoff).

### `/import-spec` ⛔

**What it does:** Reads a PRD, spec, or feature list, pulls out features and phases with
parallel sub-agents, shows you what it found, and creates GitLab issues (plus a milestone
per phase) **only after you confirm**.

**Why it matters:** A spec in a document can't be worked; issues can. Every mechanism in
Blueprint — branch names, the duplicate-work gate, `Closes #N` — keys off an issue number.

**Use it when:** you have a written spec and an empty tracker. Skip it if `/kickoff`
already created what you need.

### `/import-design`

**What it does:** Turns a design guide, brand guidelines, or a design-token export into
`frontend/CLAUDE.md`.

**Why it matters:** Without it, `ux-design` and `ux-review` can only give generic advice.
With it, they check against *your* colors, components, and spacing.

**Use it when:** your project has a UI and a design system, before the first UI feature.

---

## Plan the work

### `/dotplanning` ⛔

**What it does:** Plans one release milestone before any code is written. It:
- asks twelve kickoff questions that decide the release's shape (theme, date vs. scope,
  capacity, how many slots to hold for real-user reports, freeze date, cut line);
- maps every feature to the screens, endpoints, models, and docs it needs, and flags
  anything with no issue or design behind it;
- orders the work into workstreams and names each one's review chain;
- proposes a `release::committed` / `reserve` / `stretch` label for every issue and fits
  the committed set to your stated capacity — asking you, never guessing;
- writes a self-contained HTML report to `~/Downloads`.

**Why it matters:** Most late releases were late on day one — a missing screen, an
undecided question, or more committed work than the team can do. This finds those while
they're still cheap to fix.

**Use it when:** once per milestone, before the first feature branch. Re-run only if the
scope changes materially. It's the begin-gate; `/pre-release` is the end-gate.

### `/voc`

**What it does:** Runs a *Voice of the Customer* panel. It first looks for real evidence
(your tracker, then public discussion of this kind of product) and records how strong that
evidence is. Then each of your personas reviews the proposed feature, and it reports
adoption blockers, usability worries, and priority mismatches.

**Why it matters:** It surfaces the "who is this actually for?" questions before anyone
designs anything — the cheapest moment to change course.

**Yes, but:** it is a **simulation**, not user research. Never present its output as
customer feedback; a real user report always outranks it.

**Use it when:** before `architect` on any new user-facing feature. Run it as
`/voc all <feature>` or `/voc <persona-name> <feature>`.

### `/adr`

**What it does:** Creates a numbered Architecture Decision Record in `docs/adr/` using the
classic Context / Decision / Consequences template.

**Why it matters:** Six months from now, "why did we pick this database?" has a one-page
answer instead of an archaeology project. The skill also carries two rules that bite
later:
- `Accepted` means the *decision* was made, not that it shipped — say so in an
  `Implementation status` blockquote.
- When an ADR is accepted, re-read the open issues that cite it. They were written before
  the decision and may still argue for an option it rejected
  (`scripts/adr-accepted-issue-sweep.py` finds them).

**Use it when:** you make a choice that would be expensive to reverse — stack, data
storage, auth approach.

### `/sunset-check`

**What it does:** Asks each persona the opposite of `/voc`: *"this is gone next release —
what breaks for you?"* It first verifies what the feature really does in the code (not
what its docs claim), then recommends one of four verbs: **remove**, **fix**, **narrow**,
or **demote**.

**Why it matters:** Every feature costs maintenance forever. Without a disciplined way to
ask whether something should still exist, half-built and oversold features pile up.

**Use it when:** a feature is half-finished, rarely used, or costing more than it returns.

---

## Build and ship a change

### `/review`

**What it does:** A general code review of one file or the whole branch diff: correctness,
conventions, consistency, testing gaps, and documentation gaps.

**Why it matters:** The specialist agents each look for one kind of problem. `/review` is
the generalist pass that catches what falls between them.

**Use it when:** any time before `/mr`, especially on a change no specialist agent covers.

### `/mr` ⛔

**What it does:** Opens a merge request for the current branch. First it checks that the
branch is clean, a changelog fragment exists, and no other MR already covers the issue.
Then it writes a structured description — summary, a **Requirements** table, test plan,
the **Gates** ledger, and `Closes #N` — and creates the MR with `glab`.

**Why it matters:** The MR description is the permanent record of what changed and which
reviews ran. Writing it the same way every time is what lets `/kaizen` later measure which
reviews actually find problems.

**Use it when:** your branch is committed and its gates have run. It never merges — you
do that on a green pipeline.

### `/ci-debug`

**What it does:** Pulls the logs of every failed job in a pipeline (in parallel),
identifies the root cause, and prescribes a specific fix — file and change — **without**
applying it.

**Why it matters:** Retrying a red pipeline and hoping it turns green wastes time and
hides real bugs. Reading the log first is the rule; this does the reading for you.

**Use it when:** a pipeline fails and you want a diagnosis before anyone touches code.

### `/fix-mr` ⛔

**What it does:** Gets a blocked MR to green **and** mergeable. It checks both the
pipeline and whether the MR conflicts with `main`, resolves conflicts, diagnoses failures,
fixes, commits, pushes, and re-checks — at most three rounds. It never merges.

**Why it matters:** "Pipeline green" isn't "ready." An MR can pass CI and still conflict
with `main`. Checking both stops the "but it was green!" surprise.

**Use it when:** an MR is red or shows a merge conflict. Pass several MR numbers to work
through them one at a time.

### `/batch` ⛔

**What it does:** Lands several milestone issues in parallel. It asks which milestone and
labels to pull from (never guesses), then gives each issue its own worktree and its own
agent. It skips issues already checked out (the `status::wip` label), and `scripts/wt new`
checks out each one it starts, so a second wave or session cannot grab the same issue:
1. Each agent implements, runs its gates, **commits, and stops** before pushing.
2. The orchestrator runs [`completeness-check`](/reference/agents/#completeness-check) on
   each branch — a fresh auditor, because an agent shouldn't grade its own work and can't
   start one itself.
3. Fixes land as a new commit; at most one more audit pass runs.
4. A stale-base check, then the push and the MR.
5. The orchestrator verifies every agent's commits before believing its "done."

**Why it matters:** Parallel agents multiply both throughput and cost. The skill's rules
come from measuring real waves, where re-reading context — not writing code — was 95.9%
of the spend. So: Sonnet by default with four named reasons to escalate to Opus, a capped
wave size (default 5), and self-contained briefs.

**Choosing the model:** `/batch` reads each issue and picks the model for that issue's
agent, so one wave can mix models. The default is Sonnet. It escalates to Opus only when an
issue's root cause is unknown, the fix spans three or more packages, it changes the
product's core semantics, or it needs a design call the issue doesn't settle, and it names
the reason in its report. "Important" and "security fix" are not reasons on their own.
`/batch` runs its read-only gates (`regression-check`, `rbac-check`, `perf-check`,
`security-review`, `schema-check`) on Sonnet. `completeness-check` is the one exception and
can escalate to Opus. `regression-check` and `security-review` list `model: opus` in
`.claude/agents/` as their default, so they use Opus when you run them directly. `/batch`
overrides that at spawn time by passing `model: "sonnet"` on the Agent call, which takes
precedence over the agent file.

**Keeping token use down:** run your own session on Sonnet. `/batch` defaults the agents it
spawns to Sonnet too, so the whole wave stays cheap unless an issue earns Opus. Write
issues with a clear root cause and acceptance criteria. That is what lets `/batch` keep an
issue on Sonnet.

**Where Opus is pinned:** a few skills and agents specify Opus on purpose, because they
make judgment calls. `/batch` itself runs on Opus as the orchestrator, and the agents
`architect`, `ux-design`, `voc`, `threat-model`, `regression-check`, and `security-review`
are Opus by default (`/batch` runs `regression-check` and `security-review` on Sonnet). The `model:` line in a skill's or agent's frontmatter (`.claude/skills/`,
`.claude/agents/`) shows its choice, and the [Agents page](/reference/agents/) lists the
model for each agent.

**Yes, but:** it spawns many agents and spends real money. Start with a small wave.

**Use it when:** you have several independent, well-understood issues in one milestone.

---

## Release

### `/pre-release`

**What it does:** A cross-cutting audit of everything since the last release tag:
security, performance, regression, and documentation. Before launching it tells you how
many agents it will start (six for `full`) and estimates the token cost, and it forbids
those agents from starting more. Findings come back as blocking, important, or
informational.

**Why it matters:** Day-to-day reviews each see one branch. Only a whole-release view
catches problems that live *between* changes — and anything that's about to become a
public promise.

**Use it when:** at feature freeze, then once more before tagging. It's a one-time gate,
not a loop: re-running after every fix just finds new adjacent things forever. Run part of
it with `/pre-release security`, `performance`, or `docs`.

### `/mass-merge` ⛔

**What it does:** Lands a batch of already-green MRs without breaking `main`. It stacks
them on a local integration branch, re-runs the whole-repo checks after each one, then
merges only the safe prefix one at a time — updating each MR to the latest `main` the same
way GitLab will merge it.

**Why it matters:** Two MRs can each pass alone and break `main` together — for example,
each adds a few warnings under a "maximum N warnings" limit, and together they exceed it.
This catches that before it lands.

**Use it when:** several related MRs are green and you want to land them in one sitting.
It force-pushes and merges, so only you can start it.

**Yes, but:** it needs permission to run `glab mr merge`, and the template denies that by
default so an agent can never merge on its own. Without the permission, `/mass-merge`
still stacks the MRs and re-runs the checks, so it can tell you whether they conflict, but
it cannot land anything. To enable it, remove `Bash(glab mr merge:*)` from `deny` (a `deny` rule overrides an
`allow`) and allow `Bash(glab mr merge:*)` for your own sessions; `.claude/settings.local.json`
is git-ignored and a safe place for the allow rule. That is a personal decision. Don't
commit the allow rule or the removed `deny` entry, because that would change the default for
the whole team.

### `/release` ⛔

**What it does:** Suggests the next version from the changelog (patch, minor, or major),
runs pre-flight checks, assembles the changelog, bumps every version-bearing file, and
opens a release branch. You merge that MR, then tag and publish by hand.

**Why it matters:** Release day is when mistakes become public. A scripted, checked
release runs the same steps every time — including refusing a version that's already
published.

**Use it when:** after `/pre-release` comes back clean. See [Release workflow](/guides/release-workflow/).

---

## Keep the process healthy

These skills audit *the way you work*, not the code.

### `/kaizen`

**What it does:** Audits the development harness — CI, the review gates, pre-push, the MR
flow, the `CLAUDE.md` rules — for friction, and proposes a short, ranked list of speed
wins. It reads every MR's gate ledger to show which reviews actually find problems. It
reports and can file tooling issues; it never edits the harness itself.

**Why it matters:** Process only ever grows unless something measures it. A review that
hasn't found anything in 20 runs is costing time for nothing; `/kaizen` is how you notice.

**Use it when:** every few weeks, or whenever the workflow starts to feel slow.

### `/voc-audit` ⛔

**What it does:** Runs the persona panel against something that has **already shipped**,
checks every finding against the actual code, and sorts the survivors into "file new,"
"boost priority," or "already tracked." `--calibrate` compares what the panel predicted
with what real users later reported.

**Why it matters:** It closes the loop on `/voc`: was the simulated panel right? Without
calibration, a simulation's confidence never meets reality.

**Use it when:** after a user-facing feature ships, and again once real user reports
arrive.

### `/incident-postmortem`

**What it does:** Reconstructs one resolved process incident — a broken `main`, a check
that stayed green when it shouldn't have, lost work — from the git and CI trail. It
separates root cause from contributing factors, asks whether an existing gate should have
caught it, and writes the lesson into memory.

**Why it matters:** A lesson that stays in a chat transcript changes nothing. This one
lands where the next session will read it.

**Use it when:** right after an incident is resolved. (`/kaizen` is the periodic,
pattern-level counterpart.)

### `/tracker-hygiene`

**What it does:** Sweeps the issue tracker for drift: an issue with two `release::`
labels, an issue in a dated milestone with none, likely duplicates, and stale
"we intend to" issues with no milestone. It only reports — it never relabels or closes
anything.

**Why it matters:** A tracker that has drifted quietly misleads everyone planning from it.
Small, frequent sweeps prevent a painful rescue triage later.

**Use it when:** between milestone kickoffs, as often as you like — it's cheap.

### `/memory-audit` ⛔

**What it does:** Checks Claude Code's saved memory for this project. It looks for files
with no description (which recall can't find), files cramming in several facts, index
lines that are bare pointers, broken links, and claims about files or flags that no longer
exist. It reports first and applies only the safe fixes when you confirm.

**Why it matters:** Memory is only useful if the right note comes back at the right time.
A messy store returns the wrong notes — or none.

**Use it when:** at each release, or when Claude starts "remembering" things that are no
longer true.

---

## Go deeper

- **Skills vs. agents, and how to write your own:** [Agent architecture](/reference/agent-architecture/).
- **Which skills and agents run for which change:** [Development workflow](/guides/development-workflow/).
- **The source of truth for each skill:** `.claude/skills/<name>/SKILL.md`. Its front
  matter (`description:`, `argument-hint:`, `disable-model-invocation:`) is what Claude
  Code itself reads.
